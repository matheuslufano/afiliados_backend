const assert = require('node:assert/strict');
const crypto = require('node:crypto');

require('dotenv').config();

const prisma = require('../src/database/prisma');
const affiliateController = require('../src/controllers/affiliateController');

const suffix = crypto.randomBytes(5).toString('hex');
let user;
let affiliate;
let campaign;
let link;
let whatsappLink;

async function cleanup() {
  if (whatsappLink) await prisma.whatsAppLink.deleteMany({ where: { id: whatsappLink.id } });
  if (link) await prisma.link.deleteMany({ where: { id: link.id } });
  if (campaign) await prisma.campaign.deleteMany({ where: { id: campaign.id } });
  if (affiliate) await prisma.affiliate.deleteMany({ where: { id: affiliate.id } });
  if (user) await prisma.user.deleteMany({ where: { id: user.id } });
}

async function run() {
  user = await prisma.user.create({
    data: {
      name: 'Usuario da simulacao de afiliado',
      email: `affiliate-delete-user-${suffix}@netbox.local`,
      password: 'simulation-only'
    }
  });
  affiliate = await prisma.affiliate.create({
    data: {
      name: 'Afiliado com historico',
      email: `affiliate-delete-${suffix}@netbox.local`
    }
  });
  campaign = await prisma.campaign.create({
    data: {
      name: 'Campanha da simulacao de afiliado',
      destinationUrl: 'https://netbox.net.br/'
    }
  });
  link = await prisma.link.create({
    data: {
      name: 'Link preservado',
      originalUrl: 'https://netbox.net.br/',
      shortCode: crypto.randomBytes(4).toString('hex'),
      userId: user.id,
      affiliateId: affiliate.id,
      campaignId: campaign.id
    }
  });
  whatsappLink = await prisma.whatsAppLink.create({
    data: {
      name: 'WhatsApp vinculado ao afiliado',
      whatsappNumber: '63999999999',
      originalMessage: 'Teste',
      finalMessage: 'Teste',
      whatsappUrl: 'https://wa.me/63999999999',
      campaignId: campaign.id,
      affiliateId: affiliate.id,
      linkId: link.id,
      createdById: user.id
    }
  });

  let statusCode = 200;
  let responseBody;
  const response = {
    status(code) { statusCode = code; return this; },
    json(body) { responseBody = body; return this; }
  };

  await affiliateController.delete({ params: { id: String(affiliate.id) } }, response);

  assert.equal(statusCode, 200, JSON.stringify(responseBody));
  assert.equal(responseBody.archived, false);
  assert.equal(await prisma.affiliate.findUnique({ where: { id: affiliate.id } }), null);
  assert.equal(await prisma.whatsAppLink.findUnique({ where: { id: whatsappLink.id } }), null);
  const preservedLink = await prisma.link.findUnique({ where: { id: link.id } });
  assert.ok(preservedLink);
  assert.equal(preservedLink.affiliateId, null);

  console.log(JSON.stringify({
    resultado: 'SUCESSO',
    afiliadoApagado: true,
    linkWhatsappApagado: true,
    linkHistoricoPreservado: true,
    vinculoInvalidoRemovido: true
  }, null, 2));
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
