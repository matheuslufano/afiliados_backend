const assert = require('node:assert/strict');
const test = require('node:test');

const {
  hasIdentifiedContactNumber
} = require('../src/controllers/chatmixWebhookController');

test('aceita numero de contato identificado', () => {
  assert.equal(hasIdentifiedContactNumber('(63) 99999-0000'), true);
  assert.equal(hasIdentifiedContactNumber('5563999990000'), true);
});

test('rejeita atendimento sem numero de contato identificado', () => {
  assert.equal(hasIdentifiedContactNumber(null), false);
  assert.equal(hasIdentifiedContactNumber(''), false);
  assert.equal(hasIdentifiedContactNumber('12345'), false);
});
