const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const tmdb = require('../src/services/blogTmdb');
const originalFetch = global.fetch;
const originalToken = process.env.TMDB_READ_ACCESS_TOKEN;
afterEach(() => { global.fetch = originalFetch; if (originalToken === undefined) delete process.env.TMDB_READ_ACCESS_TOKEN; else process.env.TMDB_READ_ACCESS_TOKEN = originalToken; });
test('rejects invalid search and arbitrary download URLs before network access', async () => {
  global.fetch = () => { throw new Error('Unexpected network call'); };
  await assert.rejects(tmdb.search('', '1'), { status: 400 });
  await assert.rejects(tmdb.images('person', '1'), { status: 400 });
  await assert.rejects(tmdb.download('movie', 1, 'https://evil.test/image.jpg'), { status: 400 });
});
test('missing credentials produce controlled configuration error', async () => {
  delete process.env.TMDB_READ_ACCESS_TOKEN;
  await assert.rejects(tmdb.search('Matrix'), { status: 503 });
});
test('search filters people and adult works', async () => {
  process.env.TMDB_READ_ACCESS_TOKEN = 'test';
  global.fetch = async () => Response.json({ page: 1, total_pages: 2, results: [{ id: 1, media_type: 'person' }, { id: 2, media_type: 'movie', adult: true }, { id: 3, media_type: 'tv', name: 'Obra', first_air_date: '2025-01-01' }] });
  assert.deepEqual((await tmdb.search('Obra')).results, [{ id: 3, kind: 'tv', title: 'Obra', year: '2025' }]);
});
test('download validates membership, signature and supplies editable description', async () => {
  process.env.TMDB_READ_ACCESS_TOKEN = 'test';
  global.fetch = async url => String(url).startsWith('https://api.themoviedb.org/') ? Response.json({ title: 'Obra', images: { posters: [{ file_path: '/poster.jpg', width: 500, height: 750 }] } }) : new Response(Buffer.from([255, 216, 255, 0, 0]), { headers: { 'content-type': 'image/jpeg' } });
  await assert.rejects(tmdb.download('movie', 1, '/other.jpg'), { status: 404 });
  const asset = await tmdb.download('movie', 1, '/poster.jpg');
  assert.equal(asset.name, 'Obra — Pôster');
  assert.equal(asset.bytes.length, 5);
  global.fetch = async url => String(url).startsWith('https://api.themoviedb.org/') ? Response.json({ title: 'Obra', images: { posters: [{ file_path: '/poster.jpg' }] } }) : new Response('not an image', { headers: { 'content-type': 'image/jpeg' } });
  await assert.rejects(tmdb.download('movie', 1, '/poster.jpg'), { status: 400 });
});
