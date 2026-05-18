const express = require('express');
const campaignController = require('../controllers/campaignController');

const router = express.Router();

router.post(
  '/campaigns',
  campaignController.create
);

router.get(
  '/campaigns',
  campaignController.list
);

module.exports = router;
