const crypto = require('node:crypto');

const prisma = require('../database/prisma');

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

function codeFromText(text, allowLooseMatch = false) {
  const value = String(text || '').trim();

  if (new RegExp(`^${CODE_PATTERN}$`, 'i').test(value)) {
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
    const code = codeFromText(value);
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

function requestPayload(req) {
  return {
    body: req.body || {},
    query: req.query || {}
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

class ChatmixWebhookController {
  async receive(req, res) {
    try {
      if (!isAuthorized(req)) {
        return res.status(401).json({
          error: 'Webhook nao autorizado'
        });
      }

      const payload = requestPayload(req);
      const shortCode = extractShortCode(payload);

      if (!shortCode) {
        return res.json({
          status: 'ignored',
          reason: 'shortCode not found'
        });
      }

      const link = await prisma.link.findUnique({
        where: {
          shortCode
        }
      });

      if (!link) {
        return res.json({
          status: 'ignored',
          reason: 'link not found',
          shortCode
        });
      }

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
      const visitorData = visitorDataFromPayload(payload);

      const conversion = await prisma.conversion.create({
        data: {
          type: eventName ? `chatmix:${eventName}` : 'chatmix_webhook',
          product: product || 'Chatmix webhook',
          destination,
          visitorName: visitorData.visitorName,
          visitorPhone: visitorData.visitorPhone,
          visitorDocument: visitorData.visitorDocument,
          visitorCity: visitorData.visitorCity,
          source: visitorData.source || 'chatmix',
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
          linkId: link.id
        }
      });

      return res.status(201).json({
        status: 'received',
        conversionId: conversion.id,
        linkId: link.id,
        shortCode,
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
