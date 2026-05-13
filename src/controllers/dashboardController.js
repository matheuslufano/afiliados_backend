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

      const affiliates =
        await prisma.affiliate.findMany({
          include: {
            links: {
              include: {
                clicks: true
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

          return {
            id: affiliate.id,
            name: affiliate.name,
            totalClicks: clicks
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