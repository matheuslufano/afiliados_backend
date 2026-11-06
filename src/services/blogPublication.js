const { validateArticle, validatePublication } = require('./blogValidation');
const { formatArticle } = require('../controllers/blogController');

/**
 * The institutional repository pulls /blog/articles from this same database.
 * Publishing therefore commits a public snapshot, without inventing a remote POST.
 * syncedAt records API availability, never a confirmation of website rendering.
 */
function publicationData(article, now = new Date()) {
  validatePublication(validateArticle(article));
  const publishedAt = article.status === 'published' ? article.publishedAt : now;
  return { status: 'published', publishedAt, publicSnapshot: formatArticle({ ...article, status: 'published', publishedAt }), publishedRevision: article.revision + 1, syncedAt: now, syncAttemptedAt: now, syncError: null };
}
module.exports = { publicationData };
