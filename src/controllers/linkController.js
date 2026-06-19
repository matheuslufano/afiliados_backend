const prisma = require('../database/prisma');
const crypto = require('node:crypto');
const QRCode = require('qrcode');
const {
  buildAffiliateUrl,
  buildWhatsappTrackingUrl,
  getDefaultLandingPageUrl
} = require('../utils/publicUrls');
const {
  buildWhatsAppUrl
} = require('../utils/whatsapp');
const {
  publishRealtimeEvent
} = require('../utils/realtimeEvents');
const {
  collectVisitorTrackingData
} = require('../utils/visitorTracking');

function appendReferralCode(url, shortCode) {
  try {
    const destination = new URL(url);
    if (!destination.searchParams.has('ref')) {
      destination.searchParams.set('ref', shortCode);
    }
    return destination.toString();
  } catch {
    return url;
  }
}

function optionalText(value) {
  const text = String(value || '').trim();
  return text || null;
}

function normalizePhone(value) {
  const phone = String(value || '').replace(/\D/g, '');
  return phone || null;
}

function normalizeDocument(value) {
  const document = String(value || '').replace(/\D/g, '');
  return document || null;
}

function firstRequestValue(req, keys) {
  for (const key of keys) {
    const value = req.query?.[key] ?? req.body?.[key];

    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }

  return null;
}

function visitorDataFromRequest(req) {
  return {
    visitorName: optionalText(
      firstRequestValue(req, ['visitorName', 'name', 'nome'])
    ),
    visitorPhone: normalizePhone(
      firstRequestValue(req, [
        'visitorPhone',
        'phone',
        'telefone',
        'whatsapp'
      ])
    ),
    visitorDocument: normalizeDocument(
      firstRequestValue(req, [
        'visitorDocument',
        'document',
        'documento',
        'cpf',
        'cnpj',
        'cpfcnpj'
      ])
    ),
    visitorCity: optionalText(
      firstRequestValue(req, ['visitorCity', 'city', 'cidade'])
    ),
    source: optionalText(firstRequestValue(req, ['source', 'origem']))
  };
}

async function formatLinkResponse(req, link) {
  const promoLink = buildAffiliateUrl(req, link.shortCode);

  return {
    id: link.id,
    name: link.name,
    originalUrl: link.originalUrl,
    shortCode: link.shortCode,
    promoLink,
    clicks: link.clicks.length,
    conversions: link.conversions.length,
    whatsappLink: buildWhatsappTrackingUrl(req, link.shortCode),
    createdAt: link.createdAt,
    affiliate: link.affiliate
      ? {
          id: link.affiliate.id,
          name: link.affiliate.name,
          email: link.affiliate.email,
          city: link.affiliate.city
        }
      : null,
    qrCode: await QRCode.toDataURL(promoLink, {
      margin: 1,
      width: 220
    })
  };
}

async function resolveOptionalAffiliateId(raw) {
  if (raw === undefined || raw === null || raw === '') {
    return { ok: true, id: undefined };
  }
  const n =
    typeof raw === 'number' && Number.isInteger(raw)
      ? raw
      : parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(n) || n < 1) {
    return { ok: false, error: 'affiliateId inválido' };
  }
  const affiliate = await prisma.affiliate.findUnique({
    where: { id: n }
  });
  if (!affiliate) {
    return { ok: false, error: 'Afiliado não encontrado' };
  }
  return { ok: true, id: n };
}

class LinkController {
  async list(req, res) {
    try {
      const links = await prisma.link.findMany({
        orderBy: {
          createdAt: 'desc'
        },
        include: {
          affiliate: true,
          clicks: true,
          conversions: true
        }
      });

      const formattedLinks = await Promise.all(
        links.map((link) => formatLinkResponse(req, link))
      );

      return res.json(formattedLinks);
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        error: 'Erro ao listar links'
      });
    }
  }

  async create(req, res) {
    try {
      const {
        name,
        url,
        affiliateId: rawAffiliateId
      } = req.body;

      const originalUrl = String(url || getDefaultLandingPageUrl()).trim();

      if (!originalUrl) {
        return res.status(400).json({
          error: 'URL é obrigatória'
        });
      }

      const linkName = String(name || '').trim();

      const affiliateResult =
        await resolveOptionalAffiliateId(rawAffiliateId);
      if (!affiliateResult.ok) {
        return res.status(400).json({
          error: affiliateResult.error
        });
      }
      const affiliateId = affiliateResult.id;

      let userId;
      if (process.env.DEFAULT_USER_ID) {
        userId = Number(process.env.DEFAULT_USER_ID);
        if (!Number.isFinite(userId) || userId < 1) {
          return res.status(400).json({
            error: 'DEFAULT_USER_ID inválido'
          });
        }
        const configuredUser = await prisma.user.findUnique({
          where: { id: userId }
        });
        if (!configuredUser) {
          return res.status(400).json({
            error: 'Usuário configurado em DEFAULT_USER_ID não existe'
          });
        }
      } else {
        const firstUser = await prisma.user.findFirst({
          orderBy: { id: 'asc' }
        });
        if (!firstUser) {
          return res.status(400).json({
            error:
              'Nenhum usuário cadastrado. Crie um usuário ou defina DEFAULT_USER_ID no ambiente.'
          });
        }
        userId = firstUser.id;
      }

      const maxAttempts = 8;
      let link;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const shortCode = crypto.randomBytes(4).toString('hex');
        const affiliateUrl = buildAffiliateUrl(req, shortCode);
        try {
          link = await prisma.link.create({
            data: {
              name: linkName || null,
              originalUrl,
              shortCode,
              affiliateUrl,
              userId,
              ...(affiliateId !== undefined && { affiliateId })
            }
          });
          break;
        } catch (error) {
          // Único índice relevante no create é shortCode; meta.target varia por driver.
          if (error?.code === 'P2002' && attempt < maxAttempts - 1) {
            continue;
          }
          throw error;
        }
      }

      if (!link) {
        return res.status(500).json({
          error: 'Não foi possível gerar um código curto único'
        });
      }

      return res.status(201).json({
        message: 'Link criado com sucesso',
        link: buildAffiliateUrl(req, link.shortCode)
      });
    } catch (error) {
      console.error(error);

      if (error?.code === 'P2003') {
        return res.status(400).json({
          error:
            'Referência inválida (usuário ou afiliado). Verifique os dados.'
        });
      }

      return res.status(500).json({
        error: 'Erro ao criar link'
      });
    }
  }

  async update(req, res) {
    try {
      const id = Number(req.params.id);

      if (!Number.isFinite(id) || id < 1) {
        return res.status(400).json({
          error: 'ID do link invalido'
        });
      }

      const data = {};

      if (req.body.name !== undefined) {
        data.name = String(req.body.name || '').trim() || null;
      }

      const rawUrl =
        req.body.url !== undefined ? req.body.url : req.body.originalUrl;

      if (rawUrl !== undefined) {
        const originalUrl = String(rawUrl || '').trim();

        if (!originalUrl) {
          return res.status(400).json({
            error: 'URL e obrigatoria'
          });
        }

        data.originalUrl = originalUrl;
      }

      if (req.body.affiliateId !== undefined) {
        const affiliateResult =
          await resolveOptionalAffiliateId(req.body.affiliateId);

        if (!affiliateResult.ok) {
          return res.status(400).json({
            error: affiliateResult.error
          });
        }

        data.affiliateId = affiliateResult.id ?? null;
      }

      const link = await prisma.link.update({
        where: {
          id
        },
        data,
        include: {
          affiliate: true,
          clicks: true,
          conversions: true
        }
      });

      return res.json(await formatLinkResponse(req, link));
    } catch (error) {
      if (error?.code === 'P2025') {
        return res.status(404).json({
          error: 'Link nao encontrado'
        });
      }

      console.error(error);

      return res.status(500).json({
        error: 'Erro ao atualizar link'
      });
    }
  }

  async redirect(req, res) {
    try {
      const { shortCode } = req.params;

      const link = await prisma.link.findUnique({
        where: {
          shortCode
        }
      });

      if (!link) {
        return res.status(404).json({
          error: 'Link não encontrado'
        });
      }

      const click = await prisma.click.create({
        data: {
          ...collectVisitorTrackingData(req),
          linkId: link.id
        }
      });

      publishRealtimeEvent('link-clicked', {
        linkId: link.id,
        shortCode: link.shortCode,
        clickedAt: click.clickedAt
      });

      return res.redirect(appendReferralCode(link.originalUrl, shortCode));

    } catch (error) {
      console.error(error);

      return res.status(500).json({
        error: 'Erro ao acessar link'
      });
    }
  }

  async stats(req, res) {
    try {
      const { id } = req.params;

      const link = await prisma.link.findUnique({
        where: {
          id: Number(id)
        },
        include: {
          clicks: {
            orderBy: {
              clickedAt: 'desc'
            }
          },
          conversions: {
            orderBy: {
              convertedAt: 'desc'
            }
          }
        }
      });

      if (!link) {
        return res.status(404).json({
          error: 'Link não encontrado'
        });
      }

      return res.json({
        id: link.id,
        name: link.name,
        originalUrl: link.originalUrl,
        shortCode: link.shortCode,
        promoLink: buildAffiliateUrl(req, link.shortCode),
        totalClicks: link.clicks.length,
        totalConversions: link.conversions.length,
        whatsappLink: buildWhatsappTrackingUrl(req, link.shortCode),
        clicks: link.clicks,
        conversions: link.conversions
      });

    } catch (error) {
      console.error(error);

      return res.status(500).json({
        error: 'Erro ao buscar estatísticas'
      });
    }
  }

  async delete(req, res) {
    try {
      const id = Number(req.params.id);

      if (!Number.isFinite(id) || id < 1) {
        return res.status(400).json({
          error: 'ID do link invalido'
        });
      }

      const link = await prisma.link.findUnique({
        where: {
          id
        }
      });

      if (!link) {
        return res.status(404).json({
          error: 'Link nao encontrado'
        });
      }

      await prisma.$transaction([
        prisma.click.deleteMany({
          where: {
            linkId: id
          }
        }),
        prisma.conversion.deleteMany({
          where: {
            linkId: id
          }
        }),
        prisma.link.delete({
          where: {
            id
          }
        })
      ]);

      return res.json({
        message: 'Link apagado com sucesso'
      });
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        error: 'Erro ao apagar link'
      });
    }
  }

  async updateConversion(req, res) {
    try {
      const id = Number(req.params.id);

      if (!Number.isFinite(id) || id < 1) {
        return res.status(400).json({
          error: 'ID da conversao invalido'
        });
      }

      const data = {};

      if (req.body.visitorName !== undefined) {
        data.visitorName = optionalText(req.body.visitorName);
      }

      if (req.body.visitorPhone !== undefined) {
        data.visitorPhone = normalizePhone(req.body.visitorPhone);
      }

      if (req.body.visitorDocument !== undefined) {
        data.visitorDocument = normalizeDocument(req.body.visitorDocument);
      }

      if (req.body.visitorCity !== undefined) {
        data.visitorCity = optionalText(req.body.visitorCity);
      }

      if (req.body.product !== undefined) {
        data.product = optionalText(req.body.product);
      }

      if (req.body.source !== undefined) {
        data.source = optionalText(req.body.source);
      }

      const conversion = await prisma.conversion.update({
        where: {
          id
        },
        data
      });

      return res.json(conversion);
    } catch (error) {
      if (error?.code === 'P2025') {
        return res.status(404).json({
          error: 'Conversao nao encontrada'
        });
      }

      console.error(error);

      return res.status(500).json({
        error: 'Erro ao atualizar conversao'
      });
    }
  }

  async deleteConversion(req, res) {
    try {
      const id = Number(req.params.id);

      if (!Number.isFinite(id) || id < 1) {
        return res.status(400).json({
          error: 'ID da conversao invalido'
        });
      }

      await prisma.conversion.delete({
        where: {
          id
        }
      });

      return res.json({
        message: 'Conversao apagada com sucesso'
      });
    } catch (error) {
      if (error?.code === 'P2025') {
        return res.status(404).json({
          error: 'Conversao nao encontrada'
        });
      }

      console.error(error);

      return res.status(500).json({
        error: 'Erro ao apagar conversao'
      });
    }
  }

  async affiliateStats(req, res) {
    try {
      const { id } = req.params;

      const affiliate = await prisma.affiliate.findUnique({
        where: {
          id: Number(id)
        },
        include: {
          links: {
            orderBy: {
              createdAt: 'desc'
            },
            include: {
              clicks: {
                orderBy: {
                  clickedAt: 'desc'
                }
              },
              conversions: {
                orderBy: {
                  convertedAt: 'desc'
                }
              }
            }
          }
        }
      });

      if (!affiliate) {
        return res.status(404).json({
          error: 'Afiliado não encontrado'
        });
      }

      const totalClicks = affiliate.links.reduce(
        (acc, link) => acc + link.clicks.length,
        0
      );

      const totalConversions = affiliate.links.reduce(
        (acc, link) => acc + link.conversions.length,
        0
      );

      const formattedLinks = affiliate.links.map(link => {
        const promoLink = buildAffiliateUrl(req, link.shortCode);
        const whatsappLink = buildWhatsappTrackingUrl(req, link.shortCode);
        const latestClick = link.clicks[0] || null;

        return {
          id: link.id,
          name: link.name,
          shortCode: link.shortCode,
          originalUrl: link.originalUrl,
          clicks: link.clicks.length,
          conversions: link.conversions.length,
          whatsappLink,
          promoLink,
          latestClickAt: latestClick?.clickedAt || null,
          conversionEvents: link.conversions.map(conversion => ({
            id: conversion.id,
            type: conversion.type,
            product: conversion.product,
            destination: conversion.destination,
            visitorName: conversion.visitorName,
            visitorPhone: conversion.visitorPhone,
            visitorDocument: conversion.visitorDocument,
            visitorCity: conversion.visitorCity,
            source: conversion.source,
            ipAddress: conversion.ipAddress,
            userAgent: conversion.userAgent,
            referrer: conversion.referrer,
            utmSource: conversion.utmSource,
            utmMedium: conversion.utmMedium,
            utmCampaign: conversion.utmCampaign,
            utmTerm: conversion.utmTerm,
            utmContent: conversion.utmContent,
            deviceType: conversion.deviceType,
            browser: conversion.browser,
            operatingSystem: conversion.operatingSystem,
            platform: conversion.platform,
            language: conversion.language,
            geoCountry: conversion.geoCountry,
            geoRegion: conversion.geoRegion,
            geoCity: conversion.geoCity,
            timezone: conversion.timezone,
            screenWidth: conversion.screenWidth,
            screenHeight: conversion.screenHeight,
            convertedAt: conversion.convertedAt,
            linkId: link.id,
            linkName: link.name,
            shortCode: link.shortCode,
            originalUrl: link.originalUrl,
            promoLink,
            whatsappLink,
            totalClicks: link.clicks.length,
            latestClickAt: latestClick?.clickedAt || null
          }))
        };
      });

      return res.json({
        affiliate: affiliate.name,
        totalLinks: affiliate.links.length,
        totalClicks,
        totalConversions,
        conversionEvents: formattedLinks.flatMap(
          link => link.conversionEvents
        ),
        links: formattedLinks
      });
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        error: 'Erro ao buscar estatísticas do afiliado'
      });
    }
  }

  async whatsapp(req, res) {
    try {
      const { shortCode } = req.params;
      const product =
        String(req.query.product || 'Plano Familia Netbox').trim();
      const visitorData = visitorDataFromRequest(req);

      const link = await prisma.link.findUnique({
        where: {
          shortCode
        }
      });

      if (!link) {
        return res.status(404).json({
          error: 'Link nao encontrado'
        });
      }

      const destination = buildWhatsAppUrl(
        req.query.message
          ? String(req.query.message)
          : `Tenho interesse no ${product}. Vim pelo link de divulgacao ${shortCode}.`
      );

      const conversion = await prisma.conversion.create({
        data: {
          type: 'whatsapp',
          product,
          destination,
          ...visitorData,
          ...collectVisitorTrackingData(req),
          linkId: link.id
        }
      });

      publishRealtimeEvent('link-converted', {
        linkId: link.id,
        shortCode: link.shortCode,
        conversionId: conversion.id,
        product,
        convertedAt: conversion.convertedAt
      });

      if (req.method === 'POST') {
        return res.status(201).json({
          conversionId: conversion.id,
          destination,
          convertedAt: conversion.convertedAt
        });
      }

      return res.redirect(destination);
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        error: 'Erro ao registrar conversao'
      });
    }
  }
}

module.exports = new LinkController();
