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
const chatmixIntegrationRoutes = require('./routes/chatmixIntegrationRoutes');
const sgpRoutes = require('./routes/sgpRoutes');
const wordpressRoutes = require('./routes/wordpressRoutes');
const eventRoutes = require('./routes/eventRoutes');
const crmRoutes = require('./routes/crmRoutes');
const whatsappLinkRoutes = require('./routes/whatsappLinkRoutes');
const contactRoutes = require('./routes/contactRoutes');
const maintenanceRoutes = require('./routes/maintenanceRoutes');
const clickRoutes = require('./routes/clickRoutes');
const blogRoutes = require('./routes/blogRoutes');
const { prismaStudioRoute } = require('./routes/prismaStudioRoute');

const app = express();

app.set('trust proxy', true);

app.use(cors());
app.use(prismaStudioRoute);
app.use(express.json({ limit: '5mb' }));

app.use(testRoute);
app.use(linkRoutes);
app.use(affiliateRoutes);
app.use(dashboardRoutes);
app.use(cityRoutes);
app.use(authRoutes);
app.use(campaignRoutes);
app.use(userRoutes);
app.use(chatmixWebhookRoutes);
app.use(chatmixIntegrationRoutes);
app.use(sgpRoutes);
app.use(wordpressRoutes);
app.use(eventRoutes);
app.use(crmRoutes);
app.use(whatsappLinkRoutes);
app.use(contactRoutes);
app.use(maintenanceRoutes);
app.use(clickRoutes);
app.use(blogRoutes);
app.use(require('./routes/blogMediaRoutes'));
app.use(require('./routes/blogAdminRoutes'));
app.use(require('./routes/blogAnalyticsRoutes'));

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
