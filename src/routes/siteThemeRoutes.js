const router = require('express').Router();
const { requireAuth, requireManager } = require('../middleware/auth');
const controller = require('../controllers/siteThemeController');
router.get('/site/themes', controller.read);
router.get('/admin/blog/themes', requireAuth, controller.read);
router.put('/admin/blog/themes/:scope', requireAuth, requireManager, controller.update);
module.exports = router;
