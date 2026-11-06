const express = require('express');
const blogController = require('../controllers/blogController');

const router = express.Router();

// Editorial reading is public; creation and approval remain an import workflow.
router.get('/blog/articles', blogController.list);
router.get('/blog/articles/:slug', blogController.detail);

module.exports = router;
