const DEFAULT_PUBLIC_API_BASE_URL = 'https://srv2.chatmix.com.br';
const DEFAULT_MESSAGES_PATH =
  '/api-v2/public-api/attendances/{attendance_id}/messages';
const DEFAULT_TIMEOUT_MS = 10000;

class ChatmixApiError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'ChatmixApiError';
    this.code = options.code || 'CHATMIX_API_ERROR';
    this.httpStatus = options.httpStatus || 502;
    this.cause = options.cause;
  }
}

function requiredPublicApiToken() {
  const token = String(process.env.CHATMIX_API_X_AUTH || '').trim();

  if (!token) {
    throw new ChatmixApiError('API de mensagens do Chatmix nao configurada', {
      code: 'CHATMIX_MESSAGES_API_NOT_CONFIGURED',
      httpStatus: 503
    });
  }

  return token;
}

function messagesUrl(attendanceId) {
  const baseUrl = String(
    process.env.CHATMIX_PUBLIC_API_BASE_URL || DEFAULT_PUBLIC_API_BASE_URL
  ).replace(/\/+$/, '');
  const pathTemplate = String(
    process.env.CHATMIX_MESSAGES_PATH || DEFAULT_MESSAGES_PATH
  );
  const path = pathTemplate.replace(
    /\{attendance_id\}|\{attendanceId\}/gi,
    encodeURIComponent(attendanceId)
  );

  return new URL(path, `${baseUrl}/`).toString();
}

function timeoutMs() {
  const configured = Number(process.env.CHATMIX_API_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_TIMEOUT_MS;
}

async function readOptionalJson(response) {
  const text = await response.text();

  if (!text) {
    return { data: null, validJson: true };
  }

  try {
    return { data: JSON.parse(text), validJson: true };
  } catch {
    return { data: null, validJson: false };
  }
}

function messagesFromResponse(data) {
  if (Array.isArray(data)) {
    return data;
  }

  const candidates = [
    data?.messages,
    data?.items,
    data?.results,
    data?.data,
    data?.data?.messages,
    data?.data?.items,
    data?.result?.messages,
    data?.attendance?.messages,
    data?.conversation?.messages,
    data?.data?.attendance?.messages,
    data?.data?.conversation?.messages
  ];

  return candidates.find(Array.isArray) || [];
}

function publicApiHttpError(status) {
  if (status === 401 || status === 403) {
    return new ChatmixApiError('Credencial da API do Chatmix rejeitada', {
      code: 'CHATMIX_MESSAGES_UNAUTHORIZED',
      httpStatus: status
    });
  }

  if (status === 404) {
    return new ChatmixApiError('Atendimento nao encontrado no Chatmix', {
      code: 'CHATMIX_ATTENDANCE_NOT_FOUND',
      httpStatus: 404
    });
  }

  if (status === 429) {
    return new ChatmixApiError('Limite de consultas do Chatmix excedido', {
      code: 'CHATMIX_MESSAGES_RATE_LIMITED',
      httpStatus: 429
    });
  }

  return new ChatmixApiError(
    `API de mensagens do Chatmix respondeu com HTTP ${status}`,
    {
      code: 'CHATMIX_MESSAGES_HTTP_ERROR',
      httpStatus: status >= 400 && status < 500 ? status : 502
    }
  );
}

async function getChatmixAttendanceMessages(attendanceId, fetchImpl = fetch) {
  const normalizedId = String(attendanceId || '').trim();

  if (!normalizedId) {
    throw new ChatmixApiError('attendance_id nao informado', {
      code: 'CHATMIX_ATTENDANCE_ID_REQUIRED',
      httpStatus: 400
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs());
  let response;

  try {
    response = await fetchImpl(messagesUrl(normalizedId), {
      method: 'GET',
      headers: {
        accept: 'application/json',
        'X-auth': requiredPublicApiToken(),
        'User-Agent': 'Mozilla/5.0 (compatible; AfiliadosNetbox/1.0)'
      },
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof ChatmixApiError) {
      throw error;
    }

    throw new ChatmixApiError(
      error?.name === 'AbortError'
        ? 'Tempo limite excedido ao buscar mensagens no Chatmix'
        : 'Nao foi possivel acessar a API de mensagens do Chatmix',
      {
        code:
          error?.name === 'AbortError'
            ? 'CHATMIX_MESSAGES_TIMEOUT'
            : 'CHATMIX_MESSAGES_UNAVAILABLE',
        httpStatus: 502,
        cause: error
      }
    );
  } finally {
    clearTimeout(timeout);
  }

  const parsed = await readOptionalJson(response);

  if (!response.ok) {
    throw publicApiHttpError(response.status);
  }

  if (!parsed.validJson) {
    throw new ChatmixApiError('Resposta invalida da API de mensagens do Chatmix', {
      code: 'CHATMIX_MESSAGES_INVALID_RESPONSE',
      httpStatus: 502
    });
  }

  const messages = messagesFromResponse(parsed.data);

  return {
    provider: 'chatmix',
    attendanceId: normalizedId,
    count: messages.length,
    messages,
    raw: parsed.data
  };
}

async function validateChatmixAttendance(attendanceId, fetchImpl = fetch) {
  const result = await getChatmixAttendanceMessages(attendanceId, fetchImpl);

  return {
    attendanceId: result.attendanceId,
    data: result.raw
  };
}

module.exports = {
  ChatmixApiError,
  getChatmixAttendanceMessages,
  validateChatmixAttendance
};
