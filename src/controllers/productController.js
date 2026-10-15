const Product = require('../models/Product');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');

// ─── POST /api/v1/products ────────────────────────────────────────
exports.createProduct = asyncHandler(async (req, res) => {
  const product = await Product.create(req.body);

  // Return the full product (including costPrice) only to admin
  const data =
    req.user.role === 'admin'
      ? await Product.findById(product._id).select('+costPrice')
      : product;

  res.status(201).json({ success: true, data });
});

// ─── GET /api/v1/products ─────────────────────────────────────────
exports.getProducts = asyncHandler(async (req, res) => {
  const {
    category, search, minPrice, maxPrice,
    page = 1, limit = 25, sort = '-createdAt',
  } = req.query;

  // Build filter
  const filter = { isActive: true };
  if (category) filter.category = category;
  if (minPrice || maxPrice) {
    filter.retailPrice = {};
    if (minPrice) filter.retailPrice.$gte = parseFloat(minPrice);
    if (maxPrice) filter.retailPrice.$lte = parseFloat(maxPrice);
  }
  if (search) {
    filter.$text = { $search: search };
  }

  const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
  const total = await Product.countDocuments(filter);

  // Admin sees costPrice; employees do not
  let query = Product.find(filter);
  if (req.user.role === 'admin') {
    query = query.select('+costPrice');
  }

  const products = await query
    .sort(sort)
    .skip(skip)
    .limit(parseInt(limit, 10));

  res.status(200).json({
    success: true,
    count: products.length,
    total,
    page: parseInt(page, 10),
    pages: Math.ceil(total / parseInt(limit, 10)),
    data: products,
  });
});

// ─── GET /api/v1/products/:id ─────────────────────────────────────
exports.getProduct = asyncHandler(async (req, res) => {
  let query = Product.findById(req.params.id);
  if (req.user.role === 'admin') {
    query = query.select('+costPrice');
  }

  const product = await query;
  if (!product) throw new ApiError('Product not found.', 404);

  res.status(200).json({ success: true, data: product });
});

// ─── PUT /api/v1/products/:id ─────────────────────────────────────
exports.updateProduct = asyncHandler(async (req, res) => {
  // Employees must not update costPrice
  if (req.user.role !== 'admin') {
    delete req.body.costPrice;
  }

  let product = await Product.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });

  if (!product) throw new ApiError('Product not found.', 404);

  // Re-fetch with costPrice for admin
  if (req.user.role === 'admin') {
    product = await Product.findById(product._id).select('+costPrice');
  }

  res.status(200).json({ success: true, data: product });
});

// ─── PATCH /api/v1/products/:id/stock ─── Quick stock adjustment ──
exports.updateStock = asyncHandler(async (req, res) => {
  const { adjustment } = req.body; // positive to add, negative to subtract

  if (adjustment == null || typeof adjustment !== 'number') {
    throw new ApiError('Provide a numeric "adjustment" value.', 400);
  }

  const product = await Product.findById(req.params.id);
  if (!product) throw new ApiError('Product not found.', 404);

  const newQty = product.quantity + adjustment;
  if (newQty < 0) {
    throw new ApiError(
      `Insufficient stock. Current: ${product.quantity}, requested adjustment: ${adjustment}`,
      400
    );
  }

  product.quantity = newQty;
  await product.save();

  res.status(200).json({ success: true, data: product });
});

// ─── DELETE /api/v1/products/:id ─── Soft delete ──────────────────
exports.deleteProduct = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) throw new ApiError('Product not found.', 404);

  product.isActive = false;
  await product.save();

  res.status(200).json({ success: true, message: 'Product deactivated.' });
});
