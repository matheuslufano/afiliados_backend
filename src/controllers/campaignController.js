const { generateAffiliateCode } = require('../utils/affiliateCodes');
const prisma = require('../database/prisma');
const {
  buildAffiliateUrl,
  buildWhatsappTrackingUrl,
  getDefaultLandingPageUrl
} = require('../utils/publicUrls');

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
    const shortCode = generateAffiliateCode();
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

function includesSgp(value) {
  return String(value || '').toLowerCase().includes('sgp');
}

function conversionStatus(conversion, convertedInSgp) {
  if (convertedInSgp) return 'CONVERTED';
  if (conversion.crmDeal?.status?.key === 'lost') return 'LOST';
  if (conversion.crmDeal) return 'IN_NEGOTIATION';
  if (conversion.visitorName || conversion.visitorPhone) return 'LEAD_IDENTIFIED';
  if (conversion.attendanceId) return 'ATTENDANCE_STARTED';
  return 'WHATSAPP_STARTED';
}

function formatConversionEvent(conversion, link) {
  const convertedInSgp = Boolean(
    conversion.crmDeal?.sgpId ||
      [conversion.type, conversion.source, conversion.product].some(includesSgp)
  );
  const status = conversionStatus(conversion, convertedInSgp);
  const deal = conversion.crmDeal;

  return {
    id: conversion.id,
    customerName:
      conversion.visitorName || deal?.customerName || 'Cliente não identificado',
    customerPhone: conversion.visitorPhone || deal?.phone || null,
    customerDocument: conversion.visitorDocument || null,
    city: conversion.visitorCity || deal?.city || null,
    plan: deal?.plan || conversion.product || null,
    seller: deal?.responsibleUser?.name || deal?.owner || null,
    attendanceId: conversion.attendanceId || deal?.chatmixId || null,
    sgpCustomerId: deal?.sgpId || null,
    convertedAt: conversion.convertedAt,
    sgpConvertedAt: convertedInSgp
      ? deal?.closedAt || deal?.updatedAt || conversion.convertedAt
      : null,
    firstClickAt: null,
    whatsappStartedAt: conversion.convertedAt,
    attendanceStartedAt: conversion.attendanceId
      ? conversion.convertedAt
      : null,
    leadCreatedAt: deal?.createdAt || null,
    lastAttendanceAt: deal?.lastInteractionAt || deal?.updatedAt || null,
    status,
    statusName: deal?.status?.name || null,
    stageName: deal?.stage?.name || null,
    convertedInSgp,
    sgpStatus: convertedInSgp
      ? 'CONVERTED'
      : status === 'LOST'
        ? 'NOT_CONVERTED'
        : deal
          ? 'IN_NEGOTIATION'
          : 'NOT_VERIFIED',
    attributionStatus:
      link.affiliateId && (conversion.visitorPhone || deal?.phone) && convertedInSgp
        ? 'VERIFIED'
        : link.affiliateId
          ? 'TRACKED'
          : 'NOT_IDENTIFIED',
    source: conversion.source || conversion.type || null,
    history: (deal?.history || []).map((item) => ({
      id: item.id,
      eventType: item.eventType,
      message: item.message,
      createdAt: item.createdAt
    }))
  };
}

function formatCampaign(req, campaign) {
  const links = campaign.links.map((link) => ({
    id: link.id,
    name: link.name,
    displayName: link.whatsappLinks?.[0]?.name || link.name,
    originalUrl: link.originalUrl,
    shortCode: link.shortCode,
    promoLink: buildAffiliateUrl(req, link.shortCode),
    clicks: link.clicks.length,
    clickEvents: link.clicks.map((click) => ({
      id: click.id,
      clickedAt: click.clickedAt,
      city: click.geoCity || null,
      source: click.source || click.utmSource || null
    })),
    conversions: link.conversions?.length || 0,
    conversionEvents: (link.conversions || []).map((conversion) =>
      formatConversionEvent(conversion, link)
    ),
    whatsappLink: buildWhatsappTrackingUrl(req, link.shortCode),
    linkType: link.whatsappLinks?.length
      ? 'whatsapp'
      : link.campaignId
        ? 'campaign'
        : 'individual',
    affiliate: link.affiliate
      ? {
          id: link.affiliate.id,
          name: link.affiliate.name,
          email: link.affiliate.email,
          city: link.affiliate.city,
          photoUrl: link.affiliate.photoUrl
        }
      : null
  }));

  const totalClicks = links.reduce(
    (sum, link) => sum + link.clicks,
    0
  );

  const totalConversions = links.reduce(
    (sum, link) => sum + link.conversions,
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
    totalConversions,
    topAffiliate,
    topLink,
    links
  };
}

class CampaignController {
  async create(req, res) {
    try {
      const name = String(req.body.name || '').trim();
      const destinationUrl = String(
        req.body.destinationUrl || getDefaultLandingPageUrl()
      ).trim();
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
              whatsappLinks: {
                orderBy: { createdAt: 'desc' },
                select: { id: true, name: true, createdAt: true }
              },
              clicks: true,
              conversions: {
                orderBy: {
                  convertedAt: 'desc'
                },
                include: {
                  crmDeal: {
                    include: {
                      status: true,
                      stage: true,
                      responsibleUser: {
                        select: {
                          name: true
                        }
                      },
                      history: {
                        orderBy: {
                          createdAt: 'asc'
                        }
                      }
                    }
                  }
                }
              }
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

  async update(req, res) {
    try {
      const id = Number(req.params.id);
      const name = String(req.body.name || '').trim();
      const destinationUrl = String(req.body.destinationUrl || '').trim();

      if (!Number.isFinite(id) || id <= 0) {
        return res.status(400).json({ error: 'Campanha invalida' });
      }

      if (!name || !destinationUrl) {
        return res.status(400).json({
          error: 'Nome da campanha e URL de destino sao obrigatorios'
        });
      }

      const existing = await prisma.campaign.findUnique({
        where: { id },
        include: {
          links: {
            include: { conversions: { select: { id: true } } }
          }
        }
      });
      if (!existing) {
        return res.status(404).json({ error: 'Campanha nao encontrada' });
      }

      const requestedLinks = Array.isArray(req.body.links)
        ? req.body.links.map((item) => ({
            id: Number(item?.id) || null,
            affiliateId: Number(item?.affiliateId),
            shortCode: String(item?.shortCode || '').trim().toLowerCase()
          }))
        : existing.links.map((link) => ({
            id: link.id,
            affiliateId: link.affiliateId,
            shortCode: link.shortCode
          }));

      if (requestedLinks.length === 0) {
        return res.status(400).json({ error: 'Selecione pelo menos um afiliado' });
      }

      if (requestedLinks.some((item) =>
        !Number.isFinite(item.affiliateId) || item.affiliateId <= 0 ||
        !/^[a-f0-9]{8}$/.test(item.shortCode)
      )) {
        return res.status(400).json({
          error: 'Afiliado invalido ou codigo fora do padrao de 8 caracteres hexadecimais'
        });
      }

      if (new Set(requestedLinks.map((item) => item.affiliateId)).size !== requestedLinks.length) {
        return res.status(400).json({ error: 'Um afiliado nao pode aparecer duas vezes na campanha' });
      }
      if (new Set(requestedLinks.map((item) => item.shortCode)).size !== requestedLinks.length) {
        return res.status(409).json({ error: 'Existem codigos de divulgacao duplicados' });
      }

      const existingLinkIds = new Set(existing.links.map((link) => link.id));
      if (requestedLinks.some((item) => item.id && !existingLinkIds.has(item.id))) {
        return res.status(400).json({ error: 'Um dos links nao pertence a esta campanha' });
      }

      const affiliates = await prisma.affiliate.findMany({
        where: {
          id: { in: requestedLinks.map((item) => item.affiliateId) },
          active: true
        }
      });
      if (affiliates.length !== requestedLinks.length) {
        return res.status(400).json({ error: 'Um ou mais afiliados nao foram encontrados ou estao inativos' });
      }
      const affiliatesById = new Map(affiliates.map((affiliate) => [affiliate.id, affiliate]));

      const retainedIds = requestedLinks.map((item) => item.id).filter(Boolean);
      const conflictingCode = await prisma.link.findFirst({
        where: {
          shortCode: { in: requestedLinks.map((item) => item.shortCode) },
          ...(retainedIds.length ? { id: { notIn: retainedIds } } : {})
        }
      });
      if (conflictingCode) {
        return res.status(409).json({ error: 'Codigo de divulgacao ja esta em uso' });
      }

      const removedLinks = existing.links.filter((link) => !retainedIds.includes(link.id));
      const removedLinkIds = removedLinks.map((link) => link.id);
      const removedConversionIds = removedLinks.flatMap((link) =>
        link.conversions.map((conversion) => conversion.id)
      );
      const userId = existing.links[0]?.userId || await getDefaultUserId();

      await prisma.$transaction(async (tx) => {
        if (removedLinkIds.length) {
          await tx.crmDeal.updateMany({
            where: { OR: [{ linkId: { in: removedLinkIds } }, { conversionId: { in: removedConversionIds } }] },
            data: { linkId: null, conversionId: null }
          });
          await tx.webhookLog.updateMany({
            where: { OR: [{ linkId: { in: removedLinkIds } }, { conversionId: { in: removedConversionIds } }] },
            data: { linkId: null, conversionId: null }
          });
          await tx.conversion.deleteMany({ where: { linkId: { in: removedLinkIds } } });
          await tx.click.deleteMany({ where: { linkId: { in: removedLinkIds } } });
          await tx.link.deleteMany({ where: { id: { in: removedLinkIds } } });
        }

        await tx.campaign.update({ where: { id }, data: { name, destinationUrl } });

        for (const item of requestedLinks) {
          const affiliate = affiliatesById.get(item.affiliateId);
          if (item.id) {
            const previous = existing.links.find((link) => link.id === item.id);
            await tx.link.update({
              where: { id: item.id },
              data: {
                name: `${name} - ${affiliate.name}`,
                originalUrl: destinationUrl,
                shortCode: item.shortCode,
                affiliateUrl: buildAffiliateUrl(req, item.shortCode),
                affiliateId: item.affiliateId
              }
            });
            if (previous.shortCode !== item.shortCode || previous.affiliateId !== item.affiliateId) {
              await tx.crmDeal.updateMany({
                where: { linkId: item.id },
                data: { trackingCode: item.shortCode, affiliateId: item.affiliateId }
              });
              await tx.webhookLog.updateMany({
                where: { linkId: item.id },
                data: { shortCode: item.shortCode }
              });
            }
          } else {
            await tx.link.create({
              data: {
                name: `${name} - ${affiliate.name}`,
                originalUrl: destinationUrl,
                shortCode: item.shortCode,
                affiliateUrl: buildAffiliateUrl(req, item.shortCode),
                userId,
                affiliateId: item.affiliateId,
                campaignId: id
              }
            });
          }
        }
      });

      const campaign = await prisma.campaign.findUnique({
        where: { id },
        include: {
          links: {
            orderBy: { createdAt: 'desc' },
            include: {
              affiliate: true,
              whatsappLinks: {
                orderBy: { createdAt: 'desc' },
                select: { id: true, name: true, createdAt: true }
              },
              clicks: true,
              conversions: {
                orderBy: { convertedAt: 'desc' },
                include: {
                  crmDeal: {
                    include: {
                      status: true,
                      stage: true,
                      responsibleUser: { select: { name: true } },
                      history: { orderBy: { createdAt: 'asc' } }
                    }
                  }
                }
              }
            }
          }
        }
      });

      return res.json(formatCampaign(req, campaign));
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Erro ao editar campanha' });
    }
  }

  async delete(req, res) {
    try {
      const id = Number(req.params.id);

      if (!Number.isFinite(id) || id <= 0) {
        return res.status(400).json({
          error: 'Campanha invalida'
        });
      }

      const campaign = await prisma.campaign.findUnique({
        where: {
          id
        },
        include: {
          links: {
            select: {
              id: true
            }
          }
        }
      });

      if (!campaign) {
        return res.status(404).json({
          error: 'Campanha nao encontrada'
        });
      }

      const linkIds = campaign.links.map((link) => link.id);

      await prisma.$transaction([
        prisma.click.deleteMany({
          where: {
            linkId: {
              in: linkIds
            }
          }
        }),
        prisma.conversion.deleteMany({
          where: {
            linkId: {
              in: linkIds
            }
          }
        }),
        prisma.link.deleteMany({
          where: {
            campaignId: id
          }
        }),
        prisma.campaign.delete({
          where: {
            id
          }
        })
      ]);

      return res.status(204).send();
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        error: 'Erro ao apagar campanha'
      });
    }
  }
}

module.exports = new CampaignController();
