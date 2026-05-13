const express = require('express');
const cors = require('cors');

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
  res.send('API Affiliate funcionando');
});

module.exports = app;