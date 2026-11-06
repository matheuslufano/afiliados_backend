const prisma = require('../database/prisma');

const PUBLIC_STATUSES = ['demo', 'published'];
const MAX_QUERY_LENGTH = 160;

function dateOnly(value) {
  return value.toISOString().slice(0, 10);
}

/** Convert the relational record to the contract consumed by the Netbox Blog. */
function formatArticle(article) {
  const blogBaseUrl = String(process.env.BLOG_SITE_URL || '').replace(/\/$/, '');

  return {
    id: article.id,
    slug: article.slug,
    title: article.title,
    summary: article.summary,
    topic: article.topic,
    category: article.category,
    cover: article.cover,
    coverAlt: article.coverAlt,
    coverCredit: article.coverCredit,
    spotlight: article.spotlight,
    author: article.author,
    authorPhotoUrl: article.authorUser?.photoUrl || '',
    publishedAt: dateOnly(article.publishedAt),
    updatedAt: dateOnly(article.updatedAt),
    status: article.status,
    featured: article.featured,
    content: article.content,
    seo: article.seo,
    sources: article.sources.map(({ title, url, publisher, role }) => ({
      title,
      url,
      publisher,
      ...(role !== 'reference' ? { role } : {})
    })),
    ...(blogBaseUrl ? { url: `${blogBaseUrl}/${article.slug}` } : {})
  };
}

// Working copies must never leak through the public read API.
function publicVersion(article) {
  const published = article.publicSnapshot || formatArticle(article);
  // Legacy snapshots can resolve a missing photo; new snapshots freeze the published identity.
  return !Object.hasOwn(published, 'authorPhotoUrl') && published.author === article.author && article.authorUser?.photoUrl
    ? { ...published, authorPhotoUrl: article.authorUser.photoUrl } : published;
}

function publicArticleWhere({ category = '', query = '' } = {}) {
  const terms = String(query).trim().slice(0, MAX_QUERY_LENGTH).split(/\s+/).filter(Boolean);
  return {
    status: { in: PUBLIC_STATUSES },
    publishedAt: { lte: new Date() },
    ...(category ? { category } : {}),
    ...(terms.length
      ? {
          AND: terms.map((term) => ({
            OR: ['title', 'summary', 'topic', 'category'].map((field) => ({
              [field]: { contains: term, mode: 'insensitive' }
            }))
          }))
        }
      : {})
  };
}

class BlogController {
  async list(req, res) {
    try {
      const articles = await prisma.blogArticle.findMany({
        where: publicArticleWhere(),
        include: { sources: { orderBy: { position: 'asc' } }, authorUser: { select: { photoUrl: true } } },
        orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }]
      });
      const category = String(req.query.category || '').trim();
      const terms = String(req.query.q || '').trim().slice(0, MAX_QUERY_LENGTH).toLocaleLowerCase().split(/\s+/).filter(Boolean);
      return res.json(articles.map(publicVersion).filter(article => (!category || article.category === category) && terms.every(term => [article.title, article.summary, article.topic, article.category, JSON.stringify(article.content)].join(' ').toLocaleLowerCase().includes(term))));
    } catch (error) {
      console.error('Erro ao listar artigos do Blog:', error);
      return res.status(500).json({ error: 'Erro ao carregar artigos do Blog.' });
    }
  }

  async detail(req, res) {
    try {
      const article = await prisma.blogArticle.findFirst({
        where: { slug: req.params.slug, ...publicArticleWhere() },
        include: { sources: { orderBy: { position: 'asc' } }, authorUser: { select: { photoUrl: true } } }
      });
      if (!article) return res.status(404).json({ error: 'Artigo não encontrado.' });
      return res.json(publicVersion(article));
    } catch (error) {
      console.error('Erro ao carregar artigo do Blog:', error);
      return res.status(500).json({ error: 'Erro ao carregar artigo do Blog.' });
    }
  }
}

module.exports = new BlogController();
module.exports.formatArticle = formatArticle;
module.exports.publicArticleWhere = publicArticleWhere;
module.exports.publicVersion = publicVersion;
