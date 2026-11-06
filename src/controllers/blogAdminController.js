const { randomUUID } = require('crypto');
const prisma = require('../database/prisma');
const { formatArticle, publicVersion } = require('./blogController');
const { fail, text, validateArticle } = require('../services/blogValidation');
const { publicationData } = require('../services/blogPublication');

const include = { sources: { orderBy: { position: 'asc' } }, categoryRecord: true, authorUser: { select: { photoUrl: true } } };
const wrap = handler => async (req, res) => {
  try { await handler(req, res); } catch (error) {
    const status = error.status || (['P2002', 'P2003', 'P2025'].includes(error.code) ? 409 : 500);
    if (status === 500) console.error('Blog administrativo:', error);
    res.status(status).json({ error: status === 500 ? 'Não foi possível concluir a operação no banco.' : error.code ? 'Slug/nome duplicado ou registro relacionado inválido.' : error.message });
  }
};
async function current(tx, id, revision) {
  const article = await tx.blogArticle.findUnique({ where: { id }, include });
  if (!article) fail('Artigo não encontrado.', 404);
  if (!Number.isInteger(revision) || revision !== article.revision) fail('Artigo alterado em outra sessão. Recarregue antes de salvar.', 409);
  return article;
}
/** Compare-and-swap prevents simultaneous editors from silently overwriting each other. */
async function replace(tx, article, data) {
  const result = await tx.blogArticle.updateMany({ where: { id: article.id, revision: article.revision }, data: { ...data, revision: { increment: 1 } } });
  if (!result.count) fail('Artigo alterado em outra sessão. Recarregue.', 409);
  return tx.blogArticle.findUnique({ where: { id: article.id }, include });
}
exports.list = wrap(async (req, res) => {
  const page = Math.max(1, Math.min(100000, parseInt(req.query.page, 10) || 1));
  const pageSize = [12, 24, 48].includes(Number(req.query.pageSize)) ? Number(req.query.pageSize) : 12;
  const q = String(req.query.q || '').trim().slice(0, 160);
  const status = ['draft', 'published', 'archived', 'demo'].includes(req.query.status) ? req.query.status : undefined;
  const where = { ...(status ? { status } : {}), ...(req.query.category ? { category: String(req.query.category) } : {}), ...(q ? { OR: ['title', 'summary', 'searchText'].map(field => ({ [field]: { contains: q, mode: 'insensitive' } })) } : {}) };
  const sort = ['createdAt', 'updatedAt', 'publishedAt'].includes(req.query.sort) ? req.query.sort : 'updatedAt';
  const [items, total, all, published, drafts, categories] = await prisma.$transaction([
    prisma.blogArticle.findMany({ where, include, orderBy: [{ [sort]: 'desc' }, { id: 'asc' }], skip: (page - 1) * pageSize, take: pageSize }),
    prisma.blogArticle.count({ where }), prisma.blogArticle.count(), prisma.blogArticle.count({ where: { status: 'published' } }),
    prisma.blogArticle.count({ where: { status: 'draft' } }), prisma.blogCategory.count()
  ]);
  res.json({ items, total, page, pageSize, pages: Math.ceil(total / pageSize), metrics: { total: all, published, drafts, categories } });
});
/** Copy editorial data into a new unpublished record; assets are shared rather than deleted/reuploaded. */
exports.duplicate = wrap(async (req, res) => {
  const id = req.body?.id;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id || '')) fail('Identificador de cópia inválido.');
  const copy = await prisma.$transaction(async tx => {
    const source = await current(tx, req.params.id, req.body.revision);
    const slug = source.slug.slice(0, 155).replace(/-+$/, '') + '-copia-' + id;
    const existing = await tx.blogArticle.findUnique({ where: { id }, include });
    if (existing) {
      if (existing.authorId !== req.user.id || existing.slug !== slug) fail('Identificador já utilizado.', 409);
      return existing;
    }
    const title = source.title.slice(0, 192) + ' (cópia)';
    const now = new Date();
    return tx.blogArticle.create({ data: {
      id, title, slug, summary: source.summary,
      topic: source.topic, category: source.category, cover: source.cover, coverAlt: source.coverAlt, coverCredit: source.coverCredit,
      ...(source.spotlight ? { spotlight: source.spotlight } : {}), content: source.content, seo: { ...source.seo, title }, searchText: source.searchText,
      author: req.user.name, authorId: req.user.id, status: 'draft', featured: false, revision: 1, publishedAt: now, updatedAt: now,
      sources: { create: source.sources.map(({ title, url, publisher, role, position }) => ({ title, url, publisher, role, position })) },
    }, include });
  });
  res.status(201).json(copy);
});
/** Revision checks reject deletion of an article changed after the list was loaded. */
exports.remove = wrap(async (req, res) => {
  await prisma.$transaction(async tx => {
    await current(tx, req.params.id, req.body?.revision);
    const deleted = await tx.blogArticle.deleteMany({ where: { id: req.params.id, revision: req.body.revision } });
    if (!deleted.count) fail('Artigo alterado em outra sessão. Atualize a listagem.', 409);
  });
  res.status(204).end();
});
exports.detail = wrap(async (req, res) => {
  const article = await prisma.blogArticle.findUnique({ where: { id: req.params.id }, include });
  if (!article) fail('Artigo não encontrado.', 404);
  res.json(article);
});
/** Resolve authors from active accounts; never trust a client-supplied name/photo. */
async function resolveAuthor(db, authorId, fallbackId) {
  const id = authorId === undefined || authorId === null ? fallbackId : authorId;
  if (!Number.isSafeInteger(id) || id <= 0) fail('Selecione um autor válido.');
  const user = await db.user.findFirst({ where: { id, active: true }, select: { id: true, name: true } });
  if (!user) fail('Autor inexistente ou inativo.');
  return { author: user.name, authorId: user.id };
}
exports.authors = wrap(async (_req, res) => res.json(await prisma.user.findMany({
  where: { active: true }, select: { id: true, name: true, photoUrl: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }]
})));
exports.create = wrap(async (req, res) => {
  const data = validateArticle(req.body);
  // Client-generated ID makes retry after a lost response safe without slug-based overwrites.
  if (!/^[0-9a-f-]{36}$/i.test(req.body.id || '')) fail('Identificador de criação inválido.');
  const existing = await prisma.blogArticle.findUnique({ where: { id: req.body.id } });
  if (existing) { if (existing.authorId !== (req.body.authorId ?? req.user.id)) fail('Identificador já utilizado.', 409); return res.json(existing); }
  const author = await resolveAuthor(prisma, req.body.authorId, req.user.id);
  res.status(201).json(await prisma.blogArticle.create({ data: { ...data, id: req.body.id || randomUUID(), ...author, status: 'draft', publishedAt: new Date(), updatedAt: new Date() }, include }));
});
exports.update = wrap(async (req, res) => {
  const data = validateArticle(req.body);
  res.json(await prisma.$transaction(async tx => {
    const article = await current(tx, req.params.id, req.body.revision);
    if (['published', 'demo'].includes(article.status) && data.slug !== article.slug) fail('Despublique antes de alterar o slug.');
    const author = req.body.authorId === undefined || req.body.authorId === article.authorId ? {} : await resolveAuthor(tx, req.body.authorId, article.authorId);
    // Capture legacy published photos before changing the linked draft author.
    const snapshot = article.publicSnapshot ? publicVersion(article) : formatArticle(article);
    return replace(tx, article, { ...data, ...author, updatedAt: new Date(), ...(['published', 'demo'].includes(article.status) ? { publicSnapshot: snapshot, publishedRevision: article.publishedRevision ?? article.revision } : {}) });
  }));
});
exports.transition = wrap(async (req, res) => {
  const action = req.body.action;
  if (!['publish', 'unpublish', 'archive'].includes(action)) fail('Ação inválida.');
  try {
    const saved = await prisma.$transaction(async tx => {
      const article = await current(tx, req.params.id, req.body.revision);
      const now = new Date();
      if (action === 'publish') {
        // The institutional site reads this API directly: commit the public snapshot atomically.
        return replace(tx, article, publicationData(article, now));
      }
      return replace(tx, article, { status: action === 'archive' ? 'archived' : 'draft', syncedAt: now, syncAttemptedAt: now, syncError: null });
    });
    res.json(saved);
  } catch (error) {
    if (error.status !== 409) await prisma.blogArticle.updateMany({ where: { id: req.params.id, revision: req.body.revision }, data: { syncError: error.status === 400 ? error.message : 'Falha ao disponibilizar conteúdo na API.', syncAttemptedAt: new Date() } }).catch(() => {});
    throw error;
  }
});
exports.categories = wrap(async (_req, res) => res.json(await prisma.blogCategory.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { articles: true } } } })));
/** The database Restrict relation also protects articles linked during a concurrent deletion. */
exports.removeCategory = wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (!/^[1-9]\d*$/.test(req.params.id) || !Number.isSafeInteger(id)) fail('Categoria inválida.');
  try {
    await prisma.blogCategory.delete({ where: { id } });
  } catch (error) {
    if (error.code === 'P2003') fail('Esta categoria possui artigos vinculados. Mova os artigos para outra categoria antes de excluir.', 409);
    if (error.code === 'P2025') fail('Categoria não encontrada. Atualize a listagem.', 404);
    throw error;
  }
  res.status(204).end();
});
exports.saveCategory = wrap(async (req, res) => {
  const data = { name: text(req.body.name, 100, true), description: text(req.body.description || '', 500) };
  if (req.params.id) return res.json(await prisma.blogCategory.update({ where: { id: Number(req.params.id) }, data }));
  const slug = text(req.body.slug, 200, true);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) fail('Slug inválido.');
  res.status(201).json(await prisma.blogCategory.create({ data: { ...data, slug } }));
});
