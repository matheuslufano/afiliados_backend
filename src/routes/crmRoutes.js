const express = require('express');
const router = express.Router();

const crmController = require('../controllers/crmController');

router.get('/crm/deals', crmController.listDeals);
router.post('/crm/sync-conversions', crmController.syncConversions);
router.post('/crm/stages', crmController.createStage);
router.put('/crm/stages/:id', crmController.updateStage);
router.delete('/crm/stages/:id', crmController.deleteStage);
router.put('/crm/deals/:id', crmController.updateDeal);

module.exports = router;
