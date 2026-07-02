const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { getAllServices, createService, updateService, deleteService } = require('../controllers/serviceController');

router.use(auth);
router.get('/', getAllServices);
router.post('/', createService);
router.put('/:id', updateService);
router.delete('/:id', deleteService);

module.exports = router;
