const { MAX_IMAGE_BYTES, imageExtension } = require('./blogMedia');
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const validPath = value => typeof value === 'string' && /^\/[a-zA-Z0-9_-]+\.(jpg|png|webp)$/.test(value);

/** Credentials and all downloads stay on the server; arbitrary URLs are never accepted. */
async function request(path, params = {}) {
  const token = process.env.TMDB_READ_ACCESS_TOKEN?.trim();
  if (!token) fail('Configure TMDB_READ_ACCESS_TOKEN no backend para buscar imagens.', 503);
  const url = new URL(`https://api.themoviedb.org/3/${path}`);
  url.search = new URLSearchParams(params).toString();
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000), redirect: 'error' });
  if (!response.ok) fail('O catálogo TMDB está indisponível. Tente novamente.', 503);
  return response.json();
}
function identity(kind, id) {
  if (!['movie', 'tv'].includes(kind) || !/^\d{1,10}$/.test(String(id)) || Number(id) < 1) fail('Obra inválida.');
}
async function search(query, page = '1') {
  if (typeof query !== 'string' || !query.trim() || query.length > 200 || !/^\d+$/.test(String(page)) || Number(page) < 1 || Number(page) > 500) fail('Informe uma busca e página válidas.');
  const data = await request('search/multi', { query: query.trim(), page: String(page), language: 'pt-BR', include_adult: 'false' });
  return { page: data.page, pages: Math.min(data.total_pages || 0, 500), results: (data.results || []).filter(item => ['movie', 'tv'].includes(item.media_type) && !item.adult).map(item => ({ id: item.id, kind: item.media_type, title: item.title || item.name, year: (item.release_date || item.first_air_date || '').slice(0, 4) })) };
}
async function images(kind, id) {
  identity(kind, id);
  const work = await request(`${kind}/${id}`, { language: 'pt-BR', append_to_response: 'images', include_image_language: 'pt,en,null' });
  if (work.adult) fail('Obra indisponível.', 404);
  const title = work.title || work.name;
  return { title, images: ['posters', 'backdrops'].flatMap(group => (work.images?.[group] || []).filter(item => validPath(item.file_path)).map(item => ({ path: item.file_path, type: group === 'posters' ? 'poster' : 'landscape', preview: `https://image.tmdb.org/t/p/w500${item.file_path}`, width: item.width, height: item.height }))) };
}
async function download(kind, id, path) {
  if (!validPath(path)) fail('Imagem inválida.');
  const catalog = await images(kind, id);
  const selected = catalog.images.find(image => image.path === path);
  if (!selected) fail('Imagem não pertence à obra selecionada.', 404);
  const response = await fetch(`https://image.tmdb.org/t/p/w1280${path}`, { signal: AbortSignal.timeout(20000), redirect: 'error' });
  if (!response.ok) fail('Não foi possível baixar a imagem.', 503);
  if (Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES) fail('A imagem excede 8 MB.');
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > MAX_IMAGE_BYTES) { fail('A imagem excede 8 MB.'); }
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  const mime = response.headers.get('content-type')?.split(';')[0];
  imageExtension(bytes, mime);
  return { bytes, mime, name: `${catalog.title} — ${selected.type === 'poster' ? 'Pôster' : 'Imagem horizontal'}`.slice(0, 500), source: `https://www.themoviedb.org/${kind}/${id}` };
}
module.exports = { search, images, download };
