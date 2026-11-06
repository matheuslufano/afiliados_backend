const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { mediaDirectory, MAX_IMAGE_BYTES, saveImage } = require('../services/blogMedia');
const router = express.Router();
const prisma = require('../database/prisma');
const tmdb = require('../services/blogTmdb');
const catalog = require('../services/blogImageCatalog');
const wrap = handler => async (req, res) => {
  try { await handler(req, res); }
  catch (error) { res.status(error.status || 503).json({ error: error.status ? error.message : 'Não foi possível consultar ou salvar a imagem. Tente novamente.' }); }
};
router.get('/admin/blog/tmdb/search', requireAuth, wrap(async (req, res) => res.json(await tmdb.search(req.query.q, req.query.page))));
router.get('/admin/blog/tmdb/:kind/:id/images', requireAuth, wrap(async (req, res) => res.json(await tmdb.images(req.params.kind, req.params.id))));
async function importImage(req, res, download) {
  const base = process.env.BLOG_MEDIA_PUBLIC_URL || (process.env.NODE_ENV !== 'production' ? `http://localhost:${req.socket.localPort}` : '');
  let origin;
  try { origin = new URL(base); } catch {}
  if (!origin || !['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) return res.status(503).json({ error: 'Configure BLOG_MEDIA_PUBLIC_URL com a origem pública do backend.' });
  const data = await download();
  const asset = await prisma.blogMediaAsset.create({ data, select: { id: true, name: true } });
  res.status(201).json({ url: `${origin.origin}/blog/media/assets/${asset.id}`, alt: asset.name });
}
router.post('/admin/blog/tmdb/import', requireAuth, wrap(async (req, res) => {
  const { kind, id, path } = req.body || {};
  await importImage(req, res, () => tmdb.download(kind, id, path));
}));
router.get('/admin/blog/catalog/:provider/search', requireAuth, wrap(async (req, res) => res.json(await catalog.search(req.params.provider, req.query.q, req.query.page))));
router.get('/admin/blog/catalog/:provider/:kind/:id/images', requireAuth, wrap(async (req, res) => res.json(await catalog.images(req.params.provider, req.params.kind, req.params.id))));
router.post('/admin/blog/catalog/:provider/import', requireAuth, wrap(async (req, res) => {
  const { kind, id, path } = req.body || {};
  await importImage(req, res, () => catalog.download(req.params.provider, kind, id, path));
}));
router.get('/blog/media/assets/:id', wrap(async (req, res) => {
  if (!/^[a-f0-9-]{36}$/i.test(req.params.id)) return res.sendStatus(404);
  const asset = await prisma.blogMediaAsset.findUnique({ where: { id: req.params.id } });
  if (!asset) return res.sendStatus(404);
  res.set({ 'Content-Type': asset.mime, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=31536000, immutable' }).send(Buffer.from(asset.bytes));
}));

// Reads are public because published articles embed these assets. Upload remains administrative.
router.use('/blog/media', express.static(mediaDirectory, { dotfiles: 'deny', index: false, immutable: true, maxAge: '1y', setHeaders(res) { res.setHeader('X-Content-Type-Options', 'nosniff'); } }));
router.post('/admin/blog/media', requireAuth, express.raw({ type: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'], limit: MAX_IMAGE_BYTES }), async (req, res) => {
  try {
    const base = process.env.BLOG_MEDIA_PUBLIC_URL || (process.env.NODE_ENV !== 'production' ? `http://localhost:${req.socket.localPort}` : '');
    let publicOrigin;
    try { publicOrigin = new URL(base); } catch {}
    if (!publicOrigin || !['http:', 'https:'].includes(publicOrigin.protocol) || publicOrigin.username || publicOrigin.password || publicOrigin.search || publicOrigin.hash || publicOrigin.pathname !== '/') return res.status(503).json({ error: 'Configure BLOG_MEDIA_PUBLIC_URL com a origem pública do backend para permitir envio de imagens.' });
    const filename = await saveImage(req.body, req.get('content-type')?.split(';')[0]);
    res.status(201).json({ url: `${publicOrigin.origin}/blog/media/${filename}` });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Não foi possível salvar a imagem no servidor.' });
  }
});
router.use((error, _req, res, next) => {
  if (error.type === 'entity.too.large') return res.status(413).json({ error: 'A imagem deve ter até 8 MB.' });
  next(error);
});
module.exports = router;
