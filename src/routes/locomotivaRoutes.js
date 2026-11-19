const express = require("express");
const crypto = require("node:crypto");
const path = require("node:path");
const {
  requireAuth,
  requireManager,
  requireAdmin,
} = require("../middleware/auth");
const r = require("../services/locomotivaRepository");
const v = require("../services/locomotivaValidation");
const mail = require("../services/locomotivaMail");
const router = express.Router();
const wrap = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (e) {
    if (e.code === "P2010" && e.meta?.code === "42P01") {
      return res.status(503).json({
        error: "A campanha ainda está sendo preparada. Tente novamente mais tarde.",
        code: "CAMPAIGN_SCHEMA_UNAVAILABLE",
      });
    }
    res
      .status(
        e.status ||
          (e.code === "P2010" && e.meta?.code === "23505" ? 409 : 500),
      )
      .json({
        error: e.status
          ? e.message
          : "Não foi possível concluir a operação. Atualize os dados e tente novamente.",
      });
  }
};
router.use(["/locomotiva", "/admin/locomotiva"], (req, res, next) => {
  res.set("Cache-Control", "no-store");
  res.set("Referrer-Policy", "no-referrer");
  next();
});
// No URL fetching: the current installation has no authorized Instagram photo provider.
router.post(
  "/locomotiva/profile",
  wrap(async (req, res) => {
    res.json({
      ...v.instagram(req.body.instagram, req.body.profileUrl),
      photo: null,
      source: null,
      state: "UNAVAILABLE",
    });
  }),
);
router.get(
  "/locomotiva/config",
  wrap(async (req, res) => {
    const c = await r.config();
    res.json({
      config: c.published ? c : { ...v.DEFAULT_CONFIG, revision: c.revision },
      availability: c.published ? await r.availability() : [],
    });
  }),
);
router.post(
  "/locomotiva/registrations",
  wrap(async (req, res) => {
    // Hash socket address, never trust arbitrary X-Forwarded-For in the existing global proxy setting.
    const bucket = crypto
      .createHash("sha256")
      .update(`${req.socket.remoteAddress}:${Math.floor(Date.now() / 900000)}`)
      .digest("hex");
    await r.prisma
      .$executeRaw`DELETE FROM "LocomotivaRate" WHERE "expiresAt" < now()`;
    const [rate] = await r.prisma
      .$queryRaw`INSERT INTO "LocomotivaRate" (key,"expiresAt") VALUES (${bucket}, now() + interval '15 minutes') ON CONFLICT (key) DO UPDATE SET count = "LocomotivaRate".count + 1 RETURNING count`;
    if (rate.count > 30)
      v.fail(
        "Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.",
        429,
      );
    const receipt = await r.submit(req.body);
    res.status(201).json(receipt);
    mail.drain().catch(() => {});
  }),
);
router.use("/admin/locomotiva", requireAuth, requireManager);
router.get(
  "/admin/locomotiva",
  wrap(async (req, res) => {
    const [c, availability, registrations, invites] = await Promise.all([
      r.config(),
      r.availability(),
      r.prisma
        .$queryRaw`SELECT * FROM "LocomotivaRegistration" ORDER BY "createdAt" DESC`,
      r.prisma.$queryRaw`SELECT id,data FROM "LocomotivaInvite"`,
    ]);
    res.json({
      config: c,
      missing: v.missing(c),
      availability,
      registrations: registrations.map(r.safe),
      invites: invites.map((i) => ({ id: i.id, ...i.data })),
      canReadCpf: req.user.role === "ADMIN",
      mailConfigured: Boolean(
        process.env.LOCOMOTIVA_SMTP_URL && process.env.LOCOMOTIVA_MAIL_FROM,
      ),
      photoIntegration: false,
    });
  }),
);
router.put(
  "/admin/locomotiva/config",
  wrap(async (req, res) => {
    const result = await r.transaction(async (tx) => {
      const old = await r.config(tx);
      if (req.body.revision !== old.revision)
        v.fail("A configuração mudou. Recarregue antes de salvar.", 409);
      const c = { ...v.configuration(req.body), revision: old.revision + 1 };
      await tx.$executeRaw`INSERT INTO "LocomotivaConfig" (id,data) VALUES (1,${JSON.stringify(c)}::jsonb) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`;
      await r.audit(
        tx,
        null,
        req.user.id,
        "CONFIG",
        `Versão ${c.revision}; ${c.published ? "publicada" : "fechada"}; aprovação declarada: ${c.approvedBy}`,
      );
      return c;
    });
    res.json(result);
  }),
);
router.get(
  "/admin/locomotiva/registrations/:id",
  wrap(async (req, res) => {
    const [row] = await r.prisma
      .$queryRaw`SELECT * FROM "LocomotivaRegistration" WHERE id = ${req.params.id}`;
    if (!row) v.fail("Inscrição não encontrada.", 404);
    const history = await r.prisma
      .$queryRaw`SELECT * FROM "LocomotivaAudit" WHERE "registrationId" = ${row.id} ORDER BY at`;
    const emails = await r.prisma
      .$queryRaw`SELECT id,kind,state,attempts,"lastError","sentAt","createdAt" FROM "LocomotivaMail" WHERE "registrationId" = ${row.id} ORDER BY "createdAt"`;
    res.json({ ...r.safe(row), history, emails });
  }),
);
router.get(
  "/admin/locomotiva/registrations/:id/cpf",
  requireAdmin,
  wrap(async (req, res) => {
    const [row] = await r.prisma
      .$queryRaw`SELECT data FROM "LocomotivaRegistration" WHERE id = ${req.params.id}`;
    if (!row) v.fail("Inscrição não encontrada.", 404);
    await r.audit(
      r.prisma,
      req.params.id,
      req.user.id,
      "CPF_READ",
      "Consulta restrita ao administrador",
    );
    res.json({ cpf: v.decrypt(row.data.cpfCipher) });
  }),
);
router.put(
  "/admin/locomotiva/registrations/:id",
  wrap(async (req, res) => {
    res.json(await r.update(req.params.id, req.body, req.user.id));
    mail.drain().catch(() => {});
  }),
);
router.post(
  "/admin/locomotiva/mail/:id/retry",
  wrap(async (req, res) => {
    await r.transaction(async (tx) => {
      const [row] =
        await tx.$queryRaw`SELECT * FROM "LocomotivaMail" WHERE id = ${req.params.id}`;
      if (!row) v.fail("E-mail não encontrado.", 404);
      if (!["FAILED", "SENT", "SENDING"].includes(row.state))
        v.fail("O envio já está na fila.", 409);
      if (
        row.state === "SENDING" &&
        Date.now() - new Date(row.createdAt).getTime() < 300000
      )
        v.fail("Envio em processamento. Aguarde.", 409);
      const [current] =
        await tx.$queryRaw`SELECT status,date,data FROM "LocomotivaRegistration" WHERE id = ${row.registrationId}`;
      if (row.kind === "CONFIRMED" && current.status !== "CONFIRMED")
        v.fail("A confirmação antiga não pode ser reenviada nesta situação.");
      const [latest] =
        await tx.$queryRaw`SELECT id FROM "LocomotivaMail" WHERE "registrationId" = ${row.registrationId} ORDER BY "createdAt" DESC LIMIT 1`;
      if (latest.id !== row.id)
        v.fail("Reenvie somente a comunicação mais recente.");
      await tx.$executeRaw`UPDATE "LocomotivaMail" SET state = 'PENDING' WHERE id = ${row.id}`;
      await r.audit(
        tx,
        row.registrationId,
        req.user.id,
        "MAIL_RETRY",
        "Reenvio autorizado",
      );
    });
    res.json({ ok: true });
    mail.drain().catch(() => {});
  }),
);
router.post(
  "/admin/locomotiva/invites",
  wrap(async (req, res) => {
    const token = crypto.randomBytes(32).toString("base64url");
    const data = {
      name: v.required(req.body.name, "nome do convidado", 150),
      instagram: v.required(req.body.instagram, "perfil", 30),
      state: "REGISTERED",
      createdAt: new Date().toISOString(),
      expiresAt: "2026-12-01T03:00:00.000Z",
      createdBy: req.user.id,
    };
    const inviteId = r.id();
    await r.prisma
      .$executeRaw`INSERT INTO "LocomotivaInvite" (id,"tokenHash",data) VALUES (${inviteId},${v.fingerprint(token)},${JSON.stringify(data)}::jsonb)`;
    res.status(201).json({ id: inviteId, token });
  }),
);
router.post(
  "/admin/locomotiva/invites/:id/sent",
  wrap(async (req, res) => {
    const updated = await r.prisma
      .$executeRaw`UPDATE "LocomotivaInvite" SET data = data || ${JSON.stringify({ state: "SENT", sentAt: new Date().toISOString(), sentBy: req.user.id })}::jsonb WHERE id = ${req.params.id}`;
    if (!updated) v.fail("Convite não encontrado.", 404);
    res.json({ ok: true });
  }),
);
// Public source remains in the requested sibling folder; deploy it alongside the backend.
router.use(
  "/campanha-locomotiva",
  express.static(
    process.env.LOCOMOTIVA_PUBLIC_DIR ||
      path.resolve(__dirname, "../../../locomotiva-reseva"),
    { index: "index.html", dotfiles: "deny" },
  ),
);
module.exports = router;
