const ApiError = require('../utils/ApiError');

/**
 * Central error handler for all Express errors.
 * Differentiates operational errors from unexpected ones.
 */
const errorHandler = (err, _req, res, _next) => {
  let error = { ...err, message: err.message };

  // ─── Mongoose Bad ObjectId ──────────────────────────────────────
  if (err.name === 'CastError') {
    error = new ApiError(`Resource not found (invalid ID: ${err.value})`, 400);
  }

  // ─── Mongoose Duplicate Key ─────────────────────────────────────
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue).join(', ');
    error = new ApiError(`Duplicate value for field(s): ${field}`, 409);
  }

  // ─── Mongoose Validation Error ──────────────────────────────────
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map((e) => e.message);
    error = new ApiError(messages.join('. '), 400);
  }

  // ─── JWT Errors ─────────────────────────────────────────────────
  if (err.name === 'JsonWebTokenError') {
    error = new ApiError('Invalid token. Please log in again.', 401);
  }
  if (err.name === 'TokenExpiredError') {
    error = new ApiError('Token expired. Please log in again.', 401);
  }

  const statusCode = error.statusCode || 500;

  res.status(statusCode).json({
    success: false,
    message: error.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

module.exports = errorHandler;
