const express = require('express');

const chatmixWebhookController = require(
  '../controllers/chatmixWebhookController'
);

const router = express.Router();

router.post(
  '/webhooks/chatmix',
  chatmixWebhookController.receive
);

module.exports = router;
