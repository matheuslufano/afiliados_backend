const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');

require('dotenv').config();

const prisma = require('../src/database/prisma');

const suffix = crypto.randomBytes(5).toString('hex');
const keepTestData = process.env.KEEP_TEST_DATA === '1';
let user;
let affiliates = [];
let campaignId;
let server;

function listen(httpServer) {
  return new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(0, '127.0.0.1', () => resolve(httpServer.address().port));
  });
}

function close(httpServer) {
  if (!httpServer) return Promise.resolve();
  return new Promise((resolve) => httpServer.close(resolve));
}

async function cleanup() {
  if (campaignId) {
    const links = await prisma.link.findMany({
      where: { campaignId },
      select: { id: true }
    });
    const linkIds = links.map((link) => link.id);
    await prisma.conversion.deleteMany({ where: { linkId: { in: linkIds } } });
    await prisma.click.deleteMany({ where: { linkId: { in: linkIds } } });
    await prisma.link.deleteMany({ where: { campaignId } });
    await prisma.campaign.deleteMany({ where: { id: campaignId } });
  }
  if (affiliates.length) {
    await prisma.affiliate.deleteMany({
      where: { id: { in: affiliates.map((affiliate) => affiliate.id) } }
    });
  }
  if (user) await prisma.user.deleteMany({ where: { id: user.id } });
}

async function run() {
  user = await prisma.user.create({
    data: {
      name: 'Operador Teste Campanha',
      email: `campaign-${suffix}@netbox.local`,
      password: 'simulation-only',
      role: 'ADMIN'
    }
  });
  process.env.DEFAULT_USER_ID = String(user.id);

  affiliates = await Promise.all(
    Array.from({ length: 4 }, (_, index) =>
      prisma.affiliate.create({
        data: {
          name: `Afiliado Campanha ${index + 1} ${suffix}`,
          email: `affiliate-campaign-${index + 1}-${suffix}@netbox.local`,
          active: true
        }
      })
    )
  );

  const app = require('../src/app');
  server = http.createServer(app);
  const port = await listen(server);
  const baseUrl = `http://127.0.0.1:${port}`;

  const invalidResponse = await fetch(`${baseUrl}/campaigns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Campanha sem afiliados', affiliateIds: [] })
  });
  assert.equal(invalidResponse.status, 400);

  const createResponse = await fetch(`${baseUrl}/campaigns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `Campanha Teste ${suffix}`,
      destinationUrl: 'https://netbox.net.br/planos',
      affiliateIds: affiliates.slice(0, 3).map((affiliate) => affiliate.id)
    })
  });
  const campaign = await createResponse.json();
  assert.equal(createResponse.status, 201);
  assert.equal(campaign.totalLinks, 3);
  assert.equal(campaign.totalAffiliates, 3);
  campaignId = campaign.id;

  const editedName = `Campanha Editada ${suffix}`;
  const editedDestination = 'https://netbox.net.br/planos?origem=teste-campanha';
  const editedShortCode = crypto.randomBytes(4).toString('hex');
  const removedLinkId = campaign.links[2].id;
  const updateResponse = await fetch(`${baseUrl}/campaigns/${campaignId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: editedName,
      destinationUrl: editedDestination,
      links: [
        { id: campaign.links[0].id, affiliateId: campaign.links[0].affiliate.id, shortCode: editedShortCode },
        { id: campaign.links[1].id, affiliateId: campaign.links[1].affiliate.id, shortCode: campaign.links[1].shortCode },
        { affiliateId: affiliates[3].id, shortCode: crypto.randomBytes(4).toString('hex') }
      ]
    })
  });
  const updatedCampaign = await updateResponse.json();
  assert.equal(updateResponse.status, 200);
  assert.equal(updatedCampaign.name, editedName);
  assert.equal(updatedCampaign.destinationUrl, editedDestination);
  updatedCampaign.links.forEach((item) => {
    assert.equal(item.originalUrl, editedDestination);
  });
  assert.equal(updatedCampaign.links.some((item) => item.id === removedLinkId), false);
  assert.equal(updatedCampaign.links.some((item) => item.shortCode === editedShortCode), true);
  assert.equal(updatedCampaign.links.some((item) => item.affiliate.id === affiliates[3].id), true);

  for (const [index, link] of updatedCampaign.links.entries()) {
    const clickResponse = await fetch(`${baseUrl}/r/${link.shortCode}`, {
      redirect: 'manual',
      headers: {
        'user-agent': `Campaign-Test-${index + 1}`,
        'x-forwarded-for': `192.0.2.${index + 1}`
      }
    });
    assert.equal(clickResponse.status, 302);
    assert.ok(clickResponse.headers.get('location').includes(`ref=${link.shortCode}`));

    const conversionResponse = await fetch(
      `${baseUrl}/links/${link.shortCode}/whatsapp`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visitorName: `Cliente Campanha ${index + 1}`,
          visitorPhone: `639${String(91000000 + index)}`,
          visitorCity: 'Palmas'
        })
      }
    );
    assert.equal(conversionResponse.status, 201);
  }

  const listResponse = await fetch(`${baseUrl}/campaigns`);
  const campaigns = await listResponse.json();
  assert.equal(listResponse.status, 200);
  const report = campaigns.find((item) => item.id === campaignId);
  assert.ok(report);
  assert.equal(report.totalLinks, 3);
  assert.equal(report.totalAffiliates, 3);
  assert.equal(report.totalClicks, 3);
  assert.equal(report.totalConversions, 3);
  assert.ok(report.topAffiliate);
  assert.ok(report.topLink);
  report.links.forEach((link) => {
    assert.equal(link.clicks, 1);
    assert.equal(link.conversions, 1);
    assert.equal(link.conversionEvents[0].status, 'LEAD_IDENTIFIED');
    assert.equal(link.conversionEvents[0].attributionStatus, 'TRACKED');
  });

  let deletionStatus = 'NAO EXECUTADA (dados preservados)';
  if (!keepTestData) {
    const deleteResponse = await fetch(`${baseUrl}/campaigns/${campaignId}`, {
      method: 'DELETE'
    });
    assert.equal(deleteResponse.status, 204);
    assert.equal(
      await prisma.campaign.findUnique({ where: { id: campaignId } }),
      null
    );
    campaignId = null;
    deletionStatus = 'HTTP 204';
  }

  console.log(
    JSON.stringify(
      {
        resultado: 'SUCESSO',
        campaignId: campaign.id,
        campanha: editedName,
        afiliados: 3,
        linksGerados: 3,
        cliquesSimulados: 3,
        conversoesSimuladas: 3,
        validacaoSemAfiliado: 'HTTP 400',
        edicaoDaCampanha: 'HTTP 200',
        afiliadoAdicionado: true,
        afiliadoRemovido: true,
        codigoEditado: true,
        statusConversoes: 'LEAD_IDENTIFIED',
        atribuicao: 'TRACKED',
        exclusaoDaCampanha: deletionStatus,
        dadosPreservados: keepTestData
      },
      null,
      2
    )
  );
}

run()
  .catch((error) => {
    console.error('TESTE_DE_CAMPANHA_FALHOU', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await close(server);
    if (!keepTestData) await cleanup();
    await prisma.$disconnect();
  });
