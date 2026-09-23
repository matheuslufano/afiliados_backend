function stripTrailingSlash(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function firstHeaderValue(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  return String(raw || '').split(',')[0].trim();
}

function inferAppBaseUrl(req) {
  const protocol =
    firstHeaderValue(req?.headers?.['x-forwarded-proto']) ||
    req?.protocol ||
    'http';
  const host =
    firstHeaderValue(req?.headers?.['x-forwarded-host']) ||
    firstHeaderValue(req?.headers?.host) ||
    (typeof req?.get === 'function' ? req.get('host') : '');

  if (!host) {
    return '';
  }

  return stripTrailingSlash(`${protocol}://${host}`);
}

function publicAppBaseUrl(req) {
  const inferredUrl = inferAppBaseUrl(req);
  if (inferredUrl) {
    return inferredUrl;
  }

  return stripTrailingSlash(process.env.APP_URL);
}

function buildAffiliateUrl(req, shortCode) {
  return `${publicAppBaseUrl(req)}/r/${encodeURIComponent(shortCode)}`;
}

function buildWhatsappTrackingUrl(req, shortCode) {
  return `${publicAppBaseUrl(req)}/links/${encodeURIComponent(shortCode)}/whatsapp`;
}

function slugify(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'whatsapp';
}

function buildNamedWhatsappTrackingUrl(req, shortCode, name) {
  return `${publicAppBaseUrl(req)}/links/${encodeURIComponent(shortCode)}/whatsapp/${encodeURIComponent(slugify(name))}`;
}

function buildPublicLinkUrls(req, shortCode, whatsappName = '') {
  const affiliateUrl = buildAffiliateUrl(req, shortCode);
  const whatsappTrackingUrl = buildWhatsappTrackingUrl(req, shortCode);
  const whatsappNamedTrackingUrl = whatsappName
    ? buildNamedWhatsappTrackingUrl(req, shortCode, whatsappName)
    : whatsappTrackingUrl;
  return { affiliateUrl, whatsappTrackingUrl, whatsappNamedTrackingUrl };
}

function getDefaultLandingPageUrl() {
  return String(process.env.LANDING_PAGE_URL || '').trim();
}

function validateDestinationUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return { ok: false, error: 'URL de destino obrigatória.' };
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:') return { ok: false, error: 'A URL de destino deve usar HTTPS.' };
    if (!parsed.hostname) return { ok: false, error: 'A URL de destino deve possuir um domínio válido.' };
    return { ok: true, value: parsed.toString() };
  } catch {
    return { ok: false, error: 'Informe uma URL de destino válida.' };
  }
}

module.exports = {
  buildAffiliateUrl,
  buildPublicLinkUrls,
  buildNamedWhatsappTrackingUrl,
  buildWhatsappTrackingUrl,
  getDefaultLandingPageUrl,
  validateDestinationUrl,
  inferAppBaseUrl,
  publicAppBaseUrl,
  slugify
};
