const prisma = require('../database/prisma');
const {
  resolveProfilePhotoUrl,
  storedProfilePhotoUrl,
  withProfilePhoto
} = require('../utils/profilePhotos');

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

      const generatedPhotoUrl = trimmedPhotoUrl || await resolveProfilePhotoUrl('affiliate', trimmedEmail);
      const affiliate =
        await prisma.affiliate.create({
          data: {
            name: trimmedName,
            email: trimmedEmail,
            phone: trimmedPhone || null,
            city: trimmedCity || null,
            photoUrl: generatedPhotoUrl
          }
        });

      return res.status(201).json(
        withProfilePhoto(affiliate, 'affiliate')
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

      return res.json(await Promise.all(affiliates.map(async (affiliate) => ({
        ...affiliate,
        photoUrl: storedProfilePhotoUrl(
          affiliate.photoUrl,
          'affiliate',
          affiliate.id || affiliate.email || affiliate.name
        )
      }))));

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
        data.photoUrl = String(photoUrl).trim() || await resolveProfilePhotoUrl('affiliate', id);
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

      return res.json(withProfilePhoto(affiliate, 'affiliate'));

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

      const deleted = await prisma.$transaction(async (tx) => {
        // O WhatsAppLink usa restrição de exclusão. Ele precisa ser removido
        // antes do perfil; links e negócios permanecem como histórico, sem o
        // vínculo com o afiliado excluído.
        const whatsappLinks = await tx.whatsAppLink.deleteMany({
          where: { affiliateId }
        });
        const commissions = await tx.affiliateCommission.deleteMany({
          where: { affiliateId }
        });
        const crmDeals = await tx.crmDeal.updateMany({
          where: { affiliateId },
          data: { affiliateId: null }
        });
        const links = await tx.link.updateMany({
          where: { affiliateId },
          data: { affiliateId: null }
        });

        await tx.affiliate.delete({ where: { id: affiliateId } });

        return {
          affiliate: 1,
          whatsappLinks: whatsappLinks.count,
          commissions: commissions.count,
          detachedCrmDeals: crmDeals.count,
          detachedLinks: links.count
        };
      });

      return res.json({
        message: `Afiliado ${affiliate.name} removido definitivamente.`,
        reason: 'Os registros históricos foram preservados sem vínculo com o perfil excluído.',
        archived: false,
        deleted
      });

    } catch (error) {
      if (error?.code === 'P2025') {
        return res.status(404).json({
          error: 'Afiliado nÃ£o encontrado',
          reason: 'O afiliado jÃ¡ foi removido ou nÃ£o estÃ¡ mais disponÃ­vel.'
        });
      }

      if (error?.code === 'P2003') {
        return res.status(409).json({
          error: 'Não foi possível remover o afiliado porque ainda existem dados vinculados.',
          reason: 'Nenhum dado foi alterado. Atualize a página e tente novamente.'
        });
      }
      console.error(error);

      return res.status(500).json({
        error: 'Erro ao apagar afiliado.',
        reason: 'A operação foi desfeita por segurança e o afiliado não foi removido.',
        details: getErrorDetails(error)
      });
    }
  }
}

module.exports =
  new AffiliateController();
