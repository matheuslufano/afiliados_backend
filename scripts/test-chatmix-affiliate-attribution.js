const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');

require('dotenv').config();

const attendanceId = `sim-${Date.now()}`;
const shortCode = crypto.randomBytes(4).toString('hex');
const uniqueSuffix = crypto.randomBytes(4).toString('hex');
const keepTestData = process.env.KEEP_TEST_DATA === '1';

process.env.CHATMIX_API_X_AUTH = 'simulation-token';
process.env.CHATMIX_WEBHOOK_SECRET = 'simulation-webhook-secret';
process.env.CHATMIX_API_TIMEOUT_MS = '3000';

const prisma = require('../src/database/prisma');
const {
  subscribeRealtimeEvents
} = require('../src/utils/realtimeEvents');

let affiliate;
let user;
let link;
let fakeChatmixServer;
let backendServer;

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function close(server) {
  if (!server) return Promise.resolve();
  return new Promise((resolve) => server.close(resolve));
}

async function cleanup() {
  await prisma.webhookLog.deleteMany({ where: { attendanceId } });
  await prisma.crmDeal.deleteMany({ where: { chatmixId: attendanceId } });
  await prisma.conversion.deleteMany({ where: { attendanceId } });
  if (link) await prisma.link.deleteMany({ where: { id: link.id } });
  if (affiliate) {
    await prisma.affiliate.deleteMany({ where: { id: affiliate.id } });
  }
  if (user) await prisma.user.deleteMany({ where: { id: user.id } });
}

async function run() {
  user = await prisma.user.create({
    data: {
      name: 'Operador Simulacao Chatmix',
      email: `chatmix-sim-${uniqueSuffix}@netbox.local`,
      password: 'simulation-only',
      role: 'ADMIN'
    }
  });

  affiliate = await prisma.affiliate.create({
    data: {
      name: `Afiliado Teste Chatmix ${uniqueSuffix}`,
      email: `afiliado-chatmix-${uniqueSuffix}@netbox.local`,
      active: true
    }
  });

  link = await prisma.link.create({
    data: {
      name: 'Link de simulacao Chatmix',
      originalUrl: 'https://netbox.net.br/',
      shortCode,
      userId: user.id,
      affiliateId: affiliate.id
    }
  });

  fakeChatmixServer = http.createServer((req, res) => {
    assert.equal(req.headers['x-auth'], 'simulation-token');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        data: {
          conversation: {
            messages: [
              {
                id: 'first-message',
                type: 'received',
                createdAt: new Date().toISOString(),
                sender: { name: 'Cliente da simulacao' },
                content: {
                  type: 'text',
                  content: `Ola! Codigo do afiliado: [${shortCode}]`
                }
              }
            ]
          }
        }
      })
    );
  });

  const fakeChatmixPort = await listen(fakeChatmixServer);
  process.env.CHATMIX_PUBLIC_API_BASE_URL = `http://127.0.0.1:${fakeChatmixPort}`;

  const realtimeEvents = [];
  const unsubscribe = subscribeRealtimeEvents((event) => {
    if (event.payload?.attendanceId === attendanceId) {
      realtimeEvents.push(event);
    }
  });

  const app = require('../src/app');
  backendServer = http.createServer(app);
  const backendPort = await listen(backendServer);

  const webhookResponse = await fetch(
    `http://127.0.0.1:${backendPort}/webhooks/chatmix`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-chatmix-secret': 'simulation-webhook-secret'
      },
      body: JSON.stringify({
        attendance_id: attendanceId,
        event: 'attendance_started',
        channel_data: { name: 'WhatsApp Teste', type: 'whatsapp' },
        client_data: { name: 'Cliente da simulacao', user: '63999990000' },
        data: { 'Nome Cliente': 'Cliente da simulacao' }
      })
    }
  );
  const webhookBody = await webhookResponse.json();
  assert.equal(webhookResponse.status, 201);
  assert.equal(webhookBody.shortCode, shortCode);
  assert.equal(webhookBody.affiliateId, affiliate.id);

  const webhookLog = await prisma.webhookLog.findFirst({
    where: { provider: 'chatmix', attendanceId },
    orderBy: { receivedAt: 'desc' }
  });
  const conversion = await prisma.conversion.findUnique({
    where: { attendanceId },
    include: { link: { include: { affiliate: true } } }
  });
  const crmDeal = await prisma.crmDeal.findFirst({
    where: { chatmixId: attendanceId },
    include: { affiliate: true, link: true }
  });
  const reportResponse = await fetch(
    `http://127.0.0.1:${backendPort}/affiliate/${affiliate.id}/stats`
  );
  const report = await reportResponse.json();

  assert.equal(webhookLog.shortCode, shortCode);
  assert.equal(webhookLog.linkId, link.id);
  assert.equal(webhookLog.conversionId, conversion.id);
  assert.equal(conversion.link.affiliateId, affiliate.id);
  assert.equal(conversion.link.affiliate.name, affiliate.name);
  assert.equal(crmDeal.trackingCode, shortCode);
  assert.equal(crmDeal.affiliateId, affiliate.id);
  assert.equal(crmDeal.linkId, link.id);
  assert.equal(crmDeal.conversionId, conversion.id);
  assert.equal(report.totalConversions, 1);
  assert.equal(report.conversionEvents[0].shortCode, shortCode);
  assert.equal(
    realtimeEvents.some(
      (event) =>
        event.type === 'link-converted' &&
        event.payload.affiliateId === affiliate.id
    ),
    true
  );

  unsubscribe();

  console.log(
    JSON.stringify(
      {
        resultado: 'SUCESSO',
        webhook: {
          statusHttp: webhookResponse.status,
          attendanceId,
          shortCode,
          conversionId: conversion.id,
          webhookLogId: webhookLog.id
        },
        vinculo: {
          linkId: link.id,
          affiliateId: affiliate.id,
          affiliateName: affiliate.name
        },
        crm: {
          dealId: crmDeal.id,
          trackingCode: crmDeal.trackingCode,
          affiliateId: crmDeal.affiliateId
        },
        relatorio: {
          affiliate: report.affiliate,
          totalConversions: report.totalConversions,
          codigoNaConversao: report.conversionEvents[0].shortCode
        },
        tempoReal: realtimeEvents.map((event) => event.type),
        dadosPreservados: keepTestData
      },
      null,
      2
    )
  );
}

run()
  .catch((error) => {
    console.error('SIMULACAO_FALHOU', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await close(backendServer);
    await close(fakeChatmixServer);
    if (!keepTestData) await cleanup();
    await prisma.$disconnect();
  });
