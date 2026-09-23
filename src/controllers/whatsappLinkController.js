const prisma = require('../database/prisma');
const whatsappLinkService = require('../services/whatsappLinkService');
const { configuredWhatsAppNumber } = require('../utils/whatsapp');

function handleError(res, error, fallback) {
  if (error?.status) return res.status(error.status).json({ error: error.message });
  console.error(error);
  return res.status(500).json({ error: fallback });
}

class WhatsAppLinkController {
  async listMessageTemplates(req, res) {
    try {
      return res.json(await prisma.whatsAppMessageTemplate.findMany({
        where: { createdById: req.user.id },
        orderBy: [{ updatedAt: 'desc' }, { name: 'asc' }],
        select: { id: true, name: true, message: true, createdAt: true, updatedAt: true }
      }));
    } catch (error) {
      return handleError(res, error, 'Erro ao listar os textos salvos.');
    }
  }

  async createMessageTemplate(req, res) {
    try {
      const name = String(req.body?.name || '').trim();
      const message = String(req.body?.message || '').trim();
      if (!name) throw whatsappLinkService.validationError('Informe um nome para a mensagem.');
      if (name.length > 120) throw whatsappLinkService.validationError('O nome deve ter no máximo 120 caracteres.');
      if (!message) throw whatsappLinkService.validationError('Escreva uma mensagem antes de salvá-la.');
      if (message.length > 1000) throw whatsappLinkService.validationError('A mensagem deve ter no máximo 1000 caracteres.');

      const duplicate = await prisma.whatsAppMessageTemplate.findUnique({
        where: { createdById_name: { createdById: req.user.id, name } },
        select: { id: true }
      });
      if (duplicate) throw whatsappLinkService.validationError('Você já possui uma mensagem salva com esse nome.', 409);

      return res.status(201).json(await prisma.whatsAppMessageTemplate.create({
        data: { name, message, createdById: req.user.id },
        select: { id: true, name: true, message: true, createdAt: true, updatedAt: true }
      }));
    } catch (error) {
      return handleError(res, error, 'Erro ao salvar o texto da mensagem.');
    }
  }

  async removeMessageTemplate(req, res) {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) throw whatsappLinkService.validationError('ID do texto salvo inválido.');
      const result = await prisma.whatsAppMessageTemplate.deleteMany({
        where: { id, createdById: req.user.id }
      });
      if (!result.count) throw whatsappLinkService.validationError('Texto salvo não encontrado ou sem permissão para apagar.', 404);
      return res.status(204).send();
    } catch (error) {
      return handleError(res, error, 'Erro ao apagar o texto salvo.');
    }
  }

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
