const assert = require('node:assert/strict');
const test = require('node:test');

const {
  validateChatmixAttendance
} = require('../src/services/chatmixApi');

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body)
  };
}

async function withApiToken(token, callback) {
  const previousToken = process.env.CHATMIX_API_X_AUTH;

  if (token === null) {
    delete process.env.CHATMIX_API_X_AUTH;
  } else {
    process.env.CHATMIX_API_X_AUTH = token;
  }

  try {
    await callback();
  } finally {
    if (previousToken === undefined) {
      delete process.env.CHATMIX_API_X_AUTH;
    } else {
      process.env.CHATMIX_API_X_AUTH = previousToken;
    }
  }
}

test('confirma attendance_id retornado pela API do Chatmix', async () => {
  await withApiToken('token-de-teste', async () => {
    const result = await validateChatmixAttendance(
      'attendance-123',
      async (url, options) => {
        assert.match(url, /attendance-123\/messages$/);
        assert.equal(options.headers['X-auth'], 'token-de-teste');
        return response(200, { messages: [] });
      }
    );

    assert.equal(result.attendanceId, 'attendance-123');
  });
});

test('rejeita quando o attendance_id nao existe no Chatmix', async () => {
  await withApiToken('token-de-teste', async () => {
    await assert.rejects(
      validateChatmixAttendance(
        'attendance-123',
        async () => response(404, { error: 'not found' })
      ),
      { code: 'CHATMIX_ATTENDANCE_NOT_FOUND', httpStatus: 404 }
    );
  });
});

test('exige o token da API antes de validar', async () => {
  await withApiToken(null, async () => {
    await assert.rejects(
      validateChatmixAttendance('attendance-123', async () => {
        throw new Error('fetch nao deveria ser chamado');
      }),
      { code: 'CHATMIX_MESSAGES_API_NOT_CONFIGURED', httpStatus: 503 }
    );
  });
});
