const express = require('express');
const router = express.Router();

const prisma = require('../database/prisma');

router.get('/test-db', async (req, res) => {
  try {
    const [totalUsers, totalLinks] = await Promise.all([
      prisma.user.count(),
      prisma.link.count()
    ]);

    res.json({
      database: 'Conectado ✅',
      totalUsers,
      totalLinks
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: 'Erro ao conectar com banco'
    });
  }
});

module.exports = router;