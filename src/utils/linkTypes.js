function isOfficialNetboxUrl(value) {
  try {
    return /netbox/i.test(new URL(String(value || '')).hostname);
  } catch {
    return false;
  }
}

function getLinkType(link) {
  if (link?.whatsappLinks?.length) return 'whatsapp';
  if (link?.campaignId || link?.campaign) return 'campaign';
  if (isOfficialNetboxUrl(link?.originalUrl)) return 'official';
  return 'individual';
}

module.exports = { getLinkType };
