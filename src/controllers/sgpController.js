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

function optionalText(value) {
  const text = String(value || '').trim();
  return text || null;
}

function normalizePhone(value) {
  const phone = String(value || '').replace(/\D/g, '');
  return phone || null;
}

function normalizeDocument(value) {
  const document = String(value || '').replace(/\D/g, '');
  return document || null;
}

function firstValueFromPayload(payload, keys) {
  for (const key of keys) {
    const value = payload?.[key];

    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }

  return null;
}

function visitorDataFromBody(req) {
  const customer = customerFromBody(req);

  return {
    visitorName: optionalText(
      firstValueFromPayload(req.body, ['visitorName', 'name', 'nome']) ||
        firstValueFromPayload(customer, ['nome', 'name'])
    ),
    visitorPhone: normalizePhone(
      firstValueFromPayload(req.body, [
        'visitorPhone',
        'phone',
        'telefone',
        'whatsapp'
      ]) ||
        firstValueFromPayload(customer, ['telefone', 'celular', 'whatsapp'])
    ),
    visitorDocument: normalizeDocument(
      firstValueFromPayload(req.body, [
        'visitorDocument',
        'document',
        'documento',
        'cpf',
        'cnpj',
        'cpfcnpj'
      ]) ||
        firstValueFromPayload(customer, [
          'cpfcnpj',
          'cpf',
          'cnpj',
          'documento'
        ])
    ),
    visitorCity: optionalText(
      firstValueFromPayload(req.body, ['visitorCity', 'city', 'cidade']) ||
        firstValueFromPayload(customer, ['cidade', 'city'])
    ),
    source: optionalText(
      firstValueFromPayload(req.body, ['source', 'origem'])
    )
  };
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
      ...visitorDataFromBody(req),
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

function findArrayByKey(value, wantedKeys, depth = 0) {
  if (!value || depth > 8) {
    return [];
  }

  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value !== 'object') {
    return [];
  }

  for (const [key, item] of Object.entries(value)) {
    if (wantedKeys.has(normalizeKey(key)) && Array.isArray(item)) {
      return item;
    }
  }

  for (const item of Object.values(value)) {
    const found = findArrayByKey(item, wantedKeys, depth + 1);
    if (found.length > 0) {
      return found;
    }
  }

  return [];
}

function directValueByKey(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const entries = Object.entries(value);

  for (const wantedKey of keys.map(normalizeKey)) {
    for (const [key, item] of entries) {
      if (normalizeKey(key) === wantedKey) {
        return item;
      }
    }
  }

  return null;
}

function firstValue(value, keys) {
  const direct = directValueByKey(value, keys);
  if (direct !== null && direct !== undefined && direct !== '') {
    return direct;
  }

  return findValueByKey(value, new Set(keys.map(normalizeKey)));
}

function firstText(value, keys) {
  const found = firstValue(value, keys);

  if (found === null || found === undefined || found === '') {
    return null;
  }

  return String(found);
}

function statusFromValue(value) {
  if (value === true) {
    return {
      active: true,
      label: 'Ativo'
    };
  }

  if (value === false) {
    return {
      active: false,
      label: 'Inativo'
    };
  }

  if (typeof value === 'number') {
    if (value === 1) {
      return {
        active: true,
        label: 'Ativo'
      };
    }

    if (value === 0) {
      return {
        active: false,
        label: 'Inativo'
      };
    }
  }

  const text = String(value || '').trim();
  const normalized = normalizeKey(text);

  if (!normalized) {
    return {
      active: null,
      label: 'Status nao informado'
    };
  }

  if (
    [
      '0',
      'false',
      'falso',
      'n',
      'nao',
      'no',
      'inactive',
      'inativo',
      'cancelado',
      'cancelada',
      'bloqueado',
      'bloqueada',
      'suspenso',
      'suspensa',
      'desativado',
      'desativada'
    ].includes(normalized)
  ) {
    return {
      active: false,
      label: 'Inativo'
    };
  }

  if (
    [
      '1',
      'true',
      'verdadeiro',
      's',
      'sim',
      'yes',
      'active',
      'ativo',
      'ativa',
      'habilitado',
      'habilitada',
      'liberado',
      'liberada',
      'normal',
      'ok'
    ].includes(normalized)
  ) {
    return {
      active: true,
      label: 'Ativo'
    };
  }

  if (
    /inativo|cancelad|bloquead|suspens|desativad|inactive/.test(normalized)
  ) {
    return {
      active: false,
      label: 'Inativo'
    };
  }

  if (/ativo|habilitad|liberad|normal|active/.test(normalized)) {
    return {
      active: true,
      label: 'Ativo'
    };
  }

  return {
    active: null,
    label: text
  };
}

function resolveStatus(value, keys) {
  const found = firstValue(value, keys);
  return statusFromValue(found);
}

function normalizeContract(contract) {
  const status = resolveStatus(contract, [
    'contratoStatusDisplay',
    'contrato_status_display',
    'statusDisplay',
    'status_display',
    'situacaoDisplay',
    'situacao_display',
    'ativo',
    'active',
    'habilitado',
    'status',
    'situacao',
    'situacao_contrato',
    'contrato_situacao',
    'status_contrato',
    'contrato_status',
    'status_id',
    'statusid'
  ]);

  return {
    id:
      firstText(contract, [
        'id',
        'contrato',
        'contrato_id',
        'clientecontrato',
        'clientecontrato_id'
      ]) || null,
    plan:
      firstText(contract, [
        'servico_plano',
        'servicoPlano',
        'plano',
        'plano_nome',
        'planonome',
        'servico',
        'produto'
      ]) || null,
    status: status.label,
    active: status.active,
    address:
      firstText(contract, [
        'endereco',
        'logradouro',
        'endereco_instalacao',
        'logradouro_instalacao'
      ]) || null,
    raw: contract
  };
}

function normalizeSgpCustomer(result, document) {
  const source = Array.isArray(result) ? result[0] || {} : result || {};
  const contracts = findArrayByKey(
    result,
    new Set([
      'contratos',
      'contrato',
      'clientecontratos',
      'clientecontrato',
      'servicos'
    ].map(normalizeKey))
  ).map(normalizeContract);

  const status = resolveStatus(source, [
    'ativo',
    'active',
    'status',
    'situacao',
    'status_cliente',
    'cliente_status',
    'status_id',
    'statusid'
  ]);

  let active = status.active;

  if (contracts.some((contract) => contract.active === true)) {
    active = true;
  } else if (
    active === null &&
    contracts.length > 0 &&
    contracts.every((contract) => contract.active === false)
  ) {
    active = false;
  }

  return {
    id:
      firstText(source, ['id', 'cliente_id', 'clienteid', 'codigo']) ||
      null,
    name:
      firstText(source, ['nome', 'razao', 'razao_social', 'cliente']) ||
      null,
    document:
      firstText(source, ['cpfcnpj', 'cpf', 'cnpj', 'documento']) ||
      document,
    phone:
      firstText(source, [
        'telefone',
        'fone',
        'celular',
        'whatsapp',
        'numero',
        'telefone_celular',
        'contato'
      ]) || null,
    city:
      firstText(source, [
        'cidade',
        'municipio',
        'city',
        'cidade_nome',
        'nome_cidade'
      ]) || null,
    status: active === true ? 'Ativo' : active === false ? 'Inativo' : status.label,
    active,
    contracts,
    raw: result
  };
}

function customersFromResult(result) {
  if (Array.isArray(result)) {
    return result;
  }

  const found = findArrayByKey(
    result,
    new Set([
      'clientes',
      'cliente',
      'results',
      'resultados',
      'data',
      'dados'
    ].map(normalizeKey))
  );

  if (found.length > 0) {
    return found;
  }

  return result && typeof result === 'object' ? [result] : [];
}

function normalizeSgpCustomerList(result) {
  return customersFromResult(result)
    .map((item) => normalizeSgpCustomer(item, ''))
    .filter((customer) => {
      const documentDigits = String(customer.document || '').replace(/\D/g, '');

      return Boolean(
        customer.id ||
          customer.name ||
          documentDigits ||
          customer.phone ||
          customer.city ||
          customer.contracts.length > 0
      );
    });
}

function summarizeCustomers(customers) {
  const activeCustomers = customers.filter((customer) => customer.active === true);
  const inactiveCustomers = customers.filter((customer) => customer.active === false);
  const unknownCustomers = customers.filter((customer) => customer.active === null);
  const byCityMap = new Map();

  customers.forEach((customer) => {
    const city = customer.city || 'Cidade nao informada';
    const current = byCityMap.get(city) || {
      city,
      total: 0,
      active: 0
    };

    current.total += 1;
    if (customer.active === true) {
      current.active += 1;
    }

    byCityMap.set(city, current);
  });

  return {
    total: customers.length,
    active: activeCustomers.length,
    inactive: inactiveCustomers.length,
    unknown: unknownCustomers.length,
    byCity: Array.from(byCityMap.values()).sort((a, b) => b.total - a.total)
  };
}

class SgpController {
  async status(req, res) {
    return res.json(sgpClient.getStatus());
  }

  async customer(req, res) {
    try {
      const document =
        req.query?.document ||
        req.query?.cpfcnpj ||
        req.query?.cpf ||
        req.query?.cnpj ||
        req.query?.query ||
        req.query?.search ||
        req.query?.nome ||
        req.query?.name ||
        req.query?.telefone ||
        req.query?.phone ||
        req.query?.cidade ||
        req.query?.city;

      const result = await sgpClient.searchCustomer(document);

      return res.json({
        provider: 'sgp',
        customer: normalizeSgpCustomer(result, String(document || '')),
        result
      });
    } catch (error) {
      return handleError(res, error, 'Erro ao consultar cliente no SGP');
    }
  }

  async customers(req, res) {
    try {
      const result = await sgpClient.listCustomers();
      const customers = normalizeSgpCustomerList(result);

      return res.json({
        provider: 'sgp',
        customers,
        summary: summarizeCustomers(customers),
        result
      });
    } catch (error) {
      return handleError(res, error, 'Erro ao listar clientes no SGP');
    }
  }

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
