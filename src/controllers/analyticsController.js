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

  res.status(200).json({
    success: true,
    dateRange: { start, end },
    sales: salesData,
    returns: returnData,
    adjusted: {
      netRevenue: adjustedRevenue,
      netCOGS: adjustedCOGS,
      netProfit: adjustedProfit,
      profitMarginPercent: adjustedRevenue > 0
        ? parseFloat(((adjustedProfit / adjustedRevenue) * 100).toFixed(2))
        : 0,
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
