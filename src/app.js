const express = require('express');
const cors = require('cors');

const prisma = require('./database/prisma');
const testRoute = require('./routes/testRoute');
const linkRoutes = require('./routes/linkRoutes');
const affiliateRoutes = require('./routes/affiliateRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');

const app = express();

app.use(cors());
app.use(express.json());

app.use(testRoute);
app.use(linkRoutes);
app.use(affiliateRoutes);
app.use(dashboardRoutes);

app.get('/', (req, res) => {
  res.send('API funcionando 🚀');
});

app.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return res.json({
      status: 'online',
      database: 'ok'
    });
  } catch (error) {
    console.error(error);
    return res.status(503).json({
      status: 'degraded',
      database: 'unavailable'
    });
  }
});

module.exports = app;