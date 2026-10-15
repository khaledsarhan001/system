const router = require('express').Router();
const { authenticate, verifyAdmin } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { createProductSchema, updateProductSchema } = require('../validators/productValidator');
const ctrl = require('../controllers/productController');

// All product routes require authentication
router.use(authenticate);

router
  .route('/')
  .get(ctrl.getProducts)
  .post(verifyAdmin, validate(createProductSchema), ctrl.createProduct);

router
  .route('/:id')
  .get(ctrl.getProduct)
  .put(verifyAdmin, validate(updateProductSchema), ctrl.updateProduct)
  .delete(verifyAdmin, ctrl.deleteProduct);

router.patch('/:id/stock', verifyAdmin, ctrl.updateStock);

module.exports = router;
