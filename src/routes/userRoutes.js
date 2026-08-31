const express = require('express');
const userController = require('../controllers/userController');
const { requireAdmin, requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get(
  '/users',
  requireAuth,
  userController.list
);

router.post(
  '/users',
  requireAuth,
  userController.create
);

router.put(
  '/users/:id',
  requireAuth,
  userController.update
);

router.delete(
  '/users/:id',
  requireAuth,
  requireAdmin,
  userController.delete
);

module.exports = router;
