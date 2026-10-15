const router = require('express').Router();
const { authenticate, verifyAdmin } = require('../middleware/auth');
const ctrl = require('../controllers/analyticsController');

// *** ALL analytics routes: Admin-only ***
router.use(authenticate);
router.use(verifyAdmin);

router.get('/profit', ctrl.getProfitSummary);
router.get('/top-selling', ctrl.getTopSellingProducts);
router.get('/most-profitable', ctrl.getMostProfitableProducts);
router.get('/dashboard', ctrl.getDashboard);

module.exports = router;
