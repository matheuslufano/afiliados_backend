const MANAGER_ROLES = new Set(['ADMIN', 'MANAGER']);

const CONDITION_FIELDS = {
  responsibleUserId: { path: 'responsibleUserId', type: 'number' },
  createdByUserId: { path: 'createdByUserId', type: 'number' },
  affiliateId: { path: 'affiliateId', type: 'number' },
  trackingCode: { path: 'trackingCode', type: 'text' },
  city: { path: 'city', type: 'text' },
  source: { relation: 'source', field: 'name', type: 'text' },
  campaign: { path: 'campaignName', type: 'text' },
  status: { relation: 'status', field: 'key', type: 'text' },
  stageId: { path: 'stageId', type: 'number' },
  createdAt: { path: 'createdAt', type: 'date' },
  updatedAt: { path: 'updatedAt', type: 'date' },
  lastInteractionAt: { path: 'lastInteractionAt', type: 'date' },
  closedAt: { path: 'closedAt', type: 'date' },
  value: { path: 'monthlyValue', type: 'number' },
  phone: { path: 'phone', type: 'presence' }
};

const OPERATORS_BY_TYPE = {
  text: new Set(['equals', 'not_equals', 'contains', 'not_contains', 'starts_with', 'ends_with', 'in', 'not_in', 'empty', 'not_empty']),
  number: new Set(['equals', 'not_equals', 'greater_than', 'less_than', 'between', 'in', 'not_in', 'empty', 'not_empty']),
  date: new Set(['equals', 'before', 'after', 'between', 'empty', 'not_empty']),
  presence: new Set(['empty', 'not_empty'])
};

const SORTS = {
  'created-desc': { createdAt: 'desc' },
  'created-asc': { createdAt: 'asc' },
  'updated-desc': { updatedAt: 'desc' },
  'updated-asc': { updatedAt: 'asc' },
  'value-desc': { monthlyValue: 'desc' },
  'value-asc': { monthlyValue: 'asc' },
  'oldest-no-contact': { lastInteractionAt: 'asc' }
};

function isManager(user) {
  return MANAGER_ROLES.has(user.role);
}

function accessWhere(user) {
  if (user.role === 'ADMIN') {
    return {};
  }

  if (user.role === 'MANAGER' && user.teamId) {
    return {
      OR: [
        { responsibleUserId: user.id },
        { responsibleUser: { teamId: user.teamId } },
        { responsibleUserId: null }
      ]
    };
  }

  return { responsibleUserId: user.id };
}

function scopeWhere(user, scope, requestedUserId) {
  if (requestedUserId) {
    if (!isManager(user) && requestedUserId !== user.id) {
      const error = new Error('Nao e permitido consultar negociacoes de outro usuario');
      error.status = 403;
      throw error;
    }

    return { responsibleUserId: requestedUserId };
  }

  if (scope === 'mine') {
    return { responsibleUserId: user.id };
  }

  if (scope === 'unassigned') {
    if (!isManager(user)) {
      const error = new Error('Somente gestores podem consultar negociacoes sem responsavel');
      error.status = 403;
      throw error;
    }
    return { responsibleUserId: null };
  }

  if (scope === 'team') {
    if (!user.teamId || !isManager(user)) {
      const error = new Error('O usuario nao possui equipe gerenciavel');
      error.status = 403;
      throw error;
    }
    return { responsibleUser: { teamId: user.teamId } };
  }

  return {};
}

function parseValue(value, type) {
  if (type === 'number') {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      throw new Error('Valor numerico invalido');
    }
    return parsed;
  }

  if (type === 'date') {
    const parsed = new Date(String(value));
    if (Number.isNaN(parsed.getTime())) {
      throw new Error('Data invalida');
    }
    return parsed;
  }

  return String(value ?? '').trim();
}

function conditionWhere(condition) {
  const definition = CONDITION_FIELDS[condition?.field];
  const operator = String(condition?.operator || '');

  if (!definition || !OPERATORS_BY_TYPE[definition.type]?.has(operator)) {
    throw new Error('Campo ou operador de filtro invalido');
  }

  let predicate;
  const values = Array.isArray(condition.value) ? condition.value : [condition.value];

  if (operator === 'empty') predicate = null;
  if (operator === 'not_empty') predicate = { not: null };
  if (operator === 'equals') predicate = parseValue(values[0], definition.type);
  if (operator === 'not_equals') predicate = { not: parseValue(values[0], definition.type) };
  if (operator === 'contains') predicate = { contains: parseValue(values[0], definition.type), mode: 'insensitive' };
  if (operator === 'not_contains') predicate = { not: { contains: parseValue(values[0], definition.type), mode: 'insensitive' } };
  if (operator === 'starts_with') predicate = { startsWith: parseValue(values[0], definition.type), mode: 'insensitive' };
  if (operator === 'ends_with') predicate = { endsWith: parseValue(values[0], definition.type), mode: 'insensitive' };
  if (operator === 'in') predicate = { in: values.map((value) => parseValue(value, definition.type)) };
  if (operator === 'not_in') predicate = { notIn: values.map((value) => parseValue(value, definition.type)) };
  if (operator === 'greater_than' || operator === 'after') predicate = { gt: parseValue(values[0], definition.type) };
  if (operator === 'less_than' || operator === 'before') predicate = { lt: parseValue(values[0], definition.type) };
  if (operator === 'between') {
    predicate = {
      gte: parseValue(values[0], definition.type),
      lte: parseValue(values[1], definition.type)
    };
  }

  if (definition.relation) {
    return { [definition.relation]: { [definition.field]: predicate } };
  }

  return { [definition.path]: predicate };
}

function parseConditions(raw) {
  if (!raw) return [];
  const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!Array.isArray(value) || value.length > 20) {
    throw new Error('Filtros devem ser uma lista com no maximo 20 condicoes');
  }
  return value.map(conditionWhere);
}

function orderBy(sort) {
  return SORTS[sort] || SORTS['created-desc'];
}

function canAssign(user, target) {
  return Boolean(user?.id && target?.active);
}

module.exports = {
  CONDITION_FIELDS,
  SORTS,
  accessWhere,
  canAssign,
  isManager,
  orderBy,
  parseConditions,
  scopeWhere
};
