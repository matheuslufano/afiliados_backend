const test = require('node:test');
const assert = require('node:assert/strict');
const { extractShortCode } = require('../src/controllers/chatmixWebhookController');

const code = 'a1b2c3d4';

for (const [position, message] of [
  ['sozinho', code],
  ['no início', `${code} Olá, quero conhecer os planos`],
  ['no meio', `Olá, meu código ${code} e quero conhecer os planos`],
  ['no fim', `Olá, quero conhecer os planos ${code}`]
]) {
  test(`reconhece o código do afiliado ${position} da primeira mensagem`, () => {
    assert.equal(extractShortCode({ body: { messages: [{ text: message }] } }), code);
  });
}

test('não interpreta um identificador técnico isolado como código de afiliado', () => {
  assert.equal(extractShortCode({ body: { attendance_id: code } }), null);
});
