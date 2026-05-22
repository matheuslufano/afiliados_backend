const prisma = require('../database/prisma');
const crypto = require('node:crypto');
const QRCode = require('qrcode');

const DEFAULT_WHATSAPP_NUMBER = '55008006022732';

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

function normalizePhoneNumber(value) {
  return String(value || '').replace(/\D/g, '');
}

function buildWhatsAppUrl(message) {
  const text =
    message ||
    process.env.WHATSAPP_MESSAGE ||
    'Tenho interesse no Plano Familia Netbox.';

  if (process.env.WHATSAPP_URL) {
    const url = new URL(process.env.WHATSAPP_URL);
    url.searchParams.set('text', text);
    return url.toString();
  }

  const phone = normalizePhoneNumber(
    process.env.WHATSAPP_NUMBER || DEFAULT_WHATSAPP_NUMBER
  );

  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}

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
        links.map(async (link) => {
          const promoLink =
            link.affiliateUrl || buildAffiliateUrl(req, link.shortCode);

          return {
            id: link.id,
            name: link.name,
            originalUrl: link.originalUrl,
            shortCode: link.shortCode,
            promoLink,
            clicks: link.clicks.length,
            conversions: link.conversions.length,
            whatsappLink: `${publicAppBaseUrl(req)}/links/${link.shortCode}/whatsapp`,
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
        })
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

      if (!url || typeof url !== 'string' || !url.trim()) {
        return res.status(400).json({
          error: 'URL é obrigatória'
        });
      }

      const originalUrl = url.trim();
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
        link: link.affiliateUrl
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

      await prisma.click.create({
        data: {
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
          linkId: link.id
        }
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
        promoLink: link.affiliateUrl || buildAffiliateUrl(req, link.shortCode),
        totalClicks: link.clicks.length,
        totalConversions: link.conversions.length,
        whatsappLink: `${publicAppBaseUrl(req)}/links/${link.shortCode}/whatsapp`,
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

  async affiliateStats(req, res) {
    try {
      const { id } = req.params;

      const affiliate = await prisma.affiliate.findUnique({
        where: {
          id: Number(id)
        },
        include: {
          links: {
            include: {
              clicks: true,
              conversions: true
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

      return res.json({
        affiliate: affiliate.name,
        totalLinks: affiliate.links.length,
        totalClicks,
        totalConversions,

        links: affiliate.links.map(link => ({
          id: link.id,
          name: link.name,
          shortCode: link.shortCode,
          originalUrl: link.originalUrl,
          clicks: link.clicks.length,
          conversions: link.conversions.length,
          whatsappLink: `${publicAppBaseUrl(req)}/links/${link.shortCode}/whatsapp`,
          promoLink: link.affiliateUrl || buildAffiliateUrl(req, link.shortCode)
        }))
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

      await prisma.conversion.create({
        data: {
          type: 'whatsapp',
          product,
          destination,
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
          linkId: link.id
        }
      });

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
