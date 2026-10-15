const mongoose = require('mongoose');

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Product name is required'],
      trim: true,
      maxlength: [200, 'Product name cannot exceed 200 characters'],
    },
    category: {
      type: String,
      required: [true, 'Category is required'],
      trim: true,
      enum: {
        values: [
          'shirts', 'pants', 'dresses', 'jackets', 'coats',
          'skirts', 'shorts', 'activewear', 'underwear',
          'accessories', 'footwear', 'other',
        ],
        message: '{VALUE} is not a supported category',
      },
    },
    sku: {
      type: String,
      required: [true, 'SKU/Barcode is required'],
      unique: true,
      uppercase: true,
      trim: true,
      match: [/^[A-Z0-9-]+$/, 'SKU must contain only uppercase letters, digits, and hyphens'],
    },
    sizes: {
      type: [String],
      required: [true, 'At least one size is required'],
      validate: {
        validator: (v) => v.length > 0,
        message: 'Sizes array must contain at least one size',
      },
      enum: {
        values: ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', 'ONE-SIZE'],
        message: '{VALUE} is not a supported size',
      },
    },
    colors: {
      type: [String],
      required: [true, 'At least one color is required'],
      validate: {
        validator: (v) => v.length > 0,
        message: 'Colors array must contain at least one color',
      },
    },
    costPrice: {
      type: Number,
      required: [true, 'Wholesale cost price is required'],
      min: [0, 'Cost price cannot be negative'],
      select: false, // *** CRITICAL: Hidden from all default queries ***
    },
    retailPrice: {
      type: Number,
      required: [true, 'Retail selling price is required'],
      min: [0, 'Retail price cannot be negative'],
    },
    quantity: {
      type: Number,
      required: [true, 'Stock quantity is required'],
      min: [0, 'Quantity cannot be negative'],
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    description: {
      type: String,
      trim: true,
      maxlength: [1000, 'Description cannot exceed 1000 characters'],
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ─── Indexes ───────────────────────────────────────────────────────
productSchema.index({ sku: 1 }, { unique: true });
productSchema.index({ category: 1 });
productSchema.index({ name: 'text', category: 'text' });

// ─── Virtual: Unit Profit (only meaningful when costPrice is selected) ──
productSchema.virtual('unitProfit').get(function () {
  if (this.costPrice == null) return undefined; // costPrice not loaded
  return parseFloat((this.retailPrice - this.costPrice).toFixed(2));
});

productSchema.virtual('profitMargin').get(function () {
  if (this.costPrice == null || this.retailPrice === 0) return undefined;
  return parseFloat((((this.retailPrice - this.costPrice) / this.retailPrice) * 100).toFixed(2));
});

module.exports = mongoose.model('Product', productSchema);
