const QRCode = require('qrcode');
const prisma = require('../database/prisma');
const { generateAffiliateCode } = require('../utils/affiliateCodes');
const { buildAffiliateUrl, buildWhatsappTrackingUrl, getDefaultLandingPageUrl } = require('../utils/publicUrls');
const {
  DEFAULT_IDENTIFICATION_TEMPLATE,
  buildWhatsAppMessage,
  buildWhatsAppUrl,
  isValidWhatsAppPhone,
  normalizePhoneNumber
} = require('../utils/whatsapp');

const includeRelations = {
  campaign: { select: { id: true, name: true } },
  affiliate: { select: { id: true, name: true, active: true } },
  link: { select: { id: true, shortCode: true, createdAt: true } },
  createdBy: { select: { id: true, name: true } }
};

const INDIVIDUAL_WHATSAPP_CAMPAIGN_NAME = 'WhatsApp individual';
const DEFAULT_INDIVIDUAL_DESTINATION_URL = 'https://netboxfibra.com.br';

function validationError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function parseRequiredId(value, label) {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) throw validationError(`${label} inválido.`);
  return id;
}

async function getOrCreateIndividualWhatsAppCampaign() {
  const existing = await prisma.campaign.findFirst({
    where: { name: INDIVIDUAL_WHATSAPP_CAMPAIGN_NAME },
    orderBy: { id: 'asc' }
  });
  if (existing) return existing;

  return prisma.campaign.create({
    data: {
      name: INDIVIDUAL_WHATSAPP_CAMPAIGN_NAME,
      destinationUrl: getDefaultLandingPageUrl() || DEFAULT_INDIVIDUAL_DESTINATION_URL
    }
  });
}

async function resolveContext({ campaignId, affiliateId, affiliateCodeId }) {
  const parsedAffiliateId = parseRequiredId(affiliateId, 'Afiliado');
  const affiliate = await prisma.affiliate.findUnique({ where: { id: parsedAffiliateId } });
  if (!affiliate) throw validationError('Afiliado não encontrado.', 404);
  if (!affiliate.active) throw validationError('O afiliado está inativo.');

  let link;
  let campaign;
  if (affiliateCodeId) {
    link = await prisma.link.findUnique({ where: { id: parseRequiredId(affiliateCodeId, 'Código') } });
    if (!link) throw validationError('Código de afiliado não encontrado.', 404);
    if (!link.active) throw validationError('O código de afiliado está inativo.');
    if (link.affiliateId !== parsedAffiliateId) {
      throw validationError('O código selecionado não pertence ao afiliado informado.');
    }
    if (campaignId && link.campaignId !== parseRequiredId(campaignId, 'Campanha')) {
      throw validationError('O código selecionado não pertence à campanha informada.');
    }
    campaign = await prisma.campaign.findUnique({ where: { id: link.campaignId } });
  } else {
    if (campaignId) {
      const parsedCampaignId = parseRequiredId(campaignId, 'Campanha');
      campaign = await prisma.campaign.findUnique({ where: { id: parsedCampaignId } });
    } else {
      const latestAffiliateLink = await prisma.link.findFirst({
        where: { affiliateId: parsedAffiliateId },
        orderBy: { createdAt: 'desc' },
        select: { campaignId: true }
      });
      if (latestAffiliateLink?.campaignId) {
        campaign = await prisma.campaign.findUnique({
          where: { id: latestAffiliateLink.campaignId }
        });
      }
      if (!campaign) {
        campaign = await getOrCreateIndividualWhatsAppCampaign();
      }
    }
  }
  if (!campaign) {
    throw validationError('Não foi possível definir o vínculo do novo código.', 500);
  }
  return { campaign, affiliate, link };
}

async function createAffiliateCode({ req, campaign, affiliate, userId }) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const shortCode = generateAffiliateCode();
    try {
      return await prisma.link.create({
        data: {
          name: `${campaign.name} - ${affiliate.name} - WhatsApp`,
          originalUrl: campaign.destinationUrl,
          shortCode,
          affiliateUrl: buildAffiliateUrl(req, shortCode),
          userId,
          affiliateId: affiliate.id,
          campaignId: campaign.id
        }
      });
    } catch (error) {
      if (error?.code !== 'P2002' || attempt === 7) throw error;
    }
  }
  throw validationError('Não foi possível gerar um código único.', 500);
}

function buildValues(payload, context) {
  const name = String(payload.name || context.link?.name || `Link WhatsApp - ${context.affiliate.name}`).trim();
  if (name.length > 120) throw validationError('O nome do link deve ter no máximo 120 caracteres.');
  const originalMessage = String(payload.message ?? payload.originalMessage ?? '').trim();
  if (originalMessage.length > 1000) throw validationError('A mensagem deve ter no máximo 1000 caracteres.');
  const whatsappNumber = normalizePhoneNumber(payload.whatsappNumber);
  if (!isValidWhatsAppPhone(whatsappNumber)) {
    throw validationError('Informe um número de WhatsApp brasileiro válido, com DDD.');
  }
  const appendAffiliateCode = payload.appendAffiliateCode !== false;
  const identificationTemplate = String(
    payload.identificationTemplate || DEFAULT_IDENTIFICATION_TEMPLATE
  ).trim();
  if (identificationTemplate.length > 500) throw validationError('O texto de identificação deve ter no máximo 500 caracteres.');
  if (appendAffiliateCode && !identificationTemplate.includes('{{codigo}}')) {
    throw validationError('O texto de identificação deve conter {{codigo}}.');
  }
  const finalMessage = buildWhatsAppMessage({
    message: originalMessage,
    affiliateCode: context.link.shortCode,
    affiliateName: context.affiliate.name,
    campaignName: context.campaign.name,
    template: identificationTemplate,
    appendAffiliateCode
  });
  if (!finalMessage) throw validationError('Informe uma mensagem ou ative a identificação do afiliado.');
  return {
    name,
    whatsappNumber,
    originalMessage,
    finalMessage,
    identificationTemplate,
    appendAffiliateCode,
    whatsappUrl: buildWhatsAppUrl({ phone: whatsappNumber, message: finalMessage })
  };
}

async function format(req, item) {
  const params = new URLSearchParams({
    whatsappLinkId: String(item.id),
    message: item.finalMessage,
    source: 'whatsapp-link'
  });
  const whatsappUrl = `${buildWhatsappTrackingUrl(req, item.link.shortCode)}?${params.toString()}`;
  return {
    ...item,
    whatsappUrl,
    affiliateCodeId: item.linkId,
    affiliateCode: item.link.shortCode,
    qrCode: await QRCode.toDataURL(whatsappUrl, { margin: 1, width: 260 })
  };
}

async function resolveTrackingTarget({ linkId, whatsappLinkId, message }) {
  const parsedWhatsAppLinkId = Number(whatsappLinkId);
  const hasWhatsAppLinkId = Number.isInteger(parsedWhatsAppLinkId) && parsedWhatsAppLinkId > 0;
  const normalizedMessage = String(message || '').trim();

  const exactItem = hasWhatsAppLinkId
    ? await prisma.whatsAppLink.findFirst({
      where: { id: parsedWhatsAppLinkId, linkId },
      select: { whatsappNumber: true, finalMessage: true }
    })
    : null;

  if (exactItem) return exactItem;

  return prisma.whatsAppLink.findFirst({
    where: {
      linkId,
      ...(normalizedMessage && { finalMessage: normalizedMessage })
    },
    orderBy: { updatedAt: 'desc' },
    select: { whatsappNumber: true, finalMessage: true }
  });
}

async function create(req, payload) {
  const context = await resolveContext(payload);
  if (!context.link) {
    buildValues(payload, { ...context, link: { shortCode: '00000000' } });
  }
  if (!context.link) {
    if (!payload.generateNewCode) throw validationError('Selecione um código existente ou gere um novo código.');
    context.link = await createAffiliateCode({
      req,
      campaign: context.campaign,
      affiliate: context.affiliate,
      userId: req.user.id
    });
  }
  const values = buildValues(payload, context);
  const item = await prisma.whatsAppLink.create({
    data: {
      ...values,
      channel: 'whatsapp',
      campaignId: context.campaign.id,
      affiliateId: context.affiliate.id,
      linkId: context.link.id,
      createdById: req.user.id
    },
    include: includeRelations
  });
  return format(req, item);
}

async function update(req, id, payload) {
  const existing = await prisma.whatsAppLink.findUnique({ where: { id } });
  if (!existing) throw validationError('Link WhatsApp não encontrado.', 404);
  const merged = {
    campaignId: payload.campaignId ?? existing.campaignId,
    affiliateId: payload.affiliateId ?? existing.affiliateId,
    affiliateCodeId: payload.affiliateCodeId ?? existing.linkId
  };
  const context = await resolveContext(merged);
  const values = buildValues({
    name: payload.name ?? existing.name,
    message: payload.message ?? existing.originalMessage,
    whatsappNumber: payload.whatsappNumber ?? existing.whatsappNumber,
    appendAffiliateCode: payload.appendAffiliateCode ?? existing.appendAffiliateCode,
    identificationTemplate: payload.identificationTemplate ?? existing.identificationTemplate
  }, context);
  const item = await prisma.whatsAppLink.update({
    where: { id },
    data: {
      ...values,
      active: payload.active ?? existing.active,
      campaignId: context.campaign.id,
      affiliateId: context.affiliate.id,
      linkId: context.link.id
    },
    include: includeRelations
  });
  return format(req, item);
}

module.exports = {
  buildValues,
  create,
  format,
  includeRelations,
  getOrCreateIndividualWhatsAppCampaign,
  resolveTrackingTarget,
  resolveContext,
  update,
  validationError
};
