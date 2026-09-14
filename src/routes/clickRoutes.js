const express = require('express');
const { requireAuth, requireManager } = require('../middleware/auth');
const controller = require('../controllers/clickController');

const router = express.Router();

router.get('/clicks/metrics', requireAuth, requireManager, controller.metrics);
router.get('/clicks/timeline', requireAuth, requireManager, controller.timeline);
router.get('/clicks/ranking', requireAuth, requireManager, controller.ranking);
router.get('/clicks/export', requireAuth, requireManager, controller.export);
router.get('/clicks/:id', requireAuth, requireManager, controller.details);
router.get('/clicks', requireAuth, requireManager, controller.list);

module.exports = router;
