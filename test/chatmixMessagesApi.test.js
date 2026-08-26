const assert = require('node:assert/strict');
const test = require('node:test');

const {
  getChatmixAttendanceMessages
} = require('../src/services/chatmixApi');

function response(status, body, options = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () =>
      options.rawText === undefined
        ? JSON.stringify(body)
        : options.rawText
  };
}

async function withEnvironment(values, callback) {
  const previous = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]])
  );

  Object.entries(values).forEach(([key, value]) => {
    if (value === null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  });

  try {
    await callback();
  } finally {
    Object.entries(previous).forEach(([key, value]) => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    });
  }
}

test('busca mensagens usando attendance_id e X-auth no servidor', async () => {
  await withEnvironment(
    { CHATMIX_API_X_AUTH: 'token-somente-no-backend' },
    async () => {
      const result = await getChatmixAttendanceMessages(
        ' atendimento/123 ',
        async (url, options) => {
          assert.match(url, /atendimento%2F123\/messages$/);
          assert.equal(options.headers['X-auth'], 'token-somente-no-backend');
          return response(200, {
            data: {
              messages: [{ id: 'message-1', text: 'Ola' }]
            }
          });
        }
      );

      assert.equal(result.attendanceId, 'atendimento/123');
      assert.equal(result.count, 1);
      assert.deepEqual(result.messages, [{ id: 'message-1', text: 'Ola' }]);
    }
  );
});

test('preserva toda a conversa quando mensagens estao aninhadas no atendimento', async () => {
  await withEnvironment({ CHATMIX_API_X_AUTH: 'token-de-teste' }, async () => {
    const conversation = [
      { id: 'first', fromMe: false, text: 'Primeira mensagem' },
      { id: 'second', fromMe: true, text: 'Resposta do atendente' },
    ];
    const result = await getChatmixAttendanceMessages(
      'attendance-123',
      async () => response(200, { data: { attendance: { messages: conversation } } }),
    );

    assert.equal(result.count, 2);
    assert.deepEqual(result.messages, conversation);
  });
});

test('rejeita attendance_id vazio antes de chamar a API', async () => {
  await assert.rejects(
    getChatmixAttendanceMessages('   ', async () => {
      throw new Error('fetch nao deveria ser chamado');
    }),
    { code: 'CHATMIX_ATTENDANCE_ID_REQUIRED', httpStatus: 400 }
  );
});

test('rejeita busca quando X-auth nao esta configurado', async () => {
  await withEnvironment({ CHATMIX_API_X_AUTH: null }, async () => {
    await assert.rejects(
      getChatmixAttendanceMessages('attendance-123', async () => {
        throw new Error('fetch nao deveria ser chamado');
      }),
      { code: 'CHATMIX_MESSAGES_API_NOT_CONFIGURED', httpStatus: 503 }
    );
  });
});

for (const status of [401, 403]) {
  test(`preserva erro de autenticacao HTTP ${status}`, async () => {
    await withEnvironment({ CHATMIX_API_X_AUTH: 'token-secreto' }, async () => {
      await assert.rejects(
        getChatmixAttendanceMessages(
          'attendance-123',
          async () => response(status, { error: 'unauthorized' })
        ),
        { code: 'CHATMIX_MESSAGES_UNAUTHORIZED', httpStatus: status }
      );
    });
  });
}

test('preserva atendimento nao encontrado como HTTP 404', async () => {
  await withEnvironment({ CHATMIX_API_X_AUTH: 'token-secreto' }, async () => {
    await assert.rejects(
      getChatmixAttendanceMessages(
        'attendance-inexistente',
        async () => response(404, { error: 'not found' })
      ),
      { code: 'CHATMIX_ATTENDANCE_NOT_FOUND', httpStatus: 404 }
    );
  });
});

test('trata resposta de sucesso que nao seja JSON', async () => {
  await withEnvironment({ CHATMIX_API_X_AUTH: 'token-secreto' }, async () => {
    await assert.rejects(
      getChatmixAttendanceMessages(
        'attendance-123',
        async () => response(200, null, { rawText: '<html>erro</html>' })
      ),
      { code: 'CHATMIX_MESSAGES_INVALID_RESPONSE', httpStatus: 502 }
    );
  });
});

test('interrompe consulta quando excede o timeout', async () => {
  await withEnvironment(
    {
      CHATMIX_API_X_AUTH: 'token-secreto',
      CHATMIX_API_TIMEOUT_MS: '5'
    },
    async () => {
      await assert.rejects(
        getChatmixAttendanceMessages(
          'attendance-123',
          async (_url, options) =>
            new Promise((_resolve, reject) => {
              options.signal.addEventListener('abort', () => {
                const error = new Error('aborted');
                error.name = 'AbortError';
                reject(error);
              });
            })
        ),
        { code: 'CHATMIX_MESSAGES_TIMEOUT', httpStatus: 502 }
      );
    }
  );
});

test('erros nunca incluem o token X-auth', async () => {
  const secret = 'token-que-nao-pode-vazar';

  await withEnvironment({ CHATMIX_API_X_AUTH: secret }, async () => {
    try {
      await getChatmixAttendanceMessages(
        'attendance-123',
        async () => response(500, { token: secret })
      );
      assert.fail('a consulta deveria falhar');
    } catch (error) {
      assert.doesNotMatch(JSON.stringify(error), new RegExp(secret));
      assert.doesNotMatch(String(error.message), new RegExp(secret));
    }
  });
});
