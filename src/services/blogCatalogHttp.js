const { MAX_IMAGE_BYTES, imageExtension } = require('./blogMedia');
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };

/** Fixed provider URLs only; never return upstream error bodies containing credentials. */
async function json(url, options = {}) {
  let response;
  try { response = await fetch(url, { ...options, signal: AbortSignal.timeout(15000), redirect: 'error' }); }
  catch { fail('Não foi possível conectar ao catálogo. Tente novamente.', 503); }
  if (!response.ok) {
    if (response.status === 429) fail('Limite do catálogo atingido. Aguarde antes de tentar novamente.', 429);
    if ([401, 403].includes(response.status)) fail('Credenciais do catálogo recusadas. Confira a configuração no backend.', 503);
    if (response.status === 404) fail('Obra não encontrada no catálogo.', 404);
    fail('O catálogo está indisponível. Tente novamente.', 503);
  }
  return response.json();
}
function searchInput(query, page) {
  if (typeof query !== 'string' || !query.trim() || query.length > 200 || /[\x00-\x1f]/.test(query) || !/^\d+$/.test(String(page)) || Number(page) < 1 || Number(page) > 500) fail('Informe uma busca e página válidas.');
}
function identity(kind, id, expected) {
  if (kind !== expected || !/^[1-9]\d{0,9}$/.test(String(id))) fail('Obra inválida.');
}
/** Downloads are selected from a revalidated provider result, capped and signature-checked. */
async function downloadImage(url) {
  let response;
  try { response = await fetch(url, { signal: AbortSignal.timeout(20000), redirect: 'error' }); }
  catch { fail('Não foi possível baixar a imagem.', 503); }
  if (!response.ok || !response.body) fail('Não foi possível baixar a imagem.', 503);
  if (Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES) fail('A imagem excede 8 MB.');
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > MAX_IMAGE_BYTES) fail('A imagem excede 8 MB.');
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  const mime = response.headers.get('content-type')?.split(';')[0];
  imageExtension(bytes, mime);
  return { bytes, mime };
}
module.exports = { fail, json, searchInput, identity, downloadImage };
