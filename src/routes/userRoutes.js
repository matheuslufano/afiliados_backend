const express = require('express');
const userController = require('../controllers/userController');

const router = express.Router();

router.get(
  '/users',
  userController.list
);

router.post(
  '/users',
  userController.create
);

router.put(
  '/users/:id',
  userController.update
);

router.delete(
  '/users/:id',
  userController.delete
);

module.exports = router;
