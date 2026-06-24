const express = require('express');

const chatmixWebhookController = require(
  '../controllers/chatmixWebhookController'
);

const router = express.Router();

router.get(
  '/webhooks/chatmix/logs',
  chatmixWebhookController.listLogs
);

router.all(
  '/webhooks/chatmix',
  chatmixWebhookController.receive
);

module.exports = router;
