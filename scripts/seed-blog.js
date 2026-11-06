require('dotenv').config();

const { readFile } = require('fs/promises');
const path = require('path');
const prisma = require('../src/database/prisma');

const dataPath = path.join(__dirname, '..', 'prisma', 'data', 'blog-articles.json');

function asDate(value, field, slug) {
  const date = new Date(`${value}T12:00:00.000Z`);
  if (Number.isNaN(date.valueOf())) throw new Error(`${field} inválida em ${slug}`);
  return date;
}

async function upsertArticle(article) {
  const data = {
    slug: article.slug,
    title: article.title,
    summary: article.summary,
    topic: article.topic || null,
    category: article.category,
    cover: article.cover,
    coverAlt: article.coverAlt,
    coverCredit: article.coverCredit || null,
    author: article.author,
    publishedAt: asDate(article.publishedAt, 'publishedAt', article.slug),
    updatedAt: asDate(article.updatedAt, 'updatedAt', article.slug),
    status: article.status,
    featured: Boolean(article.featured),
    content: article.content,
    searchText: JSON.stringify(article.content),
    seo: article.seo,
    spotlight: article.spotlight || undefined
  };

  await prisma.$transaction(async (tx) => {
    // Never overwrite a working copy maintained in the administrative panel.
    const existing = await tx.blogArticle.findUnique({ where: { id: article.id } });
    if (existing && (existing.revision > 1 || existing.authorId)) return;
    await tx.blogCategory.upsert({ where: { slug: article.category }, create: { slug: article.category, name: article.category }, update: {} });
    await tx.blogArticle.upsert({
      where: { id: article.id },
      create: { id: article.id, ...data },
      update: data
    });
    await tx.blogArticleSource.deleteMany({ where: { articleId: article.id } });
    if (article.sources?.length) {
      await tx.blogArticleSource.createMany({
        data: article.sources.map((source, position) => ({
          articleId: article.id,
          title: source.title,
          url: source.url,
          publisher: source.publisher,
          role: source.role || 'reference',
          position
        }))
      });
    }
  });
}

async function main() {
  const articles = JSON.parse(await readFile(dataPath, 'utf8'));
  if (!Array.isArray(articles) || !articles.length) throw new Error('Catálogo editorial vazio.');
  if (new Set(articles.map(({ slug }) => slug)).size !== articles.length) throw new Error('Há slugs duplicados.');

  for (const article of articles) await upsertArticle(article);
  console.log(`${articles.length} artigos do Blog sincronizados.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
