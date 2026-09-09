require('dotenv').config();

const app = require('./app');
const { attachPrismaStudioUpgrade } = require('./routes/prismaStudioRoute');

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
  console.log(
    `Servidor rodando na porta ${PORT}`
  );
});

attachPrismaStudioUpgrade(server);
