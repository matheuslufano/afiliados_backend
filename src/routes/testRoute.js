const express = require('express');
const router = express.Router();

const prisma = require('../database/prisma');

router.get('/test-db', async (req, res) => {
  try {
    const users = await prisma.user.findMany();

    res.json(users);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: 'Erro ao conectar com banco'
    });
  }
});

module.exports = router;