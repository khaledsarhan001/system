const mongoose = require('mongoose');

// ─── Transaction Item Sub-Schema ──────────────────────────────────
const transactionItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: [true, 'Product reference is required'],
    },
    productName: {
      type: String,
      required: true, // Denormalized for historical record
    },
    sku: {
      type: String,
      required: true,
    },
    size: {
      type: String,
      required: [true, 'Size is required for each item'],
    },
    color: {
      type: String,
      required: [true, 'Color is required for each item'],
    },
    quantity: {
      type: Number,
      required: [true, 'Quantity is required'],
      min: [1, 'Quantity must be at least 1'],
    },
    // *** Snapshotted at transaction time for accurate historical profit ***
    costPriceAtSale: {
      type: Number,
      required: true,
      select: false, // Hidden from non-admin queries
    },
    retailPriceAtSale: {
      type: Number,
      required: true,
    },
  },
  { _id: false }
);

// ─── Main Transaction Schema ──────────────────────────────────────
const transactionSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      required: [true, 'Transaction type is required'],
      enum: {
        values: ['sale', 'return'],
        message: 'Type must be either sale or return',
      },
    },
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Employee reference is required'],
    },
    items: {
      type: [transactionItemSchema],
      required: true,
      validate: {
        validator: (v) => v.length > 0,
        message: 'Transaction must contain at least one item',
      },
    },
    totalAmount: {
      type: Number,
      required: true,
      min: [0, 'Total amount cannot be negative'],
    },
    // ─── Return-specific fields ────────────────────────────────────
    returnReason: {
      type: String,
      trim: true,
      maxlength: [500, 'Return reason cannot exceed 500 characters'],
      // Required only for returns (validated in controller)
    },
    relatedTransaction: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Transaction',
      // Reference to the original sale when processing a return
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ─── Indexes ───────────────────────────────────────────────────────
transactionSchema.index({ type: 1, createdAt: -1 });
transactionSchema.index({ employee: 1 });
transactionSchema.index({ createdAt: -1 });
transactionSchema.index({ 'items.product': 1 });

module.exports = mongoose.model('Transaction', transactionSchema);
