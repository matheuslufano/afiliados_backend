const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const service = require('../src/services/blogFreeMedia');
const { isTransparentAnimation } = require('../src/services/blogGifTransparency');
const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });

const page = (id = 1, info = {}, metadata = {}) => ({ pageid: id, title: `File:Landscape ${id}.jpg`, index: id, imageinfo: [{
  width: 800, height: 500, size: 100, mime: 'image/jpeg',
  url: `https://upload.wikimedia.org/wikipedia/commons/a/ab/${id}.jpg`,
  thumburl: `https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/${id}.jpg/400px.jpg`,
  ...info,
  extmetadata: { LicenseShortName: { value: 'CC0' }, Artist: { value: '<a href="https://example.org">Artist</a>' }, ...metadata },
}] });
const jpeg = () => new Response(Buffer.from([255, 216, 255, 0, 0]), { headers: { 'content-type': 'image/jpeg' } });
function gif(flags = [1, 1]) {
  const header = Buffer.from('47494638396101000100800000000000ffffff', 'hex');
  const frames = flags.map(flag => Buffer.from([0x21, 0xf9, 4, flag, 1, 0, 0, 0, 0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x44, 1, 0]));
  return Buffer.concat([header, ...frames, Buffer.from([0x3b])]);
}

test('GIF parser distinguishes animation, transparency, truncation and opaque frames', () => {
  assert.equal(isTransparentAnimation(gif()), true);
  assert.equal(isTransparentAnimation(gif([1])), false);
  assert.equal(isTransparentAnimation(gif([0, 0])), false);
  assert.equal(isTransparentAnimation(gif([1, 0])), false);
  assert.equal(isTransparentAnimation(gif().subarray(0, -1)), false);
  assert.equal(isTransparentAnimation(Buffer.from('not a GIF')), false);
});

test('invalid queries, pagination and import IDs fail before networking', async () => {
  global.fetch = () => { throw new Error('Unexpected fetch'); };
  for (const query of ['', null, ['cat'], 'x'.repeat(121)]) await assert.rejects(service.search(query), { status: 400 });
  await assert.rejects(service.search('cat', 'video'), { status: 400 });
  await assert.rejects(service.search('cat', 'gif', '-1'), { status: 400 });
  await assert.rejects(service.search('cat', 'gif', '10001'), { status: 400 });
  await assert.rejects(service.download('https://evil.test/a', 'landscape'), { status: 400 });
});

test('search filters licenses, restrictions, orientation, file sizes and untrusted URLs', async () => {
  global.fetch = async (url, options) => {
    assert.equal(new URL(url).hostname, 'commons.wikimedia.org');
    assert.equal(options.redirect, 'error');
    assert.equal(new URL(url).searchParams.get('gsroffset'), '20');
    return Response.json({ continue: { gsroffset: 40 }, query: { pages: [
      page(), page(2, {}, { LicenseShortName: { value: 'Public domain' } }),
      page(3, {}, { LicenseShortName: { value: 'CC BY-SA 4.0' } }),
      page(4, {}, { Restrictions: { value: 'trademark' } }),
      page(5, { height: 1000 }), page(6, { size: 9000000 }),
      page(7, { url: 'https://evil.test/image.jpg' }), page(8, { thumburl: 'javascript:alert(1)' }),
    ] } });
  };
  const result = await service.search('nature', 'landscape', '20');
  assert.deepEqual(result.results.map(item => item.id), [1, 2]);
  assert.equal(result.nextOffset, 40);
  assert.equal(result.results[0].author, 'Artist');
  assert.ok(result.results[0].preview.startsWith('https://thumb.wikimedia.org/'));
  assert.equal(result.results[0].original, undefined);
});

test('portrait filtering and GIF search examine the actual downloaded blocks', async () => {
  global.fetch = async url => {
    if (new URL(url).hostname === 'commons.wikimedia.org') return Response.json({ query: { pages: [page(1, { height: 900 }), page(2)] } });
    throw new Error('No image download expected');
  };
  assert.deepEqual((await service.search('flower', 'portrait')).results.map(item => item.id), [1]);
  global.fetch = async url => new URL(url).hostname === 'commons.wikimedia.org'
    ? Response.json({ query: { pages: [page(1, { mime: 'image/gif' }), page(2, { mime: 'image/gif' })] } })
    : new Response(gif(String(url).includes('1.jpg') ? [1, 1] : [0, 0]), { headers: { 'content-type': 'image/gif' } });
  assert.deepEqual((await service.search('earth', 'gif')).results.map(item => item.id), [1]);
});

test('import rechecks license and downloads only Commons originals with bounded size and MIME', async () => {
  global.fetch = async url => new URL(url).hostname === 'commons.wikimedia.org' ? Response.json({ query: { pages: [page()] } }) : jpeg();
  const result = await service.download(1, 'landscape');
  assert.equal(result.mime, 'image/jpeg');
  assert.equal(result.name, 'Landscape 1');
  assert.ok(result.source.startsWith('https://commons.wikimedia.org/wiki/File'));
  global.fetch = async () => Response.json({ query: { pages: [page(1, {}, { LicenseShortName: { value: 'CC BY 4.0' } })] } });
  await assert.rejects(service.download(1, 'landscape'), { status: 404 });
  for (const response of [new Response('bad', { headers: { 'content-type': 'image/jpeg' } }), new Response('large', { headers: { 'content-type': 'image/jpeg', 'content-length': '9000000' } })]) {
    global.fetch = async url => new URL(url).hostname === 'commons.wikimedia.org' ? Response.json({ query: { pages: [page()] } }) : response;
    await assert.rejects(service.download(1, 'landscape'), { status: 400 });
  }
});

test('upstream failures are controlled and do not expose response bodies', async () => {
  global.fetch = async () => new Response('secret', { status: 429 });
  await assert.rejects(service.search('cat'), error => error.status === 429 && !error.message.includes('secret'));
  global.fetch = async () => { throw new Error('private details'); };
  await assert.rejects(service.search('cat'), error => error.status === 503 && !error.message.includes('private'));
});

test('authenticated import persists the real asset contract and serves its bytes', async () => {
  const express = require('express');
  const { createHmac } = require('node:crypto');
  const prisma = require('../src/database/prisma');
  const previous = { user: prisma.user.findUnique, create: prisma.blogMediaAsset.create, find: prisma.blogMediaAsset.findUnique, origin: process.env.BLOG_MEDIA_PUBLIC_URL };
  let stored;
  prisma.user.findUnique = async () => ({ id: 1, active: true, role: 'USER' });
  prisma.blogMediaAsset.create = async ({ data }) => { stored = { ...data, id: '123e4567-e89b-12d3-a456-426614174000' }; return stored; };
  prisma.blogMediaAsset.findUnique = async () => stored;
  process.env.BLOG_MEDIA_PUBLIC_URL = 'https://media.example.org';
  global.fetch = async url => new URL(url).hostname === 'commons.wikimedia.org' ? Response.json({ query: { pages: [page()] } }) : jpeg();
  const app = express(); app.use(express.json()); app.use(require('../src/routes/blogMediaRoutes'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const payload = Buffer.from(JSON.stringify({ id: 1 })).toString('base64url');
  const token = payload + '.' + createHmac('sha256', process.env.JWT_SECRET || 'minha_chave_super_secreta').update(payload).digest('base64url');
  try {
    assert.equal((await originalFetch(base + '/admin/blog/free-media/search?q=cat')).status, 401);
    assert.equal((await originalFetch(base + '/admin/blog/free-media/import', { method: 'POST' })).status, 401);
    const imported = await originalFetch(base + '/admin/blog/free-media/import', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 1, mode: 'landscape', url: 'https://evil.test/ignored' }) });
    assert.equal(imported.status, 201);
    assert.equal((await imported.json()).url, 'https://media.example.org/blog/media/assets/' + stored.id);
    assert.equal(stored.source, 'https://commons.wikimedia.org/wiki/File%3ALandscape%201.jpg');
    const image = await originalFetch(base + '/blog/media/assets/' + stored.id);
    assert.equal(image.headers.get('content-type'), 'image/jpeg');
    assert.deepEqual(Buffer.from(await image.arrayBuffer()), stored.bytes);
  } finally {
    await new Promise(resolve => server.close(resolve));
    prisma.user.findUnique = previous.user; prisma.blogMediaAsset.create = previous.create; prisma.blogMediaAsset.findUnique = previous.find;
    if (previous.origin === undefined) delete process.env.BLOG_MEDIA_PUBLIC_URL; else process.env.BLOG_MEDIA_PUBLIC_URL = previous.origin;
  }
});
