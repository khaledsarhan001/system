const Joi = require('joi');

const registerSchema = Joi.object({
  name: Joi.string().trim().max(100).required(),
  email: Joi.string().email().lowercase().trim().required(),
  password: Joi.string().min(8).max(128).required(),
  role: Joi.string().valid('admin', 'employee').default('employee'),
});

const loginSchema = Joi.object({
  email: Joi.string().email().lowercase().trim().required(),
  password: Joi.string().required(),
});

const updateUserSchema = Joi.object({
  name: Joi.string().trim().max(100),
  email: Joi.string().email().lowercase().trim(),
  isActive: Joi.boolean(),
}).min(1);

module.exports = { registerSchema, loginSchema, updateUserSchema };
