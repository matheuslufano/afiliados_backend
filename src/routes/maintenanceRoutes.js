const express = require('express');
const controller = require('../controllers/maintenanceController');
const { requireAdmin, requireAuth } = require('../middleware/auth');

const router = express.Router();

router.post('/admin/maintenance/purge-links', requireAuth, requireAdmin, controller.purgeLinks);
router.post('/admin/maintenance/purge-crm', requireAuth, requireAdmin, controller.purgeCrm);
router.post('/admin/maintenance/purge-database', requireAuth, requireAdmin, controller.purgeDatabase);
router.post('/admin/prisma-studio-session', requireAuth, requireAdmin, controller.createPrismaStudioSession);

module.exports = router;
