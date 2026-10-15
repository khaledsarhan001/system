const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { createSaleSchema, createReturnSchema } = require('../validators/transactionValidator');
const ctrl = require('../controllers/transactionController');

// All transaction routes require authentication
router.use(authenticate);

router.get('/', ctrl.getTransactions);
router.get('/:id', ctrl.getTransaction);

router.post('/sale', validate(createSaleSchema), ctrl.createSale);
router.post('/return', validate(createReturnSchema), ctrl.createReturn);

module.exports = router;
