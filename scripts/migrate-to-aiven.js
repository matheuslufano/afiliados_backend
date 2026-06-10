const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const dotenv = require('dotenv');
const { PrismaClient } = require('@prisma/client');

const TABLES = [
  { label: 'usuarios', model: 'user', table: 'User' },
  { label: 'afiliados', model: 'affiliate', table: 'Affiliate' },
  { label: 'campanhas', model: 'campaign', table: 'Campaign' },
  { label: 'links', model: 'link', table: 'Link' },
  { label: 'cliques', model: 'click', table: 'Click' },
  { label: 'conversoes', model: 'conversion', table: 'Conversion' }
];

const args = process.argv.slice(2);

function hasFlag(flag) {
  return args.includes(flag);
}

function readArg(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function readEnvFile(fileName) {
  const filePath = path.resolve(process.cwd(), fileName);

  if (!fs.existsSync(filePath)) {
    return {};
  }

  return dotenv.parse(fs.readFileSync(filePath));
}

function cleanEnvValue(value) {
  return String(value || '').trim().replace(/^['"]|['"]$/g, '');
}

function maskUrl(value) {
  try {
    const url = new URL(value);
    if (url.username) {
      url.username = '***';
    }
    if (url.password) {
      url.password = '***';
    }
    return url.toString();
  } catch {
    return '<invalid url>';
  }
}

function resolveUrls() {
  const sourceEnv = readEnvFile('.env');
  const aivenEnv = readEnvFile('.env.aiven');

  const sourceUrl = cleanEnvValue(
    readArg('--source') ||
      process.env.SOURCE_DATABASE_URL ||
      sourceEnv.SOURCE_DATABASE_URL ||
      sourceEnv.DATABASE_URL ||
      process.env.DATABASE_URL
  );

  const destinationUrl = cleanEnvValue(
    readArg('--dest') ||
      process.env.AIVEN_DATABASE_URL ||
      process.env.DEST_DATABASE_URL ||
      aivenEnv.AIVEN_DATABASE_URL ||
      aivenEnv.DEST_DATABASE_URL ||
      aivenEnv.DATABASE_URL
  );

  return { sourceUrl, destinationUrl };
}

function validateUrls(sourceUrl, destinationUrl) {
  if (!sourceUrl) {
    throw new Error('Banco de origem nao encontrado. Defina DATABASE_URL no .env.');
  }

  if (!destinationUrl) {
    throw new Error(
      'Banco da Aiven nao encontrado. Crie .env.aiven com DATABASE_URL.'
    );
  }

  if (sourceUrl === destinationUrl) {
    throw new Error('Origem e destino estao usando a mesma DATABASE_URL.');
  }

  const destination = new URL(destinationUrl);
  const sslmode = destination.searchParams.get('sslmode');

  if (
    !hasFlag('--allow-non-aiven-host') &&
    !destination.hostname.endsWith('.aivencloud.com')
  ) {
    throw new Error(
      'A URL de destino nao parece ser da Aiven. Use --allow-non-aiven-host se isso for intencional.'
    );
  }

  if (!['require', 'verify-ca', 'verify-full'].includes(sslmode)) {
    throw new Error(
      'A URL da Aiven precisa incluir sslmode=require, verify-ca ou verify-full.'
    );
  }
}

function prismaFor(url) {
  return new PrismaClient({
    datasources: {
      db: {
        url
      }
    }
  });
}

async function runPrismaMigrateDeploy(destinationUrl) {
  await new Promise((resolve, reject) => {
    const isWindows = process.platform === 'win32';
    const command = isWindows ? 'cmd.exe' : 'npx';
    const commandArgs = isWindows
      ? ['/d', '/s', '/c', 'npx prisma migrate deploy']
      : ['prisma', 'migrate', 'deploy'];
    const child = spawn(command, commandArgs, {
      env: {
        ...process.env,
        DATABASE_URL: destinationUrl
      },
      stdio: 'inherit'
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`prisma migrate deploy falhou com codigo ${code}`));
    });
  });
}

async function getCounts(prisma) {
  const entries = await Promise.all(
    TABLES.map(async (item) => [
      item.label,
      await prisma[item.model].count()
    ])
  );

  return Object.fromEntries(entries);
}

function printCounts(title, counts) {
  console.log(`\n${title}`);
  TABLES.forEach((item) => {
    console.log(`- ${item.label}: ${counts[item.label]}`);
  });
}

async function ensureDestinationIsEmpty(destination) {
  const counts = await getCounts(destination);
  const occupied = TABLES.filter((item) => counts[item.label] > 0);

  if (occupied.length > 0) {
    printCounts('Dados encontrados no destino:', counts);
    throw new Error(
      'Aiven ja tem dados nas tabelas da aplicacao. Use uma base vazia para evitar duplicidade.'
    );
  }
}

async function copyInBatches(destinationModel, rows) {
  const batchSize = 500;

  for (let index = 0; index < rows.length; index += batchSize) {
    const batch = rows.slice(index, index + batchSize);
    await destinationModel.createMany({
      data: batch
    });
  }
}

async function copyTable(source, destination, table) {
  const rows = await source[table.model].findMany({
    orderBy: {
      id: 'asc'
    }
  });

  if (rows.length === 0) {
    console.log(`- ${table.label}: 0`);
    return;
  }

  await copyInBatches(destination[table.model], rows);
  console.log(`- ${table.label}: ${rows.length}`);
}

async function resetSequence(destination, table) {
  const quotedTable = `"${table.table}"`;
  const tableLiteral = `'${quotedTable}'`;

  await destination.$executeRawUnsafe(`
    SELECT setval(
      pg_get_serial_sequence(${tableLiteral}, 'id'),
      COALESCE((SELECT MAX(id) FROM ${quotedTable}), 1),
      (SELECT COUNT(*) FROM ${quotedTable}) > 0
    )
  `);
}

async function copyData(source, destination) {
  console.log('\nCopiando dados para a Aiven...');

  for (const table of TABLES) {
    await copyTable(source, destination, table);
  }

  console.log('\nAjustando sequencias de IDs...');
  for (const table of TABLES) {
    await resetSequence(destination, table);
  }
}

async function main() {
  const dryRun = hasFlag('--dry-run');
  const schemaOnly = hasFlag('--schema-only');
  const dataOnly = hasFlag('--data-only');
  const { sourceUrl, destinationUrl } = resolveUrls();

  validateUrls(sourceUrl, destinationUrl);

  console.log('Origem:', maskUrl(sourceUrl));
  console.log('Destino:', maskUrl(destinationUrl));

  if (dryRun) {
    const source = prismaFor(sourceUrl);
    try {
      printCounts('Dados na origem:', await getCounts(source));
    } finally {
      await source.$disconnect();
    }

    console.log('\nDry run concluido. Nenhuma alteracao foi feita.');
    return;
  }

  if (!dataOnly) {
    console.log('\nAplicando migrations do Prisma na Aiven...');
    await runPrismaMigrateDeploy(destinationUrl);
  }

  if (schemaOnly) {
    console.log('\nSchema criado/atualizado na Aiven.');
    return;
  }

  const source = prismaFor(sourceUrl);
  const destination = prismaFor(destinationUrl);

  try {
    printCounts('Dados na origem:', await getCounts(source));
    await ensureDestinationIsEmpty(destination);
    await copyData(source, destination);
    printCounts('Dados finais na Aiven:', await getCounts(destination));
  } finally {
    await Promise.all([
      source.$disconnect(),
      destination.$disconnect()
    ]);
  }
}

main().catch((error) => {
  console.error('\nMigracao cancelada.');
  console.error(error.message);
  process.exitCode = 1;
});
