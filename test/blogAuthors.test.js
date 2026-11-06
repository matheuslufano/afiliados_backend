const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHmac } = require('node:crypto');
const prisma = require('../src/database/prisma');

test('active regular users can choose real authors; publication stays restricted', async () => {
  const express = require('express');
  const account = { id: 1, name: 'Editor', active: true, role: 'USER' };
  const author = { id: 2, name: 'Responsável', photoUrl: 'https://example.org/author.jpg' };
  const originals = [];
  function stub(object, key, value) { originals.push(() => { object[key] = value; }); object[key] = value; }
  let stored;
  stub(prisma.user, 'findUnique', async () => account);
  stub(prisma.user, 'findFirst', async ({ where }) => where.id === author.id ? author : null);
  stub(prisma.user, 'findMany', async ({ select, where }) => {
    assert.deepEqual(select, { id: true, name: true, photoUrl: true });
    assert.equal(where.active, true);
    return [author];
  });
  stub(prisma.blogArticle, 'findUnique', async () => stored);
  stub(prisma.blogArticle, 'create', async ({ data }) => (stored = { ...data, revision: 1, sources: [], authorUser: { photoUrl: author.photoUrl } }));
  stub(prisma.blogArticle, 'updateMany', async ({ data }) => { stored = { ...stored, ...data, revision: stored.revision + 1 }; return { count: 1 }; });
  stub(prisma, '$transaction', async callback => callback(prisma));
  const app = express(); app.use(express.json()); app.use(require('../src/routes/blogAdminRoutes'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const payload = Buffer.from(JSON.stringify({ id: 1 })).toString('base64url');
  const token = payload + '.' + createHmac('sha256', process.env.JWT_SECRET || 'minha_chave_super_secreta').update(payload).digest('base64url');
  async function request(path, method = 'GET', body, authenticated = true) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/admin/blog${path}`, {
      method, headers: { 'Content-Type': 'application/json', ...(authenticated ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    return { status: response.status, data: await response.json() };
  }
  const draft = { id: randomUUID(), title: 'Teste', slug: 'teste', category: 'teste', summary: 'Resumo', cover: '', coverAlt: '', content: [] };
  try {
    assert.equal((await request('/authors', 'GET', undefined, false)).status, 401);
    assert.deepEqual((await request('/authors')).data, [author]);
    assert.equal((await request('/articles', 'POST', { ...draft, authorId: 99 })).status, 400);
    assert.equal((await request('/articles', 'POST', { ...draft, authorId: '2' })).status, 400);
    let response = await request('/articles', 'POST', { ...draft, authorId: 2, author: 'Forged name', authorUser: { photoUrl: 'forged' } });
    assert.equal(response.status, 201);
    assert.equal(response.data.author, author.name);
    assert.equal(response.data.authorUser.photoUrl, author.photoUrl);
    assert.equal((await request('/articles', 'POST', { ...draft, authorId: 2 })).data.id, draft.id);
    stored = { ...stored, authorId: 1, author: account.name, status: 'published', publicSnapshot: { author: account.name, title: 'Publicado', authorPhotoUrl: 'https://example.org/old.jpg' } };
    response = await request(`/articles/${draft.id}`, 'PUT', { ...draft, revision: 1, authorId: 2 });
    assert.equal(response.status, 200);
    assert.equal(response.data.authorId, 2);
    assert.equal(response.data.author, author.name);
    assert.equal(response.data.publicSnapshot.author, account.name);
    assert.equal(response.data.publicSnapshot.authorPhotoUrl, 'https://example.org/old.jpg');
    assert.equal((await request(`/articles/${draft.id}/publication`, 'POST', { action: 'publish', revision: 2 })).status, 403);
    assert.equal((await request('/categories', 'POST', { name: 'Teste', slug: 'teste' })).status, 403);
    assert.equal((await request('/categories/1', 'DELETE')).status, 403);
  } finally {
    await new Promise(resolve => server.close(resolve));
    originals.reverse().forEach(restore => restore());
  }
});
