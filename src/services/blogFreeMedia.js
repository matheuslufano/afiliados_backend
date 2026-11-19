const { MAX_IMAGE_BYTES, imageExtension } = require('./blogMedia');
const { isTransparentAnimation } = require('./blogGifTransparency');
const { fail } = require('./blogValidation');
const API = 'https://commons.wikimedia.org/w/api.php';
const HEADERS = { 'User-Agent': 'NetboxBlogMedia/1.0 (https://netbox.net.br)' };
const MODES = ['portrait', 'landscape', 'gif'];

function validateMode(mode) {
  if (!MODES.includes(mode)) fail('Formato de imagem inválido.');
}
function mediaUrl(value, thumbnail = false) {
  try {
    const url = new URL(value);
    const allowed = url.hostname === 'upload.wikimedia.org' || thumbnail && url.hostname === 'thumb.wikimedia.org';
    if (url.protocol === 'https:' && allowed && !url.port && !url.username && !url.password && url.pathname.startsWith('/wikipedia/commons/')) return url.href;
  } catch {}
  return '';
}
const plainText = value => String(value || '').replace(/<[^>]*>/g, '').replace(/&(?:nbsp|amp|quot|lt|gt);/g, match => ({ '&nbsp;': ' ', '&amp;': '&', '&quot;': '"', '&lt;': '<', '&gt;': '>' })[match]).trim().slice(0, 500);

async function request(params) {
  const url = new URL(API);
  url.search = new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiurlwidth: '400', ...params });
  let response;
  try { response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15000), redirect: 'error' }); }
  catch { fail('Não foi possível consultar o Wikimedia Commons. Tente novamente.', 503); }
  if (!response.ok) fail('Wikimedia Commons indisponível. Tente novamente mais tarde.', response.status === 429 ? 429 : 503);
  const data = await response.json();
  if (data.error) fail('A busca de imagens está indisponível. Tente outro termo.', 503);
  return data;
}

/** Only explicit CC0 / public-domain records are offered; no client-provided URL is trusted. */
function normalize(page, mode) {
  const info = page.imageinfo?.[0];
  const metadata = info?.extmetadata;
  const license = metadata?.LicenseShortName?.value;
  if (!['CC0', 'Public domain'].includes(license) || plainText(metadata?.Restrictions?.value)) return null;
  if (!info || !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(info.mime) || !Number.isSafeInteger(info.size) || info.size < 1 || info.size > MAX_IMAGE_BYTES) return null;
  if (!(info.width > 0 && info.height > 0) || !Number.isSafeInteger(page.pageid) || page.pageid < 1 || !page.title?.startsWith('File:')) return null;
  if (mode === 'portrait' && info.height <= info.width || mode === 'landscape' && info.width <= info.height || mode === 'gif' && info.mime !== 'image/gif') return null;
  const original = mediaUrl(info.url);
  const preview = mediaUrl(mode === 'gif' ? info.url : info.thumburl || info.url, true);
  if (!original || !preview) return null;
  return {
    id: page.pageid, title: plainText(page.title.replace(/^File:/, '').replace(/\.(jpe?g|png|gif|webp)$/i, '')),
    width: info.width, height: info.height, preview, original, mime: info.mime,
    license, author: plainText(metadata?.Artist?.value) || 'Autor não informado',
    source: `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title)}`,
  };
}

async function downloadBytes(item) {
  let response;
  try { response = await fetch(item.original, { headers: HEADERS, signal: AbortSignal.timeout(20000), redirect: 'error' }); }
  catch { fail('Não foi possível baixar a imagem do Commons.', 503); }
  if (!response.ok) fail('A imagem está indisponível no Commons.', 503);
  if (Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES) { await response.body?.cancel(); fail('A imagem excede 8 MB.'); }
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > MAX_IMAGE_BYTES) fail('A imagem excede 8 MB.');
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  const mime = response.headers.get('content-type')?.split(';')[0];
  if (mime !== item.mime) fail('O formato da imagem foi alterado. Busque novamente.');
  imageExtension(bytes, mime);
  return bytes;
}

async function search(query, mode = 'landscape', offset = '0') {
  validateMode(mode);
  if (typeof query !== 'string' || !query.trim() || query.length > 120 || !/^\d{1,5}$/.test(String(offset)) || Number(offset) > 10000) fail('Informe um tema e uma página válidos.');
  const term = query.trim().replace(/[":|\\]/g, ' ');
  const data = await request({ generator: 'search', gsrsearch: `${term} haslicense:unrestricted ${mode === 'gif' ? 'filemime:gif' : 'filetype:bitmap'}`, gsrnamespace: '6', gsrlimit: mode === 'gif' ? '6' : '20', gsroffset: String(Number(offset)) });
  const candidates = (data.query?.pages || []).sort((a, b) => (a.index || 0) - (b.index || 0)).map(page => normalize(page, mode)).filter(Boolean);
  const results = [];
  let skipped = 0;
  // Bound concurrent downloads. GIF flags are checked on the real bytes, not filename guesses.
  for (let index = 0; index < candidates.length; index += 2) {
    const batch = await Promise.all(candidates.slice(index, index + 2).map(async item => {
      if (mode === 'gif') {
        try { if (!isTransparentAnimation(await downloadBytes(item))) return null; }
        catch { skipped++; return null; }
      }
      const { original, mime, ...result } = item;
      return result;
    }));
    results.push(...batch.filter(Boolean));
  }
  const next = data.continue?.gsroffset;
  return { results, nextOffset: Number.isInteger(next) && next <= 10000 ? next : null, ...(skipped ? { warning: 'Alguns GIFs não puderam ser verificados. Tente novamente mais tarde.' } : {}) };
}

async function download(id, mode) {
  validateMode(mode);
  if (!/^[1-9]\d{0,11}$/.test(String(id))) fail('Imagem inválida.');
  const data = await request({ pageids: String(id) });
  const page = data.query?.pages?.find(page => page.pageid === Number(id));
  const item = page && normalize(page, mode);
  if (!item) fail('Imagem indisponível ou sem licença compatível. Faça uma nova busca.', 404);
  const bytes = await downloadBytes(item);
  if (mode === 'gif' && !isTransparentAnimation(bytes)) fail('O arquivo não é um GIF animado com transparência em todos os quadros.');
  return { bytes, mime: item.mime, name: item.title, source: item.source };
}
module.exports = { search, download };
