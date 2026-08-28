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

router.put(
  '/campaigns/:id',
  campaignController.update
);

router.delete(
  '/campaigns/:id',
  campaignController.delete
);

module.exports = router;
