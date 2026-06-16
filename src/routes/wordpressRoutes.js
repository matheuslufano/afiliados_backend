const express = require('express');
const router = express.Router();

const wordpressController = require('../controllers/wordpressController');

router.get(
  '/wordpress/landing.js',
  wordpressController.landingScript
);

module.exports = router;
