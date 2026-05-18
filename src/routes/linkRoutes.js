const express = require('express');
const router = express.Router();

const linkController = require(
  '../controllers/linkController'
);

router.get(
  '/affiliate/:id/stats',
  linkController.affiliateStats
);

router.post(
  '/links',
  linkController.create
);

router.delete(
  '/links/:id',
  linkController.delete
);

router.get(
  '/r/:shortCode',
  linkController.redirect
);

router.get(
  '/links/:id/stats',
  linkController.stats
);

module.exports = router;
