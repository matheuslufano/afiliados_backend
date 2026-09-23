const express = require('express');
const campaignController = require('../controllers/campaignController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.post(
  '/campaigns',
  requireAuth,
  campaignController.create
);

router.get(
  '/campaigns',
  requireAuth,
  campaignController.list
);

router.put(
  '/campaigns/:id',
  requireAuth,
  campaignController.update
);

router.delete(
  '/campaigns/:id',
  requireAuth,
  campaignController.delete
);

module.exports = router;
