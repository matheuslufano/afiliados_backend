const DEFAULT_TIMEOUT_MS = 15000;

function getConfig() {
  const baseUrl = String(process.env.SGP_BASE_URL || '').replace(/\/+$/, '');
  const app = String(process.env.SGP_APP || '').trim();
  const token = String(process.env.SGP_TOKEN || '').trim();

  if (!baseUrl || !app || !token) {
    throw new Error(
      'SGP nao configurado. Defina SGP_BASE_URL, SGP_APP e SGP_TOKEN.'
    );
  }

  return {
    baseUrl,
    app,
    token
  };
}

function normalizePersonType(value) {
  const type = String(value || 'F').trim().toUpperCase();
  return ['F', 'J', 'E', 'EJ'].includes(type) ? type : 'F';
}

function withCredentials(payload = {}) {
  const config = getConfig();

  return {
    app: config.app,
    token: config.token,
    ...payload
  };
}

function pruneEmptyValues(value) {
  if (Array.isArray(value)) {
    return value
      .map(pruneEmptyValues)
      .filter((item) => item !== undefined);
  }

  if (value && typeof value === 'object') {
    return Object.entries(value).reduce((acc, [key, item]) => {
      const cleaned = pruneEmptyValues(item);
      if (cleaned !== undefined) {
        acc[key] = cleaned;
      }
      return acc;
    }, {});
  }

  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  return value;
}

function appendFormValue(form, key, value) {
  if (value === undefined || value === null || value === '') {
    return;
  }

  if (typeof value === 'object') {
    form.append(key, JSON.stringify(value));
    return;
  }

  form.append(key, String(value));
}

function toFormData(payload) {
  if (typeof FormData === 'undefined') {
    throw new Error('FormData nao esta disponivel nesta versao do Node.');
  }

  const form = new FormData();

  Object.entries(payload || {}).forEach(([key, value]) => {
    appendFormValue(form, key, value);
  });

  return form;
}

function buildUrl(path, query = {}) {
  const { baseUrl } = getConfig();
  const url = new URL(path, `${baseUrl}/`);

  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });

  return url;
}

async function parseResponse(response) {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function requestSgp(path, options = {}) {
  const {
    method = 'POST',
    body,
    bodyMode = 'json',
    query,
    timeoutMs = DEFAULT_TIMEOUT_MS
  } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers = {};
  let requestBody;

  if (body !== undefined) {
    if (bodyMode === 'form') {
      requestBody = toFormData(body);
    } else {
      headers['content-type'] = 'application/json';
      requestBody = JSON.stringify(body);
    }
  }

  try {
    const response = await fetch(buildUrl(path, query), {
      method,
      headers,
      body: requestBody,
      signal: controller.signal
    });

    const data = await parseResponse(response);

    if (!response.ok) {
      const error = new Error(
        `SGP respondeu com status ${response.status}`
      );
      error.status = response.status;
      error.data = data;
      throw error;
    }

    return data;
  } finally {
    clearTimeout(timer);
  }
}

function createPreCadastro(type, payload) {
  return requestSgp(`/api/precadastro/${normalizePersonType(type)}`, {
    bodyMode: 'form',
    body: withCredentials(pruneEmptyValues(payload))
  });
}

function createCrmClient(type, payload) {
  return requestSgp(`/api/crm/cliente/${normalizePersonType(type)}`, {
    body: withCredentials(pruneEmptyValues(payload))
  });
}

function createCrmContractByCpfCnpj(cpfcnpj, payload) {
  return requestSgp('/api/crm/cliente/contratos/', {
    body: withCredentials(pruneEmptyValues(payload)),
    query: {
      cpfcnpj
    }
  });
}

function createCrmContractByClientId(clientId, payload) {
  return requestSgp(`/api/crm/cliente/${clientId}/contratos`, {
    body: withCredentials(pruneEmptyValues(payload))
  });
}

module.exports = {
  createCrmClient,
  createCrmContractByClientId,
  createCrmContractByCpfCnpj,
  createPreCadastro,
  normalizePersonType
};
