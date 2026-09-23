const prisma = require('../src/database/prisma');

async function main() {
  const links = await prisma.link.findMany({
    select: { id: true, shortCode: true, originalUrl: true, active: true },
    orderBy: { id: 'asc' }
  });
  const invalid = links.filter((link) => {
    try {
      const url = new URL(link.originalUrl);
      return url.protocol !== 'https:' || !url.hostname;
    } catch {
      return true;
    }
  });
  console.log(JSON.stringify({ total: links.length, invalidCount: invalid.length, invalid }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
