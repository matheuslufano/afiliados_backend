const express = require('express');

const sgpController = require('../controllers/sgpController');

const router = express.Router();

router.post(
  '/integrations/sgp/sale',
  (req, res) => sgpController.sale(req, res)
);

router.post(
  '/integrations/sgp/pre-cadastro',
  (req, res) => sgpController.preCadastro(req, res)
);

router.post(
  '/integrations/sgp/crm/cliente',
  (req, res) => sgpController.crmClient(req, res)
);

router.post(
  '/integrations/sgp/crm/contrato',
  (req, res) => sgpController.crmContract(req, res)
);

module.exports = router;
