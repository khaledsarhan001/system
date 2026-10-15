const ApiError = require('../utils/ApiError');

/**
 * Factory that creates an Express middleware to validate req.body
 * against a Joi schema.
 *
 * @param {import('joi').ObjectSchema} schema - Joi validation schema
 * @returns {import('express').RequestHandler}
 */
const validate = (schema) => (req, _res, next) => {
  const { error, value } = schema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    const messages = error.details.map((d) => d.message).join('. ');
    return next(new ApiError(messages, 400));
  }

  req.body = value; // Use sanitised values
  next();
};

module.exports = validate;
