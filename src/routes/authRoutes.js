const express = require('express');
const authController = require('../controllers/authController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/auth/me', requireAuth, authController.me);

router.post(
  '/auth/login',
  authController.login
);

module.exports = router;
