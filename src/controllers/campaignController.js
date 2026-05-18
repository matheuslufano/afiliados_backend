const crypto = require('node:crypto');
const prisma = require('../database/prisma');

function publicAppBaseUrl(req) {
  const configuredUrl = (process.env.APP_URL || '').replace(/\/+$/, '');
  if (configuredUrl) {
    return configuredUrl;
  }

  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.get('host');

  return `${protocol}://${host}`.replace(/\/+$/, '');
}

function buildAffiliateUrl(req, shortCode) {
  return `${publicAppBaseUrl(req)}/r/${shortCode}`;
}

async function getDefaultUserId() {
  if (process.env.DEFAULT_USER_ID) {
    const userId = Number(process.env.DEFAULT_USER_ID);
    if (Number.isFinite(userId) && userId > 0) {
      return userId;
    }
  }

  const firstUser = await prisma.user.findFirst({
    orderBy: {
      id: 'asc'
    }
  });

  return firstUser?.id;
}

async function createUniqueLink({
  req,
  campaignId,
  campaignName,
  destinationUrl,
  affiliate,
  userId
}) {
  const maxAttempts = 8;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const shortCode = crypto.randomBytes(4).toString('hex');
    const affiliateUrl = buildAffiliateUrl(req, shortCode);

    try {
      return await prisma.link.create({
        data: {
          name: `${campaignName} - ${affiliate.name}`,
          originalUrl: destinationUrl,
          shortCode,
          affiliateUrl,
          userId,
          affiliateId: affiliate.id,
          campaignId
        },
        include: {
          affiliate: true,
          clicks: true
        }
      });
    } catch (error) {
      if (error?.code === 'P2002' && attempt < maxAttempts - 1) {
        continue;
      }

      throw error;
    }
  }

  throw new Error('Nao foi possivel gerar um codigo curto unico');
}

function formatCampaign(req, campaign) {
  const links = campaign.links.map((link) => ({
    id: link.id,
    name: link.name,
    originalUrl: link.originalUrl,
    shortCode: link.shortCode,
    promoLink: link.affiliateUrl || buildAffiliateUrl(req, link.shortCode),
    clicks: link.clicks.length,
    affiliate: link.affiliate
      ? {
          id: link.affiliate.id,
          name: link.affiliate.name,
          email: link.affiliate.email,
          city: link.affiliate.city
        }
      : null
  }));

  const totalClicks = links.reduce(
    (sum, link) => sum + link.clicks,
    0
  );

  const topAffiliate =
    links
      .filter((link) => link.affiliate)
      .sort((a, b) => b.clicks - a.clicks)[0]?.affiliate ?? null;

  const topLink =
    links
      .slice()
      .sort((a, b) => b.clicks - a.clicks)[0] ?? null;

  return {
    id: campaign.id,
    name: campaign.name,
    destinationUrl: campaign.destinationUrl,
    createdAt: campaign.createdAt,
    totalLinks: links.length,
    totalAffiliates: links.filter((link) => link.affiliate).length,
    totalClicks,
    topAffiliate,
    topLink,
    links
  };
}

class CampaignController {
  async create(req, res) {
    try {
      const name = String(req.body.name || '').trim();
      const destinationUrl = String(req.body.destinationUrl || '').trim();
      const affiliateIds = Array.isArray(req.body.affiliateIds)
        ? req.body.affiliateIds.map(Number)
        : [];

      const uniqueAffiliateIds = [
        ...new Set(
          affiliateIds.filter((id) => Number.isFinite(id) && id > 0)
        )
      ];

      if (!name || !destinationUrl) {
        return res.status(400).json({
          error: 'Nome da campanha e URL de destino sao obrigatorios'
        });
      }

      if (uniqueAffiliateIds.length === 0) {
        return res.status(400).json({
          error: 'Selecione pelo menos um afiliado'
        });
      }

      const userId = await getDefaultUserId();
      if (!userId) {
        return res.status(400).json({
          error: 'Nenhum usuario cadastrado para criar links'
        });
      }

      const affiliates = await prisma.affiliate.findMany({
        where: {
          id: {
            in: uniqueAffiliateIds
          },
          active: true
        },
        orderBy: {
          name: 'asc'
        }
      });

      if (affiliates.length !== uniqueAffiliateIds.length) {
        return res.status(400).json({
          error: 'Um ou mais afiliados nao foram encontrados ou estao inativos'
        });
      }

      const campaign = await prisma.campaign.create({
        data: {
          name,
          destinationUrl
        }
      });

      const links = [];

      try {
        for (const affiliate of affiliates) {
          const link = await createUniqueLink({
            req,
            campaignId: campaign.id,
            campaignName: name,
            destinationUrl,
            affiliate,
            userId
          });

          links.push(link);
        }
      } catch (error) {
        await prisma.link.deleteMany({
          where: {
            campaignId: campaign.id
          }
        });

        await prisma.campaign.delete({
          where: {
            id: campaign.id
          }
        });

        throw error;
      }

      return res.status(201).json(
        formatCampaign(req, {
          ...campaign,
          links
        })
      );
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        error: 'Erro ao criar campanha'
      });
    }
  }

  async list(req, res) {
    try {
      const campaigns = await prisma.campaign.findMany({
        orderBy: {
          createdAt: 'desc'
        },
        include: {
          links: {
            orderBy: {
              createdAt: 'desc'
            },
            include: {
              affiliate: true,
              clicks: true
            }
          }
        }
      });

      return res.json(
        campaigns.map((campaign) => formatCampaign(req, campaign))
      );
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        error: 'Erro ao listar campanhas'
      });
    }
  }
}

module.exports = new CampaignController();
