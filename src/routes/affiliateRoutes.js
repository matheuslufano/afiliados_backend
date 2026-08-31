const express = require('express');

const router = express.Router();
const { requireAuth } = require('../middleware/auth');

const affiliateController =
  require(
    '../controllers/affiliateController'
  );

router.post(
  '/affiliate',
  requireAuth,
  affiliateController.create
);

router.get(
  '/affiliate',
  affiliateController.list
);

router.put(
  '/affiliate/:id',
  requireAuth,
  affiliateController.update
);

router.delete(
  '/affiliate/:id',
  affiliateController.delete
);

module.exports = router;
