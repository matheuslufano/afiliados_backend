const prisma = require('../database/prisma');
const ExcelJS = require('exceljs');
const { buildAffiliateUrl } = require('../utils/publicUrls');
const { getLinkType } = require('../utils/linkTypes');

const MAX_LIMIT = 200;
const SORT_FIELDS = {
  createdAt: 'clickedAt',
  affiliate: 'link',
  campaign: 'link',
  source: 'source',
  city: 'geoCity',
  status: 'isValid'
};

function text(value, max = 160) {
  return String(value || '').trim().slice(0, max);
}

function integer(value) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function date(value, endOfDay = false) {
  if (!value) return null;
  const parsed = new Date(`${String(value).slice(0, 10)}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function filtersFromQuery(query) {
  const link = {};
  const affiliateId = integer(query.affiliateId);
  const campaignId = integer(query.campaignId);
  const trackingLinkId = integer(query.trackingLinkId);
  if (affiliateId) link.affiliateId = affiliateId;
  if (campaignId) link.campaignId = campaignId;
  if (trackingLinkId) link.id = trackingLinkId;

  const where = {};
  if (Object.keys(link).length) where.link = { is: link };
  const clickedAt = {};
  const startDate = date(query.startDate);
  const endDate = date(query.endDate, true);
  if (startDate) clickedAt.gte = startDate;
  if (endDate) clickedAt.lte = endDate;
  if (Object.keys(clickedAt).length) where.clickedAt = clickedAt;
  ['source', 'utmMedium', 'deviceType', 'geoCity'].forEach((field) => {
    const input = text(query[field]);
    if (input) where[field] = input;
  });

  const status = text(query.status).toLowerCase();
  if (status === 'valid') Object.assign(where, { isValid: true, isSuspectedBot: false });
  if (status === 'invalid') where.isValid = false;
  if (status === 'suspected') where.isSuspectedBot = true;
  if (status === 'converted') where.conversions = { some: {} };
  if (status === 'not-converted') where.conversions = { none: {} };

  const search = text(query.search, 120);
  if (search) {
    where.OR = [
      { clickCode: { contains: search, mode: 'insensitive' } },
      { utmSource: { contains: search, mode: 'insensitive' } },
      { utmCampaign: { contains: search, mode: 'insensitive' } },
      { referrer: { contains: search, mode: 'insensitive' } },
      { link: { is: { name: { contains: search, mode: 'insensitive' } } } },
      { link: { is: { shortCode: { contains: search, mode: 'insensitive' } } } },
      { link: { is: { affiliate: { is: { name: { contains: search, mode: 'insensitive' } } } } } },
      { conversions: { some: { visitorPhone: { contains: search } } } }
    ];
  }
  return where;
}

function clickSelect() {
  return {
    id: true, clickCode: true, clickedAt: true, source: true, utmMedium: true,
    utmCampaign: true, utmSource: true, deviceType: true, geoCity: true,
    geoRegion: true, isValid: true, isSuspectedBot: true, isUnique: true,
    destinationUrl: true, referrer: true,
    link: { select: { id: true, name: true, shortCode: true, originalUrl: true,
      campaign: { select: { id: true, name: true } },
      whatsappLinks: { select: { id: true } },
      affiliate: { select: { id: true, name: true, photoUrl: true } } } },
    conversions: { select: { id: true, visitorName: true, visitorPhone: true, convertedAt: true, type: true } }
  };
}

function publicClick(req, click) {
  const link = click.link ? {
    ...click.link,
    promoLink: buildAffiliateUrl(req, click.link.shortCode),
    linkType: getLinkType(click.link)
  } : click.link;
  return { ...click, link, clickCode: click.clickCode || `LEG-${click.id}`,
    status: click.isSuspectedBot ? 'SUSPEITO' : click.isValid ? (click.conversions.length ? 'CONVERTIDO' : 'VÁLIDO') : 'INVÁLIDO' };
}

function periodBefore(where) {
  if (!where.clickedAt?.gte || !where.clickedAt?.lte) return null;
  const duration = where.clickedAt.lte.getTime() - where.clickedAt.gte.getTime();
  return { ...where, clickedAt: { gte: new Date(where.clickedAt.gte.getTime() - duration - 1), lte: new Date(where.clickedAt.gte.getTime() - 1) } };
}

class ClickController {
  async list(req, res) {
    try {
      const where = filtersFromQuery(req.query);
      const page = Math.max(1, integer(req.query.page) || 1);
      const limit = Math.min(MAX_LIMIT, integer(req.query.limit) || 20);
      const order = text(req.query.order).toLowerCase() === 'asc' ? 'asc' : 'desc';
      const sort = SORT_FIELDS[text(req.query.sort)] || 'clickedAt';
      const orderBy = sort === 'link' ? { link: { name: order } } : { [sort]: order };
      const [total, data] = await prisma.$transaction([
        prisma.click.count({ where }),
        prisma.click.findMany({ where, select: clickSelect(), orderBy, skip: (page - 1) * limit, take: limit })
      ]);
      const linkIds = [...new Set(data.map((click) => click.link?.id).filter(Boolean))];
      const clickSequence = linkIds.length
        ? await prisma.click.findMany({
            where: { linkId: { in: linkIds } },
            select: { id: true, linkId: true },
            orderBy: [{ linkId: 'asc' }, { clickedAt: 'asc' }, { id: 'asc' }]
          })
        : [];
      const clickPositions = new Map();
      const nextPositionByLink = new Map();
      clickSequence.forEach((click) => {
        const nextPosition = (nextPositionByLink.get(click.linkId) || 0) + 1;
        nextPositionByLink.set(click.linkId, nextPosition);
        clickPositions.set(click.id, nextPosition);
      });
      const rankedData = data.map((click) => ({
        ...click,
        link: click.link
          ? { ...click.link, clickPosition: clickPositions.get(click.id) || null }
          : click.link
      }));
      return res.json({ data: rankedData.map((click) => publicClick(req, click)), pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } });
    } catch (error) { console.error(error); return res.status(500).json({ error: 'Erro ao listar cliques' }); }
  }

  async details(req, res) {
    try {
      const id = integer(req.params.id);
      if (!id) return res.status(400).json({ error: 'Clique inválido' });
      const click = await prisma.click.findUnique({ where: { id }, include: {
        link: { include: { affiliate: true, campaign: true } },
        conversions: { include: { contact: true, crmDeal: { include: { stage: true, status: true } } }, orderBy: { convertedAt: 'desc' } }
      } });
      if (!click) return res.status(404).json({ error: 'Clique não encontrado' });
      return res.json(publicClick(req, click));
    } catch (error) { console.error(error); return res.status(500).json({ error: 'Erro ao carregar detalhe do clique' }); }
  }

  async metrics(req, res) {
    try {
      const where = filtersFromQuery(req.query);
      const previous = periodBefore(where);
      const [totalClicks, uniqueClicks, validClicks, converted, whatsappClicks, links, activeLinks, affiliatesWithClicks, previousClicks] = await Promise.all([
        prisma.click.count({ where }), prisma.click.count({ where: { ...where, isUnique: true } }),
        prisma.click.count({ where: { ...where, isValid: true, isSuspectedBot: false } }),
        prisma.conversion.count({ where: { click: { is: { ...where, isValid: true, isSuspectedBot: false } } } }),
        prisma.click.count({ where: { ...where, destinationUrl: { contains: 'whatsapp', mode: 'insensitive' } } }),
        prisma.link.count(), prisma.link.count({ where: { active: true } }),
        prisma.click.groupBy({ by: ['linkId'], where: { ...where, link: { is: { affiliateId: { not: null } } } } }),
        previous ? prisma.click.count({ where: previous }) : Promise.resolve(null)
      ]);
      const affiliateIds = new Set((await prisma.click.findMany({ where, select: { link: { select: { affiliateId: true } } } })).map((item) => item.link.affiliateId).filter(Boolean));
      const percent = previousClicks === null || previousClicks === 0 ? null : ((totalClicks - previousClicks) / previousClicks) * 100;
      return res.json({ totalClicks, uniqueClicks, activeLinks, totalLinks: links, affiliatesWithClicks: affiliateIds.size, validClicks, conversionRate: validClicks ? (converted / validClicks) * 100 : 0, conversions: converted, whatsappClicks, whatsappPercentage: totalClicks ? (whatsappClicks / totalClicks) * 100 : 0, previousPeriodComparison: percent, _linkGroups: affiliatesWithClicks.length });
    } catch (error) { console.error(error); return res.status(500).json({ error: 'Erro ao calcular métricas' }); }
  }

  async timeline(req, res) {
    try {
      const where = filtersFromQuery(req.query);
      const group = ['hour', 'day', 'week', 'month'].includes(text(req.query.group)) ? text(req.query.group) : 'day';
      const clicks = await prisma.click.findMany({ where, select: { clickedAt: true, isUnique: true, conversions: { select: { id: true } } }, orderBy: { clickedAt: 'asc' } });
      const buckets = new Map();
      for (const click of clicks) { const date = new Date(click.clickedAt); const key = group === 'month' ? date.toISOString().slice(0, 7) : group === 'hour' ? date.toISOString().slice(0, 13) : date.toISOString().slice(0, 10); const row = buckets.get(key) || { date: key, clicks: 0, uniqueClicks: 0, conversions: 0 }; row.clicks++; row.uniqueClicks += click.isUnique ? 1 : 0; row.conversions += click.conversions.length; buckets.set(key, row); }
      // Mantém a série contínua: dias sem tráfego aparecem como zero no gráfico.
      if (group === 'day') {
        const requestedStart = date(req.query.startDate);
        const requestedEnd = date(req.query.endDate, true);
        const start = requestedStart || new Date(Date.now() - 29 * 86400000);
        const end = requestedEnd || new Date();
        for (const cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
          const key = cursor.toISOString().slice(0, 10);
          if (!buckets.has(key)) buckets.set(key, { date: key, clicks: 0, uniqueClicks: 0, conversions: 0 });
        }
      }
      return res.json([...buckets.values()].sort((a, b) => a.date.localeCompare(b.date)));
    } catch (error) { console.error(error); return res.status(500).json({ error: 'Erro ao gerar timeline' }); }
  }

  async ranking(req, res) {
    try {
      const where = filtersFromQuery(req.query);
      const clicks = await prisma.click.findMany({ where, select: { isUnique: true, conversions: { select: { id: true } }, link: { select: { affiliate: { select: { id: true, name: true, photoUrl: true } } } } } });
      const rows = new Map(); const total = clicks.length;
      clicks.forEach((click) => { const affiliate = click.link.affiliate; if (!affiliate) return; const row = rows.get(affiliate.id) || { affiliateId: affiliate.id, affiliateName: affiliate.name, avatar: affiliate.photoUrl, clicks: 0, uniqueClicks: 0, leads: 0, conversions: 0 }; row.clicks++; row.uniqueClicks += click.isUnique ? 1 : 0; row.conversions += click.conversions.length; row.leads += click.conversions.length; rows.set(affiliate.id, row); });
      return res.json([...rows.values()].map((row) => ({ ...row, conversionRate: row.clicks ? (row.conversions / row.clicks) * 100 : 0, percentage: total ? (row.clicks / total) * 100 : 0 })).sort((a, b) => b.clicks - a.clicks));
    } catch (error) { console.error(error); return res.status(500).json({ error: 'Erro ao gerar ranking' }); }
  }

  async export(req, res) {
    try {
      const where = filtersFromQuery(req.query);
      const format = text(req.query.format).toLowerCase();
      if (!['csv', 'xlsx'].includes(format)) return res.status(400).json({ error: 'Formato de exportação inválido.' });
      const rows = await prisma.click.findMany({ where, select: clickSelect(), orderBy: { clickedAt: 'desc' }, take: 10000 });
      const header = ['ID do clique', 'Data/hora', 'Afiliado', 'Campanha', 'Link', 'URL curta', 'Destino', 'Origem', 'Medium', 'Dispositivo', 'Cidade', 'Estado', 'Status', 'Conversão', 'UTM Source', 'UTM Campaign'];
      const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
      const values = rows.map((click) => { const item = publicClick(req, click); return [item.clickCode, item.clickedAt.toISOString(), item.link.affiliate?.name, item.link.campaign?.name, item.link.name, item.link.shortCode, item.destinationUrl || item.link.originalUrl, item.source, item.utmMedium, item.deviceType, item.geoCity, item.geoRegion, item.status, item.conversions.length ? 'Sim' : 'Não', item.utmSource, item.utmCampaign]; });
      if (format === 'xlsx') {
        const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet('Cliques');
        sheet.addRow(header); values.forEach((row) => sheet.addRow(row)); sheet.getRow(1).font = { bold: true }; sheet.columns.forEach((column) => { column.width = 20; });
        const output = await workbook.xlsx.writeBuffer(); res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); res.setHeader('Content-Disposition', 'attachment; filename="relatorio-links-clicados.xlsx"'); return res.send(Buffer.from(output));
      }
      const csv = [header, ...values].map((row) => row.map(escape).join(',')).join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', 'attachment; filename="relatorio-links-clicados.csv"'); return res.send(`\uFEFF${csv}`);
    } catch (error) { console.error(error); return res.status(500).json({ error: 'Erro ao exportar cliques' }); }
  }
}

module.exports = new ClickController();
