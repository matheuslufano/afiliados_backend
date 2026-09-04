const express = require('express');
const { requireAuth } = require('../middleware/auth');
const controller = require('../controllers/whatsappLinkController');

const router = express.Router();
router.get('/whatsapp-links/config', requireAuth, controller.config);
router.get('/affiliate-codes', requireAuth, controller.listCodes);
router.get('/whatsapp-links', requireAuth, controller.list);
router.post('/whatsapp-links', requireAuth, controller.create);
router.put('/whatsapp-links/:id', requireAuth, controller.update);
router.patch('/whatsapp-links/:id', requireAuth, controller.update);
router.delete('/whatsapp-links/:id', requireAuth, controller.remove);

module.exports = router;
