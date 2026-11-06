// Resolve the backend environment independently of the terminal's working directory.
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const app = require('./app');
const { attachPrismaStudioUpgrade } = require('./routes/prismaStudioRoute');

const PORT = process.env.PORT || 3000;
require('./services/blogAnalyticsCollection').startAnalyticsRetention();

const server = app.listen(PORT, () => {
  console.log(
    `Servidor rodando na porta ${PORT}`
  );
});

attachPrismaStudioUpgrade(server);
