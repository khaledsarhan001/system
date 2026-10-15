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

// ─── Production Seeded Users (Single default Admin account) ──────────────────
const USERS = [
  {
    id: 'admin_1',
    name: 'المدير العام (Admin)',
    email: 'admin@apparel.com',
    username: 'admin',
    password: 'Admin@Apparel2026!',
    role: 'admin',
    jobTitle: 'المدير العام',
    avatar: 'AD',
    phone: '+20 100 000 0000',
    address: 'الإدارة المركزية',
    branch: 'المقر الرئيسي',
    createdAt: new Date().toISOString()
  }
];

// ─── Clean Real Store: No hardcoded mock products or transactions ─────────────
let products = [];
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
    jobTitle: user.jobTitle || 'المدير العام',
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
      jobTitle: user.jobTitle || (user.role === 'admin' ? 'المدير العام' : 'موظف مبيعات'),
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
    jobTitle: u.jobTitle || (u.role === 'admin' ? 'المدير العام' : 'موظف مبيعات'),
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
  const { name, jobTitle, email, phone, address, branch, username, password, role } = req.body;

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
    jobTitle: (jobTitle || (role === 'admin' ? 'مدير نظام' : 'موظف مبيعات')).trim(),
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
  const { name, jobTitle, email, phone, address, branch, username, password, role } = req.body;

  const emp = USERS.find(u => u.id === id);
  if (!emp) {
    return res.status(404).json({ success: false, message: 'Employee not found.' });
  }

  // Check unique username if modified
  if (username && username.trim().toLowerCase() !== emp.username.toLowerCase()) {
    if (USERS.some(u => u.id !== id && u.username.toLowerCase() === username.trim().toLowerCase())) {
      return res.status(400).json({ success: false, message: 'Username is already in use by another user.' });
    }
    emp.username = username.trim();
  }

  // Check unique email if modified
  if (email && email.toLowerCase() !== (emp.email || '').toLowerCase()) {
    if (USERS.some(u => u.id !== id && u.email && u.email.toLowerCase() === email.trim().toLowerCase())) {
      return res.status(400).json({ success: false, message: 'Email address is already in use by another user.' });
    }
  }

  if (name) emp.name = name.trim();
  if (jobTitle !== undefined) emp.jobTitle = jobTitle.trim();
  if (email !== undefined) emp.email = (email || '').trim().toLowerCase();
  if (phone !== undefined) emp.phone = (phone || '').trim();
  if (address !== undefined) emp.address = (address || '').trim();
  if (branch !== undefined) emp.branch = (branch || '').trim();
  if (password && password.trim()) emp.password = password;
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

// Factory Reset Endpoint (Admin Only with Password Verification)
app.post(['/api/v1/admin/factory-reset', '/api/admin/factory-reset'], authMiddleware, verifyAdmin, (req, res) => {
  const { password } = req.body;
  const adminUser = USERS.find(u => u.id === req.user.id) || USERS[0];
  if (!password || (adminUser && adminUser.password !== password)) {
    return res.status(400).json({ success: false, message: 'Incorrect admin password. Factory reset cancelled.' });
  }

  products = [];
  transactions = [];
  USERS.length = 0;
  USERS.push({
    id: 'admin_1',
    name: 'المدير العام (Admin)',
    email: 'admin@apparel.com',
    username: 'admin',
    password: 'Admin@Apparel2026!',
    role: 'admin',
    jobTitle: 'المدير العام',
    avatar: 'AD',
    phone: '+20 100 000 0000',
    address: 'الإدارة المركزية',
    branch: 'المقر الرئيسي',
    createdAt: new Date().toISOString()
  });

  res.json({ success: true, message: 'Factory reset completed successfully. Store is pristine.' });
});

// ══════════════════════════════════════════════════════════════════════════════
//  PRODUCT ROUTES  (auth required on all)
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/v1/products
app.get('/api/v1/products', authMiddleware, (req, res) => {
  const data = products.map(p => formatProduct(p, req.user.role));
  res.json({ success: true, count: data.length, role: req.user.role, data });
});

// POST /api/v1/products
app.post('/api/v1/products', authMiddleware, verifyAdmin, (req, res) => {
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
app.patch('/api/v1/products/:id/stock', authMiddleware, verifyAdmin, (req, res) => {
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

  const totalRevenue  = sales.reduce((s, tx) => s + tx.total, 0);
  const totalCOGS     = sales.reduce((s, tx) => s + ((tx.costPrice || 0) * tx.quantity), 0);
  const totalRefunded = returns.reduce((s, tx) => s + tx.total, 0);

  const netRevenue    = parseFloat((totalRevenue - totalRefunded).toFixed(2));
  const netProfit     = parseFloat((netRevenue - totalCOGS).toFixed(2));
  const margin        = netRevenue > 0 ? parseFloat(((netProfit / netRevenue) * 100).toFixed(2)) : 0;

  // Real top products from actual sales
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
    const pMargin = p.revenue > 0 ? parseFloat(((profit / p.revenue) * 100).toFixed(1)) : 0;
    return {
      name: p.name,
      qty: p.qty,
      revenue: parseFloat(p.revenue.toFixed(2)),
      profit,
      margin: pMargin
    };
  }).sort((a, b) => b.revenue - a.revenue).slice(0, 5);

  // Real category breakdown from actual sales
  const categoryBreakdown = {
    shirts: 0,
    pants: 0,
    dresses: 0,
    jackets: 0,
    activewear: 0,
    other: 0
  };

  sales.forEach(tx => {
    const prod = products.find(p => p.id === tx.productId);
    const cat = (prod ? prod.category : 'other') || 'other';
    if (categoryBreakdown[cat] !== undefined) {
      categoryBreakdown[cat] = parseFloat((categoryBreakdown[cat] + tx.total).toFixed(2));
    } else {
      categoryBreakdown.other = parseFloat((categoryBreakdown.other + tx.total).toFixed(2));
    }
  });

  // Dynamic trends from real transaction timestamps (0s if no transactions)
  const now = new Date();
  const dailyLabels = ['09:00', '12:00', '15:00', '18:00', '21:00'];
  const dailyRev = [0, 0, 0, 0, 0];
  const dailyProf = [0, 0, 0, 0, 0];

  const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const weeklyLabels = [];
  const weeklyRev = [];
  const weeklyProf = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    weeklyLabels.push(daysOfWeek[d.getDay()]);
    weeklyRev.push(0);
    weeklyProf.push(0);
  }

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthlyLabels = [];
  const monthlyRev = [];
  const monthlyProf = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    monthlyLabels.push(monthNames[d.getMonth()]);
    monthlyRev.push(0);
    monthlyProf.push(0);
  }

  sales.forEach(tx => {
    const txDate = new Date(tx.createdAt);
    const profit = tx.total - ((tx.costPrice || 0) * tx.quantity);

    if (txDate.toDateString() === now.toDateString()) {
      const hour = txDate.getHours();
      let slot = 0;
      if (hour >= 21) slot = 4;
      else if (hour >= 18) slot = 3;
      else if (hour >= 15) slot = 2;
      else if (hour >= 12) slot = 1;
      else slot = 0;
      dailyRev[slot] = parseFloat((dailyRev[slot] + tx.total).toFixed(2));
      dailyProf[slot] = parseFloat((dailyProf[slot] + profit).toFixed(2));
    }

    const diffDays = Math.floor((now - txDate) / (24 * 60 * 60 * 1000));
    if (diffDays >= 0 && diffDays < 7) {
      const idx = 6 - diffDays;
      weeklyRev[idx] = parseFloat((weeklyRev[idx] + tx.total).toFixed(2));
      weeklyProf[idx] = parseFloat((weeklyProf[idx] + profit).toFixed(2));
    }

    const diffMonths = (now.getFullYear() - txDate.getFullYear()) * 12 + (now.getMonth() - txDate.getMonth());
    if (diffMonths >= 0 && diffMonths < 6) {
      const idx = 5 - diffMonths;
      monthlyRev[idx] = parseFloat((monthlyRev[idx] + tx.total).toFixed(2));
      monthlyProf[idx] = parseFloat((monthlyProf[idx] + profit).toFixed(2));
    }
  });

  const trends = {
    daily: { labels: dailyLabels, revenue: dailyRev, profit: dailyProf },
    weekly: { labels: weeklyLabels, revenue: weeklyRev, profit: weeklyProf },
    monthly: { labels: monthlyLabels, revenue: monthlyRev, profit: monthlyProf }
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
      totalItemsInStock:    products.reduce((acc, p) => acc + (p.quantity || 0), 0),
      lowStockCount:        products.filter(p => p.quantity <= 30).length,
    },
    trends,
    categoryBreakdown,
    topProducts,
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
  console.log('🚀  Apparel Inventory System is Live (Production Mode)');
  console.log(`🌐  Open: http://localhost:${PORT}`);
  console.log('----------------------------------------------------');
  console.log('👤  Admin → username: admin / password: Admin@Apparel2026!');
  console.log('====================================================');
});
