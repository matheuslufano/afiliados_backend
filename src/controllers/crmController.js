const prisma = require('../database/prisma');
const {
  accessWhere,
  canAssign,
  isManager,
  orderBy,
  parseConditions,
  scopeWhere
} = require('../services/crmAccess');

const FUNNEL_NAME = 'Funil Vendas Chatmix';

const DEFAULT_STATUSES = [
  { key: 'new', name: 'Nova', color: '#2563eb', isFinal: false },
  { key: 'ongoing', name: 'Em andamento', color: '#0891b2', isFinal: false },
  { key: 'no_contact', name: 'Sem contato', color: '#64748b', isFinal: false },
  { key: 'waiting', name: 'Aguardando retorno', color: '#ca8a04', isFinal: false },
  { key: 'presentation', name: 'Apresentacao enviada', color: '#7c3aed', isFinal: false },
  { key: 'negotiation', name: 'Em negociacao', color: '#db2777', isFinal: false },
  { key: 'won', name: 'Venda concluida', color: '#16a34a', isFinal: true },
  { key: 'lost', name: 'Venda perdida', color: '#6b7280', isFinal: true },
  { key: 'canceled', name: 'Cancelada', color: '#991b1b', isFinal: true }
];

const DEFAULT_STAGES = [
  {
    name: 'Sem contato',
    position: 1,
    color: '#64748b',
    slaHours: 24
  },
  {
    name: 'Em atendimento',
    position: 2,
    color: '#0891b2',
    slaHours: 48
  },
  {
    name: 'Apresentacao',
    position: 3,
    color: '#2563eb',
    slaHours: 72
  },
  {
    name: 'Informacoes cadastrais',
    position: 4,
    color: '#7c3aed',
    slaHours: 24
  },
  {
    name: 'Venda concluida',
    position: 5,
    color: '#16a34a',
    slaHours: 0,
    isFinal: true,
    isWonStage: true
  },
  {
    name: 'Venda perdida',
    position: 6,
    color: '#6b7280',
    slaHours: 0,
    isFinal: true,
    isLostStage: true
  }
];

const DEFAULT_SOURCES = [
  { name: 'Afiliado', type: 'affiliate' },
  { name: 'Campanha', type: 'campaign' },
  { name: 'WhatsApp direto', type: 'whatsapp' },
  { name: 'Chatmix', type: 'chatmix' },
  { name: 'SGP', type: 'sgp' },
  { name: 'Manual', type: 'manual' }
];

function toPlainDecimal(value) {
  if (value === null || value === undefined) {
    return 0;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value.toNumber === 'function') {
    return value.toNumber();
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function containsAny(value, tokens) {
  const text = normalizeText(value);
  return tokens.some((token) => text.includes(token));
}

function addHours(date, hours) {
  const next = new Date(date);
  next.setHours(next.getHours() + hours);
  return next;
}

async function ensureCrmDefaults() {
  let funnel = await prisma.crmFunnel.findUnique({ where: { name: FUNNEL_NAME } });

  if (!funnel) {
    funnel = await prisma.crmFunnel.create({
      data: {
        name: FUNNEL_NAME,
        description: 'Funil principal para vendas vindas do Chatmix, afiliados e campanhas.'
      }
    });
  } else if (!funnel.isActive) {
    funnel = await prisma.crmFunnel.update({
      where: { id: funnel.id },
      data: { isActive: true }
    });
  }

  const statuses = {};
  for (const status of DEFAULT_STATUSES) {
    statuses[status.key] = await prisma.crmDealStatus.upsert({
      where: {
        key: status.key
      },
      update: {
        name: status.name,
        color: status.color,
        isFinal: status.isFinal
      },
      create: status
    });
  }

  const stageCount = await prisma.crmStage.count({ where: { funnelId: funnel.id } });
  if (stageCount === 0) {
    await prisma.crmStage.createMany({
      data: DEFAULT_STAGES.map((stage) => ({
        ...stage,
        funnelId: funnel.id,
        isFinal: Boolean(stage.isFinal),
        isWonStage: Boolean(stage.isWonStage),
        isLostStage: Boolean(stage.isLostStage)
      }))
    });
  }

  const savedStages = await prisma.crmStage.findMany({
    where: { funnelId: funnel.id },
    orderBy: [{ position: 'asc' }, { id: 'asc' }]
  });
  const stages = Object.fromEntries(
    savedStages.map((stage) => [normalizeText(stage.name), stage])
  );

  const sources = {};
  for (const source of DEFAULT_SOURCES) {
    sources[source.name] = await prisma.crmLeadSource.upsert({
      where: {
        name: source.name
      },
      update: {
        type: source.type
      },
      create: source
    });
  }

  return {
    funnel,
    statuses,
    stages,
    sources
  };
}

function deriveConversionPlacement(conversion) {
  const link = conversion.link;
  const searchText = [
    conversion.type,
    conversion.product,
    conversion.destination,
    conversion.source,
    conversion.userAgent,
    link?.name,
    link?.originalUrl,
    link?.campaign?.name
  ].filter(Boolean).join(' ');
  const hasVisitorData = Boolean(
    conversion.visitorName ||
      conversion.visitorPhone ||
      conversion.visitorDocument ||
      conversion.visitorCity
  );
  const hasChatmix =
    containsAny(searchText, ['chatmix']) ||
    containsAny(conversion.source, ['chatmix']);
  const hasSgpOrSale = containsAny(searchText, [
    'sgp',
    'venda',
    'vendido',
    'vendida',
    'cliente ativo',
    'contrato ativo'
  ]);
  const hasLoss = containsAny(searchText, [
    'perd',
    'cancel',
    'sem cobertura',
    'desist',
    'concorrente'
  ]);

  if (hasLoss) {
    return {
      statusKey: 'lost',
      stageName: 'Venda perdida',
      activity: 'Venda perdida',
      priorityLevel: 'low'
    };
  }

  if (hasSgpOrSale) {
    return {
      statusKey: 'won',
      stageName: 'Venda concluida',
      activity: 'Venda concluida',
      priorityLevel: 'medium'
    };
  }

  if (hasChatmix && hasVisitorData) {
    return {
      statusKey: 'negotiation',
      stageName: 'Informacoes cadastrais',
      activity: 'Conferir dados coletados no Chatmix',
      priorityLevel: 'high'
    };
  }

  if (hasVisitorData) {
    return {
      statusKey: 'ongoing',
      stageName: 'Em atendimento',
      activity: '1o contato - 24 horas',
      priorityLevel: 'medium'
    };
  }

  return {
    statusKey: 'no_contact',
    stageName: 'Sem contato',
    activity: '1o contato - 24 horas',
    priorityLevel: 'medium'
  };
}

function sourceForConversion(conversion) {
  if (containsAny(conversion.source, ['chatmix']) || containsAny(conversion.type, ['chatmix'])) {
    return 'Chatmix';
  }

  if (conversion.link?.campaignId) {
    return 'Campanha';
  }

  if (conversion.link?.affiliateId) {
    return 'Afiliado';
  }

  if (containsAny(conversion.type, ['whatsapp'])) {
    return 'WhatsApp direto';
  }

  return 'Campanha';
}

function customerNameForConversion(conversion) {
  return (
    conversion.visitorName ||
    conversion.visitorPhone ||
    conversion.link?.affiliate?.name ||
    conversion.link?.name ||
    `Conversao #${conversion.id}`
  );
}

async function createHistoryOnce(dealId, eventType, message, metadata) {
  const existing = await prisma.crmDealHistory.findFirst({
    where: {
      dealId,
      eventType,
      message
    }
  });

  if (existing) {
    return existing;
  }

  return prisma.crmDealHistory.create({
    data: {
      dealId,
      eventType,
      message,
      metadata
    }
  });
}

async function createCommissionIfNeeded(deal, conversion) {
  if (!deal.affiliateId || deal.status.key !== 'won') {
    return null;
  }

  const amount = Number(process.env.AFFILIATE_DEFAULT_COMMISSION || 30);

  return prisma.affiliateCommission.upsert({
    where: {
      affiliateId_dealId: {
        affiliateId: deal.affiliateId,
        dealId: deal.id
      }
    },
    update: {},
    create: {
      affiliateId: deal.affiliateId,
      dealId: deal.id,
      amount: Number.isFinite(amount) ? amount : 30,
      notes: `Comissao gerada pela conversao #${conversion.id}`
    }
  });
}

async function syncConvertedClients() {
  const startedAt = new Date();
  const defaults = await ensureCrmDefaults();
  const conversions = await prisma.conversion.findMany({
    orderBy: {
      convertedAt: 'desc'
    },
    include: {
      link: {
        include: {
          affiliate: true,
          campaign: true
        }
      },
      crmDeal: true
    }
  });
  let created = 0;
  let updated = 0;

  for (const conversion of conversions) {
    const placement = deriveConversionPlacement(conversion);
    const sourceName = sourceForConversion(conversion);
    const stage =
      defaults.stages[normalizeText(placement.stageName)] ||
      Object.values(defaults.stages)[0];
    const status = defaults.statuses[placement.statusKey];
    const source = defaults.sources[sourceName] || defaults.sources.Campanha;
    const nextFollowUpAt = addHours(conversion.convertedAt, stage?.slaHours || 24);
    const monthlyValue = containsAny(conversion.product, ['149'])
      ? 149.9
      : containsAny(conversion.product, ['139'])
        ? 139.9
        : null;
    const baseData = {
      customerName: customerNameForConversion(conversion),
      phone: conversion.visitorPhone,
      city: conversion.visitorCity,
      funnelId: defaults.funnel.id,
      sourceId: source.id,
      affiliateId: conversion.link?.affiliateId || null,
      linkId: conversion.linkId,
      campaignName: conversion.link?.campaign?.name || conversion.link?.name || null,
      estimatedValue: monthlyValue,
      monthlyValue,
      plan: conversion.product || null,
      trackingCode: conversion.link?.shortCode || null,
      lastInteractionAt: conversion.convertedAt,
      nextFollowUpAt,
      notes: `Criado automaticamente a partir do relatorio de conversoes. Origem: ${sourceName}.`,
      chatmixId: containsAny(conversion.source, ['chatmix']) ? String(conversion.id) : null
    };
    const createData = {
      ...baseData,
      stageId: stage.id,
      statusId: status.id,
      priorityLevel: placement.priorityLevel,
      closedAt: placement.statusKey === 'won' ? conversion.convertedAt : null
    };
    const updateData = {
      ...baseData
    };

    const deal = await prisma.crmDeal.upsert({
      where: {
        conversionId: conversion.id
      },
      update: updateData,
      create: {
        ...createData,
        conversionId: conversion.id
      },
      include: {
        status: true
      }
    });

    if (conversion.crmDeal) {
      updated += 1;
    } else {
      created += 1;
    }

    await createHistoryOnce(
      deal.id,
      'conversion_synced',
      `Cliente convertido importado do relatorio (conversao #${conversion.id})`,
      {
        conversionId: conversion.id,
        source: sourceName,
        status: placement.statusKey
      }
    );

    await createCommissionIfNeeded(deal, conversion);
  }

  await prisma.crmSyncLog.create({
    data: {
      integrationName: 'Relatorio de conversoes',
      status: 'success',
      message: `${created} cliente(s) convertido(s) criado(s), ${updated} atualizado(s).`,
      startedAt,
      finishedAt: new Date()
    }
  });

  return {
    created,
    updated,
    total: conversions.length
  };
}

function formatDeal(deal) {
  const conversion = deal.conversion;
  const link = deal.link;

  return {
    id: String(deal.id),
    customerName: deal.customerName,
    phone: deal.phone || '',
    email: deal.email || '',
    city: deal.city || '',
    neighborhood: deal.neighborhood || '',
    address: deal.address || '',
    status: deal.status.key,
    statusName: deal.status.name,
    statusColor: deal.status.color,
    stageId: String(deal.stageId),
    stageName: deal.stage.name,
    funnelId: String(deal.funnelId),
    source: deal.source?.name || 'Manual',
    affiliate: deal.affiliate?.name || 'Sem afiliado',
    affiliateId: deal.affiliateId,
    campaign: deal.campaignName || link?.campaign?.name || link?.name || 'Sem campanha',
    value: toPlainDecimal(deal.estimatedValue),
    monthlyValue: toPlainDecimal(deal.monthlyValue),
    plan: deal.plan || conversion?.product || 'A definir',
    cardColor: deal.cardColor || '',
    owner: deal.responsibleUser?.name || '',
    createdByUserId: deal.createdByUserId,
    createdByUserName: deal.createdByUser?.name || '',
    responsibleUserId: deal.responsibleUserId,
    responsibleUserName: deal.responsibleUser?.name || '',
    responsibleUserPhotoUrl: deal.responsibleUser?.photoUrl || null,
    updatedByUserId: deal.updatedByUserId,
    activity:
      deal.tasks?.[0]?.title ||
      (deal.status.key === 'won'
        ? 'Venda concluida'
        : deal.status.key === 'lost'
          ? 'Venda perdida'
          : '1o contato - 24 horas'),
    createdAt: deal.createdAt,
    updatedAt: deal.updatedAt,
    lastInteractionAt: deal.lastInteractionAt || deal.updatedAt,
    nextFollowUpAt: deal.nextFollowUpAt || deal.updatedAt,
    priority: deal.priorityLevel,
    attempts: deal.history?.filter((item) => item.eventType === 'contact_registered').length || 0,
    notes: deal.notes || '',
    trackingCode: deal.trackingCode || '',
    chatmixId: deal.chatmixId || '',
    sgpId: deal.sgpId || '',
    conversionId: deal.conversionId,
    linkId: deal.linkId,
    tasks: (deal.tasks || []).map((task) => ({
      id: String(task.id),
      title: task.title,
      status: task.status,
      dueAt: task.dueAt
    })),
    history: (deal.history || []).map((item) => ({
      id: String(item.id),
      eventType: item.eventType,
      message: item.message,
      createdAt: item.createdAt
    })),
    sale: deal.status.key === 'won'
      ? {
          plan: deal.plan || conversion?.product || 'Plano contratado',
          monthlyValue: toPlainDecimal(deal.monthlyValue),
          installationFee: 0,
          closedAt: deal.closedAt || deal.updatedAt,
          installationAt: null,
          installationStatus: deal.sgpId ? 'Cliente localizado no SGP' : 'Pendente',
          commission: toPlainDecimal(deal.commissions?.[0]?.amount)
        }
      : null
  };
}

function formatStage(stage) {
  return {
    id: String(stage.id),
    title: stage.name,
    color: stage.color || '#64748b',
    slaHours: stage.slaHours || 0,
    isFinal: stage.isFinal,
    isWonStage: stage.isWonStage,
    isLostStage: stage.isLostStage
  };
}

function readStagePayload(body) {
  const data = {};

  if (body.name !== undefined || body.title !== undefined) {
    const name = String(body.name ?? body.title ?? '').trim();

    if (!name) {
      return {
        error: 'Nome da etapa e obrigatorio'
      };
    }

    data.name = name;
  }

  if (body.color !== undefined) {
    const color = String(body.color || '').trim();
    data.color = /^#[0-9a-f]{6}$/i.test(color) ? color : '#64748b';
  }

  if (body.slaHours !== undefined) {
    const slaHours = Number(body.slaHours);
    data.slaHours = Number.isFinite(slaHours) && slaHours >= 0
      ? Math.round(slaHours)
      : 0;
  }

  if (body.position !== undefined) {
    const position = Number(body.position);

    if (Number.isFinite(position) && position > 0) {
      data.position = Math.round(position);
    }
  }

  if (body.isWonStage !== undefined) {
    data.isWonStage = Boolean(body.isWonStage);
  }

  if (body.isLostStage !== undefined) {
    data.isLostStage = Boolean(body.isLostStage);
  }

  if (body.isFinal !== undefined) {
    data.isFinal = Boolean(body.isFinal);
  }

  if (data.isWonStage && data.isLostStage) {
    return {
      error: 'A etapa nao pode ser venda concluida e venda perdida ao mesmo tempo'
    };
  }

  if (data.isWonStage || data.isLostStage) {
    data.isFinal = true;
  }

  return {
    data
  };
}

class CrmController {
  async createFunnel(req, res) {
    try {
      const name = String(req.body.name || '').trim();
      const description = String(req.body.description || '').trim() || null;
      const sourceFunnelId = Number(req.body.sourceFunnelId);

      if (!name || name.length > 80) {
        return res.status(400).json({
          error: 'O nome do funil e obrigatorio e deve ter ate 80 caracteres'
        });
      }

      const defaults = await ensureCrmDefaults();
      const source = await prisma.crmFunnel.findUnique({
        where: {
          id: Number.isInteger(sourceFunnelId)
            ? sourceFunnelId
            : defaults.funnel.id
        },
        include: {
          stages: {
            orderBy: {
              position: 'asc'
            }
          }
        }
      });

      if (!source) {
        return res.status(400).json({ error: 'Funil de origem nao encontrado' });
      }

      const funnel = await prisma.$transaction(async (transaction) => {
        const created = await transaction.crmFunnel.create({
          data: {
            name,
            description
          }
        });

        if (source.stages.length > 0) {
          await transaction.crmStage.createMany({
            data: source.stages.map((stage) => ({
              funnelId: created.id,
              name: stage.name,
              position: stage.position,
              color: stage.color,
              slaHours: stage.slaHours,
              isFinal: stage.isFinal,
              isWonStage: stage.isWonStage,
              isLostStage: stage.isLostStage
            }))
          });
        }

        return transaction.crmFunnel.findUnique({
          where: { id: created.id },
          include: {
            stages: {
              orderBy: { position: 'asc' }
            }
          }
        });
      });

      return res.status(201).json({
        id: String(funnel.id),
        name: funnel.name,
        description: funnel.description,
        stages: funnel.stages.map(formatStage)
      });
    } catch (error) {
      if (error?.code === 'P2002') {
        return res.status(409).json({
          error: 'Ja existe um funil com esse nome'
        });
      }

      console.error(error);
      return res.status(500).json({ error: 'Erro ao criar funil' });
    }
  }

  async listDeals(req, res) {
    try {
      const shouldSync = req.query.syncConverted !== 'false';
      const sync = shouldSync
        ? await syncConvertedClients()
        : null;
      const defaults = await ensureCrmDefaults();
      const funnels = await prisma.crmFunnel.findMany({
        where: {
          isActive: true
        },
        orderBy: {
          id: 'asc'
        },
        include: {
          stages: {
            orderBy: {
              position: 'asc'
            }
          }
        }
      });
      const requestedUserId = req.query.responsibleUserId
        ? Number(req.query.responsibleUserId)
        : null;
      const funnelId = req.query.funnelId ? Number(req.query.funnelId) : null;
      const conditions = parseConditions(req.query.filters);
      const queryParts = [
        { archivedAt: null },
        accessWhere(req.user),
        scopeWhere(req.user, String(req.query.scope || ''), requestedUserId),
        ...conditions
      ];

      if (funnelId) queryParts.push({ funnelId });
      if (req.query.status && req.query.status !== 'all') {
        queryParts.push({ status: { key: String(req.query.status) } });
      }

      const deals = await prisma.crmDeal.findMany({
        where: { AND: queryParts },
        orderBy: orderBy(String(req.query.sort || 'created-desc')),
        include: {
          funnel: true,
          stage: true,
          status: true,
          source: true,
          affiliate: true,
          link: {
            include: {
              campaign: true
            }
          },
          conversion: true,
          tasks: {
            orderBy: {
              dueAt: 'asc'
            }
          },
          history: {
            orderBy: {
              createdAt: 'desc'
            },
            take: 20
          },
          commissions: true
          ,createdByUser: { select: { id: true, name: true } }
          ,responsibleUser: { select: { id: true, name: true, photoUrl: true } }
        }
      });

      return res.json({
        funnels: funnels.map((funnel) => ({
          id: String(funnel.id),
          name: funnel.name,
          description: funnel.description,
          stages: funnel.stages.map(formatStage)
        })),
        stages: (
          funnels.find((funnel) => !funnelId || funnel.id === funnelId)?.stages ||
          Object.values(defaults.stages)
        ).map(formatStage),
        statuses: Object.values(defaults.statuses).map((status) => ({
          id: status.key,
          name: status.name,
          color: status.color,
          isFinal: status.isFinal
        })),
        deals: deals.map(formatDeal),
        currentUser: req.user,
        permissions: {
          canViewAll: isManager(req.user),
          canViewTeam: isManager(req.user) && Boolean(req.user.teamId),
          canViewUnassigned: isManager(req.user),
          canShareFilters: isManager(req.user),
          canTransfer: isManager(req.user)
        },
        sync
      });
    } catch (error) {
      if (error instanceof SyntaxError || /invalido|Filtros/.test(error.message)) {
        return res.status(error.status || 400).json({ error: error.message });
      }
      if (error.status) {
        return res.status(error.status).json({ error: error.message });
      }
      console.error(error);
      await prisma.crmSyncLog.create({
        data: {
          integrationName: 'Relatorio de conversoes',
          status: 'error',
          message: error.message,
          finishedAt: new Date()
        }
      }).catch(() => null);

      return res.status(500).json({
        error: 'Erro ao listar CRM'
      });
    }
  }

  async syncConversions(req, res) {
    try {
      const sync = await syncConvertedClients();
      return res.json(sync);
    } catch (error) {
      console.error(error);
      return res.status(500).json({
        error: 'Erro ao sincronizar conversoes com CRM'
      });
    }
  }

  async listAssignableUsers(req, res) {
    const users = await prisma.user.findMany({
      where: {
        active: true
      },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        email: true,
        photoUrl: true,
        role: true,
        teamId: true,
        active: true
      }
    });
    return res.json(users);
  }

  async createDeal(req, res) {
    try {
      const defaults = await ensureCrmDefaults();
      const customerName = String(req.body.customerName || '').trim();
      if (!customerName) {
        return res.status(400).json({ error: 'Nome do cliente e obrigatorio' });
      }

      const funnelId = Number(req.body.funnelId) || defaults.funnel.id;
      const stageId = Number(req.body.stageId) || Object.values(defaults.stages)[0]?.id;
      const stage = await prisma.crmStage.findFirst({ where: { id: stageId, funnelId } });
      const status = await prisma.crmDealStatus.findUnique({
        where: { key: String(req.body.status || 'new') }
      });
      if (!stage || !status) {
        return res.status(400).json({ error: 'Funil, etapa ou status invalido' });
      }

      let responsibleUserId = req.user.id;
      if (req.body.responsibleUserId !== undefined) {
        const requestedId = req.body.responsibleUserId === null
          ? null
          : Number(req.body.responsibleUserId);
        if (requestedId === null && !isManager(req.user)) {
          responsibleUserId = req.user.id;
        }
        if (requestedId !== null && requestedId !== req.user.id) {
          const target = await prisma.user.findUnique({ where: { id: requestedId } });
          if (!canAssign(req.user, target)) {
            return res.status(403).json({ error: 'Responsavel nao permitido' });
          }
        }
        if (requestedId !== null || isManager(req.user)) {
          responsibleUserId = requestedId;
        }
      }

      const sourceName = String(req.body.source || 'Manual').trim();
      const source = await prisma.crmLeadSource.upsert({
        where: { name: sourceName },
        update: {},
        create: { name: sourceName, type: 'manual' }
      });
      const deal = await prisma.crmDeal.create({
        data: {
          customerName,
          phone: String(req.body.phone || '').trim() || null,
          email: String(req.body.email || '').trim() || null,
          city: String(req.body.city || '').trim() || null,
          neighborhood: String(req.body.neighborhood || '').trim() || null,
          address: String(req.body.address || '').trim() || null,
          plan: String(req.body.plan || '').trim() || null,
          notes: String(req.body.notes || '').trim() || null,
          campaignName: String(req.body.campaign || '').trim() || null,
          monthlyValue: Number(req.body.monthlyValue || req.body.value) || null,
          estimatedValue: Number(req.body.value || req.body.monthlyValue) || null,
          priorityLevel: String(req.body.priority || 'medium'),
          funnelId,
          stageId,
          statusId: status.id,
          sourceId: source.id,
          createdByUserId: req.user.id,
          responsibleUserId,
          updatedByUserId: req.user.id,
          lastInteractionAt: new Date(),
          nextFollowUpAt: req.body.nextFollowUpAt ? new Date(req.body.nextFollowUpAt) : null,
          history: {
            create: {
              eventType: 'deal_created',
              message: `Negociacao criada por ${req.user.name}`,
              metadata: { userId: req.user.id, responsibleUserId }
            }
          }
        },
        include: {
          funnel: true,
          stage: true,
          status: true,
          source: true,
          affiliate: true,
          link: { include: { campaign: true } },
          conversion: true,
          tasks: true,
          history: true,
          commissions: true,
          createdByUser: { select: { id: true, name: true } },
          responsibleUser: { select: { id: true, name: true, photoUrl: true } }
        }
      });
      return res.status(201).json({ deal: formatDeal(deal) });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Erro ao criar negociacao' });
    }
  }

  async transferDeal(req, res) {
    try {
      if (!isManager(req.user)) {
        return res.status(403).json({ error: 'Somente gestores podem transferir negociacoes' });
      }

      const id = Number(req.params.id);
      const responsibleUserId = req.body.responsibleUserId === null
        ? null
        : Number(req.body.responsibleUserId);
      const current = await prisma.crmDeal.findFirst({
        where: { id, ...accessWhere(req.user) },
        include: { responsibleUser: { select: { name: true } } }
      });
      if (!current) return res.status(404).json({ error: 'Negociacao nao encontrada' });
      const target = responsibleUserId
        ? await prisma.user.findUnique({ where: { id: responsibleUserId } })
        : null;
      if (responsibleUserId && !canAssign(req.user, target)) {
        return res.status(403).json({ error: 'Responsavel nao permitido' });
      }
      const updated = await prisma.$transaction(async (transaction) => {
        const deal = await transaction.crmDeal.update({
          where: { id },
          data: {
            responsibleUserId,
            owner: null,
            updatedByUserId: req.user.id
          }
        });
        await transaction.crmDealHistory.create({
          data: {
            dealId: id,
            eventType: 'responsible_transferred',
            message: `Responsavel alterado de ${current.responsibleUser?.name || 'Sem responsavel'} para ${target?.name || 'Sem responsavel'} por ${req.user.name}`,
            metadata: {
              previousResponsibleUserId: current.responsibleUserId,
              responsibleUserId,
              changedByUserId: req.user.id
            }
          }
        });
        return deal;
      });
      return res.json({ deal: updated });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Erro ao transferir negociacao' });
    }
  }

  async deleteDeal(req, res) {
    const id = Number(req.params.id);
    if (!isManager(req.user)) {
      return res.status(403).json({ error: 'Somente gestores podem excluir negociacoes' });
    }
    const deal = await prisma.crmDeal.findFirst({ where: { id, ...accessWhere(req.user) } });
    if (!deal) return res.status(404).json({ error: 'Negociacao nao encontrada' });
    await prisma.crmDeal.delete({ where: { id } });
    return res.status(204).send();
  }

  async createStage(req, res) {
    try {
      const defaults = await ensureCrmDefaults();
      const funnelId = Number(req.body.funnelId) || defaults.funnel.id;
      const payload = readStagePayload(req.body);

      if (payload.error) {
        return res.status(400).json({
          error: payload.error
        });
      }

      if (!payload.data.name) {
        return res.status(400).json({
          error: 'Nome da etapa e obrigatorio'
        });
      }

      const funnel = await prisma.crmFunnel.findUnique({
        where: {
          id: funnelId
        }
      });

      if (!funnel) {
        return res.status(400).json({
          error: 'Funil nao encontrado'
        });
      }

      const lastStage = await prisma.crmStage.findFirst({
        where: {
          funnelId
        },
        orderBy: {
          position: 'desc'
        }
      });

      const stage = await prisma.crmStage.create({
        data: {
          funnelId,
          name: payload.data.name,
          color: payload.data.color || '#64748b',
          slaHours: payload.data.slaHours ?? 24,
          position: payload.data.position || ((lastStage?.position || 0) + 1),
          isFinal: Boolean(payload.data.isFinal),
          isWonStage: Boolean(payload.data.isWonStage),
          isLostStage: Boolean(payload.data.isLostStage)
        }
      });

      return res.status(201).json({
        stage: formatStage(stage)
      });
    } catch (error) {
      if (error?.code === 'P2002') {
        return res.status(409).json({
          error: 'Ja existe uma etapa com esse nome neste funil'
        });
      }

      console.error(error);
      return res.status(500).json({
        error: 'Erro ao criar etapa do CRM'
      });
    }
  }

  async updateStage(req, res) {
    try {
      const id = Number(req.params.id);

      if (!Number.isFinite(id) || id < 1) {
        return res.status(400).json({
          error: 'ID da etapa invalido'
        });
      }

      const payload = readStagePayload(req.body);

      if (payload.error) {
        return res.status(400).json({
          error: payload.error
        });
      }

      const currentStage = await prisma.crmStage.findUnique({
        where: {
          id
        }
      });

      if (!currentStage) {
        return res.status(404).json({
          error: 'Etapa nao encontrada'
        });
      }

      const nextData = {
        ...payload.data
      };
      const nextIsWonStage =
        nextData.isWonStage !== undefined
          ? nextData.isWonStage
          : currentStage.isWonStage;
      const nextIsLostStage =
        nextData.isLostStage !== undefined
          ? nextData.isLostStage
          : currentStage.isLostStage;

      if (nextIsWonStage && nextIsLostStage) {
        return res.status(400).json({
          error: 'A etapa nao pode ser venda concluida e venda perdida ao mesmo tempo'
        });
      }

      if (nextIsWonStage || nextIsLostStage) {
        nextData.isFinal = true;
      }

      const stage = await prisma.crmStage.update({
        where: {
          id
        },
        data: nextData
      });

      return res.json({
        stage: formatStage(stage)
      });
    } catch (error) {
      if (error?.code === 'P2002') {
        return res.status(409).json({
          error: 'Ja existe uma etapa com esse nome neste funil'
        });
      }

      console.error(error);
      return res.status(500).json({
        error: 'Erro ao atualizar etapa do CRM'
      });
    }
  }

  async deleteStage(req, res) {
    try {
      const id = Number(req.params.id);

      if (!Number.isFinite(id) || id < 1) {
        return res.status(400).json({
          error: 'ID da etapa invalido'
        });
      }

      const result = await prisma.$transaction(async (transaction) => {
        const currentStage = await transaction.crmStage.findUnique({
          where: { id }
        });

        if (!currentStage) {
          return {
            status: 404,
            error: 'Etapa nao encontrada'
          };
        }

        const fallbackStage = await transaction.crmStage.findFirst({
          where: {
            funnelId: currentStage.funnelId,
            id: { not: id }
          },
          orderBy: [
            { position: 'asc' },
            { id: 'asc' }
          ]
        });

        if (!fallbackStage) {
          return {
            status: 409,
            error: 'O funil precisa ter pelo menos uma etapa'
          };
        }

        const dealsToMove = await transaction.crmDeal.findMany({
          where: { stageId: id },
          select: { id: true }
        });

        if (dealsToMove.length > 0) {
          await transaction.crmDeal.updateMany({
            where: { stageId: id },
            data: { stageId: fallbackStage.id }
          });

          await transaction.crmDealHistory.createMany({
            data: dealsToMove.map((deal) => ({
              dealId: deal.id,
              eventType: 'stage_deleted',
              message: `Etapa ${currentStage.name} removida; negociacao movida para ${fallbackStage.name}`,
              metadata: {
                deletedStageId: currentStage.id,
                fallbackStageId: fallbackStage.id
              }
            }))
          });
        }

        await transaction.crmStage.delete({
          where: { id }
        });

        const remainingStages = await transaction.crmStage.findMany({
          where: { funnelId: currentStage.funnelId },
          orderBy: [
            { position: 'asc' },
            { id: 'asc' }
          ],
          select: {
            id: true,
            position: true
          }
        });

        for (const [index, stage] of remainingStages.entries()) {
          if (stage.position !== index + 1) {
            await transaction.crmStage.update({
              where: { id: stage.id },
              data: { position: index + 1 }
            });
          }
        }

        return {
          status: 200,
          deletedStageId: String(currentStage.id),
          fallbackStageId: String(fallbackStage.id),
          movedDeals: dealsToMove.length
        };
      });

      if (result.error) {
        return res.status(result.status).json({
          error: result.error
        });
      }

      return res.json({
        deletedStageId: result.deletedStageId,
        fallbackStageId: result.fallbackStageId,
        movedDeals: result.movedDeals
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({
        error: 'Erro ao apagar etapa do CRM'
      });
    }
  }
  async updateDeal(req, res) {
    try {
      const id = Number(req.params.id);

      if (!Number.isFinite(id) || id < 1) {
        return res.status(400).json({
          error: 'ID da negociacao invalido'
        });
      }

      const data = {};
      const history = [];
      let transferHistory = null;
      const allowedDeal = await prisma.crmDeal.findFirst({
        where: { id, ...accessWhere(req.user) },
        include: {
          responsibleUser: {
            select: {
              name: true
            }
          }
        }
      });
      if (!allowedDeal) {
        return res.status(404).json({ error: 'Negociacao nao encontrada' });
      }
      data.updatedByUserId = req.user.id;

      if (req.body.responsibleUserId !== undefined) {
        const responsibleUserId = req.body.responsibleUserId === null
          ? null
          : Number(req.body.responsibleUserId);

        if (
          allowedDeal.responsibleUserId !== responsibleUserId &&
          !isManager(req.user)
        ) {
          return res.status(403).json({
            error: 'Somente gestores podem transferir negociacoes'
          });
        }

        const target = responsibleUserId
          ? await prisma.user.findUnique({ where: { id: responsibleUserId } })
          : null;

        if (
          responsibleUserId !== null &&
          (!Number.isInteger(responsibleUserId) || !canAssign(req.user, target))
        ) {
          return res.status(403).json({
            error: 'Responsavel inexistente, inativo ou nao permitido'
          });
        }

        data.responsibleUserId = responsibleUserId;
        data.owner = null;

        if (allowedDeal.responsibleUserId !== responsibleUserId) {
          transferHistory = {
            previousResponsibleUserId: allowedDeal.responsibleUserId,
            previousResponsibleName:
              allowedDeal.responsibleUser?.name || 'Sem responsavel',
            responsibleUserId,
            responsibleName: target?.name || 'Sem responsavel'
          };
        }
      }

      if (req.body.stageId !== undefined) {
        const stageId = Number(req.body.stageId);

        if (!Number.isFinite(stageId) || stageId < 1) {
          return res.status(400).json({
            error: 'Etapa invalida'
          });
        }

        const stage = await prisma.crmStage.findUnique({
          where: {
            id: stageId
          }
        });

        if (!stage) {
          return res.status(400).json({
            error: 'Etapa nao encontrada'
          });
        }

        data.stageId = stageId;

        if (req.body.status === undefined && (stage.isWonStage || stage.isLostStage)) {
          const status = await prisma.crmDealStatus.findUnique({
            where: {
              key: stage.isWonStage ? 'won' : 'lost'
            }
          });

          if (status) {
            data.statusId = status.id;
            if (stage.isWonStage) {
              data.closedAt = new Date();
            }
          }
        }

        history.push('Etapa alterada no CRM');
      }

      if (req.body.status !== undefined) {
        const status = await prisma.crmDealStatus.findUnique({
          where: {
            key: String(req.body.status)
          }
        });

        if (!status) {
          return res.status(400).json({
            error: 'Status invalido'
          });
        }

        data.statusId = status.id;
        if (status.key === 'won') {
          data.closedAt = new Date();
        }
        history.push(`Status alterado para ${status.name}`);
      }

      [
        'customerName',
        'phone',
        'email',
        'city',
        'neighborhood',
        'address',
        'plan',
        'priorityLevel',
        'cardColor',
        'notes',
        'chatmixId',
        'sgpId'
      ].forEach((key) => {
        if (req.body[key] !== undefined) {
          data[key] = String(req.body[key] || '').trim() || null;
        }
      });

      if (req.body.monthlyValue !== undefined) {
        data.monthlyValue = Number(req.body.monthlyValue) || null;
      }

      if (req.body.nextFollowUpAt !== undefined) {
        data.nextFollowUpAt = req.body.nextFollowUpAt
          ? new Date(req.body.nextFollowUpAt)
          : null;
      }

      const deal = await prisma.crmDeal.update({
        where: {
          id
        },
        data,
        include: {
          status: true,
          affiliate: true
        }
      });

      for (const message of history) {
        await prisma.crmDealHistory.create({
          data: {
            dealId: id,
            eventType: 'deal_updated',
            message
          }
        });
      }

      if (transferHistory) {
        await prisma.crmDealHistory.create({
          data: {
            dealId: id,
            eventType: 'responsible_transferred',
            message: `Responsavel alterado de ${transferHistory.previousResponsibleName} para ${transferHistory.responsibleName} por ${req.user.name}`,
            metadata: {
              previousResponsibleUserId:
                transferHistory.previousResponsibleUserId,
              responsibleUserId: transferHistory.responsibleUserId,
              changedByUserId: req.user.id
            }
          }
        });
      }

      if (deal.status.key === 'won' && deal.affiliateId) {
        await prisma.affiliateCommission.upsert({
          where: {
            affiliateId_dealId: {
              affiliateId: deal.affiliateId,
              dealId: deal.id
            }
          },
          update: {},
          create: {
            affiliateId: deal.affiliateId,
            dealId: deal.id,
            amount: Number(process.env.AFFILIATE_DEFAULT_COMMISSION || 30),
            notes: 'Comissao gerada por conclusao no CRM'
          }
        });
      }

      return res.json({
        deal
      });
    } catch (error) {
      if (error?.code === 'P2025') {
        return res.status(404).json({
          error: 'Negociacao nao encontrada'
        });
      }

      console.error(error);
      return res.status(500).json({
        error: 'Erro ao atualizar negociacao'
      });
    }
  }
}

module.exports = new CrmController();
