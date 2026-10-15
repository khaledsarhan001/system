const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Simple JWT-like token implementation (no external deps needed) ──────────
const JWT_SECRET = 'apparel_rbac_secret_2024';

function signToken(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body   = Buffer.from(JSON.stringify({ ...payload, iat: Date.now(), exp: Date.now() + 8 * 60 * 60 * 1000 })).toString('base64url');
  const sig    = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function verifyToken(token) {
  try {
    const [header, body, sig] = token.split('.');
    const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
    if (sig !== expected) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (payload.exp < Date.now()) return null; // expired
    return payload;
  } catch {
    return null;
  }
}

// ─── Auth Middleware ──────────────────────────────────────────────────────────
function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Authentication required.' });
  }
  const token = authHeader.split(' ')[1];
  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token. Please log in again.' });
  }
  req.user = payload;
  next();
}

// ─── RBAC: verifyAdmin Middleware ────────────────────────────────────────────
function verifyAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ 
      success: false, 
      status: 403,
      error: 'Forbidden', 
      message: 'Access denied: Admin privileges required.' 
    });
  }
  next();
}
const adminOnly = verifyAdmin;

// ─── Seeded Users (with full fields: name, email, phone, address, branch, username, password) ──
const USERS = [
  {
    id: 'u1',
    name: 'أحمد المدير',
    email: 'admin@apparel.com',
    phone: '+20 100 123 4567',
    address: 'شارع النصر، المعادي، القاهرة',
    branch: 'الفرع الرئيسي - القاهرة',
    username: 'admin',
    password: 'admin123',
    role: 'admin',
    avatar: 'AM',
    createdAt: new Date().toISOString()
  },
  {
    id: 'u2',
    name: 'محمد الموظف',
    email: 'employee@apparel.com',
    phone: '+20 111 987 6543',
    address: 'شارع الهرم، الجيزة',
    branch: 'فرع الجيزة',
    username: 'employee',
    password: 'emp123',
    role: 'employee',
    avatar: 'MM',
    createdAt: new Date().toISOString()
  },
];

// ─── In-Memory Product Store ──────────────────────────────────────────────────
let products = [
  { id: '1', name: 'Classic Crew Neck T-Shirt', category: 'shirts',    sku: 'SHR-CN-001', sizes: ['S','M','L','XL'],    colors: ['White','Black'],       costPrice: 8.50,  retailPrice: 24.99,  quantity: 150 },
  { id: '2', name: 'Slim Fit Chinos',           category: 'pants',     sku: 'PNT-SF-002', sizes: ['S','M','L','XL'],    colors: ['Khaki','Navy'],        costPrice: 18.00, retailPrice: 49.99,  quantity: 80  },
  { id: '3', name: 'Floral Summer Dress',        category: 'dresses',   sku: 'DRS-FL-003', sizes: ['XS','S','M','L'],   colors: ['Blue Floral'],         costPrice: 22.00, retailPrice: 64.99,  quantity: 45  },
  { id: '4', name: 'Leather Bomber Jacket',      category: 'jackets',   sku: 'JKT-LB-004', sizes: ['M','L','XL'],       colors: ['Black','Brown'],       costPrice: 65.00, retailPrice: 189.99, quantity: 25  },
  { id: '5', name: 'Running Shorts',             category: 'activewear',sku: 'ACT-RS-005', sizes: ['S','M','L'],        colors: ['Black','Grey'],        costPrice: 7.00,  retailPrice: 29.99,  quantity: 200 },
];

let transactions = [];

// ─── Helper: shape product based on role ─────────────────────────────────────
function formatProduct(p, role) {
  const base = { ...p };
  if (role !== 'admin') {
    delete base.costPrice;
  } else {
    base.unitProfit     = parseFloat((base.retailPrice - base.costPrice).toFixed(2));
    base.profitMargin   = parseFloat(((base.unitProfit / base.retailPrice) * 100).toFixed(1));
  }
  return base;
}

// ══════════════════════════════════════════════════════════════════════════════
//  AUTH & EMPLOYEE MANAGEMENT ROUTES
// ══════════════════════════════════════════════════════════════════════════════

// POST /api/v1/auth/login - Supports login via Username OR Email
app.post('/api/v1/auth/login', (req, res) => {
  const { username, loginIdentifier, identifier: bodyIdentifier, email, password } = req.body;
  const identifier = (bodyIdentifier || email || loginIdentifier || username || '').trim().toLowerCase();

  if (!identifier || !password) {
    return res.status(400).json({ success: false, message: 'Username/Email and password are required.' });
  }

  // Search by either username or email
  const user = USERS.find(u => 
    (u.username.toLowerCase() === identifier || (u.email && u.email.toLowerCase() === identifier)) && 
    u.password === password
  );

  if (!user) {
    return res.status(401).json({ success: false, message: 'Invalid credentials. Please verify your username/email and password.' });
  }

  const token = signToken({ 
    id: user.id, 
    username: user.username, 
    email: user.email, 
    name: user.name, 
    role: user.role, 
    avatar: user.avatar 
  });

  res.json({
    success: true,
    message: `Welcome back, ${user.name}!`,
    token,
    user: { 
      id: user.id, 
      username: user.username, 
      email: user.email, 
      name: user.name, 
      phone: user.phone,
      address: user.address,
      branch: user.branch,
      role: user.role, 
      avatar: user.avatar 
    },
  });
});

// GET /api/v1/auth/me  (validate token & return current user)
app.get('/api/v1/auth/me', authMiddleware, (req, res) => {
  const user = USERS.find(u => u.id === req.user.id);
  res.json({ success: true, user: user || req.user });
});

// ─── ADMIN EMPLOYEE DIRECTORY & MANAGEMENT (Strict Admin Only) ──────────────
function getEmployeesHandler(_req, res) {
  const list = USERS.map(u => ({
    id: u.id,
    name: u.name,
    email: u.email || '—',
    phone: u.phone || '—',
    address: u.address || '—',
    branch: u.branch || '—',
    username: u.username,
    role: u.role,
    avatar: u.avatar,
    createdAt: u.createdAt || new Date().toISOString()
  }));
  res.json({ success: true, count: list.length, data: list });
}

function createEmployeeHandler(req, res) {
  const { name, email, phone, address, branch, username, password, role } = req.body;

  if (!name || !username || !password) {
    return res.status(400).json({ success: false, message: 'Name, username, and password are required.' });
  }

  // Check unique username
  if (USERS.some(u => u.username.toLowerCase() === username.trim().toLowerCase())) {
    return res.status(400).json({ success: false, message: 'Username is already taken. Please choose another.' });
  }

  // Check unique email if provided
  if (email && USERS.some(u => u.email && u.email.toLowerCase() === email.trim().toLowerCase())) {
    return res.status(400).json({ success: false, message: 'Email address is already in use.' });
  }

  const initials = name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || 'EM';

  const newEmp = {
    id: 'u' + Date.now(),
    name: name.trim(),
    email: (email || '').trim().toLowerCase(),
    phone: (phone || '').trim(),
    address: (address || '').trim(),
    branch: (branch || 'الفرع الرئيسي').trim(),
    username: username.trim(),
    password: password,
    role: role === 'admin' ? 'admin' : 'employee',
    avatar: initials,
    createdAt: new Date().toISOString()
  };

  USERS.push(newEmp);

  res.status(201).json({
    success: true,
    message: `Employee "${newEmp.name}" registered successfully.`,
    data: newEmp
  });
}

function deleteEmployeeHandler(req, res) {
  const { id } = req.params;

  if (id === req.user.id) {
    return res.status(400).json({ success: false, message: 'You cannot delete your own admin account.' });
  }

  const idx = USERS.findIndex(u => u.id === id);
  if (idx === -1) {
    return res.status(404).json({ success: false, message: 'Employee account not found.' });
  }

  const deleted = USERS.splice(idx, 1)[0];
  res.json({
    success: true,
    message: `Employee account "${deleted.name}" has been permanently deleted.`,
    data: deleted
  });
}

function updateEmployeeHandler(req, res) {
  const { id } = req.params;
  const { name, email, phone, address, branch, role } = req.body;

  const emp = USERS.find(u => u.id === id);
  if (!emp) {
    return res.status(404).json({ success: false, message: 'Employee not found.' });
  }

  // Check unique email if modified
  if (email && email.toLowerCase() !== (emp.email || '').toLowerCase()) {
    if (USERS.some(u => u.id !== id && u.email && u.email.toLowerCase() === email.trim().toLowerCase())) {
      return res.status(400).json({ success: false, message: 'Email address is already in use by another user.' });
    }
  }

  if (name) emp.name = name.trim();
  if (email !== undefined) emp.email = (email || '').trim().toLowerCase();
  if (phone !== undefined) emp.phone = (phone || '').trim();
  if (address !== undefined) emp.address = (address || '').trim();
  if (branch !== undefined) emp.branch = (branch || '').trim();
  if (role && (role === 'admin' || role === 'employee')) emp.role = role;

  if (name) {
    emp.avatar = name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || emp.avatar;
  }

  res.json({
    success: true,
    message: `Employee "${emp.name}" updated successfully.`,
    data: emp
  });
}

// Register user management routes under all standard & admin paths
app.get(['/api/v1/employees', '/api/employees', '/api/admin/employees', '/api/v1/admin/employees'], authMiddleware, verifyAdmin, getEmployeesHandler);
app.post(['/api/v1/employees', '/api/employees', '/api/admin/employees', '/api/v1/admin/employees'], authMiddleware, verifyAdmin, createEmployeeHandler);
app.put(['/api/v1/employees/:id', '/api/employees/:id', '/api/admin/employees/:id', '/api/v1/admin/employees/:id'], authMiddleware, verifyAdmin, updateEmployeeHandler);
app.patch(['/api/v1/employees/:id', '/api/employees/:id', '/api/admin/employees/:id', '/api/v1/admin/employees/:id'], authMiddleware, verifyAdmin, updateEmployeeHandler);
app.delete(['/api/v1/employees/:id', '/api/employees/:id', '/api/admin/employees/:id', '/api/v1/admin/employees/:id'], authMiddleware, verifyAdmin, deleteEmployeeHandler);

// ══════════════════════════════════════════════════════════════════════════════
//  PRODUCT ROUTES  (auth required on all)
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/v1/products
app.get('/api/v1/products', authMiddleware, (req, res) => {
  const data = products.map(p => formatProduct(p, req.user.role));
  res.json({ success: true, count: data.length, role: req.user.role, data });
});

// POST /api/v1/products
app.post('/api/v1/products', authMiddleware, (req, res) => {
  const newProduct = {
    id: String(Date.now()),
    name:        req.body.name        || 'Untitled',
    category:    req.body.category    || 'other',
    sku:         req.body.sku         || ('SKU-' + Math.floor(Math.random() * 9000 + 1000)),
    sizes:       req.body.sizes       || ['M'],
    colors:      req.body.colors      || ['Default'],
    costPrice:   parseFloat(req.body.costPrice)  || 0,
    retailPrice: parseFloat(req.body.retailPrice) || 0,
    quantity:    parseInt(req.body.quantity, 10)  || 0,
  };

  // Only admins can set costPrice; employees leave it 0
  if (req.user.role !== 'admin') newProduct.costPrice = 0;

  products.push(newProduct);
  res.status(201).json({ success: true, data: formatProduct(newProduct, req.user.role) });
});

// PATCH /api/v1/products/:id/stock
app.patch('/api/v1/products/:id/stock', authMiddleware, (req, res) => {
  const p = products.find(item => item.id === req.params.id);
  if (!p) return res.status(404).json({ success: false, message: 'Product not found.' });

  const adj = parseInt(req.body.adjustment, 10) || 0;
  if (p.quantity + adj < 0) {
    return res.status(400).json({ success: false, message: `Cannot reduce below zero. Current stock: ${p.quantity}` });
  }
  p.quantity += adj;
  res.json({ success: true, data: formatProduct(p, req.user.role) });
});

// DELETE /api/v1/products/:id & /api/products/:id (Admin only, supports soft/hard delete)
const deleteProductHandler = (req, res) => {
  const index = products.findIndex(item => item.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ success: false, message: 'Product not found.' });
  }

  const deletedProduct = products[index];

  // Soft Delete / Archive to preserve historical sales analytics
  if (deletedProduct.isArchived) {
    // If already archived, hard delete
    products.splice(index, 1);
  } else {
    // Soft delete / archive
    deletedProduct.isArchived = true;
    deletedProduct.isActive = false;
    // Remove from active catalog
    products.splice(index, 1);
  }

  res.json({
    success: true,
    message: `Product "${deletedProduct.name}" deleted and archived successfully.`,
    data: deletedProduct
  });
};

app.delete('/api/v1/products/:id', authMiddleware, adminOnly, deleteProductHandler);
app.delete('/api/products/:id', authMiddleware, adminOnly, deleteProductHandler);

// ══════════════════════════════════════════════════════════════════════════════
//  TRANSACTION ROUTES (auth required)
// ══════════════════════════════════════════════════════════════════════════════

// POST /api/v1/transactions/sale
app.post('/api/v1/transactions/sale', authMiddleware, (req, res) => {
  const { productId, quantity } = req.body;
  const qty = parseInt(quantity, 10) || 1;
  const p   = products.find(item => item.id === productId);

  if (!p)          return res.status(404).json({ success: false, message: 'Product not found.' });
  if (p.quantity < qty) return res.status(400).json({ success: false, message: `Insufficient stock. Available: ${p.quantity}` });

  p.quantity -= qty;

  const record = {
    id: 'TX-' + Date.now(),
    type: 'sale',
    productId:   p.id,
    productName: p.name,
    quantity: qty,
    retailPrice:    p.retailPrice,
    costPrice:      p.costPrice,          // snapshotted
    total:          parseFloat((p.retailPrice * qty).toFixed(2)),
    employee:       req.user.name,
    employeeId:     req.user.id,
    createdAt:      new Date().toISOString(),
  };
  transactions.push(record);

  res.status(201).json({ success: true, message: 'Sale recorded successfully.', data: record });
});

// POST /api/v1/transactions/return
app.post('/api/v1/transactions/return', authMiddleware, (req, res) => {
  const { productId, quantity, reason } = req.body;
  const qty = parseInt(quantity, 10) || 1;
  const p   = products.find(item => item.id === productId);

  if (!p) return res.status(404).json({ success: false, message: 'Product not found.' });

  p.quantity += qty;

  const record = {
    id: 'RTN-' + Date.now(),
    type: 'return',
    productId:   p.id,
    productName: p.name,
    quantity: qty,
    reason:       reason || 'Not specified',
    retailPrice:  p.retailPrice,
    total:        parseFloat((p.retailPrice * qty).toFixed(2)),
    employee:     req.user.name,
    employeeId:   req.user.id,
    createdAt:    new Date().toISOString(),
  };
  transactions.push(record);

  res.status(201).json({ success: true, message: 'Return processed successfully.', data: record });
});

// GET /api/v1/transactions  (employees see their own; admins see all)
app.get('/api/v1/transactions', authMiddleware, (req, res) => {
  let data = transactions;
  if (req.user.role !== 'admin') {
    data = transactions.map(tx => {
      const t = { ...tx };
      delete t.costPrice;   // mask cost from employee view
      return t;
    }).filter(tx => tx.employeeId === req.user.id);
  }
  res.json({ success: true, count: data.length, data: data.slice().reverse() });
});

// ══════════════════════════════════════════════════════════════════════════════
//  ANALYTICS & ADMIN PROTECTED ROUTES (Admin Exclusive)
// ══════════════════════════════════════════════════════════════════════════════

function getAnalyticsProfitHandler(req, res) {
  const sales   = transactions.filter(tx => tx.type === 'sale');
  const returns = transactions.filter(tx => tx.type === 'return');

  const baseRevenue = 4850, baseCOGS = 2140;

  const totalRevenue  = sales.reduce((s, tx) => s + tx.total, baseRevenue);
  const totalCOGS     = sales.reduce((s, tx) => s + (tx.costPrice * tx.quantity), baseCOGS);
  const totalRefunded = returns.reduce((s, tx) => s + tx.total, 0);

  const netRevenue    = parseFloat((totalRevenue - totalRefunded).toFixed(2));
  const netProfit     = parseFloat((netRevenue - totalCOGS).toFixed(2));
  const margin        = netRevenue > 0 ? parseFloat(((netProfit / netRevenue) * 100).toFixed(2)) : 0;

  // Top products by revenue
  const productMap = {};
  sales.forEach(tx => {
    if (!productMap[tx.productId]) {
      productMap[tx.productId] = { name: tx.productName, revenue: 0, cost: 0, qty: 0 };
    }
    productMap[tx.productId].revenue += tx.total;
    productMap[tx.productId].cost    += (tx.costPrice || 0) * tx.quantity;
    productMap[tx.productId].qty     += tx.quantity;
  });

  const topProducts = Object.values(productMap).map(p => {
    const profit = parseFloat((p.revenue - p.cost).toFixed(2));
    const margin = p.revenue > 0 ? parseFloat(((profit / p.revenue) * 100).toFixed(1)) : 0;
    return {
      name: p.name,
      qty: p.qty,
      revenue: parseFloat(p.revenue.toFixed(2)),
      profit,
      margin
    };
  }).sort((a, b) => b.revenue - a.revenue).slice(0, 5);

  // Category Breakdown
  const categoryBreakdown = {
    shirts: 0,
    pants: 0,
    dresses: 0,
    jackets: 0,
    activewear: 0,
    other: 0
  };

  // Populate base sample sales distribution across categories
  categoryBreakdown.shirts = 1450;
  categoryBreakdown.pants = 1200;
  categoryBreakdown.jackets = 1100;
  categoryBreakdown.dresses = 650;
  categoryBreakdown.activewear = 450;

  // Add actual dynamic sales
  sales.forEach(tx => {
    const prod = products.find(p => p.id === tx.productId);
    const cat = prod ? prod.category : 'other';
    if (categoryBreakdown[cat] !== undefined) {
      categoryBreakdown[cat] += tx.total;
    } else {
      categoryBreakdown.other += tx.total;
    }
  });

  // Sales Trends (Daily/Weekly/Monthly)
  const trends = {
    daily: {
      labels: ['09:00', '11:00', '13:00', '15:00', '17:00', '19:00', '21:00'],
      revenue: [320, 580, 890, 720, 1140, 950, 480],
      profit: [180, 310, 490, 390, 630, 520, 260]
    },
    weekly: {
      labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
      revenue: [1200, 1450, 1800, 2100, 2900, 3400, 2600],
      profit: [660, 790, 990, 1150, 1600, 1870, 1430]
    },
    monthly: {
      labels: ['May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'],
      revenue: [18500, 22400, 26800, 31200, 29500, 34800],
      profit: [10200, 12300, 14700, 17100, 16200, 19100]
    }
  };

  res.json({
    success: true,
    financials: {
      totalRevenue:         parseFloat(totalRevenue.toFixed(2)),
      totalCOGS:            parseFloat(totalCOGS.toFixed(2)),
      totalRefunded,
      netRevenue,
      netProfit,
      profitMarginPercent:  margin,
      totalSaleTransactions: sales.length,
      totalItemsInStock:    products.reduce((acc, p) => acc + p.quantity, 0),
      lowStockCount:        products.filter(p => p.quantity <= 30).length,
    },
    trends,
    categoryBreakdown,
    topProducts: topProducts.length ? topProducts : [
      { name: 'Leather Bomber Jacket', qty: 18, revenue: 3419.82, profit: 2249.82, margin: 65.8 },
      { name: 'Floral Summer Dress', qty: 24, revenue: 1559.76, profit: 1031.76, margin: 66.1 },
      { name: 'Slim Fit Chinos', qty: 32, revenue: 1599.68, profit: 1023.68, margin: 64.0 },
      { name: 'Classic Crew Neck T-Shirt', qty: 65, revenue: 1624.35, profit: 1071.85, margin: 66.0 },
      { name: 'Running Shorts', qty: 40, revenue: 1199.60, profit: 919.60, margin: 76.7 }
    ],
  });
}

// Protected financial analytics routes (supports /api/v1/analytics/profit, /api/analytics/profit, etc.)
app.get([
  '/api/v1/analytics/profit', 
  '/api/analytics/profit', 
  '/api/v1/analytics', 
  '/api/analytics',
  '/api/admin/analytics/profit',
  '/api/admin/analytics',
  '/api/v1/admin/analytics/profit',
  '/api/v1/admin/analytics'
], authMiddleware, verifyAdmin, getAnalyticsProfitHandler);

// ─── STRICT ADMIN PREFIX ROUTE GUARD: /api/admin/* & /api/v1/admin/* ─────────
app.use(['/api/admin', '/api/v1/admin'], authMiddleware, verifyAdmin);

app.all(['/api/admin/*', '/api/v1/admin/*'], (req, res) => {
  res.json({
    success: true,
    message: 'Authorized Admin endpoint access granted.',
    user: req.user
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = 5000;
app.listen(PORT, () => {
  console.log('====================================================');
  console.log('🚀  Apparel Inventory System is Live!');
  console.log(`🌐  Open: http://localhost:${PORT}`);
  console.log('----------------------------------------------------');
  console.log('👤  Admin    → username: admin    / password: admin123');
  console.log('👤  Employee → username: employee / password: emp123');
  console.log('====================================================');
});
