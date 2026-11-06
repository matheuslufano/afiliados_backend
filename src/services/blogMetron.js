const { fail, json, searchInput, identity } = require('./blogCatalogHttp');

async function request(path, params = {}) {
  const token = process.env.METRON_API_TOKEN?.trim();
  if (!token) fail('Configure METRON_API_TOKEN no backend para buscar capas de HQs.', 503);
  const url = new URL(`https://metron.cloud/api/${path}`);
  url.search = new URLSearchParams(params).toString();
  return json(url, { headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'NetboxBlog/1.0', Accept: 'application/json' } });
}
function coverUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ['metron.cloud', 'static.metron.cloud'].includes(url.hostname)
      && !url.username && !url.password && !url.port && !url.search && !url.hash
      && /^\/media\/[\w/.-]+\.(?:jpg|jpeg|png|webp)$/i.test(url.pathname) ? url.href : '';
  } catch { return ''; }
}
async function search(query, page = '1') {
  searchInput(query, page);
  const data = await request('issue/', { series_name: query.trim(), page: String(page) });
  // Metron's page size is controlled by the upstream API; next signals another page reliably.
  return { page: Number(page), pages: data.next ? Math.min(Number(page) + 1, 500) : Number(page), results: (data.results || []).map(item => ({ id: item.id, kind: 'issue', title: item.issue || `${item.series?.name || 'HQ'} #${item.number || ''}`, year: String(item.cover_date || '').slice(0, 4) })) };
}
async function images(kind, id) {
  identity(kind, id, 'issue');
  const issue = await request(`issue/${id}/`);
  const url = coverUrl(issue.image);
  let source = 'https://metron.cloud/';
  try {
    const resource = new URL(issue.resource_url);
    if (resource.origin === 'https://metron.cloud' && !resource.username && !resource.password) source = resource.href;
  } catch {}
  return { title: issue.issue || `${issue.series?.name || 'HQ'} #${issue.number || ''}`, source, images: url ? [{ path: 'cover', type: 'poster', preview: url, url, width: 0, height: 0 }] : [] };
}
module.exports = { search, images };
