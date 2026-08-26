const express = require('express');

const chatmixWebhookController = require(
  '../controllers/chatmixWebhookController'
);
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get(
  '/webhooks/chatmix/logs',
  requireAuth,
  chatmixWebhookController.listLogs
);

router.all(
  '/webhooks/chatmix',
  chatmixWebhookController.receive
);

module.exports = router;
