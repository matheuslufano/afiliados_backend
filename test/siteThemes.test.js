const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHmac } = require('node:crypto');
const { readFile } = require('node:fs/promises');
const { join } = require('node:path');
const { catalog, defaults, validateThemeSetting } = require('../src/services/siteThemes');

test('seasonal presets have stable unique IDs and default to disabled', () => {
  assert.equal(new Set(catalog.map(theme => theme.id)).size, catalog.length);
  assert.equal(catalog.length, 13);
  for (const theme of catalog) {
    assert.ok(theme.greeting && theme.description);
    assert.equal(theme.colors.length, 3);
    assert.ok(theme.colors.every(color => /^#[a-f0-9]{6}$/i.test(color)));
  }
  assert.deepEqual(defaults('blog'), { scope: 'blog', themeId: 'christmas', enabled: false, revision: 0, updatedAt: null });
});
test('settings reject injected presets, coerced booleans and stale-format revisions', () => {
  for (const body of [null, { themeId: '<script>', enabled: true, revision: 0 }, { themeId: 'christmas', enabled: 'false', revision: 0 }, { themeId: 'christmas', enabled: true, revision: -1 }, { themeId: 'christmas', enabled: true, revision: 1.5 }]) assert.throws(() => validateThemeSetting(body), { status: 400 });
  assert.deepEqual(validateThemeSetting({ themeId: 'christmas', enabled: true, revision: 0, arbitraryCss: 'discard' }), { themeId: 'christmas', enabled: true, revision: 0 });
});

test('HTTP + PostgreSQL: independent settings, permissions, conflicts and deactivation', { skip: process.env.SITE_THEME_TEST_DATABASE !== '1' }, async t => {
  require('dotenv').config({ quiet: true });
  const { PrismaClient } = require('@prisma/client');
  const originalUrl = new URL(process.env.DATABASE_URL);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(originalUrl.hostname), 'Integration only creates a temporary schema in local PostgreSQL.');
  const adminDb = new PrismaClient({ datasourceUrl: originalUrl.href });
  const schema = 'theme_test_' + randomUUID().replaceAll('-', '');
  assert.match(schema, /^theme_test_[a-f0-9]{32}$/);
  await adminDb.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  originalUrl.searchParams.set('schema', schema);
  process.env.DATABASE_URL = originalUrl.href;
  process.env.JWT_SECRET = randomUUID();
  const db = require('../src/database/prisma');
  let server;
  t.after(async () => {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    await db.$disconnect();
    await adminDb.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    await adminDb.$disconnect();
  });
  await adminDb.$executeRawUnsafe(`CREATE TABLE "${schema}"."User" ("id" SERIAL PRIMARY KEY, "name" TEXT NOT NULL, "email" TEXT UNIQUE NOT NULL, "password" TEXT NOT NULL, "city" TEXT, "photoUrl" TEXT, "role" TEXT NOT NULL DEFAULT 'USER', "active" BOOLEAN NOT NULL DEFAULT true, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "teamId" INTEGER)`);
  const sql = await readFile(join(__dirname, '../prisma/migrations/20261109180000_site_seasonal_themes/migration.sql'), 'utf8');
  await adminDb.$executeRawUnsafe(sql.replace('CREATE TABLE "SiteThemeSetting"', `CREATE TABLE "${schema}"."SiteThemeSetting"`));
  const admin = await db.user.create({ data: { name: 'Theme test admin', email: 'admin@example.invalid', password: 'unused-test-fixture', role: 'ADMIN' } });
  const viewer = await db.user.create({ data: { name: 'Theme test viewer', email: 'viewer@example.invalid', password: 'unused-test-fixture', role: 'USER' } });
  const app = require('express')();
  app.use(require('express').json()); app.use(require('../src/routes/siteThemeRoutes'));
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const token = id => { const payload = Buffer.from(JSON.stringify({ id })).toString('base64url'); return payload + '.' + createHmac('sha256', process.env.JWT_SECRET).update(payload).digest('base64url'); };
  async function request(path, user, body) {
    const response = await fetch(base + path, { method: body ? 'PUT' : 'GET', headers: { ...(user ? { Authorization: 'Bearer ' + token(user.id) } : {}), 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: await response.json(), cache: response.headers.get('cache-control') };
  }
  const initial = await request('/site/themes');
  assert.equal(initial.status, 200); assert.equal(initial.data.settings.length, 2); assert.ok(initial.data.settings.every(setting => !setting.enabled)); assert.equal(initial.cache, 'no-store'); assert.equal(initial.data.canManage, undefined);
  assert.equal((await request('/admin/blog/themes')).status, 401);
  assert.equal((await request('/admin/blog/themes', viewer)).data.canManage, false);
  const enabled = { themeId: 'christmas', enabled: true, revision: 0 };
  assert.equal((await request('/admin/blog/themes/blog', viewer, enabled)).status, 403);
  const changed = await request('/admin/blog/themes/blog', admin, enabled);
  assert.equal(changed.status, 200); assert.equal(changed.data.revision, 1);
  assert.equal((await request('/admin/blog/themes/blog', admin, enabled)).status, 409);
  const active = (await request('/site/themes')).data.settings;
  assert.equal(active.find(setting => setting.scope === 'blog').enabled, true);
  assert.equal(active.find(setting => setting.scope === 'institutional').enabled, false);
  assert.equal((await request('/admin/blog/themes/blog', admin, { ...enabled, themeId: 'external-css', revision: 1 })).status, 400);
  assert.equal((await request('/admin/blog/themes/unknown', admin, enabled)).status, 400);
  assert.equal((await request('/admin/blog/themes/institutional', admin, { themeId: 'halloween', enabled: true, revision: 0 })).status, 200);
  const disabled = await request('/admin/blog/themes/blog', admin, { ...enabled, enabled: false, revision: 1 });
  assert.equal(disabled.status, 200); assert.equal(disabled.data.revision, 2);
  const final = (await request('/site/themes')).data.settings;
  assert.equal(final.find(setting => setting.scope === 'blog').enabled, false);
  assert.equal(final.find(setting => setting.scope === 'institutional').enabled, true);
  assert.equal((await db.siteThemeSetting.findUnique({ where: { scope: 'institutional' } })).themeId, 'halloween');
});
