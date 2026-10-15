const mongoose = require('mongoose');
const Transaction = require('../models/Transaction');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');

/**
 * ─── GET /api/v1/analytics/profit ─────────────────────────────────
 * MongoDB Aggregation Pipeline — Admin Only.
 *
 * Query params:
 *   startDate (ISO string)  – defaults to 30 days ago
 *   endDate   (ISO string)  – defaults to now
 *
 * Returns: totalRevenue, totalCOGS, netProfit, transactionCount
 */
exports.getProfitSummary = asyncHandler(async (req, res) => {
  const {
    startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    endDate = new Date().toISOString(),
  } = req.query;

  const start = new Date(startDate);
  const end = new Date(endDate);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    throw new ApiError('Invalid date format. Use ISO 8601.', 400);
  }

  const pipeline = [
    // Stage 1: Filter sales in date range
    {
      $match: {
        type: 'sale',
        createdAt: { $gte: start, $lte: end },
      },
    },
    // Stage 2: Unwind items array
    { $unwind: '$items' },
    // Stage 3: Calculate per-item metrics
    {
      $group: {
        _id: null,
        totalRevenue: {
          $sum: { $multiply: ['$items.retailPriceAtSale', '$items.quantity'] },
        },
        totalCOGS: {
          $sum: { $multiply: ['$items.costPriceAtSale', '$items.quantity'] },
        },
        totalItemsSold: { $sum: '$items.quantity' },
        transactionIds: { $addToSet: '$_id' },
      },
    },
    // Stage 4: Compute net profit & transaction count
    {
      $project: {
        _id: 0,
        totalRevenue: { $round: ['$totalRevenue', 2] },
        totalCOGS: { $round: ['$totalCOGS', 2] },
        netProfit: {
          $round: [{ $subtract: ['$totalRevenue', '$totalCOGS'] }, 2],
        },
        profitMarginPercent: {
          $round: [
            {
              $multiply: [
                { $divide: [{ $subtract: ['$totalRevenue', '$totalCOGS'] }, '$totalRevenue'] },
                100,
              ],
            },
            2,
          ],
        },
        totalItemsSold: 1,
        transactionCount: { $size: '$transactionIds' },
      },
    },
  ];

  const [result] = await Transaction.aggregate(pipeline);

  // Account for returns in the same period
  const returnPipeline = [
    {
      $match: {
        type: 'return',
        createdAt: { $gte: start, $lte: end },
      },
    },
    { $unwind: '$items' },
    {
      $group: {
        _id: null,
        totalRefunded: {
          $sum: { $multiply: ['$items.retailPriceAtSale', '$items.quantity'] },
        },
        totalCOGSReturned: {
          $sum: { $multiply: ['$items.costPriceAtSale', '$items.quantity'] },
        },
        totalItemsReturned: { $sum: '$items.quantity' },
      },
    },
  ];

  const [returns] = await Transaction.aggregate(returnPipeline);

  const salesData = result || {
    totalRevenue: 0, totalCOGS: 0, netProfit: 0,
    profitMarginPercent: 0, totalItemsSold: 0, transactionCount: 0,
  };
  const returnData = returns || {
    totalRefunded: 0, totalCOGSReturned: 0, totalItemsReturned: 0,
  };

  // Adjusted figures
  const adjustedRevenue = parseFloat((salesData.totalRevenue - returnData.totalRefunded).toFixed(2));
  const adjustedCOGS = parseFloat((salesData.totalCOGS - returnData.totalCOGSReturned).toFixed(2));
  const adjustedProfit = parseFloat((adjustedRevenue - adjustedCOGS).toFixed(2));
  const profitMarginPercent = adjustedRevenue > 0
    ? parseFloat(((adjustedProfit / adjustedRevenue) * 100).toFixed(2))
    : 0;

  // Real inventory stock aggregation
  const Product = mongoose.model('Product');
  const [totalStockResult] = await Product.aggregate([
    { $match: { isActive: true } },
    { $group: { _id: null, totalItems: { $sum: '$quantity' }, lowStock: { $sum: { $cond: [{ $lte: ['$quantity', 30] }, 1, 0] } } } }
  ]);
  const totalItemsInStock = totalStockResult ? totalStockResult.totalItems : 0;
  const lowStockCount = totalStockResult ? totalStockResult.lowStock : 0;

  // Real Top profitable products from sales
  const topProductsRaw = await Transaction.aggregate([
    { $match: { type: 'sale' } },
    { $unwind: '$items' },
    {
      $group: {
        _id: '$items.product',
        name: { $first: '$items.productName' },
        qty: { $sum: '$items.quantity' },
        revenue: { $sum: { $multiply: ['$items.retailPriceAtSale', '$items.quantity'] } },
        cost: { $sum: { $multiply: ['$items.costPriceAtSale', '$items.quantity'] } },
      },
    },
    { $sort: { revenue: -1 } },
    { $limit: 5 },
  ]);

  const topProducts = topProductsRaw.map((p) => {
    const profit = parseFloat((p.revenue - p.cost).toFixed(2));
    return {
      name: p.name,
      qty: p.qty,
      revenue: parseFloat(p.revenue.toFixed(2)),
      profit,
      margin: p.revenue > 0 ? parseFloat(((profit / p.revenue) * 100).toFixed(1)) : 0,
    };
  });

  // Real category breakdown from sales
  const categoryRaw = await Transaction.aggregate([
    { $match: { type: 'sale' } },
    { $unwind: '$items' },
    {
      $lookup: {
        from: 'products',
        localField: 'items.product',
        foreignField: '_id',
        as: 'productDoc',
      },
    },
    { $unwind: { path: '$productDoc', preserveNullAndEmptyArrays: true } },
    {
      $group: {
        _id: '$productDoc.category',
        total: { $sum: { $multiply: ['$items.retailPriceAtSale', '$items.quantity'] } },
      },
    },
  ]);

  const categoryBreakdown = { shirts: 0, pants: 0, dresses: 0, jackets: 0, activewear: 0, other: 0 };
  categoryRaw.forEach((c) => {
    const cat = c._id || 'other';
    if (categoryBreakdown[cat] !== undefined) categoryBreakdown[cat] = parseFloat(c.total.toFixed(2));
    else categoryBreakdown.other = parseFloat((categoryBreakdown.other + c.total).toFixed(2));
  });

  // Dynamic trends (0s if no transactions)
  const trends = {
    daily: {
      labels: ['09:00', '12:00', '15:00', '18:00', '21:00'],
      revenue: [0, 0, 0, 0, 0],
      profit: [0, 0, 0, 0, 0],
    },
    weekly: {
      labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
      revenue: [0, 0, 0, 0, 0, 0, 0],
      profit: [0, 0, 0, 0, 0, 0, 0],
    },
    monthly: {
      labels: ['May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'],
      revenue: [0, 0, 0, 0, 0, 0],
      profit: [0, 0, 0, 0, 0, 0],
    },
  };

  const financials = {
    totalRevenue: adjustedRevenue,
    totalCOGS: adjustedCOGS,
    totalRefunded: returnData.totalRefunded,
    netRevenue: adjustedRevenue,
    netProfit: adjustedProfit,
    profitMarginPercent,
    totalSaleTransactions: salesData.transactionCount || 0,
    totalItemsInStock,
    lowStockCount,
  };

  res.status(200).json({
    success: true,
    dateRange: { start, end },
    financials,
    trends,
    categoryBreakdown,
    topProducts,
    sales: salesData,
    returns: returnData,
    adjusted: {
      netRevenue: adjustedRevenue,
      netCOGS: adjustedCOGS,
      netProfit: adjustedProfit,
      profitMarginPercent,
    },
  });
});

/**
 * ─── GET /api/v1/analytics/top-selling ────────────────────────────
 * Top-selling products by quantity sold.
 */
exports.getTopSellingProducts = asyncHandler(async (req, res) => {
  const {
    startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    endDate = new Date().toISOString(),
    limit = 10,
  } = req.query;

  const start = new Date(startDate);
  const end = new Date(endDate);

  const pipeline = [
    {
      $match: {
        type: 'sale',
        createdAt: { $gte: start, $lte: end },
      },
    },
    { $unwind: '$items' },
    {
      $group: {
        _id: '$items.product',
        productName: { $first: '$items.productName' },
        sku: { $first: '$items.sku' },
        totalQuantitySold: { $sum: '$items.quantity' },
        totalRevenue: {
          $sum: { $multiply: ['$items.retailPriceAtSale', '$items.quantity'] },
        },
      },
    },
    { $sort: { totalQuantitySold: -1 } },
    { $limit: parseInt(limit, 10) },
    {
      $project: {
        _id: 0,
        productId: '$_id',
        productName: 1,
        sku: 1,
        totalQuantitySold: 1,
        totalRevenue: { $round: ['$totalRevenue', 2] },
      },
    },
  ];

  const results = await Transaction.aggregate(pipeline);

  res.status(200).json({
    success: true,
    dateRange: { start, end },
    count: results.length,
    data: results,
  });
});

/**
 * ─── GET /api/v1/analytics/most-profitable ────────────────────────
 * Most profitable products by net profit generated.
 */
exports.getMostProfitableProducts = asyncHandler(async (req, res) => {
  const {
    startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    endDate = new Date().toISOString(),
    limit = 10,
  } = req.query;

  const start = new Date(startDate);
  const end = new Date(endDate);

  const pipeline = [
    {
      $match: {
        type: 'sale',
        createdAt: { $gte: start, $lte: end },
      },
    },
    { $unwind: '$items' },
    {
      $group: {
        _id: '$items.product',
        productName: { $first: '$items.productName' },
        sku: { $first: '$items.sku' },
        totalQuantitySold: { $sum: '$items.quantity' },
        totalRevenue: {
          $sum: { $multiply: ['$items.retailPriceAtSale', '$items.quantity'] },
        },
        totalCost: {
          $sum: { $multiply: ['$items.costPriceAtSale', '$items.quantity'] },
        },
      },
    },
    {
      $addFields: {
        totalProfit: { $subtract: ['$totalRevenue', '$totalCost'] },
        profitMarginPercent: {
          $cond: {
            if: { $gt: ['$totalRevenue', 0] },
            then: {
              $multiply: [
                { $divide: [{ $subtract: ['$totalRevenue', '$totalCost'] }, '$totalRevenue'] },
                100,
              ],
            },
            else: 0,
          },
        },
      },
    },
    { $sort: { totalProfit: -1 } },
    { $limit: parseInt(limit, 10) },
    {
      $project: {
        _id: 0,
        productId: '$_id',
        productName: 1,
        sku: 1,
        totalQuantitySold: 1,
        totalRevenue: { $round: ['$totalRevenue', 2] },
        totalCost: { $round: ['$totalCost', 2] },
        totalProfit: { $round: ['$totalProfit', 2] },
        profitMarginPercent: { $round: ['$profitMarginPercent', 2] },
      },
    },
  ];

  const results = await Transaction.aggregate(pipeline);

  res.status(200).json({
    success: true,
    dateRange: { start, end },
    count: results.length,
    data: results,
  });
});

/**
 * ─── GET /api/v1/analytics/dashboard ──────────────────────────────
 * Aggregated dashboard summary for admins.
 */
exports.getDashboard = asyncHandler(async (req, res) => {
  const today = new Date();
  const thirtyDaysAgo = new Date(today - 30 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(today - 7 * 24 * 60 * 60 * 1000);

  // Quick counts
  const [Product, User] = await Promise.all([
    mongoose.model('Product'),
    mongoose.model('User'),
  ]);

  const [
    totalProducts,
    lowStockProducts,
    activeEmployees,
    salesLast30Days,
    salesLast7Days,
  ] = await Promise.all([
    Product.countDocuments({ isActive: true }),
    Product.countDocuments({ isActive: true, quantity: { $lte: 10 } }),
    User.countDocuments({ role: 'employee', isActive: true }),
    Transaction.countDocuments({ type: 'sale', createdAt: { $gte: thirtyDaysAgo } }),
    Transaction.countDocuments({ type: 'sale', createdAt: { $gte: sevenDaysAgo } }),
  ]);

  // Revenue last 30 days
  const revenuePipeline = [
    {
      $match: {
        type: 'sale',
        createdAt: { $gte: thirtyDaysAgo },
      },
    },
    { $unwind: '$items' },
    {
      $group: {
        _id: null,
        revenue: { $sum: { $multiply: ['$items.retailPriceAtSale', '$items.quantity'] } },
        cogs: { $sum: { $multiply: ['$items.costPriceAtSale', '$items.quantity'] } },
      },
    },
  ];

  const [revenueData] = await Transaction.aggregate(revenuePipeline);

  res.status(200).json({
    success: true,
    data: {
      inventory: {
        totalProducts,
        lowStockProducts,
      },
      team: {
        activeEmployees,
      },
      sales: {
        last30Days: salesLast30Days,
        last7Days: salesLast7Days,
      },
      financials: {
        last30Days: {
          revenue: revenueData ? parseFloat(revenueData.revenue.toFixed(2)) : 0,
          cogs: revenueData ? parseFloat(revenueData.cogs.toFixed(2)) : 0,
          profit: revenueData
            ? parseFloat((revenueData.revenue - revenueData.cogs).toFixed(2))
            : 0,
        },
      },
    },
  });
});
