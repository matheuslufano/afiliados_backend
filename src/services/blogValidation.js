const { validateDocument } = require('./blogRichDocument');
/** Structured blocks match the institutional renderer; arbitrary HTML is never accepted. */
function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
function text(value, max = 500, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail('Texto obrigatório, inválido ou muito longo.');
  return value.trim();
}
function safeUrl(value, image = false) {
  if (!value) return '';
  if (image && /^\/(?!\/)[^\s\\]*$/.test(value)) return value;
  try { const url = new URL(value); if (url.protocol === 'https:' || url.protocol === 'http:') return url.href; } catch {}
  fail('Informe uma URL HTTP(S) válida.');
}
/** Reuse the existing spotlight JSON for original artwork; omit it for older clients. */
function validateSpotlight(value, articleTitle) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Capa da obra inválida.');
  const spotlight = {
    title: text(value.title || articleTitle, 300, true),
    poster: safeUrl(text(value.poster || '', 2000), true),
    posterAlt: text(value.posterAlt || '', 500),
  };
  if (value.trailerUrl) spotlight.trailerUrl = safeUrl(text(value.trailerUrl, 2000));
  return spotlight;
}
function validateArticle(body) {
  if (!body || typeof body !== 'object') fail('Envie um objeto JSON válido.');
  const title = text(body.title, 200, true);
  const slug = text(body.slug, 200, true);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) fail('Slug inválido. Use letras minúsculas, números e hífens.');
  if (!Array.isArray(body.content) || body.content.length > 100) fail('Conteúdo inválido.');
  const content = body.content.map(section => {
    if (!section || !Array.isArray(section.paragraphs) || section.paragraphs.length > (section.document ? 500 : 100)) fail('Bloco inválido.');
    const result = { heading: text(section.heading, 300), level: section.level === 3 ? 3 : 2, paragraphs: section.paragraphs.map(p => text(p, 20000)) };
    if (section.document) {
      result.document = validateDocument(section.document, { fail, text, safeUrl });
      result.paragraphs = result.document.filter(b => b.content).map(b => b.content.map(run => run.text).join(''));
    }
    if (section.list) {
      if (!Array.isArray(section.list) || section.list.length > 100) fail('Lista inválida.');
      result.list = section.list.map(p => text(p, 2000));
    }
    if (section.link?.href) result.link = { label: text(section.link.label, 300, true), href: safeUrl(section.link.href) };
    if (section.image?.src) result.image = { src: safeUrl(section.image.src, true), alt: text(section.image.alt, 500, true) };
    return result;
  });
  return { title, slug, summary: text(body.summary, 1000), category: text(body.category, 200, true), cover: safeUrl(text(body.cover, 2000), true), coverAlt: text(body.coverAlt, 500), ...(body.spotlight != null ? { spotlight: validateSpotlight(body.spotlight, title) } : {}), content, seo: { title, description: text(body.summary, 1000) }, searchText: JSON.stringify(content) };
}
function validatePublication(article) {
  if (!article.summary || !article.cover || !article.coverAlt || !article.content.some(s => s.paragraphs.some(p => p.trim()))) fail('Para publicar, preencha resumo, capa, texto alternativo e conteúdo.');
}
module.exports = { fail, text, safeUrl, validateArticle, validatePublication };
