const crypto = require("node:crypto");

const DATES = Array.from({ length: 10 }, (_, i) => `2026-11-${21 + i}`);
const ACTIVE = ["PENDING", "CONFIRMED", "ATTENDED", "ABSENT"];
const DEFAULT_CONFIG = {
  published: false,
  revision: 0,
  dates: DATES,
  lunch: [],
  dinner: [],
  minimumHours: 24,
  address: "",
  contact: "",
  voucher: "",
  companions: "",
  excess: "",
  balance: "",
  cancellation: "",
  publication: "",
  tags: "",
  conditions: "",
  imageTerm: "",
  privacy: "",
  approvedBy: "",
  imageChannels: "",
  imagePurpose: "",
  imageDuration: "",
  imageEditing: "",
  imagePromotion: "",
};
function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}
function required(value, label, max = 1000) {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    fail(`Preencha ${label} corretamente.`);
  return value.trim();
}
function instagram(username, link) {
  const handle = required(username, "Instagram", 30)
    .replace(/^@/, "")
    .toLowerCase();
  if (
    !/^[a-z0-9_](?:[a-z0-9_.]{0,28}[a-z0-9_])?$/.test(handle) ||
    handle.includes("..")
  )
    fail("Usuário do Instagram inválido.");
  let url;
  try {
    url = new URL(link);
  } catch {
    fail("Informe o link completo do perfil do Instagram.");
  }
  if (
    url.protocol !== "https:" ||
    !["instagram.com", "www.instagram.com"].includes(url.hostname) ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname.replace(/\/$/, "").toLowerCase() !== `/${handle}` ||
    ["p", "reel", "reels", "stories", "explore", "accounts"].includes(handle)
  )
    fail("O link deve corresponder ao usuário informado no Instagram.");
  return {
    instagram: handle,
    profileUrl: `https://www.instagram.com/${handle}/`,
  };
}
function cpfValid(cpf) {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  return [9, 10].every((n) => {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += Number(cpf[i]) * (n + 1 - i);
    return Number(cpf[n]) === ((sum * 10) % 11) % 10;
  });
}
function key() {
  const raw = process.env.LOCOMOTIVA_DATA_KEY || "";
  if (!/^[a-f0-9]{64}$/i.test(raw))
    fail("Proteção dos dados ainda não configurada.", 503);
  return Buffer.from(raw, "hex");
}
function fingerprint(value) {
  return crypto.createHmac("sha256", key()).update(value).digest("hex");
}
function encrypt(value) {
  const iv = crypto.randomBytes(12),
    cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  return Buffer.concat([
    iv,
    cipher.update(value, "utf8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]).toString("base64");
}
function decrypt(value) {
  const b = Buffer.from(value, "base64"),
    decipher = crypto.createDecipheriv("aes-256-gcm", key(), b.subarray(0, 12));
  decipher.setAuthTag(b.subarray(-16));
  return Buffer.concat([
    decipher.update(b.subarray(12, -16)),
    decipher.final(),
  ]).toString("utf8");
}
function photo(value) {
  if (!value) return null;
  if (
    typeof value !== "string" ||
    value.length > 750000 ||
    !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(value)
  )
    fail("Envie uma foto PNG, JPEG ou WebP de até 500 KB.");
  const b = Buffer.from(value.split(",")[1], "base64");
  const valid =
    b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    (b[0] === 255 && b[1] === 216 && b[2] === 255) ||
    (b.toString("ascii", 0, 4) === "RIFF" &&
      b.toString("ascii", 8, 12) === "WEBP");
  if (!valid || b.length > 512000)
    fail("Arquivo de imagem inválido ou maior que 500 KB.");
  return value;
}
function visit(body, config, now = Date.now()) {
  if (
    !config.dates.includes(body.date) ||
    !["lunch", "dinner"].includes(body.period) ||
    !config[body.period].includes(body.time)
  )
    fail("Escolha uma data e um horário disponíveis.");
  if (
    new Date(`${body.date}T${body.time}:00-03:00`).getTime() <
    now + config.minimumHours * 3600000
  )
    fail("O prazo para solicitar este horário terminou.");
  if (!["STORIES", "REELS"].includes(body.modality))
    fail("Escolha a modalidade de conteúdo.");
}
const mandatory = [
  "address",
  "contact",
  "voucher",
  "companions",
  "excess",
  "balance",
  "cancellation",
  "publication",
  "tags",
  "conditions",
  "imageTerm",
  "privacy",
  "approvedBy",
  "imageChannels",
  "imagePurpose",
  "imageDuration",
  "imageEditing",
  "imagePromotion",
];
function missing(config) {
  return mandatory
    .filter((k) => !String(config[k] || "").trim())
    .concat(config.lunch.length + config.dinner.length ? [] : ["arrivalTimes"]);
}
function configuration(body) {
  const c = { ...DEFAULT_CONFIG };
  for (const k of mandatory)
    c[k] = typeof body[k] === "string" ? body[k].trim().slice(0, 30000) : "";
  c.dates = [...new Set(body.dates || [])];
  if (!c.dates.length || c.dates.some((d) => !DATES.includes(d)))
    fail("As datas devem estar entre 21 e 30/11/2026.");
  for (const period of ["lunch", "dinner"]) {
    c[period] = [...new Set(body[period] || [])].sort();
    if (
      c[period].some(
        (t) =>
          !/^\d{2}:\d{2}$/.test(t) ||
          Number(t.slice(3)) > 59 ||
          t < (period === "lunch" ? "11:00" : "18:00") ||
          t >= (period === "lunch" ? "15:00" : "23:00"),
      )
    )
      fail(
        "Horários de chegada devem ser anteriores ao encerramento do período.",
      );
  }
  c.minimumHours = Number(body.minimumHours);
  if (
    !Number.isFinite(c.minimumHours) ||
    c.minimumHours < 0 ||
    c.minimumHours > 720
  )
    fail("Antecedência inválida.");
  c.published = body.published === true;
  if (c.published && missing(c).length)
    fail(`Resolva as configurações pendentes: ${missing(c).join(", ")}.`);
  if (c.published) {
    key();
    if (!process.env.LOCOMOTIVA_SMTP_URL || !process.env.LOCOMOTIVA_MAIL_FROM)
      fail("Configure o serviço de e-mail antes da publicação.");
  }
  return c;
}
function participant(body) {
  const cpf = String(body.cpf || "").replace(/\D/g, "");
  if (!cpfValid(cpf)) fail("CPF inválido. Confira os dígitos.");
  const email = required(body.email, "e-mail", 254).toLowerCase();
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    email !==
      String(body.emailConfirmation || "")
        .trim()
        .toLowerCase()
  )
    fail("Os e-mails devem ser válidos e iguais.");
  const phone = String(body.phone || "").replace(/\D/g, "");
  if (!/^[1-9]\d{9,10}$/.test(phone)) fail("Informe WhatsApp com DDD.");
  if (
    !"AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO"
      .split(" ")
      .includes(body.uf)
  )
    fail("Selecione uma UF válida.");
  if (body.profileConfirmed !== true) fail("Confirme o perfil informado.");
  return {
    name: required(body.name, "nome completo", 150),
    cpfCipher: encrypt(cpf),
    cpfHash: fingerprint(cpf),
    cpfLast: cpf.slice(-2),
    email,
    phone,
    city: required(body.city, "cidade", 100),
    uf: body.uf,
    ...instagram(body.instagram, body.profileUrl),
    photo: photo(body.photo),
    photoState: body.photo ? "MANUAL" : "UNAVAILABLE",
    profileConfirmedAt: new Date().toISOString(),
  };
}
module.exports = {
  DATES,
  ACTIVE,
  DEFAULT_CONFIG,
  required,
  fail,
  instagram,
  cpfValid,
  fingerprint,
  encrypt,
  decrypt,
  visit,
  missing,
  configuration,
  participant,
  photo,
};
