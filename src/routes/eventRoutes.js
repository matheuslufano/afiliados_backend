const express = require('express');
const router = express.Router();

const eventController = require('../controllers/eventController');

router.get('/events', eventController.stream);

module.exports = router;
