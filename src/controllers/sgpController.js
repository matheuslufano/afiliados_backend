const crypto = require('node:crypto');

const prisma = require('../database/prisma');
const sgpClient = require('../services/sgpClient');

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
    req.get('x-sgp-secret'),
    req.get('x-webhook-secret'),
    req.query.secret,
    extractBearerToken(req.get('authorization'))
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
}

function isAuthorized(req) {
  const expected = String(process.env.SGP_WEBHOOK_SECRET || '').trim();

  if (!expected) {
    return true;
  }

  return providedSecrets(req).some((secret) => safeCompare(secret, expected));
}

function normalizeKey(key) {
  return String(key || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function findValueByKey(value, wantedKeys, depth = 0) {
  if (!value || depth > 8) {
    return null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findValueByKey(item, wantedKeys, depth + 1);
      if (found !== null && found !== undefined && found !== '') {
        return found;
      }
    }
    return null;
  }

  if (typeof value !== 'object') {
    return null;
  }

  for (const [key, item] of Object.entries(value)) {
    if (wantedKeys.has(normalizeKey(key))) {
      return item;
    }

    const found = findValueByKey(item, wantedKeys, depth + 1);
    if (found !== null && found !== undefined && found !== '') {
      return found;
    }
  }

  return null;
}

function extractShortCode(body) {
  const value = findValueByKey(
    body,
    new Set([
      'shortcode',
      'ref',
      'referencia',
      'codigo',
      'codigoafiliado',
      'affiliatecode',
      'linkcode'
    ].map(normalizeKey))
  );

  return value ? String(value).trim().toLowerCase() : null;
}

function payloadFromBody(req) {
  return req.body?.payload || req.body?.data || stripControlFields(req.body || {});
}

function customerFromBody(req) {
  return req.body?.customer || req.body?.cliente || payloadFromBody(req);
}

function contractFromBody(req) {
  return req.body?.contract || req.body?.contrato || stripControlFields(req.body || {});
}

function stripControlFields(payload) {
  const controlFields = new Set([
    'cliente',
    'contract',
    'contrato',
    'customer',
    'data',
    'linkcode',
    'mode',
    'payload',
    'personType',
    'product',
    'produto',
    'ref',
    'referencia',
    'secret',
    'shortCode',
    'tipoPessoa',
    'type'
  ]);

  return Object.entries(payload || {}).reduce((acc, [key, value]) => {
    if (!controlFields.has(key)) {
      acc[key] = value;
    }
    return acc;
  }, {});
}

function personTypeFromBody(req) {
  return sgpClient.normalizePersonType(
    req.body?.type ||
      req.body?.tipoPessoa ||
      req.body?.personType ||
      customerFromBody(req)?.type ||
      customerFromBody(req)?.tipoPessoa
  );
}

function requireFields(payload, fields) {
  const missing = fields.filter((field) => {
    const value = payload?.[field];
    return value === undefined || value === null || value === '';
  });

  if (missing.length > 0) {
    const error = new Error(`Campos obrigatorios ausentes: ${missing.join(', ')}`);
    error.status = 400;
    throw error;
  }
}

function summarizeSgpResult(result) {
  if (!result || typeof result !== 'object') {
    return String(result || 'SGP');
  }

  const id =
    result.clientecontrato ||
    result.contrato_id ||
    result.id ||
    result.cliente_id ||
    result.precadastro_id;
  const message = result.message || result.msg || result.detail;
  const client = result.cliente || result.nome;

  return [
    'SGP',
    id ? `ID ${id}` : '',
    client ? `Cliente ${client}` : '',
    message || ''
  ]
    .filter(Boolean)
    .join(' - ');
}

async function recordSgpConversion(req, result, type) {
  const shortCode = extractShortCode(req.body);

  if (!shortCode) {
    return null;
  }

  const link = await prisma.link.findUnique({
    where: {
      shortCode
    }
  });

  if (!link) {
    return null;
  }

  return prisma.conversion.create({
    data: {
      type,
      product: req.body?.product || req.body?.produto || 'SGP',
      destination: summarizeSgpResult(result),
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      linkId: link.id
    }
  });
}

function handleError(res, error, fallback) {
  const status = error.status || 500;

  if (status >= 500) {
    console.error(error);
  }

  return res.status(status).json({
    error: error.message || fallback,
    details: error.data
  });
}

class SgpController {
  async preCadastro(req, res) {
    try {
      if (!isAuthorized(req)) {
        return res.status(401).json({
          error: 'Integracao SGP nao autorizada'
        });
      }

      const payload = customerFromBody(req);
      requireFields(payload, ['nome', 'logradouro']);

      const result = await sgpClient.createPreCadastro(
        personTypeFromBody(req),
        payload
      );
      const conversion = await recordSgpConversion(
        req,
        result,
        'sgp:pre_cadastro_created'
      );

      return res.status(201).json({
        status: 'created',
        provider: 'sgp',
        mode: 'precadastro',
        conversionId: conversion?.id || null,
        result
      });
    } catch (error) {
      return handleError(
        res,
        error,
        'Erro ao cadastrar pre-cadastro no SGP'
      );
    }
  }

  async crmClient(req, res) {
    try {
      if (!isAuthorized(req)) {
        return res.status(401).json({
          error: 'Integracao SGP nao autorizada'
        });
      }

      const payload = customerFromBody(req);
      requireFields(payload, ['nome', 'cpfcnpj']);

      const result = await sgpClient.createCrmClient(
        personTypeFromBody(req),
        payload
      );

      return res.status(201).json({
        status: 'created',
        provider: 'sgp',
        mode: 'crm_client',
        result
      });
    } catch (error) {
      return handleError(res, error, 'Erro ao cadastrar cliente no SGP');
    }
  }

  async crmContract(req, res) {
    try {
      if (!isAuthorized(req)) {
        return res.status(401).json({
          error: 'Integracao SGP nao autorizada'
        });
      }

      const payload = contractFromBody(req);
      const clientId = req.body?.clientId || req.body?.cliente_id;
      const cpfcnpj =
        req.body?.cpfcnpj ||
        req.query?.cpfcnpj ||
        customerFromBody(req)?.cpfcnpj;

      if (!clientId && !cpfcnpj) {
        return res.status(400).json({
          error: 'Informe clientId ou cpfcnpj para cadastrar contrato no SGP'
        });
      }

      requireFields(payload, [
        'pop_id',
        'plano_id',
        'portador_id',
        'forma_cobranca_codigo'
      ]);

      const result = clientId
        ? await sgpClient.createCrmContractByClientId(clientId, payload)
        : await sgpClient.createCrmContractByCpfCnpj(cpfcnpj, payload);

      const conversion = await recordSgpConversion(
        req,
        result,
        'sgp:contract_created'
      );

      return res.status(201).json({
        status: 'created',
        provider: 'sgp',
        mode: 'crm_contract',
        conversionId: conversion?.id || null,
        result
      });
    } catch (error) {
      return handleError(res, error, 'Erro ao cadastrar contrato no SGP');
    }
  }

  async sale(req, res) {
    try {
      if (!isAuthorized(req)) {
        return res.status(401).json({
          error: 'Integracao SGP nao autorizada'
        });
      }

      const mode = String(
        req.body?.mode || process.env.SGP_DEFAULT_MODE || 'precadastro'
      )
        .trim()
        .toLowerCase();

      if (mode === 'crm_contract') {
        return this.crmContract(req, res);
      }

      return this.preCadastro(req, res);
    } catch (error) {
      return handleError(res, error, 'Erro ao registrar venda no SGP');
    }
  }
}

module.exports = new SgpController();
