const prisma = require('../database/prisma');
const crypto = require('node:crypto');

class LinkController {

  async create(req, res) {
    try {
      const { url, affiliateId } = req.body;

      if (!url) {
        return res.status(400).json({
          error: 'URL é obrigatória'
        });
      }

      const shortCode =
        crypto.randomBytes(3).toString('hex');

      const link = await prisma.link.create({
        data: {
          originalUrl: url,
          shortCode,
          userId: 1,
          affiliateId
        }
      });

      return res.status(201).json({
        message: 'Link criado com sucesso',
        link: `http://localhost:3000/r/${link.shortCode}`
      });

    } catch (error) {
      console.error(error);

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
        clicks: link.clicks.length
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