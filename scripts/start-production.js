const path = require('path');
const { spawn, spawnSync } = require('child_process');

const prismaCli = path.join(__dirname, '..', 'node_modules', 'prisma', 'build', 'index.js');

function runPrisma(args) {
  const result = spawnSync(process.execPath, [prismaCli, ...args], { stdio: 'inherit', env: process.env });
  if (result.status !== 0) process.exit(result.status || 1);
}

runPrisma(['migrate', 'deploy']);
runPrisma(['generate']);

const studio = spawn(process.execPath, [prismaCli, 'studio', '--hostname', '127.0.0.1', '--port', '5555', '--browser', 'none'], {
  stdio: 'inherit',
  env: { ...process.env, CHECKPOINT_DISABLE: '1' }
});
studio.on('exit', (code) => console.error(`Prisma Studio finalizado (código ${code ?? 'desconhecido'}).`));

function shutdown() {
  if (studio && !studio.killed) studio.kill('SIGTERM');
}

process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);

require('../src/server');
