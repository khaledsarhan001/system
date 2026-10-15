const Joi = require('joi');

const VALID_SIZES = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', 'ONE-SIZE'];
const VALID_CATEGORIES = [
  'shirts', 'pants', 'dresses', 'jackets', 'coats',
  'skirts', 'shorts', 'activewear', 'underwear',
  'accessories', 'footwear', 'other',
];

const createProductSchema = Joi.object({
  name: Joi.string().trim().max(200).required(),
  category: Joi.string().valid(...VALID_CATEGORIES).required(),
  sku: Joi.string().uppercase().trim().pattern(/^[A-Z0-9-]+$/).required(),
  sizes: Joi.array().items(Joi.string().valid(...VALID_SIZES)).min(1).required(),
  colors: Joi.array().items(Joi.string().trim()).min(1).required(),
  costPrice: Joi.number().min(0).required(),
  retailPrice: Joi.number().min(0).required(),
  quantity: Joi.number().integer().min(0).default(0),
  description: Joi.string().trim().max(1000).allow(''),
});

const updateProductSchema = Joi.object({
  name: Joi.string().trim().max(200),
  category: Joi.string().valid(...VALID_CATEGORIES),
  sizes: Joi.array().items(Joi.string().valid(...VALID_SIZES)).min(1),
  colors: Joi.array().items(Joi.string().trim()).min(1),
  costPrice: Joi.number().min(0),
  retailPrice: Joi.number().min(0),
  quantity: Joi.number().integer().min(0),
  description: Joi.string().trim().max(1000).allow(''),
}).min(1);

module.exports = { createProductSchema, updateProductSchema };
