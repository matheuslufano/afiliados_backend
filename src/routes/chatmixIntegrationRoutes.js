const express = require('express');

const chatmixIntegrationController = require(
  '../controllers/chatmixIntegrationController'
);
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get(
  '/integrations/chatmix/attendances/:attendanceId/messages',
  requireAuth,
  chatmixIntegrationController.listAttendanceMessages
);

module.exports = router;
