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
const { defaults: mailTemplates } = require("../services/locomotivaMailTemplates");
const instagramPhoto = require("../services/locomotivaInstagramPhoto");
const router = express.Router();
const publicCampaign = (config) => Object.fromEntries(Object.entries(config).filter(([key]) => !key.startsWith("message")));
async function readRegistrationCpf(id, data, actor) {
  const cpf = v.decrypt(data.cpfCipher);
  await r.audit(r.prisma, id, actor, "CPF_READ", "Consulta restrita ao administrador");
  return cpf;
}
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
  if (v.localTestEnabled() && !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress))
    return res.status(403).json({ error: "O modo de teste aceita apenas conexões locais." });
  next();
});
router.post(
  "/locomotiva/profile",
  wrap(async (req, res) => {
    const profile = v.instagram(req.body.profileUrl);
    const image = await instagramPhoto.lookupPhoto(profile.instagram);
    res.json({
      ...profile,
      photo: image?.photo ?? null,
      source: image?.source ?? null,
      state: image ? "AVAILABLE" : "UNAVAILABLE",
    });
  }),
);
router.get(
  "/locomotiva/config",
  wrap(async (req, res) => {
    const c = await r.config();
    res.json({
      config: c.published ? publicCampaign(c) : { ...v.DEFAULT_CONFIG, revision: c.revision },
      availability: c.published ? await r.availability() : [],
    });
  }),
);
router.get(
  "/locomotiva/preview-config",
  wrap(async (req, res) => {
    const localAddresses = ["127.0.0.1", "::1", "::ffff:127.0.0.1"];
    if (
      !["development", undefined].includes(process.env.NODE_ENV) ||
      !localAddresses.includes(req.socket.remoteAddress)
    )
      return res.status(404).json({ error: "Not found." });

    const state = await r.settingsState();
    const { administration, ...published } = state;
    const config = administration?.draft || published;
    const existingAvailability = await r.availability();
    const bookedByDate = new Map(existingAvailability.map((day) => [day.date, day.bookedCount]));
    const now = Date.now();
    const dailyCapacity = config.dailyCapacity || 1;
    const availability = config.dates.map((date) => {
      const times = Object.fromEntries(
        ["lunch", "dinner"].map((period) => [
          period,
          (config[period] || []).filter((time) =>
            Date.parse(`${date}T${time}:00-03:00`) >= now,
          ),
        ]),
      );
      const bookedCount = bookedByDate.get(date) || 0;
      return {
        date,
        state: bookedCount >= dailyCapacity
          ? "FULL"
          : times.lunch.length || times.dinner.length
            ? "AVAILABLE"
            : "CLOSED",
        bookedCount,
        dailyCapacity,
        times,
      };
    });
    res.json({ config: publicCampaign(config), availability });
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
    if (!receipt.localTest) mail.drain().catch(() => {});
  }),
);
router.use("/admin/locomotiva", requireAuth, requireManager);
router.get(
  "/admin/locomotiva",
  wrap(async (req, res) => {
    const [state, availability, registrations, invites] = await Promise.all([
      r.settingsState(),
      r.availability(),
      r.prisma
        .$queryRaw`SELECT * FROM "LocomotivaRegistration" ORDER BY "createdAt" DESC`,
      r.prisma.$queryRaw`SELECT id,data FROM "LocomotivaInvite"`,
    ]);
    const { administration, ...c } = state;
    res.json({
      config: c.localTest && !v.localTestEnabled() ? { ...c, published: false } : c,
      localTestEnabled: v.localTestEnabled(),
      mailTemplates,
      settings: administration && {
        draft: administration.draft,
        version: administration.version,
        updatedAt: administration.updatedAt,
        reviews: administration.reviews,
        history: administration.history?.slice(-20).reverse().map(({ config, at, reviews }) => ({ revision: config.revision, at, reviews })),
      },
      missing: v.missing(administration?.draft || c),
      availability,
      registrations: registrations.map(r.safe),
      invites: invites.map((i) => ({ id: i.id, ...i.data })),
      canReadCpf: req.user.role === "ADMIN",
      mailConfigured: Boolean(
        process.env.LOCOMOTIVA_SMTP_URL && process.env.LOCOMOTIVA_MAIL_FROM,
      ),
      photoIntegration: instagramPhoto.isConfigured(),
    });
  }),
);
router.put(
  "/admin/locomotiva/config",
  wrap(async (req, res) => {
    const result = await r.transaction(async (tx) => {
      const { administration, ...live } = await r.settingsState(tx);
      const { operation, version, config, document } = req.body;
      if (version !== (administration?.version ?? 0))
        v.fail("A configuração mudou. Recarregue antes de salvar.", 409);
      const documents = ["conditions", "voucher", "imageTerm", "privacy"];
      const previous = administration?.draft || v.configuration({ ...live, published: false }, { allowEmptyDates: true });
      const publicRules = (value) => {
        const { approvedBy, ...rules } = v.configuration({ ...value, published: false }, { allowEmptyDates: true });
        return JSON.stringify(rules);
      };
      const updatedAt = new Date().toISOString();
      const editor = {
        draft: previous,
        reviews: { ...administration?.reviews },
        history: [...(administration?.history || [])],
        blockedDates: [...(administration?.blockedDates || [])],
        version: version + 1,
        updatedAt,
      };
      let published = live;
      if (operation === "save-mail-template") {
        const { event, subject, body } = req.body;
        const template = v.mailTemplate(event, subject, body);
        editor.draft = { ...previous, ...template };
        published = { ...live, ...template };
        await r.audit(tx, null, req.user.id, "MAIL_TEMPLATE", event);
      } else if (operation === "block-days") {
        const reason = v.required(req.body.reason, "motivo do bloqueio", 500);
        const requested = req.body.dates;
        if (!Array.isArray(requested) || !requested.length || requested.some((date) => !previous.dates.includes(date)))
          v.fail("Selecione datas disponíveis no rascunho.");
        const occupied = await tx.$queryRaw`SELECT date FROM "LocomotivaRegistration" WHERE status IN ('PENDING','CONFIRMED','ATTENDED','ABSENT')`;
        if (occupied.some(({ date }) => requested.includes(date))) v.fail("Há reservas afetadas. Atualize a agenda antes de bloquear.", 409);
        editor.draft = { ...previous, dates: previous.dates.filter((date) => !requested.includes(date)) };
        editor.blockedDates = [...new Set([...editor.blockedDates, ...requested])];
        for (const key of documents) if (editor.reviews[key]) editor.reviews[key] = { status: "draft", version: editor.version };
        await r.audit(tx, null, req.user.id, "BLOCK_DAYS", `${requested.join(", ")}; ${reason}`);
      } else if (operation === "save") {
        editor.draft = v.configuration({ ...config, published: false }, { allowEmptyDates: true });
        editor.blockedDates = editor.blockedDates.filter((date) => !editor.draft.dates.includes(date));
        if (publicRules(publicCampaign(editor.draft)) !== publicRules(publicCampaign(previous))) {
          for (const key of documents) {
            if (editor.reviews[key]) editor.reviews[key] = { status: "draft", version: editor.version };
          }
        }
      } else if (operation === "review" || operation === "approve") {
        if (!documents.includes(document) || !previous[document]?.trim())
          v.fail("Preencha e salve o documento antes de revisar.");
        if (operation === "approve" && (editor.reviews[document]?.status !== "review" ||
          !previous.approvedBy?.trim() || /rascunho|\bminuta\b|\bpendente de\b|\ba confirmar\b/i.test(previous[document])))
          v.fail("Confira o responsável, envie para revisão e retire as notas internas antes da aprovação.");
        editor.reviews[document] = operation === "approve"
          ? { status: "approved", version: editor.version, by: previous.approvedBy, actor: req.user.id, at: updatedAt }
          : { status: "review", version: editor.version };
      } else if (operation === "publish-local") {
        if (!v.localTestEnabled()) v.fail("A ativação de teste só está disponível no ambiente local.", 403);
        const next = v.localTestConfiguration(previous, req.body.dates);
        if (![...next.lunch, ...next.dinner].some((time) =>
          next.dates.some((date) => Date.parse(`${date}T${time}:00-03:00`) > Date.now())))
          v.fail("Escolha pelo menos uma data com horário futuro.");
        if (live.revision && !editor.history.some((entry) => entry.config.revision === live.revision))
          editor.history.push({ config: live });
        published = { ...next, revision: live.revision + 1 };
        editor.history.push({ config: published, at: updatedAt });
      } else if (operation === "publish") {
        const next = v.configuration({ ...previous, published: true });
        if (editor.blockedDates.length) {
          const occupied = await tx.$queryRaw`SELECT date FROM "LocomotivaRegistration" WHERE status IN ('PENDING','CONFIRMED','ATTENDED','ABSENT')`;
          if (occupied.some(({ date }) => editor.blockedDates.includes(date))) v.fail("Há reservas em datas bloqueadas no rascunho. Resolva os conflitos antes de publicar.", 409);
        }
        const changed = live.localTest || publicRules(publicCampaign(next)) !== publicRules(publicCampaign(live)) || live.revision === 0;
        published = { ...next, revision: changed ? live.revision + 1 : live.revision };
        if (changed || !editor.history.some((entry) => entry.config.revision === live.revision)) {
          if (live.revision && !editor.history.some((entry) => entry.config.revision === live.revision))
            editor.history.push({ config: live });
          if (published.revision !== live.revision || !live.revision)
            editor.history.push({ config: published, reviews: editor.reviews, at: updatedAt });
        }
      } else if (operation === "close") {
        published = { ...live, published: false };
      } else {
        v.fail("Selecione uma ação de configuração.");
      }
      const state = { ...published, administration: editor };
      await tx.$executeRaw`INSERT INTO "LocomotivaConfig" (id,data) VALUES (1,${JSON.stringify(state)}::jsonb) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`;
      await r.audit(tx, null, req.user.id, "CONFIG", `${operation}; edição ${editor.version}; versão pública ${published.revision}`);
      return { version: editor.version, revision: published.revision };
    });
    res.json(result);
  }),
);
router.post("/admin/locomotiva/mail/check", requireAuth, requireAdmin, wrap(async (req, res) => {
  if (v.localTestEnabled() || !process.env.LOCOMOTIVA_SMTP_URL || !process.env.LOCOMOTIVA_MAIL_FROM)
    v.fail("Envio não configurado para este ambiente.", 409);
  let verified = false;
  try { verified = await mail.verifyConnection(); } catch { /* Only expose the result, never the provider response. */ }
  await r.audit(r.prisma, null, req.user.id, "MAIL_CONNECTION_CHECK", verified ? "SMTP validado" : "SMTP não confirmado");
  if (!verified) v.fail("O provedor não confirmou a conexão de e-mail.", 502);
  res.json({ verified });
}));
router.post("/admin/locomotiva/mail/test", requireAuth, requireAdmin, wrap(async (req, res) => {
  if (v.localTestEnabled() || !process.env.LOCOMOTIVA_SMTP_URL || !process.env.LOCOMOTIVA_MAIL_FROM)
    v.fail("Envio não configurado para este ambiente.", 409);
  const recipient = v.required(req.body.recipient, "destinatário", 254);
  if (!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(recipient)) v.fail("Informe um único endereço de e-mail válido.");
  const subject = v.required(req.body.subject, "assunto", 500).replace(/[\r\n]+/g, " ");
  const text = v.required(req.body.text, "mensagem", 8000);
  const bucket = crypto.createHash("sha256").update(`mail-test:${req.user.id}:${Math.floor(Date.now()/900000)}`).digest("hex");
  await r.prisma.$executeRaw`DELETE FROM "LocomotivaRate" WHERE "expiresAt" < now()`;
  const [rate] = await r.prisma.$queryRaw`INSERT INTO "LocomotivaRate" (key,"expiresAt") VALUES (${bucket}, now() + interval '15 minutes') ON CONFLICT (key) DO UPDATE SET count = "LocomotivaRate".count + 1 RETURNING count`;
  if (rate.count > 3) v.fail("Limite de testes atingido. Tente novamente em alguns minutos.", 429);
  let accepted = false;
  try { accepted = await mail.sendTest({ recipient, subject, text }); } catch { /* Keep SMTP details private. */ }
  await r.audit(r.prisma, null, req.user.id, "MAIL_TEST", accepted ? "Aceito pelo provedor" : "Envio não confirmado");
  if (!accepted) v.fail("O provedor não confirmou o envio de teste.", 502);
  res.json({ accepted });
}));
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
    const cpfFull = req.user.role === "ADMIN"
      ? await readRegistrationCpf(row.id, row.data, req.user.id)
      : undefined;
    res.json({ ...r.safe(row), cpfFull, history, emails });
  }),
);
router.get(
  "/admin/locomotiva/registrations/:id/cpf",
  requireAdmin,
  wrap(async (req, res) => {
    const [row] = await r.prisma
      .$queryRaw`SELECT data FROM "LocomotivaRegistration" WHERE id = ${req.params.id}`;
    if (!row) v.fail("Inscrição não encontrada.", 404);
    res.json({ cpf: await readRegistrationCpf(req.params.id, row.data, req.user.id) });
  }),
);
router.delete(
  "/admin/locomotiva/registrations/:id",
  requireAdmin,
  wrap(async (req, res) => {
    await r.deleteRegistration(req.params.id, req.user.id);
    res.status(204).end();
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
