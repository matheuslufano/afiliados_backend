require("dotenv").config({ quiet: true });
const prisma = require("../src/database/prisma");
const { purgeAnalytics } = require("../src/services/blogAnalyticsCollection");
purgeAnalytics()
  .then((result) => console.log(`Eventos expirados removidos: ${result.count}`))
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
