const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { createProductSchema, updateProductSchema } = require('../validators/productValidator');
const ctrl = require('../controllers/productController');

// All product routes require authentication
router.use(authenticate);

router
  .route('/')
  .get(ctrl.getProducts)
  .post(validate(createProductSchema), ctrl.createProduct);

router
  .route('/:id')
  .get(ctrl.getProduct)
  .put(validate(updateProductSchema), ctrl.updateProduct)
  .delete(ctrl.deleteProduct);

router.patch('/:id/stock', ctrl.updateStock);

module.exports = router;
