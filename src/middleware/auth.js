const crypto = require('crypto');
const prisma = require('../database/prisma');

function verifyToken(token) {
  const [encodedPayload, signature] = String(token || '').split('.');

  if (!encodedPayload || !signature) {
    return null;
  }

  const secret = process.env.JWT_SECRET || 'minha_chave_super_secreta';
  const expected = crypto
    .createHmac('sha256', secret)
    .update(encodedPayload)
    .digest('base64url');
  const receivedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (
    receivedBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(receivedBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

async function requireAuth(req, res, next) {
  try {
    const authorization = String(req.headers.authorization || '');
    const token = authorization.startsWith('Bearer ')
      ? authorization.slice(7).trim()
      : '';
    const payload = verifyToken(token);

    if (!payload?.id) {
      return res.status(401).json({ error: 'Autenticacao obrigatoria' });
    }

    const user = await prisma.user.findUnique({
      where: { id: Number(payload.id) },
      select: {
        id: true,
        name: true,
        email: true,
        photoUrl: true,
        role: true,
        active: true,
        teamId: true
      }
    });

    if (!user?.active) {
      return res.status(401).json({ error: 'Usuario inativo ou inexistente' });
    }

    req.user = user;
    return next();
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao validar autenticacao' });
  }
}

function requireManager(req, res, next) {
  if (!['ADMIN', 'MANAGER'].includes(req.user?.role)) {
    return res.status(403).json({ error: 'Permissao de gestor obrigatoria' });
  }

  return next();
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Permissao de administrador obrigatoria' });
  }

  return next();
}

module.exports = {
  requireAuth,
  requireAdmin,
  requireManager,
  verifyToken
};
