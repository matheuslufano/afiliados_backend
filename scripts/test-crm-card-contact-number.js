const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');

require('dotenv').config();

const suffix = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
const attendanceIds = [`card-test-with-phone-${suffix}`, `card-test-without-phone-${suffix}`];
const shortCode = crypto.randomBytes(4).toString('hex');
const keepTestData = process.env.KEEP_TEST_DATA === '1';

process.env.CHATMIX_API_X_AUTH = `card-test-token-${suffix}`;
process.env.CHATMIX_WEBHOOK_SECRET = `card-test-secret-${suffix}`;
process.env.CHATMIX_API_TIMEOUT_MS = '3000';

const prisma = require('../src/database/prisma');

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

let user;
let affiliate;
let link;
let fakeChatmixServer;
let backendServer;

async function cleanup() {
  await prisma.webhookLog.deleteMany({ where: { attendanceId: { in: attendanceIds } } });
  await prisma.crmDeal.deleteMany({ where: { chatmixId: { in: attendanceIds } } });
  await prisma.conversion.deleteMany({ where: { attendanceId: { in: attendanceIds } } });
  if (link) await prisma.link.deleteMany({ where: { id: link.id } });
  if (affiliate) await prisma.affiliate.deleteMany({ where: { id: affiliate.id } });
  if (user) await prisma.user.deleteMany({ where: { id: user.id } });
}

async function run() {
  user = await prisma.user.create({
    data: {
      name: `Usuario teste cartao ${suffix}`,
      email: `card-test-${suffix}@netbox.local`,
      password: 'simulation-only',
      role: 'ADMIN'
    }
  });

  affiliate = await prisma.affiliate.create({
    data: {
      name: `Afiliado teste cartao ${suffix}`,
      email: `affiliate-card-test-${suffix}@netbox.local`,
      active: true
    }
  });

  link = await prisma.link.create({
    data: {
      name: `Link teste regra cartao ${suffix}`,
      originalUrl: 'https://netbox.net.br/',
      shortCode,
      userId: user.id,
      affiliateId: affiliate.id
    }
  });

  fakeChatmixServer = http.createServer((req, res) => {
    const attendanceId = attendanceIds.find((id) => req.url.includes(encodeURIComponent(id)));
    assert.ok(attendanceId, `Atendimento inesperado: ${req.url}`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ messages: [] }));
  });
  const fakeChatmixPort = await listen(fakeChatmixServer);
  process.env.CHATMIX_PUBLIC_API_BASE_URL = `http://127.0.0.1:${fakeChatmixPort}`;

  const app = require('../src/app');
  backendServer = http.createServer(app);
  const backendPort = await listen(backendServer);

  const cases = [
    {
      attendanceId: attendanceIds[0],
      name: `TESTE COM TELEFONE ${suffix}`,
      phone: '63999990000'
    },
    {
      attendanceId: attendanceIds[1],
      name: `TESTE SEM TELEFONE ${suffix}`
    }
  ];

  for (const item of cases) {
    const response = await fetch(`http://127.0.0.1:${backendPort}/webhooks/chatmix`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-chatmix-secret': process.env.CHATMIX_WEBHOOK_SECRET
      },
      body: JSON.stringify({
        attendance_id: item.attendanceId,
        event: 'attendance_started',
        messages: [{ text: `Codigo do afiliado [${shortCode}]` }],
        client_data: {
          name: item.name,
          ...(item.phone ? { user: item.phone } : {})
        }
      })
    });
    const body = await response.json();
    assert.ok([200, 201].includes(response.status), JSON.stringify(body));
  }

  const deals = await prisma.crmDeal.findMany({
    where: { chatmixId: { in: attendanceIds } },
    select: { id: true, chatmixId: true, customerName: true, phone: true }
  });

  assert.equal(deals.length, 1);
  assert.equal(deals[0].chatmixId, attendanceIds[0]);
  assert.equal(deals[0].phone, cases[0].phone);

  console.log(JSON.stringify({
    resultado: 'SUCESSO',
    mensagem: 'O caso com telefone criou cartao; o caso sem telefone nao criou cartao.',
    crm: {
      cartoesCriados: deals.length,
      cartaoComTelefone: deals[0]
    },
    casos: cases,
    dadosPreservados: keepTestData,
    limpeza: keepTestData
      ? 'Nao realizada. Remova os registros de teste pelo CRM ou execute novamente sem KEEP_TEST_DATA=1.'
      : 'Realizada ao final.'
  }, null, 2));
}

run()
  .catch((error) => {
    console.error('TESTE_CARTAO_FALHOU', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await close(backendServer);
    await close(fakeChatmixServer);
    if (!keepTestData) {
      await cleanup();
    }
    await prisma.$disconnect();
  });
