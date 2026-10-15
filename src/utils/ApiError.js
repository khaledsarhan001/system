/**
 * Custom operational error class.
 * Marks errors as operational so the error handler can distinguish
 * expected failures from unexpected programming bugs.
 */
class ApiError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = ApiError;
