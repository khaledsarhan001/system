const Joi = require('joi');

const registerSchema = Joi.object({
  name: Joi.string().trim().max(100).required(),
  email: Joi.string().email().lowercase().trim().required(),
  username: Joi.string().trim().min(2).max(50),
  password: Joi.string().min(6).max(128).required(),
  role: Joi.string().valid('admin', 'employee').default('employee'),
  phone: Joi.string().allow('', null),
  address: Joi.string().allow('', null),
  branch: Joi.string().allow('', null),
});

const loginSchema = Joi.object({
  email: Joi.string().trim(),
  username: Joi.string().trim(),
  identifier: Joi.string().trim(),
  loginIdentifier: Joi.string().trim(),
  password: Joi.string().required(),
}).or('email', 'username', 'identifier', 'loginIdentifier');

const updateUserSchema = Joi.object({
  name: Joi.string().trim().max(100),
  email: Joi.string().email().lowercase().trim(),
  phone: Joi.string().allow('', null),
  address: Joi.string().allow('', null),
  branch: Joi.string().allow('', null),
  role: Joi.string().valid('admin', 'employee'),
  isActive: Joi.boolean(),
}).min(1);

module.exports = { registerSchema, loginSchema, updateUserSchema };
