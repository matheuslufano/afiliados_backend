const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');

require('dotenv').config();

const simulationCount = Math.min(
  50,
  Math.max(1, Number.parseInt(process.env.SIMULATION_CLIENTS || '1', 10) || 1)
);
const simulationStamp = Date.now();
const shortCode = crypto.randomBytes(4).toString('hex');
const uniqueSuffix = crypto.randomBytes(4).toString('hex');
const keepTestData = process.env.KEEP_TEST_DATA === '1';
const clients = Array.from({ length: simulationCount }, (_, index) => ({
  attendanceId: `sim-${simulationStamp}-${index + 1}`,
  name: `Cliente Chatmix ${index + 1}`,
  phone: `639${String(90000000 + index).padStart(8, '0')}`
}));
const attendanceIds = clients.map((client) => client.attendanceId);

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
  await prisma.webhookLog.deleteMany({ where: { attendanceId: { in: attendanceIds } } });
  await prisma.crmDeal.deleteMany({ where: { chatmixId: { in: attendanceIds } } });
  await prisma.conversion.deleteMany({ where: { attendanceId: { in: attendanceIds } } });
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
    const client = clients.find((item) =>
      req.url.includes(encodeURIComponent(item.attendanceId))
    );
    assert.ok(client, `Atendimento inesperado na API Chatmix: ${req.url}`);
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
                sender: { name: client.name },
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
    if (attendanceIds.includes(event.payload?.attendanceId)) {
      realtimeEvents.push(event);
    }
  });

  const app = require('../src/app');
  backendServer = http.createServer(app);
  const backendPort = await listen(backendServer);

  const webhookResults = [];
  for (const client of clients) {
    const response = await fetch(
      `http://127.0.0.1:${backendPort}/webhooks/chatmix`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-chatmix-secret': 'simulation-webhook-secret'
        },
        body: JSON.stringify({
          attendance_id: client.attendanceId,
          event: 'attendance_started',
          channel_data: { name: 'WhatsApp Teste', type: 'whatsapp' },
          client_data: { name: client.name, user: client.phone },
          data: { 'Nome Cliente': client.name }
        })
      }
    );
    const body = await response.json();
    assert.equal(response.status, 201);
    assert.equal(body.shortCode, shortCode);
    assert.equal(body.affiliateId, affiliate.id);
    webhookResults.push({ response, body, client });
  }

  const webhookLogs = await prisma.webhookLog.findMany({
    where: { provider: 'chatmix', attendanceId: { in: attendanceIds } }
  });
  const conversions = await prisma.conversion.findMany({
    where: { attendanceId: { in: attendanceIds } },
    include: { link: { include: { affiliate: true } } }
  });
  const crmDeals = await prisma.crmDeal.findMany({
    where: { chatmixId: { in: attendanceIds } },
    include: { affiliate: true, link: true }
  });
  const reportResponse = await fetch(
    `http://127.0.0.1:${backendPort}/affiliate/${affiliate.id}/stats`
  );
  const report = await reportResponse.json();

  assert.equal(webhookLogs.length, simulationCount);
  assert.equal(conversions.length, simulationCount);
  assert.equal(crmDeals.length, simulationCount);
  webhookLogs.forEach((log) => {
    assert.equal(log.shortCode, shortCode);
    assert.equal(log.linkId, link.id);
    assert.ok(log.conversionId);
  });
  conversions.forEach((conversion) => {
    assert.equal(conversion.link.affiliateId, affiliate.id);
    assert.equal(conversion.link.affiliate.name, affiliate.name);
  });
  crmDeals.forEach((deal) => {
    assert.equal(deal.trackingCode, shortCode);
    assert.equal(deal.affiliateId, affiliate.id);
    assert.equal(deal.linkId, link.id);
    assert.ok(deal.conversionId);
  });
  assert.equal(report.totalConversions, simulationCount);
  assert.equal(report.totalContacts, simulationCount);
  assert.equal(report.contacts.length, simulationCount);
  report.conversionEvents.forEach((conversion) => {
    assert.equal(conversion.shortCode, shortCode);
  });
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
        webhooks: webhookResults.map(({ response, body, client }) => ({
          statusHttp: response.status,
          attendanceId: client.attendanceId,
          cliente: client.name,
          telefone: client.phone,
          shortCode,
          conversionId: body.conversionId,
          webhookLogId: body.webhookLogId
        })),
        vinculo: {
          linkId: link.id,
          affiliateId: affiliate.id,
          affiliateName: affiliate.name
        },
        crm: {
          negociosCriados: crmDeals.length,
          trackingCode: shortCode,
          affiliateId: affiliate.id
        },
        relatorio: {
          affiliate: report.affiliate,
          totalConversions: report.totalConversions,
          totalContacts: report.totalContacts,
          clientesAlcancados: report.contacts.map((contact) => ({
            nome: contact.name,
            telefone: contact.phone,
            atendimentos: contact.totalAttendances
          })),
          codigoNasConversoes: shortCode
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
