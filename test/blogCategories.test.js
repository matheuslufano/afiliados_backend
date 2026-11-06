const { test } = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../src/database/prisma');
const { removeCategory } = require('../src/controllers/blogAdminController');

test('category deletion handles success, linked articles, missing records and invalid IDs', async () => {
  const original = prisma.blogCategory.delete;
  async function request(id) {
    const result = {};
    const res = { status(code) { result.status = code; return this; }, json(data) { result.data = data; }, end() { result.ended = true; } };
    await removeCategory({ params: { id } }, res);
    return result;
  }
  try {
    let calls = 0;
    prisma.blogCategory.delete = async ({ where }) => { calls++; assert.equal(where.id, 7); };
    assert.deepEqual(await request('7'), { status: 204, ended: true });
    for (const id of ['0', '-1', 'abc', '1.5', '9007199254740992']) assert.equal((await request(id)).status, 400);
    assert.equal(calls, 1);
    prisma.blogCategory.delete = async () => { throw { code: 'P2003' }; };
    const linked = await request('7');
    assert.equal(linked.status, 409);
    assert.match(linked.data.error, /artigos vinculados/);
    prisma.blogCategory.delete = async () => { throw { code: 'P2025' }; };
    assert.equal((await request('7')).status, 404);
  } finally { prisma.blogCategory.delete = original; }
});
