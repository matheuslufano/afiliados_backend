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

class AffiliateController {

  async create(req, res) {
    try {
      const {
        name,
        email,
        phone,
        city,
        photoUrl
      } = req.body;

      const trimmedName = String(name || '').trim();
      const trimmedEmail = String(email || '').trim();
      const trimmedPhone = String(phone || '').trim();
      const trimmedCity = String(city || '').trim();
      const trimmedPhotoUrl = String(photoUrl || '').trim();

      if (!trimmedName || !trimmedEmail) {
        return res.status(400).json({
          error: 'Nome e email sao obrigatorios'
        });
      }

      const affiliate =
        await prisma.affiliate.create({
          data: {
            name: trimmedName,
            email: trimmedEmail,
            phone: trimmedPhone || null,
            city: trimmedCity || null,
            photoUrl: trimmedPhotoUrl || null
          }
        });

      return res.status(201).json(
        affiliate
      );
    } catch (error) {
      if (error?.code === 'P2002') {
        return res.status(409).json({
          error: 'E-mail ja cadastrado'
        });
      }

      console.error(error);

      return res.status(500).json({
        error: 'Erro ao criar afiliado',
        details: getErrorDetails(error)
      });
    }
  }

  async list(req, res) {
    try {
      const affiliates =
        await prisma.affiliate.findMany({
          orderBy: {
            createdAt: 'desc'
          }
        });

      return res.json(affiliates);

    } catch (error) {
      console.error(error);

      return res.status(500).json({
        error: 'Erro ao listar afiliados',
        details: getErrorDetails(error)
      });
    }
  }

  async update(req, res) {
    try {
      const { id } = req.params;

      const {
        name,
        email,
        phone,
        city,
        photoUrl,
        active
      } = req.body;

      const data = {};

      if (name !== undefined) {
        data.name = String(name).trim();
      }

      if (email !== undefined) {
        data.email = String(email).trim();
      }

      if (phone !== undefined) {
        data.phone = String(phone).trim() || null;
      }

      if (city !== undefined) {
        data.city = String(city).trim() || null;
      }

      if (photoUrl !== undefined) {
        data.photoUrl = String(photoUrl).trim() || null;
      }

      if (active !== undefined) {
        data.active = active;
      }

      const affiliate = await prisma.$transaction(async (transaction) => {
        const updatedAffiliate = await transaction.affiliate.update({
          where: { id: Number(id) },
          data
        });

        const userData = {};
        if (data.name !== undefined) userData.name = data.name;
        if (data.email !== undefined) userData.email = data.email;
        if (data.city !== undefined) userData.city = data.city;
        if (data.photoUrl !== undefined) userData.photoUrl = data.photoUrl;

        if (updatedAffiliate.userId && Object.keys(userData).length > 0) {
          await transaction.user.update({
            where: { id: updatedAffiliate.userId },
            data: userData
          });
        }

        return updatedAffiliate;
      });

      return res.json(affiliate);

    } catch (error) {
      if (error?.code === 'P2002') {
        return res.status(409).json({
          error: 'E-mail ja cadastrado'
        });
      }

      console.error(error);

      return res.status(500).json({
        error: 'Erro ao atualizar afiliado',
        details: getErrorDetails(error)
      });
    }
  }

  async delete(req, res) {
    try {
      const { id } = req.params;
      const affiliateId = Number(id);

      if (!Number.isInteger(affiliateId) || affiliateId <= 0) {
        return res.status(400).json({ error: 'Afiliado inválido' });
      }

      const affiliate = await prisma.affiliate.findUnique({
        where: { id: affiliateId },
        include: {
          _count: {
            select: {
              links: true,
              whatsappLinks: true,
              crmDeals: true,
              affiliateCommissions: true
            }
          }
        }
      });

      if (!affiliate) {
        return res.status(404).json({ error: 'Afiliado não encontrado' });
      }

      const hasHistory = Object.values(affiliate._count).some((count) => count > 0);

      if (hasHistory) {
        await prisma.affiliate.update({
          where: { id: affiliateId },
          data: { active: false }
        });

        return res.json({
          message: 'Afiliado arquivado porque possui histórico vinculado',
          archived: true
        });
      }

      await prisma.affiliate.delete({
        where: {
          id: affiliateId
        }
      });

      return res.json({
        message:
          'Afiliado removido',
        archived: false
      });

    } catch (error) {
      if (error?.code === 'P2003') {
        return res.status(409).json({
          error: 'Não é possível remover este afiliado porque possui dados vinculados'
        });
      }
      console.error(error);

      return res.status(500).json({
        error: 'Erro ao deletar afiliado',
        details: getErrorDetails(error)
      });
    }
  }
}

module.exports =
  new AffiliateController();
