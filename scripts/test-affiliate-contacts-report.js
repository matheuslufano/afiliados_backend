const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');

require('dotenv').config();

const prisma = require('../src/database/prisma');
const app = require('../src/app');

const suffix = crypto.randomBytes(5).toString('hex');
const created = {
  userIds: [],
  affiliateIds: [],
  linkIds: [],
  attendanceIds: []
};

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function cleanup() {
  await prisma.webhookLog.deleteMany({
    where: { attendanceId: { in: created.attendanceIds } }
  });
  await prisma.crmDeal.deleteMany({
    where: { chatmixId: { in: created.attendanceIds } }
  });
  await prisma.conversion.deleteMany({
    where: { attendanceId: { in: created.attendanceIds } }
  });
  await prisma.link.deleteMany({ where: { id: { in: created.linkIds } } });
  await prisma.affiliate.deleteMany({
    where: { id: { in: created.affiliateIds } }
  });
  await prisma.user.deleteMany({ where: { id: { in: created.userIds } } });
}

async function createConversion(linkId, index, data = {}) {
  const attendanceId = `contacts-test-${suffix}-${index}`;
  created.attendanceIds.push(attendanceId);

  return prisma.conversion.create({
    data: {
      attendanceId,
      type: 'chatmix:test',
      product: 'Teste de contatos do relatorio',
      source: 'chatmix',
      linkId,
      ...data
    }
  });
}

async function run() {
  const user = await prisma.user.create({
    data: {
      name: 'Operador teste contatos',
      email: `contacts-user-${suffix}@netbox.local`,
      password: 'test-only',
      role: 'ADMIN'
    }
  });
  created.userIds.push(user.id);

  const affiliate = await prisma.affiliate.create({
    data: {
      name: `Afiliado teste contatos ${suffix}`,
      email: `contacts-affiliate-${suffix}@netbox.local`
    }
  });
  const otherAffiliate = await prisma.affiliate.create({
    data: {
      name: `Outro afiliado ${suffix}`,
      email: `contacts-other-${suffix}@netbox.local`
    }
  });
  created.affiliateIds.push(affiliate.id, otherAffiliate.id);

  const firstLink = await prisma.link.create({
    data: {
      name: 'Divulgacao principal',
      originalUrl: 'https://netbox.net.br/',
      shortCode: crypto.randomBytes(4).toString('hex'),
      userId: user.id,
      affiliateId: affiliate.id
    }
  });
  const secondLink = await prisma.link.create({
    data: {
      name: 'Divulgacao secundaria',
      originalUrl: 'https://netbox.net.br/',
      shortCode: crypto.randomBytes(4).toString('hex'),
      userId: user.id,
      affiliateId: affiliate.id
    }
  });
  const foreignLink = await prisma.link.create({
    data: {
      name: 'Link de outro afiliado',
      originalUrl: 'https://netbox.net.br/',
      shortCode: crypto.randomBytes(4).toString('hex'),
      userId: user.id,
      affiliateId: otherAffiliate.id
    }
  });
  created.linkIds.push(firstLink.id, secondLink.id, foreignLink.id);

  await createConversion(firstLink.id, 1, {
    visitorName: 'Maria da Silva',
    visitorPhone: '(63) 99999-0001',
    visitorCity: 'Palmas'
  });
  await createConversion(secondLink.id, 2, {
    visitorName: 'Maria Silva',
    visitorPhone: '63999990001',
    visitorCity: 'Palmas'
  });
  await createConversion(firstLink.id, 3, {
    visitorName: 'Joao Cliente',
    visitorPhone: '63988880001',
    visitorDocument: '123.456.789-00'
  });
  await createConversion(secondLink.id, 4, {
    visitorName: 'Joao Atualizado',
    visitorPhone: '63977770002',
    visitorDocument: '12345678900'
  });
  await createConversion(firstLink.id, 5, {
    visitorName: 'Ana Sem Telefone'
  });
  await createConversion(firstLink.id, 6, {});
  await createConversion(foreignLink.id, 7, {
    visitorName: 'Cliente de outro afiliado',
    visitorPhone: '63966660003'
  });

  const server = http.createServer(app);
  const port = await listen(server);

  try {
    const response = await fetch(
      `http://127.0.0.1:${port}/affiliate/${affiliate.id}/stats`
    );
    const report = await response.json();

    assert.equal(response.status, 200, 'endpoint deve responder HTTP 200');
    assert.equal(report.totalConversions, 6, 'deve contar todas as conversoes');
    assert.equal(report.totalContacts, 3, 'deve contar clientes unicos identificados');
    assert.equal(report.contacts.length, 3, 'deve retornar a lista dos clientes');
    assert.equal(report.conversionEvents.length, 6, 'deve listar as conversoes do afiliado');

    const maria = report.contacts.find((contact) =>
      String(contact.phone || '').replace(/\D/g, '') === '63999990001'
    );
    assert.ok(maria, 'Maria deve ser identificada pelo telefone normalizado');
    assert.equal(maria.totalAttendances, 2, 'Maria deve ter dois atendimentos');
    assert.equal(maria.shortCodes.length, 2, 'Maria deve estar ligada aos dois codigos');

    const joao = report.contacts.find(
      (contact) =>
        String(contact.document || '').replace(/\D/g, '') === '12345678900'
    );
    assert.ok(joao, 'Joao deve ser identificado pelo documento normalizado');
    assert.equal(joao.totalAttendances, 2, 'Joao deve ter dois atendimentos');

    const ana = report.contacts.find((contact) =>
      String(contact.name || '').includes('Ana')
    );
    assert.ok(ana, 'Ana deve ser identificada pelo nome como ultimo recurso');
    assert.equal(ana.totalAttendances, 1, 'Ana deve ter um atendimento');

    assert.equal(
      report.contacts.some((contact) =>
        String(contact.name || '').includes('outro afiliado')
      ),
      false,
      'cliente de outro afiliado nao pode aparecer no relatorio'
    );

    console.log(
      JSON.stringify(
        {
          resultado: 'SUCESSO',
          affiliateId: affiliate.id,
          totalConversions: report.totalConversions,
          totalContacts: report.totalContacts,
          validacoes: {
            mesmoTelefoneAgrupado: maria.totalAttendances,
            mesmoDocumentoAgrupado: joao.totalAttendances,
            identificacaoPorNome: ana.totalAttendances,
            conversaoSemContatoExcluidaDosClientes: true,
            outroAfiliadoIsolado: true
          },
          contatos: report.contacts.map((contact) => ({
            nome: contact.name,
            telefone: contact.phone,
            documento: contact.document,
            atendimentos: contact.totalAttendances,
            codigos: contact.shortCodes
          }))
        },
        null,
        2
      )
    );
  } finally {
    await close(server);
  }
}

run()
  .catch((error) => {
    console.error('TESTE_FALHOU', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
  });
