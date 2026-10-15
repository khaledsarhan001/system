const mongoose = require('mongoose');
const Transaction = require('../models/Transaction');
const Product = require('../models/Product');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');

// ─── POST /api/v1/transactions/sale ───────────────────────────────
exports.createSale = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { items } = req.body;
    const transactionItems = [];
    let totalAmount = 0;

    for (const item of items) {
      // Fetch product WITH costPrice for snapshotting
      const product = await Product.findById(item.product)
        .select('+costPrice')
        .session(session);

      if (!product || !product.isActive) {
        throw new ApiError(`Product ${item.product} not found or inactive.`, 404);
      }

      // Validate stock
      if (product.quantity < item.quantity) {
        throw new ApiError(
          `Insufficient stock for "${product.name}". Available: ${product.quantity}, requested: ${item.quantity}`,
          400
        );
      }

      // Deduct stock
      product.quantity -= item.quantity;
      await product.save({ session });

      // Build snapshotted item record
      const lineTotal = product.retailPrice * item.quantity;
      totalAmount += lineTotal;

      transactionItems.push({
        product: product._id,
        productName: product.name,
        sku: product.sku,
        size: item.size,
        color: item.color,
        quantity: item.quantity,
        costPriceAtSale: product.costPrice,     // Snapshotted
        retailPriceAtSale: product.retailPrice,  // Snapshotted
      });
    }

    const [transaction] = await Transaction.create(
      [
        {
          type: 'sale',
          employee: req.user._id,
          items: transactionItems,
          totalAmount: parseFloat(totalAmount.toFixed(2)),
        },
      ],
      { session }
    );

    await session.commitTransaction();

    // Strip costPriceAtSale for non-admin response
    const responseData = await Transaction.findById(transaction._id)
      .populate('employee', 'name email');

    // If admin, re-fetch with cost prices
    if (req.user.role === 'admin') {
      const fullData = await Transaction.findById(transaction._id)
        .select('+items.costPriceAtSale')
        .populate('employee', 'name email');
      return res.status(201).json({ success: true, data: fullData });
    }

    res.status(201).json({ success: true, data: responseData });
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
});

// ─── POST /api/v1/transactions/return ─────────────────────────────
exports.createReturn = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { items, returnReason, relatedTransaction } = req.body;

    // Validate original transaction exists
    const originalTx = await Transaction.findById(relatedTransaction).session(session);
    if (!originalTx || originalTx.type !== 'sale') {
      throw new ApiError('Related sale transaction not found.', 404);
    }

    const transactionItems = [];
    let totalAmount = 0;

    for (const item of items) {
      const product = await Product.findById(item.product)
        .select('+costPrice')
        .session(session);

      if (!product) {
        throw new ApiError(`Product ${item.product} not found.`, 404);
      }

      // Restock
      product.quantity += item.quantity;
      await product.save({ session });

      // Find the original sale item to snapshot the same prices
      const originalItem = originalTx.items.find(
        (oi) => oi.product.toString() === item.product
      );

      const retailAtSale = originalItem
        ? originalItem.retailPriceAtSale
        : product.retailPrice;

      // For costPriceAtSale on the original, we need to re-fetch with select
      const originalTxFull = await Transaction.findById(relatedTransaction)
        .select('+items.costPriceAtSale')
        .session(session);
      const originalItemFull = originalTxFull.items.find(
        (oi) => oi.product.toString() === item.product
      );
      const costAtSale = originalItemFull
        ? originalItemFull.costPriceAtSale
        : product.costPrice;

      const lineTotal = retailAtSale * item.quantity;
      totalAmount += lineTotal;

      transactionItems.push({
        product: product._id,
        productName: product.name,
        sku: product.sku,
        size: item.size,
        color: item.color,
        quantity: item.quantity,
        costPriceAtSale: costAtSale,
        retailPriceAtSale: retailAtSale,
      });
    }

    const [transaction] = await Transaction.create(
      [
        {
          type: 'return',
          employee: req.user._id,
          items: transactionItems,
          totalAmount: parseFloat(totalAmount.toFixed(2)),
          returnReason,
          relatedTransaction,
        },
      ],
      { session }
    );

    await session.commitTransaction();

    const responseData = await Transaction.findById(transaction._id)
      .populate('employee', 'name email');

    res.status(201).json({ success: true, data: responseData });
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
});

// ─── GET /api/v1/transactions ─────────────────────────────────────
exports.getTransactions = asyncHandler(async (req, res) => {
  const {
    type, employee, startDate, endDate,
    page = 1, limit = 25, sort = '-createdAt',
  } = req.query;

  const filter = {};
  if (type) filter.type = type;
  if (employee) filter.employee = employee;
  if (startDate || endDate) {
    filter.createdAt = {};
    if (startDate) filter.createdAt.$gte = new Date(startDate);
    if (endDate) filter.createdAt.$lte = new Date(endDate);
  }

  const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
  const total = await Transaction.countDocuments(filter);

  let query = Transaction.find(filter)
    .populate('employee', 'name email');

  // Admin can see cost prices in transaction history
  if (req.user.role === 'admin') {
    query = query.select('+items.costPriceAtSale');
  }

  const transactions = await query
    .sort(sort)
    .skip(skip)
    .limit(parseInt(limit, 10));

  res.status(200).json({
    success: true,
    count: transactions.length,
    total,
    page: parseInt(page, 10),
    pages: Math.ceil(total / parseInt(limit, 10)),
    data: transactions,
  });
});

// ─── GET /api/v1/transactions/:id ─────────────────────────────────
exports.getTransaction = asyncHandler(async (req, res) => {
  let query = Transaction.findById(req.params.id)
    .populate('employee', 'name email')
    .populate('relatedTransaction');

  if (req.user.role === 'admin') {
    query = query.select('+items.costPriceAtSale');
  }

  const transaction = await query;
  if (!transaction) throw new ApiError('Transaction not found.', 404);

  res.status(200).json({ success: true, data: transaction });
});
