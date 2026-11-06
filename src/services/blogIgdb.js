const { fail, json, searchInput, identity } = require('./blogCatalogHttp');
let cachedToken;
let pendingToken;

/** App token stays in process memory and renews before expiry; concurrent requests share renewal. */
async function token() {
  const clientId = process.env.IGDB_CLIENT_ID?.trim();
  const secret = process.env.IGDB_CLIENT_SECRET?.trim();
  if (!clientId || !secret) fail('Configure IGDB_CLIENT_ID e IGDB_CLIENT_SECRET no backend para buscar imagens de jogos.', 503);
  const key = `${clientId}:${secret}`;
  if (cachedToken?.key === key && cachedToken.expires > Date.now()) return cachedToken.value;
  if (pendingToken?.key === key) return pendingToken.promise;
  const promise = (async () => {
    const data = await json('https://id.twitch.tv/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId, client_secret: secret, grant_type: 'client_credentials' }).toString() });
    if (typeof data.access_token !== 'string' || !Number.isFinite(data.expires_in) || data.expires_in <= 0) fail('Não foi possível autenticar a IGDB.', 503);
    cachedToken = { key, value: data.access_token, expires: Date.now() + Math.max(0, data.expires_in - 60) * 1000 };
    return data.access_token;
  })();
  pendingToken = { key, promise };
  try { return await promise; } finally { if (pendingToken?.promise === promise) pendingToken = null; }
}
async function request(body) {
  const accessToken = await token();
  try {
    return await json('https://api.igdb.com/v4/games', { method: 'POST', headers: { 'Client-ID': process.env.IGDB_CLIENT_ID.trim(), Authorization: `Bearer ${accessToken}`, 'Content-Type': 'text/plain', Accept: 'application/json' }, body });
  } catch (error) { cachedToken = null; throw error; }
}
async function search(query, page = '1') {
  searchInput(query, page);
  const data = await request(`search ${JSON.stringify(query.trim())}; fields name,first_release_date; limit 21; offset ${(Number(page) - 1) * 20};`);
  return { page: Number(page), pages: data.length > 20 ? Math.min(Number(page) + 1, 500) : Number(page), results: data.slice(0, 20).map(game => ({ id: game.id, kind: 'game', title: game.name, year: game.first_release_date ? new Date(game.first_release_date * 1000).toISOString().slice(0, 4) : '' })) };
}
async function images(kind, id) {
  identity(kind, id, 'game');
  const fields = 'name,slug,cover.image_id,cover.width,cover.height,artworks.image_id,artworks.width,artworks.height,screenshots.image_id,screenshots.width,screenshots.height';
  const [game] = await request(`fields ${fields}; where id = ${id}; limit 1;`);
  if (!game) fail('Jogo não encontrado.', 404);
  const images = [];
  for (const [group, type, entries] of [['cover', 'poster', game.cover ? [game.cover] : []], ['artwork', 'landscape', game.artworks || []], ['screenshot', 'landscape', game.screenshots || []]]) {
    for (const image of entries) {
      if (!/^[a-zA-Z0-9_-]{1,100}$/.test(image.image_id || '') || (type === 'landscape' && !(image.width > image.height))) continue;
      const base = 'https://images.igdb.com/igdb/image/upload/';
      images.push({ path: `${group}:${image.image_id}`, type, width: image.width || 0, height: image.height || 0, preview: `${base}t_${type === 'poster' ? 'cover_big' : 'screenshot_med'}/${image.image_id}.jpg`, url: `${base}t_1080p/${image.image_id}.jpg` });
    }
  }
  return { title: game.name, source: /^[a-z0-9-]+$/.test(game.slug || '') ? `https://www.igdb.com/games/${game.slug}` : 'https://www.igdb.com/', images };
}
module.exports = { search, images };
