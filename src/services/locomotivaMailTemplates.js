const defaults = {
  RECEIVED: {
    subject: "Recebemos sua solicitação | Locomotiva",
    body: "Olá, {{nome}}!\n\nRecebemos seu pedido de visita para {{data}} às {{horario}}. A equipe da Locomotiva vai analisar a solicitação e informar a decisão por e-mail.\n\nA visita ainda não está confirmada. Obrigado pelo interesse em participar!",
  },
  CONFIRMED: {
    subject: "Sua visita foi aprovada | Locomotiva",
    body: "Olá, {{nome}}!\n\nSua participação foi aprovada. Esperamos você em {{data}} às {{horario}}, no endereço {{endereco}}.\n\nO voucher de {{voucher}} é válido conforme as condições aceitas na inscrição. Se precisar alterar sua visita, use o contato da campanha.",
  },
  REJECTED: {
    subject: "Resposta à sua solicitação | Locomotiva",
    body: "Olá, {{nome}}!\n\nObrigado pelo interesse na campanha. Sua solicitação para {{data}} às {{horario}} não foi aprovada. A visita e o voucher não foram confirmados.\n\nAgradecemos sua compreensão.",
  },
  UPDATED: {
    subject: "Seu horário de visita foi atualizado | Locomotiva",
    body: "Olá, {{nome}}!\n\nA data ou o horário da sua visita foi atualizado para {{data}} às {{horario}}. O endereço é {{endereco}}.\n\nConfira a situação indicada nos dados da solicitação abaixo antes de comparecer.",
  },
  CANCELLED: {
    subject: "Sua visita foi cancelada | Locomotiva",
    body: "Olá, {{nome}}!\n\nA visita prevista para {{data}} às {{horario}} foi cancelada. O voucher associado a essa visita não poderá ser utilizado.\n\nSe tiver dúvidas, use o contato da campanha.",
  },
};

const variables = ["nome", "data", "horario", "endereco", "voucher", "link"];
const escapeHtml = (value) => value.replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char]);

function formattedEmail(subject, text) {
  const paragraphs = text.trim().split(/\r?\n[ \t]*\r?\n/).map((paragraph) =>
    `<p style="margin:0 0 16px;line-height:1.55">${escapeHtml(paragraph).replace(/\r?\n/g, "<br>")}</p>`,
  ).join("");
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f6efea;color:#2d2019;font-family:Arial,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#fff"><tr><td style="background:#9b441e;color:#fff;padding:20px 24px;font-size:21px;font-weight:bold">Locomotiva Restaurante</td></tr><tr><td style="padding:24px"><h1 style="font-size:22px;margin:0 0 18px">${escapeHtml(subject)}</h1>${paragraphs}</td></tr></table></td></tr></table></body></html>`;
}

module.exports = { defaults, variables, formattedEmail };
