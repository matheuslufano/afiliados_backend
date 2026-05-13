const express = require('express');

const router = express.Router();

const affiliateController =
  require(
    '../controllers/affiliateController'
  );

router.post(
  '/affiliate',
  affiliateController.create
);

router.get(
  '/affiliate',
  affiliateController.list
);

router.put(
  '/affiliate/:id',
  affiliateController.update
);

router.delete(
  '/affiliate/:id',
  affiliateController.delete
);

module.exports = router;