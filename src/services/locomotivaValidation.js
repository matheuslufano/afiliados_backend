const crypto = require("node:crypto");
const { defaults: mailDefaults, variables: mailVariables } = require("./locomotivaMailTemplates");

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
function instagram(link) {
  let url;
  try {
    url = new URL(link);
  } catch {
    fail("Informe o link completo do perfil do Instagram.");
  }
  const handle = url.pathname.replace(/^\//, "").replace(/\/$/, "").toLowerCase();
  if (
    url.protocol !== "https:" ||
    !["instagram.com", "www.instagram.com"].includes(url.hostname) ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^[a-z0-9_](?:[a-z0-9_.]{0,28}[a-z0-9_])?$/.test(handle) ||
    handle.includes("..") ||
    ["p", "reel", "reels", "stories", "explore", "accounts"].includes(handle)
  )
    fail("Informe um link válido de perfil do Instagram, como https://www.instagram.com/seuperfil/.");
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
function localTestEnabled() {
  if (!["development", undefined].includes(process.env.NODE_ENV) || process.env.LOCOMOTIVA_LOCAL_TEST !== "true") return false;
  try {
    return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL).hostname);
  } catch {
    return false;
  }
}
function localTestConfiguration(previous, dates) {
  key();
  const draft = configuration({ ...previous, dates, published: false });
  const notice = "Simulação local da Locomotiva. Use somente dados fictícios. Esta solicitação não é uma reserva real.";
  const times = draft.lunch.length || draft.dinner.length ? draft.lunch : ["11:30"];
  return {
    ...draft, lunch: times, minimumHours: 0, published: true, localTest: true,
    conditions: notice, imageTerm: notice, privacy: notice,
  };
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
    .filter((k) => {
      const value = String(config[k] || "");
      if (k === "imagePromotion" && value.trim() === "Anúncios pagos: Permitido conforme condições específicas") return true;
      return !(k === "contact" ? value.replace(/^(WhatsApp|Telefone|E-mail):/i, "") : value).trim();
    })
    .concat(config.lunch.length + config.dinner.length ? [] : ["arrivalTimes"])
    .concat(config.dates.length ? [] : ["dates"]);
}
function mailTemplate(event, subject, body) {
  if (!Object.hasOwn(mailDefaults, event)) fail("Selecione um modelo de e-mail válido.");
  const template = {
    [`messageSubject${event}`]: typeof subject === "string" ? subject.trim().slice(0, 160).replace(/[\r\n]+/g, " ") : "",
    [`message${event}`]: typeof body === "string" ? body.trim().slice(0, 4000) : "",
  };
  for (const value of Object.values(template)) {
    for (const [, token] of value.matchAll(/\{\{([^{}]+)\}\}/g)) {
      if (!mailVariables.includes(token)) fail("Há uma variável desconhecida no modelo de e-mail.");
    }
  }
  return template;
}

function configuration(body, { allowEmptyDates = false } = {}) {
  const c = { ...DEFAULT_CONFIG };
  for (const [field, limit] of Object.entries({ campaignName: 150, campaignDescription: 2000, restaurantName: 150 })) {
    if (typeof body[field] === "string" && body[field].trim()) c[field] = body[field].trim().slice(0, limit);
  }
  for (const event of Object.keys(mailDefaults)) {
    const template = mailTemplate(event, body[`messageSubject${event}`], body[`message${event}`]);
    for (const [key, value] of Object.entries(template)) if (value) c[key] = value;
  }
  if (body.voucherAmount !== undefined && body.voucherAmount !== "") {
    const amount = Number(body.voucherAmount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100000)
      fail("Informe um valor válido para o voucher.");
    c.voucherAmount = Number(amount.toFixed(2));
  }
  for (const k of mandatory)
    c[k] = typeof body[k] === "string" ? body[k].trim().slice(0, 30000) : "";
  if (!Array.isArray(body.dates))
    fail("Selecione as datas no calendário.");
  c.dates = [...new Set(body.dates)].sort();
  if ((!allowEmptyDates && !c.dates.length) || c.dates.some((date) => {
    if (typeof date !== "string" || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(date)) return true;
    const parsed = new Date(`${date}T00:00:00Z`);
    return !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date;
  }))
    fail("Selecione datas válidas no calendário.");
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
    if (!c.dates.some((date) => [...c.lunch, ...c.dinner].some((time) =>
      Date.parse(`${date}T${time}:00-03:00`) >= Date.now() + c.minimumHours * 3600000)))
      fail("Selecione pelo menos uma data futura que respeite a antecedência mínima.");
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
  return {
    name: required(body.name, "nome completo", 150),
    cpfCipher: encrypt(cpf),
    cpfHash: fingerprint(cpf),
    cpfLast: cpf.slice(-2),
    email,
    phone,
    city: required(body.city, "cidade", 100),
    uf: body.uf,
    ...instagram(body.profileUrl),
    photo: photo(body.photo),
    photoState: body.photo ? "MANUAL" : "UNAVAILABLE",
  };
}
module.exports = {
  mailTemplate,
  localTestEnabled,
  localTestConfiguration,
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
