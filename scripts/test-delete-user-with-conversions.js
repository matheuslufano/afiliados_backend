const assert = require('node:assert/strict');
const crypto = require('node:crypto');

require('dotenv').config();

const prisma = require('../src/database/prisma');
const userController = require('../src/controllers/userController');

const suffix = crypto.randomBytes(5).toString('hex');
let guardUser;
let targetUser;
let link;
let conversion;
let webhookLog;

async function cleanup() {
  if (webhookLog) {
    await prisma.webhookLog.deleteMany({ where: { id: webhookLog.id } });
  }
  if (conversion) {
    await prisma.conversion.deleteMany({ where: { id: conversion.id } });
  }
  if (link) await prisma.link.deleteMany({ where: { id: link.id } });
  if (targetUser) await prisma.user.deleteMany({ where: { id: targetUser.id } });
  if (guardUser) await prisma.user.deleteMany({ where: { id: guardUser.id } });
}

async function run() {
  guardUser = await prisma.user.create({
    data: {
      name: 'Usuario guardiao da simulacao',
      email: `guard-${suffix}@netbox.local`,
      password: 'simulation-only',
      role: 'ADMIN'
    }
  });
  targetUser = await prisma.user.create({
    data: {
      name: 'Usuario com conversao',
      email: `delete-${suffix}@netbox.local`,
      password: 'simulation-only'
    }
  });
  link = await prisma.link.create({
    data: {
      name: 'Link da exclusao',
      originalUrl: 'https://netbox.net.br/',
      shortCode: crypto.randomBytes(4).toString('hex'),
      userId: targetUser.id
    }
  });
  conversion = await prisma.conversion.create({
    data: {
      attendanceId: `delete-user-${suffix}`,
      visitorName: 'Cliente preservado no log',
      visitorPhone: '63999999999',
      linkId: link.id
    }
  });
  webhookLog = await prisma.webhookLog.create({
    data: {
      provider: 'chatmix',
      attendanceId: conversion.attendanceId,
      shortCode: link.shortCode,
      linkId: link.id,
      conversionId: conversion.id,
      raw: {},
      query: {},
      result: {}
    }
  });

  let statusCode;
  let responseBody;
  const response = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(body) {
      responseBody = body;
      return this;
    },
    send() {
      return this;
    }
  };

  await userController.delete({ params: { id: String(targetUser.id) } }, response);

  assert.equal(statusCode, 204, JSON.stringify(responseBody));
  assert.equal(await prisma.user.findUnique({ where: { id: targetUser.id } }), null);
  assert.equal(await prisma.link.findUnique({ where: { id: link.id } }), null);
  assert.equal(
    await prisma.conversion.findUnique({ where: { id: conversion.id } }),
    null
  );

  const preservedLog = await prisma.webhookLog.findUnique({
    where: { id: webhookLog.id }
  });
  assert.ok(preservedLog);
  assert.equal(preservedLog.linkId, null);
  assert.equal(preservedLog.conversionId, null);

  console.log(
    JSON.stringify(
      {
        resultado: 'SUCESSO',
        statusHttp: statusCode,
        usuarioApagado: true,
        linkApagado: true,
        conversaoApagada: true,
        webhookPreservado: true,
        referenciasInvalidasRemovidas: true
      },
      null,
      2
    )
  );
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
