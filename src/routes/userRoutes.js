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
  requireAdmin,
  userController.create
);

router.put(
  '/users/:id',
  requireAuth,
  requireAdmin,
  userController.update
);

router.delete(
  '/users/:id',
  requireAuth,
  requireAdmin,
  userController.delete
);

module.exports = router;
