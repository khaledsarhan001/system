const Joi = require('joi');

const transactionItemSchema = Joi.object({
  product: Joi.string().hex().length(24).required(), // MongoDB ObjectId
  size: Joi.string().required(),
  color: Joi.string().required(),
  quantity: Joi.number().integer().min(1).required(),
});

const createSaleSchema = Joi.object({
  items: Joi.array().items(transactionItemSchema).min(1).required(),
});

const createReturnSchema = Joi.object({
  items: Joi.array().items(transactionItemSchema).min(1).required(),
  returnReason: Joi.string().trim().max(500).required(),
  relatedTransaction: Joi.string().hex().length(24).required(),
});

module.exports = { createSaleSchema, createReturnSchema };
