function optionalText(value, maxLength = 500) {
  const text = Array.isArray(value) ? value[0] : value;
  const normalized = String(text || '').trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function firstValue(req, keys) {
  for (const key of keys) {
    const value = req.query?.[key] ?? req.body?.[key] ?? req.headers?.[key.toLowerCase()];

    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }

  return null;
}

function normalizeIp(value) {
  const ip = optionalText(value, 120);

  if (!ip) {
    return null;
  }

  return ip.split(',')[0].trim() || ip;
}

function getClientIp(req) {
  return normalizeIp(
    req.headers['cf-connecting-ip'] ||
      req.headers['x-real-ip'] ||
      req.headers['x-forwarded-for'] ||
      req.ip
  );
}

function parseDeviceType(userAgent) {
  const ua = String(userAgent || '').toLowerCase();

  if (/ipad|tablet|kindle|silk|playbook/.test(ua)) {
    return 'tablet';
  }

  if (/mobi|android|iphone|ipod|windows phone/.test(ua)) {
    return 'mobile';
  }

  if (ua) {
    return 'desktop';
  }

  return null;
}

function parseBrowser(userAgent) {
  const ua = String(userAgent || '');

  if (/Edg\//.test(ua)) return 'Edge';
  if (/OPR\//.test(ua)) return 'Opera';
  if (/CriOS|Chrome\//.test(ua)) return 'Chrome';
  if (/FxiOS|Firefox\//.test(ua)) return 'Firefox';
  if (/Safari\//.test(ua) && /Version\//.test(ua)) return 'Safari';
  if (/SamsungBrowser\//.test(ua)) return 'Samsung Internet';

  return ua ? 'Outro' : null;
}

function parseOperatingSystem(userAgent) {
  const ua = String(userAgent || '');

  if (/Android/i.test(ua)) return 'Android';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS';
  if (/Windows NT/i.test(ua)) return 'Windows';
  if (/Mac OS X/i.test(ua)) return 'macOS';
  if (/Linux/i.test(ua)) return 'Linux';

  return ua ? 'Outro' : null;
}

function collectVisitorTrackingData(req) {
  const userAgent = optionalText(req.headers['user-agent'], 1000);
  const referrer = optionalText(req.headers.referer || req.headers.referrer, 1000);
  const screenWidth = Number(firstValue(req, ['screenWidth', 'screen_width', 'sw']));
  const screenHeight = Number(firstValue(req, ['screenHeight', 'screen_height', 'sh']));

  return {
    ipAddress: getClientIp(req),
    userAgent,
    referrer,
    utmSource: optionalText(firstValue(req, ['utm_source', 'utmSource']), 120),
    utmMedium: optionalText(firstValue(req, ['utm_medium', 'utmMedium']), 120),
    utmCampaign: optionalText(firstValue(req, ['utm_campaign', 'utmCampaign']), 160),
    utmTerm: optionalText(firstValue(req, ['utm_term', 'utmTerm']), 160),
    utmContent: optionalText(firstValue(req, ['utm_content', 'utmContent']), 160),
    source: optionalText(firstValue(req, ['source', 'origem', 'utm_source', 'utmSource']), 160),
    deviceType: optionalText(
      firstValue(req, ['deviceType', 'device_type']) || parseDeviceType(userAgent),
      80
    ),
    browser: optionalText(
      firstValue(req, ['browser']) || parseBrowser(userAgent),
      120
    ),
    operatingSystem: optionalText(
      firstValue(req, ['os', 'operatingSystem', 'operating_system']) ||
        parseOperatingSystem(userAgent),
      120
    ),
    platform: optionalText(
      firstValue(req, ['platform']) || req.headers['sec-ch-ua-platform'],
      120
    ),
    language: optionalText(
      firstValue(req, ['language', 'lang']) || req.headers['accept-language'],
      250
    ),
    geoCountry: optionalText(
      firstValue(req, ['geoCountry', 'country']) ||
        req.headers['x-vercel-ip-country'] ||
        req.headers['cf-ipcountry'],
      120
    ),
    geoRegion: optionalText(
      firstValue(req, ['geoRegion', 'region', 'state', 'estado']) ||
        req.headers['x-vercel-ip-country-region'],
      160
    ),
    geoCity: optionalText(
      firstValue(req, ['geoCity']) || req.headers['x-vercel-ip-city'],
      160
    ),
    timezone: optionalText(
      firstValue(req, ['timezone', 'timeZone']) ||
        req.headers['x-vercel-ip-timezone'],
      160
    ),
    screenWidth: Number.isFinite(screenWidth) && screenWidth > 0 ? screenWidth : null,
    screenHeight: Number.isFinite(screenHeight) && screenHeight > 0 ? screenHeight : null
  };
}

module.exports = {
  collectVisitorTrackingData
};
