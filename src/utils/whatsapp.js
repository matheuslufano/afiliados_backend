const DEFAULT_WHATSAPP_NUMBER = '55008006022732';
const DEFAULT_WHATSAPP_MESSAGE = 'Olá! \u{1F44B}\n\nGostaria de conhecer os planos da Netbox.\n\nPode me enviar mais informações?';
const DEFAULT_IDENTIFICATION_TEMPLATE = '*Identificação do atendimento*\n• Afiliado: {{afiliado}}\n• Código: {{codigo}}';

const WAVING_HAND_EMOJI = '\u{1F44B}';
const WINDOWS_1252_BYTES = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84,
  0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88,
  0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c,
  0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93,
  0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b,
  0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f
};

function decodeMojibakeSequence(sequence) {
  const bytes = Array.from(sequence, (character) => {
    const codePoint = character.codePointAt(0) || 0;
    return codePoint <= 0xff ? codePoint : WINDOWS_1252_BYTES[codePoint];
  });
  if (bytes.some((byte) => byte === undefined)) return sequence;

  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes));
    return /\p{Extended_Pictographic}/u.test(decoded) ? decoded : sequence;
  } catch {
    return sequence;
  }
}

function repairWhatsAppEmoji(value) {
  return String(value || '')
    .replace(/\u00f0[\s\S]{3}/g, decodeMojibakeSequence)
    .replace(/\u00e2[\s\S]{2}/g, decodeMojibakeSequence)
    .replace(/(ol[aá]!\s*)\uFFFD/giu, `$1${WAVING_HAND_EMOJI}`);
}

function normalizeWhatsAppText(value) {
  return repairWhatsAppEmoji(value)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizePhoneNumber(value) {
  let phone = String(value || '').replace(/\D/g, '');
  if (phone.startsWith('55') && (phone.length === 12 || phone.length === 13)) {
    return phone;
  }
  if (phone.length === 10 || phone.length === 11) {
    return `55${phone}`;
  }
  return phone;
}

function isValidWhatsAppPhone(value) {
  const phone = normalizePhoneNumber(value);
  // Accept regular Brazilian mobile/landline numbers and toll-free 0800/800
  // destinations used by WhatsApp business contacts.
  return /^55(?:[1-9]{2}9?\d{8}|0?800\d{7,8})$/.test(phone);
}

function configuredWhatsAppNumber() {
  const fromNumber = process.env.WHATSAPP_NUMBER;
  let candidate = fromNumber;
  if (!candidate && process.env.WHATSAPP_URL) {
    try {
      candidate = new URL(process.env.WHATSAPP_URL).searchParams.get('phone');
    } catch {
      candidate = '';
    }
  }
  return isValidWhatsAppPhone(candidate) ? normalizePhoneNumber(candidate) : null;
}

function buildWhatsAppMessage({
  message = '',
  affiliateCode = '',
  affiliateName = '',
  campaignName = '',
  template = DEFAULT_IDENTIFICATION_TEMPLATE,
  appendAffiliateCode = true
} = {}) {
  const original = normalizeWhatsAppText(message);
  if (!appendAffiliateCode) return original;

  const values = {
    codigo: affiliateCode,
    afiliado: affiliateName,
    campanha: campaignName
  };
  const identification = normalizeWhatsAppText(template || DEFAULT_IDENTIFICATION_TEMPLATE)
    .replace(/{{\s*(codigo|afiliado|campanha)\s*}}/gi, (_, key) => values[key.toLowerCase()] || '')
    .trim();
  return [original, identification].filter(Boolean).join('\n\n');
}

function buildWhatsAppUrl(input, legacyPhone) {
  const options = typeof input === 'object' && input !== null
    ? input
    : { message: input, phone: legacyPhone };
  const text = normalizeWhatsAppText(
    options.message ||
    process.env.WHATSAPP_MESSAGE ||
    DEFAULT_WHATSAPP_MESSAGE
  );
  const phone = normalizePhoneNumber(
    options.phone ||
    configuredWhatsAppNumber() ||
    process.env.WHATSAPP_NUMBER ||
    DEFAULT_WHATSAPP_NUMBER
  );

  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}

module.exports = {
  DEFAULT_IDENTIFICATION_TEMPLATE,
  DEFAULT_WHATSAPP_MESSAGE,
  buildWhatsAppMessage,
  buildWhatsAppUrl,
  configuredWhatsAppNumber,
  isValidWhatsAppPhone,
  repairWhatsAppEmoji,
  normalizeWhatsAppText,
  normalizePhoneNumber
};
