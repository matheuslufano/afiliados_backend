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

test('cria campanha interna ao gerar o primeiro código de um afiliado', async () => {
  const originals = mockContext({ link: null });
  originals.linkFindFirst = prisma.link.findFirst;
  originals.campaignFindFirst = prisma.campaign.findFirst;
  originals.campaignCreate = prisma.campaign.create;
  prisma.link.findFirst = async () => null;
  prisma.campaign.findFirst = async () => null;
  prisma.campaign.create = async ({ data }) => ({ id: 9, ...data });

  const context = await service.resolveContext({ affiliateId: 2 });

  assert.equal(context.campaign.id, 9);
  assert.equal(context.campaign.name, 'WhatsApp individual');
  assert.match(context.campaign.destinationUrl, /^https:\/\//);
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
  assert.equal(new URL(result.whatsappUrl).searchParams.get('whatsappLinkId'), '21');
  restore(originals);
});

test('gera novo código ao trocar o afiliado responsável do link WhatsApp', async () => {
  const originals = {
    whatsAppFind: prisma.whatsAppLink.findUnique,
    whatsAppUpdate: prisma.whatsAppLink.update,
    affiliateFind: prisma.affiliate.findUnique,
    campaignFind: prisma.campaign.findUnique,
    linkCreate: prisma.link.create
  };
  let updatedData;
  let createdLinkData;
  prisma.whatsAppLink.findUnique = async () => ({
    id: 21,
    name: 'Link original',
    originalMessage: 'Olá',
    whatsappNumber: '5563999999999',
    appendAffiliateCode: true,
    identificationTemplate: 'Código: {{codigo}}',
    campaignId: 1,
    affiliateId: 2,
    linkId: 15,
    active: true
  });
  prisma.affiliate.findUnique = async ({ where }) => ({
    id: where.id,
    name: 'Novo afiliado',
    active: true
  });
  prisma.campaign.findUnique = async () => ({
    id: 1,
    name: 'Setembro',
    destinationUrl: 'https://netbox.com.br'
  });
  prisma.link.create = async ({ data }) => {
    createdLinkData = data;
    return {
      id: 33,
      active: true,
      createdAt: new Date(),
      ...data
    };
  };
  prisma.whatsAppLink.update = async ({ data }) => {
    updatedData = data;
    return {
      id: 21,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...data,
      campaign: { id: 1, name: 'Setembro' },
      affiliate: { id: data.affiliateId, name: 'Novo afiliado', active: true },
      link: { id: data.linkId, shortCode: createdLinkData.shortCode, createdAt: new Date() },
      createdBy: { id: 7, name: 'Operador' }
    };
  };

  const result = await service.update(
    { user: { id: 7 }, protocol: 'http', get: () => 'localhost:3001' },
    21,
    { affiliateId: 8, generateNewCode: true }
  );

  assert.equal(updatedData.affiliateId, 8);
  assert.equal(updatedData.linkId, 33);
  assert.match(updatedData.finalMessage, new RegExp(createdLinkData.shortCode));
  assert.equal(result.affiliate.id, 8);
  prisma.whatsAppLink.findUnique = originals.whatsAppFind;
  prisma.whatsAppLink.update = originals.whatsAppUpdate;
  prisma.affiliate.findUnique = originals.affiliateFind;
  prisma.campaign.findUnique = originals.campaignFind;
  prisma.link.create = originals.linkCreate;
});

test('resolve o número salvo pelo identificador do link WhatsApp', async () => {
  const original = prisma.whatsAppLink.findFirst;
  const calls = [];
  prisma.whatsAppLink.findFirst = async (query) => {
    calls.push(query);
    return { whatsappNumber: '5563999999999', finalMessage: 'Olá' };
  };

  const result = await service.resolveTrackingTarget({
    linkId: 15,
    whatsappLinkId: '21',
    message: 'Olá'
  });

  assert.equal(result.whatsappNumber, '5563999999999');
  assert.deepEqual(calls[0].where, { id: 21, linkId: 15 });
  prisma.whatsAppLink.findFirst = original;
});

test('links antigos resolvem o número pela mensagem e pelo link relacionado', async () => {
  const original = prisma.whatsAppLink.findFirst;
  let receivedQuery;
  prisma.whatsAppLink.findFirst = async (query) => {
    receivedQuery = query;
    return { whatsappNumber: '5563888888888', finalMessage: 'Mensagem antiga' };
  };

  const result = await service.resolveTrackingTarget({
    linkId: 15,
    message: 'Mensagem antiga'
  });

  assert.equal(result.whatsappNumber, '5563888888888');
  assert.deepEqual(receivedQuery.where, { linkId: 15, finalMessage: 'Mensagem antiga' });
  assert.deepEqual(receivedQuery.orderBy, { updatedAt: 'desc' });
  prisma.whatsAppLink.findFirst = original;
});

test('apaga somente o registro de link WhatsApp', async () => {
  const originalFind = prisma.whatsAppLink.findUnique;
  const originalDelete = prisma.whatsAppLink.delete;
  let deletedWhere;
  prisma.whatsAppLink.findUnique = async () => ({ id: 21 });
  prisma.whatsAppLink.delete = async ({ where }) => {
    deletedWhere = where;
    return { id: where.id };
  };

  await service.remove(21);

  assert.deepEqual(deletedWhere, { id: 21 });
  prisma.whatsAppLink.findUnique = originalFind;
  prisma.whatsAppLink.delete = originalDelete;
});

test('rejeita exclusão de link WhatsApp inexistente', async () => {
  const originalFind = prisma.whatsAppLink.findUnique;
  prisma.whatsAppLink.findUnique = async () => null;
  await assert.rejects(() => service.remove(999), /encontrado/i);
  prisma.whatsAppLink.findUnique = originalFind;
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
  if (originals.campaignFindFirst) prisma.campaign.findFirst = originals.campaignFindFirst;
  if (originals.campaignCreate) prisma.campaign.create = originals.campaignCreate;
  if (originals.whatsAppCreate) prisma.whatsAppLink.create = originals.whatsAppCreate;
}
