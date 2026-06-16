const DEFAULT_WHATSAPP_NUMBER = '55008006022732';
const DEFAULT_WHATSAPP_MESSAGE = 'Tenho interesse no Plano Familia Netbox.';

function normalizePhoneNumber(value) {
  return String(value || '').replace(/\D/g, '');
}

function buildWhatsAppUrl(message) {
  const text =
    message ||
    process.env.WHATSAPP_MESSAGE ||
    DEFAULT_WHATSAPP_MESSAGE;

  if (process.env.WHATSAPP_URL) {
    try {
      const url = new URL(process.env.WHATSAPP_URL);
      url.searchParams.set('text', text);
      return url.toString();
    } catch {
      // Fall back to WHATSAPP_NUMBER when WHATSAPP_URL is malformed.
    }
  }

  const phone = normalizePhoneNumber(
    process.env.WHATSAPP_NUMBER || DEFAULT_WHATSAPP_NUMBER
  );

  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}

module.exports = {
  DEFAULT_WHATSAPP_MESSAGE,
  buildWhatsAppUrl
};
