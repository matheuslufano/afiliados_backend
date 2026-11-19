const { prisma, audit } = require("./locomotivaRepository");
const nodemailer = require("nodemailer");
const { formattedEmail } = require("./locomotivaMailTemplates");
let running = false;
function transport() {
  return nodemailer.createTransport({
    url: process.env.LOCOMOTIVA_SMTP_URL,
    connectionTimeout: 10000,
    socketTimeout: 20000,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
}
function verifyConnection() {
  return transport().verify();
}
async function sendTest({ recipient, subject, text }) {
  const result = await transport().sendMail({ from: process.env.LOCOMOTIVA_MAIL_FROM, to: { name: "", address: recipient }, subject: `[Teste] ${subject}`, text, html: formattedEmail(subject, text) });
  return Boolean(result.accepted?.length);
}
/** Durable outbox: registration commits before any external mail operation. */
async function drain() {
  if (running) return;
  running = true;
  try {
    const rows =
      await prisma.$queryRaw`UPDATE "LocomotivaMail" SET state = 'SENDING', attempts = attempts + 1 WHERE id IN (SELECT id FROM "LocomotivaMail" WHERE state = 'PENDING' ORDER BY "createdAt" LIMIT 10 FOR UPDATE SKIP LOCKED) RETURNING *`;
    for (const row of rows) {
      try {
        await audit(
          prisma,
          row.registrationId,
          "mail-worker",
          "MAIL_ATTEMPT",
          `${row.id}; tentativa ${row.attempts}`,
        );
        if (
          !process.env.LOCOMOTIVA_SMTP_URL ||
          !process.env.LOCOMOTIVA_MAIL_FROM
        )
          throw new Error("NOT_CONFIGURED");
        const result = await transport().sendMail({
          from: process.env.LOCOMOTIVA_MAIL_FROM,
          ...row.payload,
          html: formattedEmail(row.payload.subject, row.payload.text),
          messageId: `<${row.id}@locomotiva.campaign>`,
        });
        if (!result.accepted?.length) throw new Error("NOT_ACCEPTED");
        await prisma.$executeRaw`UPDATE "LocomotivaMail" SET state = 'SENT', "sentAt" = now(), "lastError" = NULL WHERE id = ${row.id}`;
        await audit(
          prisma,
          row.registrationId,
          "mail-worker",
          "MAIL_SENT",
          `${row.id}; aceito pelo serviço, entrega não verificada`,
        );
      } catch {
        await prisma.$executeRaw`UPDATE "LocomotivaMail" SET state = 'FAILED', "lastError" = 'Serviço não confirmou o envio. Verifique a configuração e reenvie pelo painel.' WHERE id = ${row.id}`;
        await audit(
          prisma,
          row.registrationId,
          "mail-worker",
          "MAIL_FAILED",
          `${row.id}; tentativa ${row.attempts}`,
        );
      }
    }
  } finally {
    running = false;
  }
}
function start() {
  const timer = setInterval(() => {
    drain().catch(() => {});
  }, 30000);
  timer.unref();
}
module.exports = { drain, start, verifyConnection, sendTest };
