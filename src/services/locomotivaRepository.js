const crypto = require("node:crypto");
const prisma = require("../database/prisma");
const v = require("./locomotivaValidation");
const id = () => crypto.randomUUID();
// One campaign-wide transaction lock serializes configuration and reservation decisions.
// Partial unique database indexes remain the final protection against concurrent writers.
async function transaction(fn) {
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(2026111721)::text`;
      return fn(tx);
    },
    { timeout: 15000 },
  );
}
async function config(tx = prisma) {
  const rows =
    await tx.$queryRaw`SELECT data FROM "LocomotivaConfig" WHERE id = 1`;
  return rows[0]?.data || structuredClone(v.DEFAULT_CONFIG);
}
async function audit(tx, registrationId, actor, action, reason) {
  await tx.$executeRaw`INSERT INTO "LocomotivaAudit" (id,"registrationId",actor,action,reason) VALUES (${id()},${registrationId},${String(actor)},${action},${reason})`;
}
async function availability(tx = prisma) {
  const c = await config(tx),
    rows =
      await tx.$queryRaw`SELECT date,status FROM "LocomotivaRegistration" WHERE status IN ('PENDING','CONFIRMED','ATTENDED','ABSENT')`;
  return v.DATES.map((date) => {
    const row = rows.find((r) => r.date === date);
    const times = Object.fromEntries(
      ["lunch", "dinner"].map((p) => [
        p,
        c[p].filter(
          (t) =>
            new Date(`${date}T${t}:00-03:00`).getTime() >=
            Date.now() + c.minimumHours * 3600000,
        ),
      ]),
    );
    return {
      date,
      state:
        row?.status ||
        (c.dates.includes(date) && (times.lunch.length || times.dinner.length)
          ? "AVAILABLE"
          : "CLOSED"),
      times,
    };
  });
}
async function queue(tx, registration, c, kind) {
  await tx.$executeRaw`UPDATE "LocomotivaMail" SET state = 'SUPERSEDED' WHERE "registrationId" = ${registration.id} AND state IN ('PENDING','FAILED')`;
  const d = registration.data;
  const title = {
    RECEIVED: "Solicitação recebida — em análise",
    CONFIRMED: "Participação aprovada pela Locomotiva",
    UPDATED: "Atualização da visita Locomotiva",
    REJECTED: "Solicitação recusada",
    CANCELLED: "Participação cancelada",
  }[kind];
  const text = `${title}\nProtocolo: ${registration.id}\nData: ${registration.date} às ${d.time}\n${kind === "RECEIVED" ? "Sua participação está em análise. A visita somente estará confirmada após aprovação expressa do restaurante, enviada por e-mail." : `Situação: ${registration.status}`}\nEndereço: ${c.address}\nVoucher de R$ 200: ${c.voucher}\nAcompanhantes: ${c.companions}\nExcedente: ${c.excess}\nSaldo restante: ${c.balance}\nConteúdo: ${d.modality === "STORIES" ? "4 Stories" : "1 Reels de 60 segundos"}\nPublicação: ${c.publication}\nMarcação: ${c.tags}\nCancelamento: ${c.cancellation}\nContato: ${c.contact}`;
  await tx.$executeRaw`INSERT INTO "LocomotivaMail" (id,"registrationId",kind,payload) VALUES (${id()},${registration.id},${kind},${JSON.stringify({ to: d.email, subject: title, text })}::jsonb)`;
}
async function submit(body) {
  if (!/^[a-f0-9-]{36}$/.test(body.requestKey || ""))
    v.fail("Identificador da solicitação inválido.");
  if (body.website) v.fail("Solicitação inválida.");
  const hash = v.fingerprint(JSON.stringify(body));
  return transaction(async (tx) => {
    const previous =
      await tx.$queryRaw`SELECT id,"requestHash",date,data FROM "LocomotivaRegistration" WHERE "requestKey" = ${body.requestKey}`;
    if (previous.length) {
      if (previous[0].requestHash !== hash)
        v.fail("Esta chave já foi usada. Atualize a solicitação.", 409);
      return receipt(previous[0]);
    }
    const c = await config(tx);
    if (!c.published) v.fail("As inscrições ainda não estão abertas.", 409);
    if (body.revision !== c.revision)
      v.fail(
        "Os documentos foram atualizados. Leia e aceite a nova versão.",
        412,
      );
    if (
      !["conditions", "image", "privacy"].every(
        (k) => body.acceptances?.[k] === true,
      )
    )
      v.fail("Leia e aceite os três documentos antes de continuar.");
    v.visit(body, c);
    const person = v.participant(body);
    const occupied =
      await tx.$queryRaw`SELECT id FROM "LocomotivaRegistration" WHERE status IN ('PENDING','CONFIRMED','ATTENDED','ABSENT') AND (date = ${body.date} OR "cpfHash" = ${person.cpfHash} OR instagram = ${person.instagram} OR email = ${person.email})`;
    if (occupied.length)
      v.fail(
        "A data foi ocupada ou já existe uma inscrição ativa com os dados informados. Escolha outra data ou contate a equipe.",
        409,
      );
    let inviteId = null;
    if (body.inviteToken) {
      const invites =
        await tx.$queryRaw`SELECT id,data FROM "LocomotivaInvite" WHERE "tokenHash" = ${v.fingerprint(body.inviteToken)}`;
      if (
        !invites.length ||
        invites[0].data.revoked ||
        invites[0].data.expiresAt < new Date().toISOString()
      )
        v.fail("Convite inválido ou expirado.");
      inviteId = invites[0].id;
    }
    const data = {
      ...person,
      date: body.date,
      time: body.time,
      period: body.period,
      modality: body.modality,
      inviteId,
      acceptance: {
        revision: c.revision,
        at: new Date().toISOString(),
        conditions: c.conditions,
        imageTerm: c.imageTerm,
        privacy: c.privacy,
        terms: c,
        controls: body.acceptances,
      },
      photoSource: person.photo ? "PARTICIPANT_UPLOAD" : null,
      content: { links: [], checked: false, notes: "" },
      notes: "",
      revision: 1,
    };
    const record = { id: id(), date: body.date, status: "PENDING", data };
    await tx.$executeRaw`INSERT INTO "LocomotivaRegistration" (id,"requestKey","requestHash",date,status,"cpfHash",instagram,email,data) VALUES (${record.id},${body.requestKey},${hash},${body.date},'PENDING',${person.cpfHash},${person.instagram},${person.email},${JSON.stringify(data)}::jsonb)`;
    await audit(
      tx,
      record.id,
      "participant",
      "PENDING",
      "Solicitação e aceites recebidos",
    );
    await queue(tx, record, c, "RECEIVED");
    return receipt(record);
  });
}
function receipt(r) {
  return {
    protocol: r.id,
    date: r.date,
    time: r.data.time,
    email: r.data.email,
  };
}
function safe(r) {
  const { cpfCipher, cpfHash, ...data } = r.data;
  return {
    id: r.id,
    date: r.date,
    status: r.status,
    createdAt: r.createdAt,
    ...data,
    cpf: `***.***.***-${data.cpfLast}`,
  };
}
async function update(registrationId, body, actor) {
  return transaction(async (tx) => {
    const [r] =
      await tx.$queryRaw`SELECT * FROM "LocomotivaRegistration" WHERE id = ${registrationId}`;
    if (!r) v.fail("Inscrição não encontrada.", 404);
    if (body.revision !== r.data.revision)
      v.fail("O cadastro mudou. Reabra os detalhes antes de salvar.", 409);
    const reason = v.required(body.reason, "motivo da alteração", 2000),
      c = await config(tx);
    const transitions = {
      PENDING: ["CONFIRMED", "REJECTED", "CANCELLED"],
      CONFIRMED: ["CANCELLED", "ATTENDED", "ABSENT"],
      REJECTED: [],
      CANCELLED: [],
      ATTENDED: [],
      ABSENT: [],
    };
    const status = body.status || r.status;
    if (status !== r.status && !transitions[r.status].includes(status))
      v.fail("Mudança de situação não permitida.");
    if (
      ["ATTENDED", "ABSENT"].includes(status) &&
      new Date(`${r.date}T${r.data.time}:00-03:00`) > new Date()
    )
      v.fail("Registre presença somente após o horário da visita.");
    const changedVisit =
      body.date !== r.date ||
      body.time !== r.data.time ||
      body.period !== r.data.period;
    const data = {
      ...r.data,
      notes: String(body.notes || "").slice(0, 10000),
      revision: r.data.revision + 1,
    };
    if (changedVisit) {
      if (!["PENDING", "CONFIRMED"].includes(status))
        v.fail(
          "Somente reservas em análise ou confirmadas podem mudar de data.",
        );
      v.visit({ ...body, modality: data.modality }, c);
      const conflicts =
        await tx.$queryRaw`SELECT id FROM "LocomotivaRegistration" WHERE date = ${body.date} AND id <> ${r.id} AND status IN ('PENDING','CONFIRMED','ATTENDED','ABSENT')`;
      if (conflicts.length) v.fail("Esta data já está ocupada.", 409);
      data.date = body.date;
      data.time = body.time;
      data.period = body.period;
    }
    if (body.content) {
      const links = body.content.links;
      if (!Array.isArray(links) || links.length > 20)
        v.fail("Lista de publicações inválida.");
      for (const link of links) {
        let u;
        try {
          u = new URL(link);
        } catch {
          v.fail("Link de publicação inválido.");
        }
        if (
          u.protocol !== "https:" ||
          !["instagram.com", "www.instagram.com"].includes(u.hostname) ||
          u.username ||
          u.password ||
          u.port
        )
          v.fail("Informe links HTTPS do Instagram.");
      }
      data.content = {
        links,
        checked: body.content.checked === true,
        notes: String(body.content.notes || "").slice(0, 5000),
        reviewedBy: actor,
        reviewedAt: new Date().toISOString(),
      };
      if (
        data.content.checked &&
        links.length < (data.modality === "STORIES" ? 4 : 1)
      )
        v.fail(
          "Inclua os links de todas as publicações antes de conferir a entrega.",
        );
    }
    await tx.$executeRaw`UPDATE "LocomotivaRegistration" SET status = ${status}, date = ${data.date}, data = ${JSON.stringify(data)}::jsonb WHERE id = ${r.id}`;
    await audit(
      tx,
      r.id,
      actor,
      `${r.status} → ${status}${changedVisit ? `; ${r.date} ${r.data.time} → ${data.date} ${data.time}` : ""}`,
      reason,
    );
    const kind =
      status !== r.status &&
      ["CONFIRMED", "REJECTED", "CANCELLED"].includes(status)
        ? status
        : changedVisit
          ? "UPDATED"
          : null;
    if (kind) await queue(tx, { ...r, status, date: data.date, data }, c, kind);
    return { ok: true };
  });
}
module.exports = {
  prisma,
  id,
  transaction,
  config,
  audit,
  availability,
  submit,
  safe,
  update,
};
