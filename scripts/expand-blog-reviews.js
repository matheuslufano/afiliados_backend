/**
 * One-off editorial update: prepare a target-specific plan, then apply it atomically.
 * Keeps article IDs, routes, authors, publication dates and statuses unchanged.
 * Usage: node scripts/expand-blog-reviews.js --plan <private-plan.json>
 *        node scripts/expand-blog-reviews.js --apply <private-plan.json> --backup <new-backup.json>
 */
require('dotenv').config({ quiet: true });
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const prisma = require('../src/database/prisma');
const { validateArticle } = require('../src/services/blogValidation');
const { publicVersion } = require('../src/controllers/blogController');
const entries = [...require('../prisma/data/blog-review-expansion-20261109.json'), ...require('../prisma/data/blog-film-expansion-20261109.json')];
const media = require('../prisma/data/blog-review-media-20261109.json');
const include = { sources: { orderBy: { position: 'asc' } }, authorUser: { select: { photoUrl: true } } };
// PostgreSQL JSONB reorders object keys; compare values independently of that order.
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const hash = value => createHash('sha256').update(JSON.stringify(canonical(JSON.parse(JSON.stringify(value))))).digest('hex');
const fingerprint = article => hash({ ...article, authorUser: undefined });
const target = () => hash(process.env.DATABASE_URL || '');
const paragraph = text => ({ type: 'paragraph', content: [{ text }] });
const heading = text => ({ type: 'heading', level: 2, content: [{ text }] });
const options = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, args) => value.startsWith('--') ? [...pairs, [value, args[index + 1]]] : pairs, []));

function originalImages(article) {
  const images = [{ src: article.cover, alt: `${article.coverAlt || article.title}. ${article.coverCredit || 'Imagem do cadastro editorial.'}` }];
  for (const section of article.content) {
    if (section.image?.src) images.push(section.image);
    for (const block of section.document || []) if (block.type === 'image' && block.src) images.push(block);
  }
  if (article.spotlight?.poster) images.push({ src: article.spotlight.poster, alt: `${article.spotlight.posterAlt || article.spotlight.title || article.title} — pôster/capa do cadastro editorial.` });
  return [...new Map(images.filter(image => image.src).map(image => [image.src, { src: image.src, alt: image.alt || article.title }])).values()];
}

function expandedContent(article, entry) {
  const assets = media[entry.id];
  if (!assets?.videos.length) throw new Error(`Mídia não preparada: ${entry.id}`);
  const images = assets.images.length ? assets.images : originalImages(article).slice(0, 2);
  if (!images.length) throw new Error(`Artigo sem imagem: ${entry.id}`);
  return entry.sections.map(([title, ...paragraphs], index) => {
    const document = [heading(title), ...paragraphs.map(paragraph)];
    if (index === 0 || index === 2) {
      const image = images[index === 0 ? 0 : 1];
      if (image) document.push({ type: 'image', src: image.src, alt: image.alt, align: 'center', width: 100 });
    }
    if (index === 1) {
      document.push(paragraph(assets.videos[0].alt));
      document.push({ type: 'video', src: assets.videos[0].src, alt: assets.videos[0].alt, align: 'center', width: 100 });
      document.push(paragraph('Se o vídeo não estiver disponível para reprodução incorporada, abra o material no site de origem:'));
      document.push({ type: 'paragraph', content: [{ text: assets.videos[0].title, href: assets.videos[0].src }] });
    }
    return { heading: title, level: 2, paragraphs, document };
  });
}

function writePrivate(file, data) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
}

async function plan(file) {
  if (new Set(entries.map(entry => entry.id)).size !== entries.length) throw new Error('IDs editoriais duplicados.');
  const changes = [];
  const missing = [];
  for (const entry of entries) {
    const article = await prisma.blogArticle.findUnique({ where: { id: entry.id }, include });
    if (!article) { missing.push(entry.id); continue; }
    const validated = validateArticle({ ...article, title: entry.title || article.title, summary: entry.sections[0][1], content: expandedContent(article, entry) });
    const sources = [...(entry.source ? [entry.source] : []), ...media[entry.id].images.map(image => ({ title: 'Capturas oficiais do jogo', url: image.source, publisher: 'Steam / desenvolvedora', role: 'promotional' })), ...media[entry.id].videos.map(video => ({ title: video.title, url: video.src, publisher: video.publisher, role: 'promotional' }))];
    changes.push({ id: article.id, revision: article.revision, fingerprint: fingerprint(article), title: validated.title, summary: validated.summary, content: validated.content, searchText: validated.searchText, sources: [...new Map(sources.map(source => [source.url, source])).values()] });
  }
  writePrivate(file, { version: 1, target: target(), createdAt: new Date().toISOString(), missing, changes });
  console.log(JSON.stringify({ planned: changes.length, missing, file }));
}

async function apply(file, backupFile) {
  if (!backupFile) throw new Error('Informe --backup antes de aplicar.');
  const plan = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (plan.version !== 1 || plan.target !== target()) throw new Error('Plano de outro banco. Gere um plano no destino correto.');
  if (!Array.isArray(plan.changes) || new Set(plan.changes.map(change => change.id)).size !== plan.changes.length) throw new Error('Plano inválido.');
  const originals = await prisma.blogArticle.findMany({ where: { id: { in: plan.changes.map(change => change.id) } }, include });
  if (originals.length !== plan.changes.length) throw new Error('Artigo removido desde o planejamento.');
  for (const article of originals) {
    const change = plan.changes.find(change => change.id === article.id);
    if (fingerprint(article) !== change.fingerprint) throw new Error(`Conteúdo alterado: ${article.slug}. Gere novo plano.`);
  }
  writePrivate(backupFile, { createdAt: new Date().toISOString(), articles: originals });
  const now = new Date();
  await prisma.$transaction(async tx => {
    for (const change of plan.changes) {
      const article = await tx.blogArticle.findUnique({ where: { id: change.id }, include });
      if (!article || fingerprint(article) !== change.fingerprint) throw new Error(`Conflito: ${change.id}`);
      const validated = validateArticle({ ...article, title: change.title, summary: change.summary, content: change.content });
      const sources = [...article.sources];
      for (const source of change.sources) {
        if (sources.some(existing => existing.url === source.url)) continue;
        sources.push(await tx.blogArticleSource.create({ data: { ...source, articleId: article.id, position: sources.length } }));
      }
      const publicData = ['published', 'demo'].includes(article.status) ? {
        publicSnapshot: { ...publicVersion(article), title: validated.title, summary: validated.summary, content: validated.content, seo: { ...(publicVersion(article).seo || {}), title: validated.title, description: validated.summary }, sources: sources.map(({ title, url, publisher, role }) => ({ title, url, publisher, role })), updatedAt: now.toISOString().slice(0, 10) },
        publishedRevision: article.revision + 1, syncedAt: now, syncAttemptedAt: now, syncError: null,
      } : {};
      const result = await tx.blogArticle.updateMany({ where: { id: article.id, revision: article.revision }, data: { title: validated.title, summary: validated.summary, content: validated.content, searchText: validated.searchText, seo: { ...article.seo, title: validated.title, description: validated.summary }, revision: { increment: 1 }, updatedAt: now, ...publicData } });
      if (result.count !== 1) throw new Error(`Revisão em conflito: ${article.slug}`);
    }
  }, { timeout: 60000, isolationLevel: 'Serializable' });
  for (const change of plan.changes) {
    const article = await prisma.blogArticle.findUnique({ where: { id: change.id }, include });
    if (hash(article.content) !== hash(change.content) || (['published', 'demo'].includes(article.status) && hash(publicVersion(article).content) !== hash(change.content))) throw new Error(`Verificação falhou: ${change.id}`);
  }
  console.log(JSON.stringify({ applied: plan.changes.length, backup: backupFile, publicSnapshotsVerified: true }));
}

if (require.main === module) {
  (async () => {
    if (Boolean(options['--plan']) === Boolean(options['--apply'])) throw new Error('Escolha --plan ou --apply.');
    if (options['--plan']) await plan(options['--plan']);
    else await apply(options['--apply'], options['--backup']);
  })().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
}
