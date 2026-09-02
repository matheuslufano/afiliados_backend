const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../src/database/prisma');
const service = require('../src/services/whatsappLinkService');
const {
  buildWhatsAppMessage,
  buildWhatsAppUrl,
  normalizePhoneNumber
} = require('../src/utils/whatsapp');

test('normaliza telefone brasileiro com máscara', () => {
  assert.equal(normalizePhoneNumber('(63) 99999-9999'), '5563999999999');
});

test('codifica acentos, emoji, quebra de linha e formatação', () => {
  const message = 'Olá! 👋\nAção: *rápida* e _fácil_.\nCódigo do afiliado: ABC123';
  const url = buildWhatsAppUrl({ phone: '(63) 99999-9999', message });
  assert.equal(new URL(url).searchParams.get('text'), message);
  assert.match(url, /^https:\/\/wa\.me\/5563999999999\?text=/);
});

test('monta mensagem com placeholders de afiliado e campanha', () => {
  assert.equal(buildWhatsAppMessage({
    message: 'Olá', affiliateCode: 'ABC123', affiliateName: 'Marcos',
    campaignName: 'Setembro', template: '{{afiliado}} | {{campanha}} | Código do afiliado: {{codigo}}'
  }), 'Olá\n\nMarcos | Setembro | Código do afiliado: ABC123');
});

test('rejeita código inexistente', async () => {
  const originals = mockContext({ link: null });
  await assert.rejects(() => service.resolveContext(basePayload()), /não encontrado/i);
  restore(originals);
});

test('rejeita código pertencente a outro afiliado', async () => {
  const originals = mockContext({ link: { id: 3, affiliateId: 99, campaignId: 1, active: true } });
  await assert.rejects(() => service.resolveContext(basePayload()), /não pertence ao afiliado/i);
  restore(originals);
});

test('rejeita código inativo', async () => {
  const originals = mockContext({ link: { id: 3, affiliateId: 2, campaignId: 1, active: false } });
  await assert.rejects(() => service.resolveContext(basePayload()), /inativo/i);
  restore(originals);
});

test('infere a campanha pelo código ao vincular o WhatsApp individualmente', async () => {
  const originals = mockContext({ link: { id: 3, affiliateId: 2, campaignId: 1, active: true } });
  const context = await service.resolveContext({ affiliateId: 2, affiliateCodeId: 3 });
  assert.equal(context.campaign.id, 1);
  assert.equal(context.affiliate.id, 2);
  assert.equal(context.link.id, 3);
  restore(originals);
});

test('infere o vínculo interno do afiliado ao gerar um novo código sem campo campanha', async () => {
  const originals = mockContext({ link: null });
  originals.linkFindFirst = prisma.link.findFirst;
  prisma.link.findFirst = async () => ({ campaignId: 1 });
  const context = await service.resolveContext({ affiliateId: 2 });
  assert.equal(context.campaign.id, 1);
  assert.equal(context.affiliate.id, 2);
  assert.equal(context.link, undefined);
  restore(originals);
});

test('novo código é criado e relacionado ao link WhatsApp', async () => {
  const originals = mockContext({ link: null });
  originals.linkCreate = prisma.link.create;
  originals.whatsAppCreate = prisma.whatsAppLink.create;
  prisma.link.create = async ({ data }) => ({ id: 15, active: true, ...data });
  prisma.whatsAppLink.create = async ({ data }) => ({
    id: 21, createdAt: new Date(), updatedAt: new Date(), active: true, ...data,
    campaign: { id: 1, name: 'Setembro' }, affiliate: { id: 2, name: 'Marcos', active: true },
    link: { id: data.linkId, shortCode: 'a1b2c3d4', createdAt: new Date() },
    createdBy: { id: 7, name: 'Operador' }
  });
  const result = await service.create(
    { user: { id: 7 }, protocol: 'http', get: () => 'localhost:3001' },
    { ...basePayload(), affiliateCodeId: undefined, generateNewCode: true,
      whatsappNumber: '(63) 99999-9999', message: 'Olá', appendAffiliateCode: true,
      identificationTemplate: 'Código do afiliado: {{codigo}}' }
  );
  assert.equal(result.linkId, 15);
  assert.equal(result.createdById, 7);
  assert.equal(result.campaignId, 1);
  assert.equal(result.affiliateId, 2);
  assert.match(result.finalMessage, /Código do afiliado: [a-f0-9]{8}/);
  restore(originals);
});

function basePayload() { return { campaignId: 1, affiliateId: 2, affiliateCodeId: 3 }; }
function mockContext({ link }) {
  const originals = {
    campaignFind: prisma.campaign.findUnique,
    affiliateFind: prisma.affiliate.findUnique,
    linkFind: prisma.link.findUnique
  };
  prisma.campaign.findUnique = async () => ({ id: 1, name: 'Setembro', destinationUrl: 'https://netbox.com.br' });
  prisma.affiliate.findUnique = async () => ({ id: 2, name: 'Marcos', active: true });
  prisma.link.findUnique = async () => link;
  return originals;
}
function restore(originals) {
  prisma.campaign.findUnique = originals.campaignFind;
  prisma.affiliate.findUnique = originals.affiliateFind;
  prisma.link.findUnique = originals.linkFind;
  if (originals.linkCreate) prisma.link.create = originals.linkCreate;
  if (originals.linkFindFirst) prisma.link.findFirst = originals.linkFindFirst;
  if (originals.whatsAppCreate) prisma.whatsAppLink.create = originals.whatsAppCreate;
}
