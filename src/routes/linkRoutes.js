const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');

const linkController = require(
  '../controllers/linkController'
);

router.get(
  '/affiliate/:id/stats',
  linkController.affiliateStats
);

router.get(
  '/links',
  linkController.list
);

router.get(
  '/contacts',
  requireAuth,
  linkController.contacts
);

router.put(
  '/contacts/:id',
  requireAuth,
  linkController.updateContact
);

router.delete(
  '/contacts/:id',
  requireAuth,
  linkController.deleteContact
);

router.post(
  '/links',
  linkController.create
);

router.put(
  '/links/:id',
  linkController.update
);

router.delete(
  '/links/:id',
  linkController.delete
);

router.put(
  '/conversions/:id',
  linkController.updateConversion
);

router.delete(
  '/conversions/:id',
  linkController.deleteConversion
);

router.get(
  '/links/:shortCode/whatsapp/:linkSlug',
  linkController.whatsapp
);

router.post(
  '/links/:shortCode/whatsapp/:linkSlug',
  linkController.whatsapp
);

router.get(
  '/links/:shortCode/whatsapp',
  linkController.whatsapp
);

router.post(
  '/links/:shortCode/whatsapp',
  linkController.whatsapp
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
