const crypto = require('crypto');
const prisma = require('../database/prisma');

function createToken(user) {
  const secret =
    process.env.JWT_SECRET ||
    'minha_chave_super_secreta';

  const payload = {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: new Date().toISOString()
  };

  const encodedPayload = Buffer
    .from(JSON.stringify(payload))
    .toString('base64url');

  const signature = crypto
    .createHmac('sha256', secret)
    .update(encodedPayload)
    .digest('base64url');

  return `${encodedPayload}.${signature}`;
}

class AuthController {
  async login(req, res) {
    try {
      const email = String(req.body.email || '')
        .trim()
        .toLowerCase();

      const password = String(req.body.password || '');

      if (!email || !password) {
        return res.status(400).json({
          error: 'E-mail e senha sao obrigatorios'
        });
      }

      const user = await prisma.user.findUnique({
        where: {
          email
        }
      });

      if (!user || user.password !== password) {
        return res.status(401).json({
          error: 'E-mail ou senha invalidos'
        });
      }

      return res.json({
        token: createToken(user),
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          city: user.city
        }
      });
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        error: 'Erro ao fazer login'
      });
    }
  }
}

module.exports = new AuthController();
