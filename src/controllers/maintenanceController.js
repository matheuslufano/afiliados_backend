const prisma = require('../database/prisma');
const { signStudioToken } = require('../routes/prismaStudioRoute');

function requireConfirmation(req, res, expected) {
  if (String(req.body?.confirmation || '').trim() !== expected) {
    res.status(400).json({ error: `Digite exatamente: ${expected}` });
    return false;
  }
  return true;
}

async function purgeLinks(req, res) {
  if (!requireConfirmation(req, res, 'APAGAR LINKS')) return;
  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.crmDeal.updateMany({
        where: { OR: [{ linkId: { not: null } }, { conversionId: { not: null } }] },
        data: { linkId: null, conversionId: null }
      });
      const whatsappLinks = await tx.whatsAppLink.deleteMany();
      const clicks = await tx.click.deleteMany();
      const conversions = await tx.conversion.deleteMany();
      const links = await tx.link.deleteMany();
      return { links: links.count, whatsappLinks: whatsappLinks.count, clicks: clicks.count, conversions: conversions.count };
    }, { timeout: 120000 });
    console.warn('[maintenance] links purged', { userId: req.user.id, ...result });
    return res.json({ message: 'Todos os links e dados dependentes foram apagados.', deleted: result });
  } catch (error) {
    console.error('[maintenance] purge links failed', error);
    return res.status(500).json({ error: 'Não foi possível apagar todos os links.' });
  }
}

async function purgeCrm(req, res) {
  if (!requireConfirmation(req, res, 'APAGAR CRM')) return;
  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.conversion.updateMany({ data: { crmDeletedAt: new Date() } });
      const commissions = await tx.affiliateCommission.deleteMany();
      const tasks = await tx.crmDealTask.deleteMany();
      const history = await tx.crmDealHistory.deleteMany();
      const deals = await tx.crmDeal.deleteMany();
      const filters = await tx.savedCrmFilter.deleteMany();
      const stages = await tx.crmStage.deleteMany();
      const funnels = await tx.crmFunnel.deleteMany();
      const statuses = await tx.crmDealStatus.deleteMany();
      const sources = await tx.crmLeadSource.deleteMany();
      const syncLogs = await tx.crmSyncLog.deleteMany();
      return { deals: deals.count, tasks: tasks.count, history: history.count, commissions: commissions.count, filters: filters.count, stages: stages.count, funnels: funnels.count, statuses: statuses.count, sources: sources.count, syncLogs: syncLogs.count };
    }, { timeout: 120000 });
    console.warn('[maintenance] crm purged', { userId: req.user.id, ...result });
    return res.json({ message: 'Todos os dados do CRM foram apagados.', deleted: result });
  } catch (error) {
    console.error('[maintenance] purge crm failed', error);
    return res.status(500).json({ error: 'Não foi possível apagar os dados do CRM.' });
  }
}

async function purgeDatabase(req, res) {
  if (!requireConfirmation(req, res, 'LIMPAR BANCO')) return;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const deleted = {};
      deleted.whatsappLinks = (await tx.whatsAppLink.deleteMany()).count;
      deleted.clicks = (await tx.click.deleteMany()).count;
      deleted.commissions = (await tx.affiliateCommission.deleteMany()).count;
      deleted.tasks = (await tx.crmDealTask.deleteMany()).count;
      deleted.history = (await tx.crmDealHistory.deleteMany()).count;
      deleted.filters = (await tx.savedCrmFilter.deleteMany()).count;
      deleted.appointments = (await tx.contactAppointment.deleteMany()).count;
      deleted.interactions = (await tx.contactInteraction.deleteMany()).count;
      deleted.deals = (await tx.crmDeal.deleteMany()).count;
      deleted.conversions = (await tx.conversion.deleteMany()).count;
      deleted.links = (await tx.link.deleteMany()).count;
      deleted.contacts = (await tx.contact.deleteMany()).count;
      deleted.stages = (await tx.crmStage.deleteMany()).count;
      deleted.funnels = (await tx.crmFunnel.deleteMany()).count;
      deleted.statuses = (await tx.crmDealStatus.deleteMany()).count;
      deleted.sources = (await tx.crmLeadSource.deleteMany()).count;
      deleted.syncLogs = (await tx.crmSyncLog.deleteMany()).count;
      deleted.webhookLogs = (await tx.webhookLog.deleteMany()).count;
      deleted.campaigns = (await tx.campaign.deleteMany()).count;
      deleted.affiliates = (await tx.affiliate.deleteMany()).count;
      await tx.user.updateMany({ data: { teamId: null } });
      deleted.teams = (await tx.crmTeam.deleteMany()).count;
      return deleted;
    }, { timeout: 120000 });
    console.warn('[maintenance] database purged except users', { userId: req.user.id, ...result });
    return res.json({ message: 'Banco limpo. Apenas os usuários foram preservados.', deleted: result });
  } catch (error) {
    console.error('[maintenance] purge database failed', error);
    return res.status(500).json({ error: 'Não foi possível limpar o banco de dados.' });
  }
}

function createPrismaStudioSession(req, res) {
  return res.json({ token: signStudioToken(req.user.id), expiresInSeconds: 300 });
}

module.exports = { purgeLinks, purgeCrm, purgeDatabase, createPrismaStudioSession };
