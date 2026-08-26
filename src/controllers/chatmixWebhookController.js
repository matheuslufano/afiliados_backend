const crypto = require('node:crypto');

const prisma = require('../database/prisma');
const {
  ChatmixApiError,
  validateChatmixAttendance
} = require('../services/chatmixApi');
const {
  publishRealtimeEvent
} = require('../utils/realtimeEvents');

const CODE_PATTERN = '[a-f0-9]{8}';

function normalizeKey(key) {
  return String(key || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function safeCompare(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));

  if (left.length !== right.length) {
    return false;
  }

  return crypto.timingSafeEqual(left, right);
}

function extractBearerToken(value) {
  const match = String(value || '').match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function providedSecrets(req) {
  return [
    req.get('x-chatmix-secret'),
    req.get('x-chatmix-token'),
    req.get('x-webhook-secret'),
    req.query.secret,
    extractBearerToken(req.get('authorization'))
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
}

function isAuthorized(req) {
  const expected = String(process.env.CHATMIX_WEBHOOK_SECRET || '').trim();

  if (!expected) {
    return true;
  }

  return providedSecrets(req).some((secret) => safeCompare(secret, expected));
}

function findValuesByKey(value, wantedKeys, results = [], depth = 0) {
  if (!value || depth > 8 || results.length >= 20) {
    return results;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => findValuesByKey(item, wantedKeys, results, depth + 1));
    return results;
  }

  if (typeof value !== 'object') {
    return results;
  }

  Object.entries(value).forEach(([key, item]) => {
    if (wantedKeys.has(normalizeKey(key))) {
      results.push(item);
    }

    findValuesByKey(item, wantedKeys, results, depth + 1);
  });

  return results;
}

function collectStrings(value, results = [], depth = 0) {
  if (results.length >= 200 || depth > 8 || value === null || value === undefined) {
    return results;
  }

  if (typeof value === 'string' || typeof value === 'number') {
    results.push(String(value));
    return results;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectStrings(item, results, depth + 1));
    return results;
  }

  if (typeof value === 'object') {
    Object.values(value).forEach((item) => collectStrings(item, results, depth + 1));
  }

  return results;
}

function codeFromText(text, allowLooseMatch = false, allowBareMatch = true) {
  const value = String(text || '').trim();

  if (allowBareMatch && new RegExp(`^${CODE_PATTERN}$`, 'i').test(value)) {
    return value.toLowerCase();
  }

  const patterns = [
    new RegExp(`/r/(${CODE_PATTERN})(?:[/?#\\s]|$)`, 'i'),
    new RegExp(`/links/(${CODE_PATTERN})/whatsapp(?:[/?#\\s]|$)`, 'i'),
    new RegExp(
      `(?:ref|referencia|codigo|divulgacao|afiliado|shortcode|short code)\\D{0,30}(${CODE_PATTERN})`,
      'i'
    )
  ];

  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match) {
      return match[1].toLowerCase();
    }
  }

  if (allowLooseMatch) {
    const match = value.match(new RegExp(`(?:^|\\W)(${CODE_PATTERN})(?:\\W|$)`, 'i'));
    if (match) {
      return match[1].toLowerCase();
    }
  }

  return null;
}

function extractShortCode(body) {
  const directKeys = new Set([
    'shortcode',
    'ref',
    'referencia',
    'codigo',
    'codigoafiliado',
    'codigodeafiliado',
    'codigodoafiliado',
    'codigodivulgacao',
    'codigodedivulgacao',
    'affiliatecode',
    'linkcode'
  ]);

  const directValues = findValuesByKey(body, directKeys);

  for (const value of directValues) {
    const code = codeFromText(value, true);
    if (code) {
      return code;
    }
  }

  for (const value of collectStrings(body)) {
    const code = codeFromText(value, false, false);
    if (code) {
      return code;
    }
  }

  return null;
}

function firstStringByKey(body, keys) {
  const values = findValuesByKey(body, new Set(keys.map(normalizeKey)));

  for (const value of values) {
    if (typeof value === 'string' || typeof value === 'number') {
      const text = String(value).trim();
      if (text) {
        return text.slice(0, 255);
      }
    }
  }

  return null;
}

function optionalText(value) {
  const text = String(value || '').trim();
  return text ? text.slice(0, 255) : null;
}

function normalizePhone(value) {
  const phone = String(value || '').replace(/\D/g, '');
  return phone || null;
}

function normalizeDocument(value) {
  const document = String(value || '').replace(/\D/g, '');
  return document || null;
}

function chatmixChannelName(payload) {
  return optionalText(payload?.body?.channel_data?.name);
}

function chatmixAttendanceId(payload) {
  const id = payload?.body?.attendance_id;
  return id === undefined || id === null ? null : String(id).trim() || null;
}

function parseChannelMap() {
  const raw = String(process.env.CHATMIX_CHANNEL_LINK_MAP || '').trim();

  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    console.warn('CHATMIX_CHANNEL_LINK_MAP invalido. Use JSON: {"Canal":"shortCode"}');
    return {};
  }
}

function shortCodeFromChatmixChannel(payload) {
  const channelName = chatmixChannelName(payload);
  const map = parseChannelMap();
  const mapped = channelName ? map[channelName] : null;

  return codeFromText(mapped, true) ||
    codeFromText(process.env.CHATMIX_DEFAULT_SHORT_CODE, true);
}

function requestPayload(req) {
  return {
    body: req.body || {},
    query: req.query || {}
  };
}

function sanitizedQuery(query) {
  return Object.entries(query || {}).reduce((acc, [key, value]) => {
    if (/secret|token|authorization/i.test(key)) {
      acc[key] = '[hidden]';
      return acc;
    }

    acc[key] = value;
    return acc;
  }, {});
}

function chatmixWebhookEventPayload(payload, result, logId = null) {
  return {
    id: logId,
    receivedAt: new Date().toISOString(),
    attendanceId: chatmixAttendanceId(payload),
    channel: {
      name: optionalText(payload?.body?.channel_data?.name),
      type: optionalText(payload?.body?.channel_data?.type)
    },
    raw: payload.body,
    query: sanitizedQuery(payload.query),
    result
  };
}

async function persistChatmixWebhookEvent(req, payload, result) {
  const eventPayload = chatmixWebhookEventPayload(payload, result);
  let log = null;

  try {
    log = await prisma.webhookLog.create({
      data: {
        provider: 'chatmix',
        attendanceId: eventPayload.attendanceId,
        channelName: eventPayload.channel.name,
        channelType: eventPayload.channel.type,
        eventStatus: optionalText(result?.status),
        shortCode: optionalText(result?.shortCode),
        conversionId: result?.conversionId || null,
        linkId: result?.linkId || null,
        visitorName: optionalText(result?.visitorName),
        visitorPhone: optionalText(result?.visitorPhone),
        visitorDocument: optionalText(result?.visitorDocument),
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'] || null,
        raw: eventPayload.raw,
        query: eventPayload.query,
        result
      }
    });
  } catch (error) {
    if (error?.code === 'P2021') {
      console.warn('Tabela WebhookLog ausente; webhook Chatmix nao foi arquivado.');
    } else {
      console.error('Erro ao salvar log do webhook Chatmix:', error);
    }
  }

  publishRealtimeEvent('chatmix-webhook', {
    ...eventPayload,
    id: log?.id || null
  });

  return log;
}

function formatWebhookLog(log) {
  return {
    id: log.id,
    receivedAt: log.receivedAt,
    attendanceId: log.attendanceId,
    channel: {
      name: log.channelName,
      type: log.channelType
    },
    raw: log.raw,
    query: log.query,
    result: log.result
  };
}

function visitorDataFromPayload(payload) {
  return {
    visitorName: optionalText(
      firstStringByKey(payload, [
        'visitorName',
        'name',
        'nome',
        'cliente',
        'customerName',
        'contactName'
      ])
    ),
    visitorPhone: normalizePhone(
      firstStringByKey(payload, [
        'visitorPhone',
        'phone',
        'telefone',
        'celular',
        'whatsapp',
        'number',
        'numero'
      ])
    ),
    visitorDocument: normalizeDocument(
      firstStringByKey(payload, [
        'visitorDocument',
        'document',
        'documento',
        'cpf',
        'cnpj',
        'cpfcnpj',
        'cpfCnpj'
      ])
    ),
    visitorCity: optionalText(
      firstStringByKey(payload, ['visitorCity', 'city', 'cidade'])
    ),
    source: optionalText(
      firstStringByKey(payload, ['source', 'origem', 'channel', 'canal'])
    )
  };
}

function chatmixVisitorData(payload) {
  const body = payload.body || {};
  const data = body.data || {};
  const clientData = body.client_data || {};
  const channelData = body.channel_data || {};

  const genericData = visitorDataFromPayload(payload);

  return {
    visitorName: optionalText(
      data['Nome Cliente'] ||
        data.nomeCliente ||
        data.nome_cliente ||
        data.NOME ||
        data.Nome ||
        data.nome ||
        data.cliente
    ) || optionalText(clientData.name) || genericData.visitorName,
    visitorPhone: normalizePhone(clientData.user) ||
      normalizePhone(clientData.validate?.user) ||
      genericData.visitorPhone,
    visitorDocument: normalizeDocument(
      data.CPF ||
        data.cpf ||
        data.CNPJ ||
        data.cnpj ||
        data.documento ||
        data.document
    ) || genericData.visitorDocument,
    visitorCity: optionalText(data.CIDADE || data.cidade || data.city) ||
      genericData.visitorCity,
    source: optionalText(channelData.name) ||
      optionalText(channelData.type) ||
      genericData.source ||
      'chatmix',
    affiliateName: optionalText(
      data['Afiliado:'] ||
        data.Afiliado ||
        data.afiliado
    )
  };
}

const CRM_FUNNEL_NAME = 'Funil Vendas Chatmix';

async function ensureChatmixCrmPlacement(transaction) {
  const funnel = await transaction.crmFunnel.upsert({
    where: { name: CRM_FUNNEL_NAME },
    update: { isActive: true },
    create: {
      name: CRM_FUNNEL_NAME,
      description: 'Funil principal para atendimentos recebidos do Chatmix.'
    }
  });
  const status = await transaction.crmDealStatus.upsert({
    where: { key: 'new' },
    update: {},
    create: {
      key: 'new',
      name: 'Nova',
      color: '#2563eb',
      isFinal: false
    }
  });
  const source = await transaction.crmLeadSource.upsert({
    where: { name: 'Chatmix' },
    update: { type: 'chatmix' },
    create: { name: 'Chatmix', type: 'chatmix' }
  });
  let stage = await transaction.crmStage.findFirst({
    where: {
      funnelId: funnel.id,
      name: 'Novo contato'
    }
  });

  if (!stage) {
    stage = await transaction.crmStage.findFirst({
      where: { funnelId: funnel.id },
      orderBy: [{ position: 'asc' }, { id: 'asc' }]
    });
  }

  if (!stage) {
    stage = await transaction.crmStage.create({
      data: {
        funnelId: funnel.id,
        name: 'Novo contato',
        position: 1,
        color: '#64748b',
        slaHours: 24
      }
    });
  }

  return { funnel, stage, status, source };
}

async function createOrUpdateCrmDealFromAttendance(
  attendanceId,
  visitorData,
  link = null
) {
  if (!attendanceId) {
    return null;
  }

  return prisma.$transaction(async (transaction) => {
    await transaction.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext(${`chatmix:${attendanceId}`}))
    `;

    const existing = await transaction.crmDeal.findFirst({
      where: { chatmixId: attendanceId }
    });
    const now = new Date();

    if (existing) {
      const shouldReplaceGeneratedName =
        existing.customerName === `Atendimento Chatmix #${attendanceId}`;
      const deal = await transaction.crmDeal.update({
        where: { id: existing.id },
        data: {
          ...(visitorData.visitorName && shouldReplaceGeneratedName
            ? { customerName: visitorData.visitorName }
            : {}),
          ...(visitorData.visitorPhone
            ? { phone: visitorData.visitorPhone }
            : {}),
          ...(visitorData.visitorCity
            ? { city: visitorData.visitorCity }
            : {}),
          ...(visitorData.affiliateName
            ? { owner: visitorData.affiliateName }
            : {}),
          ...(link?.id ? { linkId: link.id } : {}),
          ...(link?.affiliateId ? { affiliateId: link.affiliateId } : {}),
          lastInteractionAt: now
        }
      });

      return { deal, created: false };
    }

    const placement = await ensureChatmixCrmPlacement(transaction);
    const deal = await transaction.crmDeal.create({
      data: {
        customerName:
          visitorData.visitorName ||
          `Atendimento Chatmix #${attendanceId}`,
        phone: visitorData.visitorPhone,
        city: visitorData.visitorCity,
        owner: visitorData.affiliateName,
        priorityLevel: 'medium',
        notes: `Atendimento ${attendanceId} criado automaticamente pelo webhook do Chatmix.`,
        chatmixId: attendanceId,
        lastInteractionAt: now,
        nextFollowUpAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        funnelId: placement.funnel.id,
        stageId: placement.stage.id,
        statusId: placement.status.id,
        sourceId: placement.source.id,
        linkId: link?.id || null,
        affiliateId: link?.affiliateId || null
      }
    });

    await transaction.crmDealHistory.create({
      data: {
        dealId: deal.id,
        eventType: 'chatmix_attendance_created',
        message: `Novo atendimento Chatmix recebido (${attendanceId})`,
        metadata: { attendanceId }
      }
    });

    return { deal, created: true };
  });
}

function recentConversionWhere(visitorData, linkId) {
  const or = [];

  if (visitorData.visitorPhone) {
    or.push({
      visitorPhone: visitorData.visitorPhone
    });
  }

  if (visitorData.visitorDocument) {
    or.push({
      visitorDocument: visitorData.visitorDocument
    });
  }

  if (!or.length) {
    return null;
  }

  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

  return {
    ...(linkId && { linkId }),
    convertedAt: {
      gte: since
    },
    OR: or
  };
}

async function conversionFromAttendance(attendanceId, linkId, visitorData) {
  if (!attendanceId) {
    return null;
  }

  const directConversion = await prisma.conversion.findUnique({
    where: { attendanceId }
  });

  if (directConversion) {
    return directConversion;
  }

  try {
    const log = await prisma.webhookLog.findFirst({
      where: {
        provider: 'chatmix',
        attendanceId,
        conversionId: {
          not: null
        },
        ...(linkId && { linkId })
      },
      orderBy: {
        receivedAt: 'desc'
      }
    });

    if (!log?.conversionId) {
      return null;
    }

    const conversion = await prisma.conversion.findUnique({
      where: {
        id: log.conversionId
      }
    });

    if (
      conversion?.visitorDocument &&
      visitorData?.visitorDocument &&
      conversion.visitorDocument !== visitorData.visitorDocument
    ) {
      return null;
    }

    return conversion;
  } catch (error) {
    if (error?.code !== 'P2021') {
      throw error;
    }

    console.warn(
      'Tabela WebhookLog ausente; pulando deduplicacao por attendance_id.'
    );
    return null;
  }
}

class ChatmixWebhookController {
  async listLogs(req, res) {
    try {
      const limit = Math.min(
        Math.max(Number(req.query.limit) || 50, 1),
        200
      );

      const logs = await prisma.webhookLog.findMany({
        where: {
          provider: 'chatmix'
        },
        orderBy: {
          receivedAt: 'desc'
        },
        take: limit
      });

      return res.json(logs.map(formatWebhookLog));
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        error: 'Erro ao listar webhooks Chatmix'
      });
    }
  }

  async receive(req, res) {
    try {
      if (!isAuthorized(req)) {
        return res.status(401).json({
          error: 'Webhook nao autorizado'
        });
      }

      const payload = requestPayload(req);
      const attendanceId = chatmixAttendanceId(payload);
      let apiAttendance;

      try {
        apiAttendance = await validateChatmixAttendance(attendanceId);
      } catch (error) {
        const validationError =
          error instanceof ChatmixApiError
            ? error
            : new ChatmixApiError('Falha ao validar atendimento no Chatmix');

        await persistChatmixWebhookEvent(req, payload, {
          status: 'validation_failed',
          reason: validationError.code,
          attendanceId
        });

        return res.status(validationError.httpStatus).json({
          status: 'validation_failed',
          error: validationError.message,
          code: validationError.code,
          attendanceId
        });
      }

      const webhookVisitorData = chatmixVisitorData(payload);
      const apiVisitorData = visitorDataFromPayload(apiAttendance.data);
      const visitorData = {
        visitorName:
          webhookVisitorData.visitorName || apiVisitorData.visitorName,
        visitorPhone:
          webhookVisitorData.visitorPhone || apiVisitorData.visitorPhone,
        visitorDocument:
          webhookVisitorData.visitorDocument || apiVisitorData.visitorDocument,
        visitorCity:
          webhookVisitorData.visitorCity || apiVisitorData.visitorCity,
        source: webhookVisitorData.source || apiVisitorData.source || 'chatmix',
        affiliateName: webhookVisitorData.affiliateName
      };
      const lookupPayload = {
        ...payload,
        apiAttendance: apiAttendance.data
      };
      const shortCode =
        extractShortCode(lookupPayload) || shortCodeFromChatmixChannel(payload);
      let link = null;

      if (shortCode) {
        link = await prisma.link.findUnique({
          where: {
            shortCode
          },
          include: {
            affiliate: true,
            campaign: true
          }
        });

      }

      const crmAttendance = await createOrUpdateCrmDealFromAttendance(
        attendanceId,
        visitorData,
        link
      );

      const eventName = firstStringByKey(payload, [
        'event',
        'eventName',
        'type',
        'status',
        'action',
        'acao'
      ]);
      const product = firstStringByKey(payload, [
        'product',
        'produto',
        'campaign',
        'campanha',
        'template',
        'templateName',
        'flow',
        'fluxo'
      ]);
      const destination = firstStringByKey(payload, [
        'phone',
        'telefone',
        'whatsapp',
        'number',
        'numero',
        'destinatario',
        'from',
        'to'
      ]);

      let existingConversion = await conversionFromAttendance(
        attendanceId,
        link?.id,
        visitorData
      );

      if (!link && existingConversion) {
        link = await prisma.link.findUnique({
          where: {
            id: existingConversion.linkId
          },
          include: {
            affiliate: true,
            campaign: true
          }
        });
      }

      if (!link) {
        const status = crmAttendance?.created ? 'received' : 'updated';
        await persistChatmixWebhookEvent(req, payload, {
          status,
          reason: 'link not resolved',
          crmDealId: crmAttendance?.deal?.id || null,
          shortCode,
          affiliateId: link?.affiliateId || null,
          affiliateName: link?.affiliate?.name || null,
          campaignId: link?.campaignId || null,
          campaignName: link?.campaign?.name || null,
          visitorPhone: visitorData.visitorPhone,
          visitorDocument: visitorData.visitorDocument,
          apiValidated: true
        });

        return res.status(crmAttendance?.created ? 201 : 200).json({
          status,
          reason: 'link not resolved',
          attendanceId,
          apiValidated: true,
          crmDealId: crmAttendance?.deal?.id || null,
          shortCode,
          visitorPhone: visitorData.visitorPhone,
          visitorDocument: visitorData.visitorDocument
        });
      }

      const conversionData = {
        type: eventName ? `chatmix:${eventName}` : 'chatmix_webhook',
        product: product || 'Chatmix webhook',
        destination,
        visitorName: visitorData.visitorName,
        visitorPhone: visitorData.visitorPhone,
        visitorDocument: visitorData.visitorDocument,
        visitorCity: visitorData.visitorCity,
        source: visitorData.source || 'chatmix',
        ipAddress: req.ip,
        userAgent: req.headers['user-agent']
      };

      const conversion = existingConversion
        ? await prisma.conversion.update({
            where: {
              id: existingConversion.id
            },
            data: {
              ...conversionData,
              attendanceId,
              linkId: link.id
            }
          })
        : await prisma.conversion.upsert({
            where: { attendanceId },
            update: conversionData,
            create: {
              ...conversionData,
              attendanceId,
              linkId: link.id
            }
          });

      if (crmAttendance?.deal?.id) {
        await prisma.crmDeal.update({
          where: { id: crmAttendance.deal.id },
          data: {
            conversionId: conversion.id,
            linkId: link.id,
            affiliateId: link.affiliateId || null
          }
        });
      }

      await persistChatmixWebhookEvent(req, payload, {
        status: existingConversion ? 'updated' : 'received',
        conversionId: conversion.id,
        crmDealId: crmAttendance?.deal?.id || null,
        linkId: link.id,
        shortCode: link.shortCode,
        affiliateId: link.affiliateId || null,
        affiliateName: link.affiliate?.name || null,
        campaignId: link.campaignId || null,
        campaignName: link.campaign?.name || null,
        visitorName: conversion.visitorName,
        visitorPhone: conversion.visitorPhone,
        visitorDocument: conversion.visitorDocument,
        apiValidated: true
      });

      publishRealtimeEvent('link-converted', {
        linkId: link.id,
        shortCode: link.shortCode,
        attendanceId,
        conversionId: conversion.id,
        crmDealId: crmAttendance?.deal?.id || null,
        product: conversion.product,
        convertedAt: conversion.convertedAt
      });

      return res.status(existingConversion ? 200 : 201).json({
        status: existingConversion ? 'updated' : 'received',
        attendanceId,
        apiValidated: true,
        conversionId: conversion.id,
        linkId: link.id,
        shortCode: link.shortCode,
        visitorName: conversion.visitorName,
        visitorPhone: conversion.visitorPhone,
        visitorDocument: conversion.visitorDocument
      });
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        error: 'Erro ao processar webhook Chatmix'
      });
    }
  }
}

module.exports = new ChatmixWebhookController();
