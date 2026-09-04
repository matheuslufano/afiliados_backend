const prisma = require('../database/prisma');
const whatsappLinkService = require('../services/whatsappLinkService');
const { configuredWhatsAppNumber } = require('../utils/whatsapp');

function handleError(res, error, fallback) {
  if (error?.status) return res.status(error.status).json({ error: error.message });
  console.error(error);
  return res.status(500).json({ error: fallback });
}

class WhatsAppLinkController {
  async config(req, res) {
    return res.json({ whatsappNumber: configuredWhatsAppNumber() });
  }

  async listCodes(req, res) {
    try {
      const campaignId = Number(req.query.campaignId) || undefined;
      const affiliateId = Number(req.query.affiliateId) || undefined;
      const search = String(req.query.search || '').trim();
      const links = await prisma.link.findMany({
        where: {
          active: true,
          affiliateId: affiliateId || { not: null },
          ...(campaignId && { campaignId }),
          ...(search && {
            OR: [
              { shortCode: { contains: search, mode: 'insensitive' } },
              { affiliate: { name: { contains: search, mode: 'insensitive' } } },
              { campaign: { name: { contains: search, mode: 'insensitive' } } }
            ]
          })
        },
        orderBy: { createdAt: 'desc' },
        include: {
          affiliate: { select: { id: true, name: true, active: true } },
          campaign: { select: { id: true, name: true } }
        }
      });
      return res.json(links.map((link) => ({
        id: link.id,
        code: link.shortCode,
        active: link.active,
        createdAt: link.createdAt,
        affiliate: link.affiliate,
        campaign: link.campaign
      })));
    } catch (error) {
      return handleError(res, error, 'Erro ao listar códigos de afiliado.');
    }
  }

  async list(req, res) {
    try {
      const where = {};
      if (req.query.campaignId) where.campaignId = Number(req.query.campaignId);
      if (req.query.affiliateId) where.affiliateId = Number(req.query.affiliateId);
      if (req.query.active === 'true') where.active = true;
      if (req.query.active === 'false') where.active = false;
      const items = await prisma.whatsAppLink.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: whatsappLinkService.includeRelations
      });
      return res.json(await Promise.all(items.map((item) => whatsappLinkService.format(req, item))));
    } catch (error) {
      return handleError(res, error, 'Erro ao listar links WhatsApp.');
    }
  }

  async create(req, res) {
    try {
      return res.status(201).json(await whatsappLinkService.create(req, req.body));
    } catch (error) {
      return handleError(res, error, 'Erro ao criar link WhatsApp.');
    }
  }

  async update(req, res) {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) throw whatsappLinkService.validationError('ID inválido.');
      return res.json(await whatsappLinkService.update(req, id, req.body));
    } catch (error) {
      return handleError(res, error, 'Erro ao atualizar link WhatsApp.');
    }
  }

  async remove(req, res) {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) throw whatsappLinkService.validationError('ID inválido.');
      await whatsappLinkService.remove(id);
      return res.status(204).send();
    } catch (error) {
      return handleError(res, error, 'Erro ao apagar link WhatsApp.');
    }
  }
}

module.exports = new WhatsAppLinkController();
