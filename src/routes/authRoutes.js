const router = require('express').Router();
const { authenticate, verifyAdmin } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { registerSchema, loginSchema, updateUserSchema } = require('../validators/authValidator');
const ctrl = require('../controllers/authController');

// ─── Public ───────────────────────────────────────────────────────
router.post('/login', validate(loginSchema), ctrl.login);

// ─── Authenticated ────────────────────────────────────────────────
router.use(authenticate); // All routes below require auth

router.get('/me', ctrl.getMe);

// ─── Admin Only ───────────────────────────────────────────────────
router.post('/register', verifyAdmin, validate(registerSchema), ctrl.register);
router.get('/users', verifyAdmin, ctrl.getUsers);
router.put('/users/:id', verifyAdmin, validate(updateUserSchema), ctrl.updateUser);
router.patch('/users/:id/deactivate', verifyAdmin, ctrl.deactivateUser);
router.delete('/users/:id', verifyAdmin, ctrl.deleteUser);

module.exports = router;
