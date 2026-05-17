const prisma = require('../database/prisma');
const crypto = require('node:crypto');

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

  async create(req, res) {
    try {
      const { url, affiliateId: rawAffiliateId } = req.body;

      if (!url || typeof url !== 'string' || !url.trim()) {
        return res.status(400).json({
          error: 'URL é obrigatória'
        });
      }

      const originalUrl = url.trim();

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

      return res.redirect(link.originalUrl);

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
        originalUrl: link.originalUrl,
        shortCode: link.shortCode,
        promoLink: link.affiliateUrl || buildAffiliateUrl(req, link.shortCode),
        totalClicks: link.clicks.length,
        clicks: link.clicks
      });

    } catch (error) {
      console.error(error);

      return res.status(500).json({
        error: 'Erro ao buscar estatísticas'
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
              clicks: true
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

      return res.json({
        affiliate: affiliate.name,
        totalLinks: affiliate.links.length,
        totalClicks,

        links: affiliate.links.map(link => ({
          id: link.id,
          shortCode: link.shortCode,
          originalUrl: link.originalUrl,
          clicks: link.clicks.length,
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
}

module.exports = new LinkController();
