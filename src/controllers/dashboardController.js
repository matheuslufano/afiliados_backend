const prisma = require('../database/prisma');

class DashboardController {

  async stats(req, res) {
    try {

      const totalAffiliates =
        await prisma.affiliate.count();

      const totalLinks =
        await prisma.link.count();

      const totalClicks =
        await prisma.click.count();

      const totalConversions =
        await prisma.conversion.count();

      const affiliates =
        await prisma.affiliate.findMany({
          include: {
            links: {
              include: {
                clicks: true,
                conversions: true
              }
            }
          }
        });

      const ranking = affiliates
        .map(affiliate => {

          const clicks =
            affiliate.links.reduce(
              (acc, link) =>
                acc + link.clicks.length,
              0
            );

          const conversions =
            affiliate.links.reduce(
              (acc, link) =>
                acc + link.conversions.length,
              0
            );

          return {
            id: affiliate.id,
            name: affiliate.name,
            totalClicks: clicks,
            totalConversions: conversions
          };
        })
        .sort(
          (a, b) =>
            b.totalClicks -
            a.totalClicks
        );

      return res.json({
        totalAffiliates,
        totalLinks,
        totalClicks,
        totalConversions,

        topAffiliates:
          ranking.slice(0, 5)
      });

    } catch (error) {
      console.error(error);

      return res.status(500).json({
        error:
          'Erro ao carregar dashboard'
      });
    }
  }
}

module.exports =
  new DashboardController();
