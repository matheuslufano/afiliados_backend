const express = require('express');
const { requireAuth } = require('../middleware/auth');
const controller = require('../controllers/contactController');

const router = express.Router();
router.use('/agenda/contacts', requireAuth);
router.get('/agenda/contacts', controller.list);
router.post('/agenda/contacts', controller.create);
router.get('/agenda/contacts/:id', controller.detail);
router.put('/agenda/contacts/:id', controller.update);
router.delete('/agenda/contacts/:id', controller.remove);
router.post('/agenda/contacts/:id/interactions', controller.interaction);
router.post('/agenda/contacts/:id/appointments', controller.appointment);
router.put('/agenda/contacts/:id/appointments/:appointmentId', controller.updateAppointment);
router.delete('/agenda/contacts/:id/appointments/:appointmentId', controller.removeAppointment);

module.exports = router;
