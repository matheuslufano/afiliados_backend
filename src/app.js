const express = require('express');
const cors = require('cors');

const prisma = require('./database/prisma');
const testRoute = require('./routes/testRoute');
const linkRoutes = require('./routes/linkRoutes');
const affiliateRoutes = require('./routes/affiliateRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const cityRoutes = require('./routes/cityRoutes');
const authRoutes = require('./routes/authRoutes');
const campaignRoutes = require('./routes/campaignRoutes');
const userRoutes = require('./routes/userRoutes');
const chatmixWebhookRoutes = require('./routes/chatmixWebhookRoutes');
const sgpRoutes = require('./routes/sgpRoutes');
const wordpressRoutes = require('./routes/wordpressRoutes');
const eventRoutes = require('./routes/eventRoutes');

const app = express();

app.set('trust proxy', true);

app.use(cors());
app.use(express.json());

app.use(testRoute);
app.use(linkRoutes);
app.use(affiliateRoutes);
app.use(dashboardRoutes);
app.use(cityRoutes);
app.use(authRoutes);
app.use(campaignRoutes);
app.use(userRoutes);
app.use(chatmixWebhookRoutes);
app.use(sgpRoutes);
app.use(wordpressRoutes);
app.use(eventRoutes);

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
