const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const catalog = require('../src/services/blogImageCatalog');
const originalFetch = global.fetch;
const keys = ['METRON_API_TOKEN', 'IGDB_CLIENT_ID', 'IGDB_CLIENT_SECRET'];
const env = Object.fromEntries(keys.map(key => [key, process.env[key]]));
afterEach(() => { global.fetch = originalFetch; for (const key of keys) { if (env[key] === undefined) delete process.env[key]; else process.env[key] = env[key]; } });
const metronIssue = { id: 12, issue: 'HQ #1', resource_url: 'https://metron.cloud/issue/12/', image: 'https://static.metron.cloud/media/issue/cover.jpg' };
const jpeg = () => new Response(Buffer.from([255, 216, 255, 0, 0]), { headers: { 'content-type': 'image/jpeg' } });

test('unconfigured catalogs and invalid identities never send a network request', async () => {
  keys.forEach(key => delete process.env[key]);
  global.fetch = () => { throw new Error('Unexpected fetch'); };
  for (const name of ['metron', 'igdb']) {
    await assert.rejects(catalog.search(name, 'Teste'), { status: 503 });
    await assert.rejects(catalog.search(name, ''), { status: 400 });
    await assert.rejects(catalog.search(name, 'Teste', '0'), { status: 400 });
    await assert.rejects(catalog.images(name, 'movie', '12'), { status: 400 });
    await assert.rejects(catalog.download(name, 'issue', 12, 'https://evil.test/image.jpg'), { status: 400 });
  }
  await assert.rejects(catalog.search('invalid', 'Teste'), { status: 400 });
});

test('Metron searches editions, validates cover host and downloads only the selected cover', async () => {
  process.env.METRON_API_TOKEN = 'metron-test';
  const seen = [];
  global.fetch = async (url, options) => {
    seen.push(String(url));
    assert.equal(options.redirect, 'error');
    if (String(url).includes('/api/')) {
      assert.equal(options.headers.Authorization, 'Bearer metron-test');
      if (String(url).includes('series_name=')) {
        assert.equal(new URL(url).searchParams.get('series_name'), 'Batman & Robin');
        return Response.json({ next: '/page2', results: [metronIssue] });
      }
      return Response.json(metronIssue);
    }
    assert.equal(options.headers, undefined, 'Provider credentials must not go to the image CDN');
    return jpeg();
  };
  const found = await catalog.search('metron', 'Batman & Robin');
  assert.equal(found.results[0].kind, 'issue');
  assert.equal(found.pages, 2);
  assert.equal((await catalog.images('metron', 'issue', 12)).images[0].type, 'poster');
  const saved = await catalog.download('metron', 'issue', 12, 'cover');
  assert.equal(saved.mime, 'image/jpeg');
  assert.equal(saved.source, 'https://metron.cloud/issue/12/');
  assert.match(saved.name, /Metron/);
  await assert.rejects(catalog.download('metron', 'issue', 12, 'screenshot:other'), { status: 404 });
  global.fetch = async () => Response.json({ ...metronIssue, image: 'https://evil.test/image.jpg' });
  assert.deepEqual((await catalog.images('metron', 'issue', 12)).images, []);
  assert.ok(seen.includes(metronIssue.image));
});

test('IGDB caches OAuth token, escapes search and separates covers from horizontal artwork/screenshots', async () => {
  process.env.IGDB_CLIENT_ID = 'igdb-images'; process.env.IGDB_CLIENT_SECRET = 'test-secret';
  let tokens = 0;
  global.fetch = async (url, options) => {
    if (String(url).includes('id.twitch.tv')) {
      tokens++;
      assert.equal(new URLSearchParams(options.body).get('client_secret'), 'test-secret');
      return Response.json({ access_token: 'app-token', expires_in: 3600 });
    }
    if (String(url).includes('images.igdb.com')) return jpeg();
    assert.equal(options.headers.Authorization, 'Bearer app-token');
    if (options.body.startsWith('search')) {
      assert.ok(options.body.includes(JSON.stringify('Game "name";')));
      assert.match(options.body, /offset 20;/);
      return Response.json([{ id: 2, name: 'Game' }]);
    }
    return Response.json([{ id: 2, name: 'Game', slug: 'game', cover: { image_id: 'cover1', width: 600, height: 900 }, artworks: [{ image_id: 'art1', width: 1920, height: 1080 }, { image_id: 'portrait', width: 500, height: 800 }], screenshots: [{ image_id: 'shot1', width: 1280, height: 720 }, { image_id: '../evil', width: 1920, height: 1080 }] }]);
  };
  const result = await catalog.search('igdb', 'Game "name";', 2);
  assert.equal(result.results[0].kind, 'game');
  const images = await catalog.images('igdb', 'game', 2);
  assert.deepEqual(images.images.map(image => image.type), ['poster', 'landscape', 'landscape']);
  const saved = await catalog.download('igdb', 'game', 2, 'screenshot:shot1');
  assert.equal(saved.source, 'https://www.igdb.com/games/game');
  await assert.rejects(catalog.download('igdb', 'game', 2, 'artwork:missing'), { status: 404 });
  assert.equal(tokens, 1);
});

test('catalog failures and invalid or oversized image data are controlled', async () => {
  process.env.METRON_API_TOKEN = 'test';
  global.fetch = async () => new Response('', { status: 429 });
  await assert.rejects(catalog.search('metron', 'Batman'), { status: 429 });
  global.fetch = async () => new Response('secret upstream error', { status: 401 });
  await assert.rejects(catalog.search('metron', 'Batman'), error => error.status === 503 && !error.message.includes('secret upstream'));
  global.fetch = async url => String(url).includes('/api/') ? Response.json(metronIssue) : new Response('not an image', { headers: { 'content-type': 'image/jpeg' } });
  await assert.rejects(catalog.download('metron', 'issue', 12, 'cover'), { status: 400 });
  global.fetch = async url => String(url).includes('/api/') ? Response.json(metronIssue) : new Response('large', { headers: { 'content-type': 'image/jpeg', 'content-length': '9000000' } });
  await assert.rejects(catalog.download('metron', 'issue', 12, 'cover'), { status: 400 });
});

test('authenticated catalog route imports an asset and serves its stored bytes without a real database', async () => {
  const express = require('express');
  const { createHmac } = require('node:crypto');
  const prisma = require('../src/database/prisma');
  const methods = { user: prisma.user.findUnique, create: prisma.blogMediaAsset.create, find: prisma.blogMediaAsset.findUnique };
  const previousOrigin = process.env.BLOG_MEDIA_PUBLIC_URL;
  process.env.METRON_API_TOKEN = 'route-test';
  process.env.BLOG_MEDIA_PUBLIC_URL = 'https://media.example.org';
  let stored;
  prisma.user.findUnique = async () => ({ id: 1, active: true, role: 'USER', name: 'Editor' });
  prisma.blogMediaAsset.create = async ({ data }) => {
    stored = { ...data, id: '123e4567-e89b-12d3-a456-426614174000' };
    return { id: stored.id, name: stored.name };
  };
  prisma.blogMediaAsset.findUnique = async () => stored;
  global.fetch = async url => String(url).startsWith('https://metron.cloud/api/') ? Response.json(metronIssue) : jpeg();
  const app = express(); app.use(express.json()); app.use(require('../src/routes/blogMediaRoutes'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const payload = Buffer.from(JSON.stringify({ id: 1 })).toString('base64url');
  const token = payload + '.' + createHmac('sha256', process.env.JWT_SECRET || 'minha_chave_super_secreta').update(payload).digest('base64url');
  try {
    for (const path of ['/admin/blog/catalog/metron/search?q=HQ', '/admin/blog/catalog/igdb/game/2/images']) assert.equal((await originalFetch(base + path)).status, 401);
    const response = await originalFetch(base + '/admin/blog/catalog/metron/import', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'issue', id: 12, path: 'cover' }) });
    assert.equal(response.status, 201);
    const asset = await response.json();
    assert.equal(asset.url, `https://media.example.org/blog/media/assets/${stored.id}`);
    assert.equal(stored.source, 'https://metron.cloud/issue/12/');
    const image = await originalFetch(base + new URL(asset.url).pathname);
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('content-type'), 'image/jpeg');
    assert.deepEqual(Buffer.from(await image.arrayBuffer()), stored.bytes);
  } finally {
    await new Promise(resolve => server.close(resolve));
    prisma.user.findUnique = methods.user; prisma.blogMediaAsset.create = methods.create; prisma.blogMediaAsset.findUnique = methods.find;
    if (previousOrigin === undefined) delete process.env.BLOG_MEDIA_PUBLIC_URL; else process.env.BLOG_MEDIA_PUBLIC_URL = previousOrigin;
  }
});
