const express = require('express');
const router = express.Router();

const crmController = require('../controllers/crmController');
const savedFilterController = require('../controllers/crmSavedFilterController');
const { requireAuth, requireManager } = require('../middleware/auth');

router.use('/crm', requireAuth);
router.get('/crm/deals', crmController.listDeals);
router.post('/crm/funnels', requireManager, crmController.createFunnel);
router.post('/crm/deals', crmController.createDeal);
router.put('/crm/deals/:id', crmController.updateDeal);
router.delete('/crm/deals/:id', crmController.deleteDeal);
router.put('/crm/deals/:id/responsible', crmController.transferDeal);
router.get('/crm/assignable-users', crmController.listAssignableUsers);
router.post('/crm/sync-conversions', requireManager, crmController.syncConversions);
router.post('/crm/stages', requireManager, crmController.createStage);
router.put('/crm/stages/:id', requireManager, crmController.updateStage);
router.delete('/crm/stages/:id', requireManager, crmController.deleteStage);
router.get('/crm/saved-filters', savedFilterController.list);
router.post('/crm/saved-filters', savedFilterController.create);
router.put('/crm/saved-filters/:id', savedFilterController.update);
router.post('/crm/saved-filters/:id/duplicate', savedFilterController.duplicate);
router.delete('/crm/saved-filters/:id', savedFilterController.remove);
router.put('/crm/saved-filters/:id/default', savedFilterController.setDefault);

module.exports = router;
