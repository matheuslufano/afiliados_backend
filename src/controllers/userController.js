const prisma = require('../database/prisma');

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

function formatUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    city: user.city,
    photoUrl: user.photoUrl,
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

      return res.json(users.map(formatUser));
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
      const role = ['ADMIN', 'MANAGER', 'USER'].includes(req.body.role)
        ? req.body.role
        : 'USER';

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

      const user = await prisma.user.create({
        data: {
          name,
          email,
          password,
          city: city || null,
          photoUrl: photoUrl || null,
          role
        }
      });

      return res.status(201).json(formatUser(user));
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
          error: 'Usuario invalido'
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
        data.photoUrl = String(req.body.photoUrl || '').trim() || null;
      }

      if (req.body.role !== undefined) {
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

      const user = await prisma.user.update({
        where: {
          id
        },
        data
      });

      return res.json(formatUser(user));
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
          error: 'Nao e possivel apagar o ultimo usuario'
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
          error: 'Usuario nao encontrado'
        });
      }

      const linkIds = user.links.map((link) => link.id);
      const conversionIds = user.links.flatMap((link) =>
        link.conversions.map((conversion) => conversion.id)
      );

      await prisma.$transaction([
        // O histórico comercial e os logs devem continuar disponíveis mesmo
        // depois que o usuário e seus links forem removidos.
        prisma.crmDeal.updateMany({
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
        }),
        prisma.webhookLog.updateMany({
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
        }),
        prisma.conversion.deleteMany({
          where: {
            linkId: {
              in: linkIds
            }
          }
        }),
        prisma.click.deleteMany({
          where: {
            linkId: {
              in: linkIds
            }
          }
        }),
        prisma.link.deleteMany({
          where: {
            userId: id
          }
        }),
        prisma.user.delete({
          where: {
            id
          }
        })
      ]);

      return res.status(204).send();
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        error: 'Erro ao apagar usuario',
        details: getErrorDetails(error)
      });
    }
  }
}

module.exports = new UserController();
