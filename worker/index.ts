import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { jwt, sign } from 'hono/jwt';
import bcrypt from 'bcryptjs';
import { MongoDataApi } from './data-api';
import { DEFAULT_PERMISSIONS, PERMISSION_LABELS, type Env, type Permission, type User } from './types';

type Variables = { user: User };
const app = new Hono<{ Bindings: Env; Variables: Variables }>();
const collections = { users: 'users', products: 'products', sales: 'transactions' };

app.use('/api/*', cors({ origin: '*', allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], allowHeaders: ['Content-Type', 'Authorization'] }));
app.use('/api/*', async (c, next) => {
  try { await next(); }
  catch (error) {
    console.error(error);
    return c.json({ success: false, message: error instanceof Error ? error.message : 'Unexpected server error.' }, 500);
  }
});

const tokenAuth = jwt({ secret: (c) => c.env.JWT_SECRET, alg: 'HS256' });
app.use('/api/*', async (c, next) => {
  if (c.req.path === '/api/auth/login' || c.req.path === '/api/health' || c.req.method === 'OPTIONS') return next();
  return tokenAuth(c, next);
});

app.use('/api/*', async (c, next) => {
  if (c.req.path === '/api/auth/login' || c.req.path === '/api/health' || c.req.method === 'OPTIONS') return next();
  const claims = c.get('jwtPayload') as { sub?: string } | undefined;
  if (!claims?.sub) return c.json({ success: false, message: 'Authentication required.' }, 401);
  const db = new MongoDataApi(c.env);
  const result = await db.findOne<User & { passwordHash?: string }>(collections.users, byId(claims.sub));
  const user = result.document;
  if (!user || !user.isActive) return c.json({ success: false, message: 'Account is unavailable.' }, 401);
  c.set('user', { ...user, id: entityId(user), permissions: { ...DEFAULT_PERMISSIONS, ...user.permissions } });
  await next();
});

function requirePermission(permission: Permission) {
  return async (c: any, next: () => Promise<void>) => {
    const user = c.get('user') as User;
    if (!user || (user.role !== 'admin' && user.permissions?.[permission] !== true)) {
      return c.json({ success: false, message: `Permission required: ${PERMISSION_LABELS[permission]}` }, 403);
    }
    await next();
  };
}

function cleanUser(user: User & { passwordHash?: string; passwordSalt?: string; password?: string }) {
  const { passwordHash: _passwordHash, passwordSalt: _passwordSalt, password: _password, ...safe } = user;
  return { ...safe, id: entityId(user), permissions: { ...DEFAULT_PERMISSIONS, ...user.permissions } };
}

function entityId(document: Record<string, any>): string {
  return document.id ?? document._id?.$oid ?? document._id ?? '';
}

function byId(id: string) {
  return /^[a-f\d]{24}$/i.test(id) ? { $or: [{ id }, { _id: { $oid: id } }] } : { id };
}

async function hashPassword(password: string, salt = crypto.getRandomValues(new Uint8Array(16))) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 210_000, hash: 'SHA-256' }, key, 256);
  return { passwordHash: [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join(''), passwordSalt: [...salt].map((b) => b.toString(16).padStart(2, '0')).join('') };
}

async function verifyPassword(password: string, saltHex: string, expected: string) {
  const salt = new Uint8Array(saltHex.match(/.{2}/g)?.map((v) => parseInt(v, 16)) ?? []);
  if (salt.length !== 16) return false;
  const actual = (await hashPassword(password, salt)).passwordHash;
  return actual.length === expected.length && [...actual].reduce((diff, ch, i) => diff | (ch.charCodeAt(0) ^ expected.charCodeAt(i)), 0) === 0;
}

app.get('/api/health', (c) => c.json({ success: true, runtime: 'cloudflare-workers', database: 'http-data-api' }));

app.post('/api/auth/login', async (c) => {
  const body = await c.req.json<{ identifier?: string; username?: string; email?: string; password?: string }>();
  const identifier = (body.identifier || body.username || body.email || '').trim().toLowerCase();
  if (!identifier || !body.password) return c.json({ success: false, message: 'Username/email and password are required.' }, 400);
  const db = new MongoDataApi(c.env);
  const found = await db.findOne<User & { passwordHash?: string; passwordSalt?: string; password?: string }>(collections.users, { $or: [{ username: identifier }, { email: identifier }] });
  const user = found.document;
  const validPassword = user?.passwordHash && user.passwordSalt
    ? await verifyPassword(body.password, user.passwordSalt, user.passwordHash)
    : user?.password ? await bcrypt.compare(body.password, user.password) : false;
  if (!user || !user.isActive || !validPassword) {
    return c.json({ success: false, message: 'Invalid credentials.' }, 401);
  }
  const token = await sign({ sub: entityId(user), role: user.role, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7 }, c.env.JWT_SECRET, 'HS256');
  return c.json({ success: true, token, data: cleanUser(user) });
});

app.get('/api/auth/me', (c) => c.json({ success: true, data: cleanUser(c.get('user')) }));

app.get('/api/products', requirePermission('productsRead'), async (c) => {
  const search = c.req.query('search')?.trim();
  const filter: Record<string, unknown> = { isActive: { $ne: false } };
  if (search) filter.$or = [{ name: { $regex: search, $options: 'i' } }, { sku: { $regex: search, $options: 'i' } }];
  const result = await new MongoDataApi(c.env).find<Record<string, unknown>>(collections.products, filter, 200);
  return c.json({ success: true, data: (result.documents ?? []).map((p) => ({ ...p, id: entityId(p) })) });
});

app.post('/api/products', requirePermission('productsWrite'), async (c) => {
  const product = await c.req.json<Record<string, unknown>>();
  const error = validateProduct(product);
  if (error) return c.json({ success: false, message: error }, 400);
  const db = new MongoDataApi(c.env);
  const exists = await db.findOne(collections.products, { sku: String(product.sku).trim().toUpperCase() });
  if (exists.document) return c.json({ success: false, message: 'SKU already exists.' }, 409);
  const document = normalizeProduct({ ...product, id: crypto.randomUUID(), isActive: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  await db.insertOne(collections.products, document);
  return c.json({ success: true, data: document }, 201);
});

app.put('/api/products/:id', requirePermission('productsWrite'), async (c) => {
  const patch = await c.req.json<Record<string, unknown>>();
  const error = validateProduct(patch, true);
  if (error) return c.json({ success: false, message: error }, 400);
  const document = normalizeProduct({ ...patch, updatedAt: new Date().toISOString() });
  delete document.id;
  const db = new MongoDataApi(c.env);
  if (document.sku) {
    const duplicate = await db.findOne<Record<string, any>>(collections.products, { sku: String(document.sku), isActive: { $ne: false } });
    if (duplicate.document && entityId(duplicate.document) !== c.req.param('id')) return c.json({ success: false, message: 'SKU already exists.' }, 409);
  }
  const result = await db.updateOne<Record<string, unknown>>(collections.products, byId(c.req.param('id')), { $set: document });
  if (!result.matchedCount) return c.json({ success: false, message: 'Product not found.' }, 404);
  const updated = await db.findOne<Record<string, unknown>>(collections.products, byId(c.req.param('id')));
  return c.json({ success: true, data: updated.document ? { ...updated.document, id: entityId(updated.document) } : null });
});

app.get('/api/employees', requirePermission('employeesRead'), async (c) => {
  const result = await new MongoDataApi(c.env).find<User & { passwordHash?: string }>(collections.users, { role: 'employee' }, 200);
  return c.json({ success: true, data: (result.documents ?? []).map(cleanUser) });
});

app.get('/api/analytics', requirePermission('analyticsRead'), async (c) => {
  const db = new MongoDataApi(c.env);
  const [productResult, salesResult] = await Promise.all([
    db.find<Record<string, any>>(collections.products, { isActive: { $ne: false } }, 1000),
    db.find<Record<string, any>>(collections.sales, { type: 'sale' }, 1000),
  ]);
  const products = productResult.documents ?? [];
  const sales = salesResult.documents ?? [];
  return c.json({ success: true, data: {
    products: products.length,
    unitsInStock: products.reduce((sum, product) => sum + Number(product.quantity || 0), 0),
    lowStock: products.filter((product) => Number(product.quantity || 0) < 5).length,
    salesCount: sales.length,
    revenue: sales.reduce((sum, sale) => sum + Number(sale.totalAmount || 0), 0),
  } });
});

app.put('/api/employees/:id/permissions', async (c) => {
  if (c.get('user').role !== 'admin') return c.json({ success: false, message: 'Administrator access required.' }, 403);
  const body = await c.req.json<{ permissions?: Record<string, unknown> }>();
  const allowed = Object.keys(DEFAULT_PERMISSIONS) as Permission[];
  if (!body.permissions || allowed.some((key) => typeof body.permissions?.[key] !== 'boolean') || Object.keys(body.permissions).some((key) => !allowed.includes(key as Permission))) {
    return c.json({ success: false, message: 'Send a boolean value for every supported permission.' }, 400);
  }
  const db = new MongoDataApi(c.env);
  const result = await db.updateOne<User>(collections.users, { $and: [byId(c.req.param('id')), { role: 'employee' }] }, { $set: { permissions: body.permissions, updatedAt: new Date().toISOString() } });
  if (!result.matchedCount) return c.json({ success: false, message: 'Employee not found.' }, 404);
  const updated = await db.findOne<User & { passwordHash?: string }>(collections.users, byId(c.req.param('id')));
  return c.json({ success: true, data: cleanUser(updated.document!) });
});

app.post('/api/sales', requirePermission('salesCreate'), async (c) => {
  const body = await c.req.json<{ items?: { productId: string; quantity: number; color?: string; size?: string }[] }>();
  if (!Array.isArray(body.items) || !body.items.length || body.items.some((x) => !x.productId || !Number.isInteger(x.quantity) || x.quantity < 1)) {
    return c.json({ success: false, message: 'A sale requires valid product IDs and positive integer quantities.' }, 400);
  }
  const db = new MongoDataApi(c.env);
  const saleItems: Record<string, unknown>[] = [];
  const adjusted: { id: string; quantity: number }[] = [];
  let totalAmount = 0;
  try {
    for (const item of body.items) {
      const loaded = await db.findOne<Record<string, any>>(collections.products, { $and: [byId(item.productId), { isActive: { $ne: false } }] });
      const product = loaded.document;
      if (!product) throw new Error(`Product ${item.productId} was not found.`);
      const stock = await db.updateOne(collections.products, { $and: [byId(item.productId), { quantity: { $gte: item.quantity } }] }, { $inc: { quantity: -item.quantity }, $set: { updatedAt: new Date().toISOString() } });
      if (!stock.matchedCount) throw new Error(`Insufficient stock for ${product.name}.`);
      adjusted.push({ id: item.productId, quantity: item.quantity });
      totalAmount += Number(product.retailPrice) * item.quantity;
      saleItems.push({ productId: item.productId, productName: product.name, sku: product.sku, quantity: item.quantity, color: item.color ?? product.colors?.[0] ?? '', size: item.size ?? '', unitPrice: Number(product.retailPrice) });
    }
    const transaction = { id: crypto.randomUUID(), type: 'sale', employeeId: c.get('user').id, items: saleItems, totalAmount, createdAt: new Date().toISOString() };
    await db.insertOne(collections.sales, transaction);
    return c.json({ success: true, data: transaction }, 201);
  } catch (error) {
    for (const item of adjusted.reverse()) await db.updateOne(collections.products, byId(item.id), { $inc: { quantity: item.quantity } });
    return c.json({ success: false, message: error instanceof Error ? error.message : 'Sale could not be completed.' }, 409);
  }
});

function validateProduct(value: Record<string, unknown>, partial = false): string | null {
  const required = ['name', 'sku', 'category', 'retailPrice', 'quantity', 'colors'];
  if (!partial && required.some((key) => value[key] === undefined)) return 'Name, SKU, category, price, quantity and colors are required.';
  if (value.name !== undefined && (typeof value.name !== 'string' || !value.name.trim())) return 'Product name is required.';
  if (value.sku !== undefined && (typeof value.sku !== 'string' || !/^[A-Za-z0-9-]+$/.test(value.sku.trim()))) return 'SKU may contain letters, numbers and hyphens.';
  if (value.category !== undefined && !['Men', 'Women', 'Kids'].includes(String(value.category))) return 'Category must be Men, Women or Kids.';
  if (value.retailPrice !== undefined && (!Number.isFinite(Number(value.retailPrice)) || Number(value.retailPrice) < 0)) return 'Price must be zero or greater.';
  if (value.quantity !== undefined && (!Number.isInteger(Number(value.quantity)) || Number(value.quantity) < 0)) return 'Quantity must be a non-negative integer.';
  if (value.colors !== undefined && (!Array.isArray(value.colors) || !value.colors.length || value.colors.some((x) => typeof x !== 'string' || !x.trim()))) return 'Add at least one valid color.';
  return null;
}

function normalizeProduct<T extends Record<string, any>>(value: T): T {
  const result = { ...value };
  if (typeof result.sku === 'string') result.sku = result.sku.trim().toUpperCase();
  if (typeof result.name === 'string') result.name = result.name.trim();
  if (Array.isArray(result.colors)) result.colors = [...new Set(result.colors.map((x: string) => x.trim()).filter(Boolean))];
  if (result.retailPrice !== undefined) result.retailPrice = Number(result.retailPrice);
  if (result.quantity !== undefined) result.quantity = Number(result.quantity);
  return result;
}

app.notFound((c) => c.req.path.startsWith('/api/')
  ? c.json({ success: false, message: 'API route not found.' }, 404)
  : c.env.ASSETS.fetch(c.req.raw));

export default app;
