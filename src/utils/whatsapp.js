const DEFAULT_WHATSAPP_NUMBER = '55008006022732';
const DEFAULT_WHATSAPP_MESSAGE = 'Tenho interesse no Plano Familia Netbox.';
const DEFAULT_IDENTIFICATION_TEMPLATE = 'Código do afiliado: {{codigo}}';

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
  return /^55[1-9]{2}9?\d{8}$/.test(phone);
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
  const original = String(message || '').trim();
  if (!appendAffiliateCode) return original;

  const values = {
    codigo: affiliateCode,
    afiliado: affiliateName,
    campanha: campaignName
  };
  const identification = String(template || DEFAULT_IDENTIFICATION_TEMPLATE)
    .replace(/{{\s*(codigo|afiliado|campanha)\s*}}/gi, (_, key) => values[key.toLowerCase()] || '')
    .trim();
  return [original, identification].filter(Boolean).join('\n\n');
}

function buildWhatsAppUrl(input, legacyPhone) {
  const options = typeof input === 'object' && input !== null
    ? input
    : { message: input, phone: legacyPhone };
  const text =
    options.message ||
    process.env.WHATSAPP_MESSAGE ||
    DEFAULT_WHATSAPP_MESSAGE;
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
  normalizePhoneNumber
};
