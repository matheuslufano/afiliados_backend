const { photo } = require("./locomotivaValidation");

const MAX_PHOTO_BYTES = 512000;
const MAX_PROFILE_BYTES = 2 * 1024 * 1024;

function providerSettings() {
  const { LOCOMOTIVA_INSTAGRAM_ACCOUNT_ID: account, LOCOMOTIVA_INSTAGRAM_TOKEN: token,
    LOCOMOTIVA_INSTAGRAM_GRAPH_VERSION: version } = process.env;
  return /^\d+$/.test(account ?? "") && /^v\d+\.\d+$/.test(version ?? "") && token
    ? { account, token, version } : null;
}

async function readLimited(response, limit) {
  if (!response.body) return null;
  if (Number(response.headers.get("content-length")) > limit) {
    await response.body.cancel();
    return null;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      size += chunk.byteLength;
      if (size > limit) {
        await reader.cancel();
        return null;
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

async function downloadPhoto(value) {
  const url = new URL(value);
  // Accept only Meta's image CDN. Reject redirects and bound the download.
  if (url.protocol !== "https:" || url.port || url.username || url.password ||
      !/(^|\.)(cdninstagram\.com|fbcdn\.net)$/.test(url.hostname)) return null;
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(5000) });
  const type = response.headers.get("content-type")?.split(";")[0];
  if (!response.ok || !["image/png", "image/jpeg", "image/webp"].includes(type)) {
    await response.body?.cancel();
    return null;
  }
  const bytes = await readLimited(response, MAX_PHOTO_BYTES);
  return bytes ? photo(`data:${type};base64,${bytes.toString("base64")}`) : null;
}

function publicLookupEnabled() {
  return process.env.LOCOMOTIVA_INSTAGRAM_PUBLIC_LOOKUP !== "false";
}

async function lookupPublicProfile(handle) {
  const profileUrl = `https://www.instagram.com/${handle}/`;
  const response = await fetch(profileUrl, { redirect: "error", signal: AbortSignal.timeout(5000) });
  if (!response.ok || !response.headers.get("content-type")?.includes("text/html")) {
    await response.body?.cancel();
    return null;
  }
  const html = (await readLimited(response, MAX_PROFILE_BYTES))?.toString("utf8");
  if (!html) return null;
  const metadata = new Map();
  for (const tag of html.split(/<\/head\s*>/i, 1)[0].matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = new Map([...tag[0].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)]
      .map(([, name, doubleQuoted, singleQuoted]) => [name.toLowerCase(), doubleQuoted ?? singleQuoted]));
    const property = attrs.get("property")?.toLowerCase();
    if (property?.startsWith("og:") && !metadata.has(property)) metadata.set(property, attrs.get("content"));
  }
  const canonicalUrl = metadata.get("og:url");
  if (metadata.get("og:type") !== "profile" || canonicalUrl?.replace(/\/$/, "").toLowerCase() !== profileUrl.slice(0, -1)) return null;
  const image = metadata.get("og:image");
  return image ? downloadPhoto(image.replace(/&(?:amp|#0*38|#x0*26);/gi, "&")) : null;
}

async function lookupBusinessProfile(handle) {
  const settings = providerSettings();
  if (!settings) return null;
  const endpoint = new URL(`https://graph.facebook.com/${settings.version}/${settings.account}`);
  endpoint.searchParams.set("fields", `business_discovery.username(${handle}){username,profile_picture_url}`);
  try {
    const response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${settings.token}` },
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    const { business_discovery: profile } = await response.json();
    if (profile?.username?.toLowerCase() !== handle || !profile.profile_picture_url) return null;
    return await downloadPhoto(profile.profile_picture_url);
  } catch {
    return null;
  }
}

async function lookupPhoto(handle) {
  const businessPhoto = await lookupBusinessProfile(handle);
  if (businessPhoto) return { photo: businessPhoto, source: "INSTAGRAM_BUSINESS_DISCOVERY" };
  if (!publicLookupEnabled()) return null;
  try {
    const publicPhoto = await lookupPublicProfile(handle);
    return publicPhoto ? { photo: publicPhoto, source: "INSTAGRAM_PUBLIC_PROFILE" } : null;
  } catch {
    return null;
  }
}

module.exports = { isConfigured: () => publicLookupEnabled() || Boolean(providerSettings()), lookupPhoto };
