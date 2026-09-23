const prisma = require('../database/prisma');
const { resolveProfilePhotoUrl, storedProfilePhotoUrl } = require('../utils/profilePhotos');

function getErrorDetails(error) {
  const parts = [];

  if (error?.code) {
    parts.push(`Codigo: ${error.code}`);
  }

  if (error?.message) {
    parts.push(String(error.message).replace(/\s+/g, ' ').trim());
  }

  const message = parts.join(' - ') || 'Erro interno sem detalhes disponiveis';

  return message.slice(0, 700);
}

async function formatUser(user) {
  const photoUrl = storedProfilePhotoUrl(
    user.photoUrl,
    'user',
    user.id || user.email || user.name
  );
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    city: user.city,
    photoUrl,
    role: user.role,
    active: user.active,
    teamId: user.teamId,
    createdAt: user.createdAt
  };
}

class UserController {
  async list(req, res) {
    try {
      const users = await prisma.user.findMany({
        orderBy: {
          createdAt: 'desc'
        }
      });

      return res.json(await Promise.all(users.map(formatUser)));
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        error: 'Erro ao listar usuarios',
        details: getErrorDetails(error)
      });
    }
  }

  async create(req, res) {
    try {
      const name = String(req.body.name || '').trim();
      const email = String(req.body.email || '').trim().toLowerCase();
      const password = String(req.body.password || '').trim();
      const city = String(req.body.city || '').trim();
      const photoUrl = String(req.body.photoUrl || '').trim();
      const requestedRole = ['ADMIN', 'MANAGER', 'USER'].includes(req.body.role)
        ? req.body.role
        : 'USER';
      const role = req.user?.role === 'ADMIN' ? requestedRole : 'USER';

      if (!name || !email || !password) {
        return res.status(400).json({
          error: 'Nome, e-mail e senha sao obrigatorios'
        });
      }

      if (password.length < 6) {
        return res.status(400).json({
          error: 'A senha precisa ter pelo menos 6 caracteres'
        });
      }

      const generatedPhotoUrl = photoUrl || await resolveProfilePhotoUrl('profile', email);
      const user = await prisma.$transaction(async (transaction) => {
        const createdUser = await transaction.user.create({
          data: {
            name,
            email,
            password,
            city: city || null,
            photoUrl: generatedPhotoUrl,
            role
          }
        });

        await transaction.affiliate.create({
          data: {
            name,
            email,
            city: city || null,
            photoUrl: generatedPhotoUrl,
            userId: createdUser.id
          }
        });

        return createdUser;
      });

      return res.status(201).json(await formatUser(user));
    } catch (error) {
      if (error?.code === 'P2002') {
        return res.status(409).json({
          error: 'E-mail ja cadastrado'
        });
      }

      console.error(error);

      return res.status(500).json({
        error: 'Erro ao criar usuario',
        details: getErrorDetails(error)
      });
    }
  }

  async update(req, res) {
    try {
      const id = Number(req.params.id);

      if (!Number.isFinite(id) || id <= 0) {
        return res.status(400).json({
          error: 'Usuário inválido.',
          reason: 'O identificador recebido não corresponde a um usuário válido.'
        });
      }

      const data = {};

      if (req.body.name !== undefined) {
        const name = String(req.body.name || '').trim();
        if (!name) {
          return res.status(400).json({
            error: 'Nome e obrigatorio'
          });
        }

        data.name = name;
      }

      if (req.body.email !== undefined) {
        const email = String(req.body.email || '').trim().toLowerCase();
        if (!email) {
          return res.status(400).json({
            error: 'E-mail e obrigatorio'
          });
        }

        data.email = email;
      }

      if (req.body.city !== undefined) {
        data.city = String(req.body.city || '').trim() || null;
      }

      if (req.body.photoUrl !== undefined) {
        data.photoUrl = String(req.body.photoUrl || '').trim() || await resolveProfilePhotoUrl('profile', id);
      }

      if (req.body.role !== undefined && req.user?.role === 'ADMIN') {
        if (!['ADMIN', 'MANAGER', 'USER'].includes(req.body.role)) {
          return res.status(400).json({
            error: 'Nivel de acesso invalido'
          });
        }

        data.role = req.body.role;
      }

      if (req.body.active !== undefined) {
        data.active = Boolean(req.body.active);
      }

      if (req.body.password !== undefined) {
        const password = String(req.body.password || '').trim();
        if (password) {
          if (password.length < 6) {
            return res.status(400).json({
              error: 'A senha precisa ter pelo menos 6 caracteres'
            });
          }

          data.password = password;
        }
      }

      const user = await prisma.$transaction(async (transaction) => {
        const updatedUser = await transaction.user.update({
          where: { id },
          data
        });

        const affiliateData = {};
        if (data.name !== undefined) affiliateData.name = data.name;
        if (data.email !== undefined) affiliateData.email = data.email;
        if (data.city !== undefined) affiliateData.city = data.city;
        if (data.photoUrl !== undefined) affiliateData.photoUrl = data.photoUrl;

        if (Object.keys(affiliateData).length > 0) {
          await transaction.affiliate.updateMany({
            where: { userId: id },
            data: affiliateData
          });
        }

        return updatedUser;
      });

      return res.json(await formatUser(user));
    } catch (error) {
      if (error?.code === 'P2002') {
        return res.status(409).json({
          error: 'E-mail ja cadastrado'
        });
      }

      if (error?.code === 'P2025') {
        return res.status(404).json({
          error: 'Usuario nao encontrado'
        });
      }

      console.error(error);

      return res.status(500).json({
        error: 'Erro ao atualizar usuario',
        details: getErrorDetails(error)
      });
    }
  }

  async delete(req, res) {
    try {
      const id = Number(req.params.id);

      if (!Number.isFinite(id) || id <= 0) {
        return res.status(400).json({
          error: 'Usuario invalido'
        });
      }

      const totalUsers = await prisma.user.count();
      if (totalUsers <= 1) {
        return res.status(400).json({
          error: 'Não é possível apagar o último usuário.',
          reason: 'O sistema precisa manter pelo menos uma conta para permitir acesso administrativo.'
        });
      }

      const user = await prisma.user.findUnique({
        where: {
          id
        },
        include: {
          links: {
            select: {
              id: true,
              conversions: {
                select: {
                  id: true
                }
              }
            }
          }
        }
      });

      if (!user) {
        return res.status(404).json({
          error: 'Usuário não encontrado.',
          reason: 'Ele pode já ter sido removido por outra sessão.'
        });
      }

      const linkIds = user.links.map((link) => link.id);
      const conversionIds = user.links.flatMap((link) =>
        link.conversions.map((conversion) => conversion.id)
      );

      const deleted = await prisma.$transaction(async (tx) => {
        // Links de WhatsApp restringem tanto o usuário criador quanto o link.
        // Removê-los primeiro evita a falha de chave estrangeira que impedia
        // a exclusão de usuários com atividade.
        const whatsappLinks = await tx.whatsAppLink.deleteMany({
          where: {
            OR: [
              { createdById: id },
              { linkId: { in: linkIds } }
            ]
          }
        });
        const crmDeals = await tx.crmDeal.updateMany({
          where: {
            OR: [
              { linkId: { in: linkIds } },
              { conversionId: { in: conversionIds } }
            ]
          },
          data: {
            linkId: null,
            conversionId: null
          }
        });
        const webhookLogs = await tx.webhookLog.updateMany({
          where: {
            OR: [
              { linkId: { in: linkIds } },
              { conversionId: { in: conversionIds } }
            ]
          },
          data: {
            linkId: null,
            conversionId: null
          }
        });
        const conversions = await tx.conversion.deleteMany({
          where: {
            linkId: {
              in: linkIds
            }
          }
        });
        const clicks = await tx.click.deleteMany({
          where: {
            linkId: {
              in: linkIds
            }
          }
        });
        const links = await tx.link.deleteMany({
          where: {
            userId: id
          }
        });
        await tx.user.delete({ where: { id } });

        return {
          user: 1,
          links: links.count,
          whatsappLinks: whatsappLinks.count,
          clicks: clicks.count,
          conversions: conversions.count,
          detachedCrmDeals: crmDeals.count,
          detachedWebhookLogs: webhookLogs.count
        };
      });

      return res.status(200).json({
        message: `Usuário ${user.name} removido definitivamente.`,
        reason: 'Os links e dados operacionais pertencentes ao usuário foram removidos; históricos comerciais foram preservados sem esses vínculos.',
        deleted
      });
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        error: 'Erro ao apagar usuário.',
        reason: 'A operação foi desfeita por segurança e o usuário não foi removido.',
        details: getErrorDetails(error)
      });
    }
  }
}

module.exports = new UserController();
