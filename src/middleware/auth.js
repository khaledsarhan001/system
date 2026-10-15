const jwt = require('jsonwebtoken');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');

/**
 * Authenticate requests via Bearer token.
 * Attaches the full user document (minus password) to req.user.
 */
const authenticate = asyncHandler(async (req, _res, next) => {
  let token;

  if (req.headers.authorization?.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    throw new ApiError('Authentication required. Please provide a valid token.', 401);
  }

  // Verify token
  const decoded = jwt.verify(token, process.env.JWT_SECRET);

  // Fetch user and confirm they are still active
  const user = await User.findById(decoded.id);

  if (!user) {
    throw new ApiError('The user associated with this token no longer exists.', 401);
  }

  if (!user.isActive) {
    throw new ApiError('This account has been deactivated. Contact an administrator.', 403);
  }

  req.user = user;
  next();
});

/**
 * Restrict access to one or more roles.
 * Usage: authorize('admin') or authorize('admin', 'employee')
 */
const authorize = (...roles) => {
  return (req, _res, next) => {
    if (!roles.includes(req.user.role)) {
      throw new ApiError(
        `Role '${req.user.role}' is not authorized to access this resource.`,
        403
      );
    }
    next();
  };
};

/**
 * Convenience middleware: Admin-only gate.
 * Used to protect financial/analytics endpoints.
 */
const verifyAdmin = (req, _res, next) => {
  if (req.user.role !== 'admin') {
    throw new ApiError('Access denied. Admin privileges required.', 403);
  }
  next();
};

module.exports = { authenticate, authorize, verifyAdmin };
