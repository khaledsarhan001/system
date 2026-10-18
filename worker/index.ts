import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { sign, verify } from 'hono/jwt';
import { D1Repository, type Product } from './d1-repository';
import { DEFAULT_PERMISSIONS, PERMISSION_LABELS, type Env, type Permission, type User } from './types';

type JwtClaims = { sub?: string; role?: string; exp?: number; [key: string]: unknown };
type Variables = { user: User; jwtPayload: JwtClaims };
const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use('/api/*', cors({ origin: '*', allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], allowHeaders: ['Content-Type', 'Authorization'] }));
app.use('/api/*', async (c, next) => {
  try { await next(); }
  catch (error) {
    console.error(error);
    return c.json({ success: false, message: error instanceof Error ? error.message : 'Unexpected server error.' }, 500);
  }
});

app.use('/api/*', async (c, next) => {
  if (c.req.path === '/api/auth/login' || c.req.path === '/api/health' || c.req.method === 'OPTIONS') return next();
  const authorization = c.req.header('Authorization') ?? '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (!token) return c.json({ success: false, message: 'Authentication required.' }, 401);
  try {
    const claims = await verify(token, c.env.JWT_SECRET, 'HS256');
    if (typeof claims.sub !== 'string' || !claims.sub) return c.json({ success: false, message: 'Invalid session token.' }, 401);
    c.set('jwtPayload', claims as JwtClaims);
    await next();
  } catch {
    return c.json({ success: false, message: 'Session expired or invalid. Please sign in again.' }, 401);
  }
});

app.use('/api/*', async (c, next) => {
  if (c.req.path === '/api/auth/login' || c.req.path === '/api/health' || c.req.method === 'OPTIONS') return next();
  const claims = c.get('jwtPayload');
  if (!claims?.sub) return c.json({ success: false, message: 'Authentication required.' }, 401);
  const user = await new D1Repository(c.env.DB).getUserById(claims.sub);
  if (!user || !user.isActive) return c.json({ success: false, message: 'Account is unavailable.' }, 401);
  c.set('user', { ...user, permissions: { ...DEFAULT_PERMISSIONS, ...user.permissions } });
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

function cleanUser(user: User) {
  return { id: user.id, name: user.name, username: user.username, email: user.email,
    phone: user.phone ?? '', branch: user.branch ?? '', jobTitle: user.jobTitle ?? '',
    role: user.role, isActive: user.isActive, lastActiveAt: user.lastActiveAt, permissions: { ...DEFAULT_PERMISSIONS, ...user.permissions } };
}

async function hashPassword(password: string, salt = crypto.getRandomValues(new Uint8Array(16))) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  // Cloudflare Workers caps PBKDF2 at 100,000 iterations.
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' }, key, 256);
  return { passwordHash: [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join(''), passwordSalt: [...salt].map((b) => b.toString(16).padStart(2, '0')).join('') };
}

async function verifyPassword(password: string, saltHex: string, expected: string) {
  const salt = new Uint8Array(saltHex.match(/.{2}/g)?.map((v) => parseInt(v, 16)) ?? []);
  if (salt.length !== 16) return false;
  const actual = (await hashPassword(password, salt)).passwordHash;
  return actual.length === expected.length && [...actual].reduce((diff, ch, i) => diff | (ch.charCodeAt(0) ^ expected.charCodeAt(i)), 0) === 0;
}

app.get('/api/health', (c) => c.json({ success: true, runtime: 'cloudflare-workers', database: 'cloudflare-d1' }));

app.post('/api/auth/login', async (c) => {
  const body = await c.req.json<{ identifier?: string; username?: string; email?: string; password?: string }>();
  const identifier = (body.identifier || body.username || body.email || '').trim().toLowerCase();
  if (!identifier || !body.password) return c.json({ success: false, message: 'Username/email and password are required.' }, 400);
  const user = await new D1Repository(c.env.DB).getUserByIdentifier(identifier);
  const validPassword = user ? await verifyPassword(body.password, user.passwordSalt, user.passwordHash) : false;
  if (!user || !user.isActive || !validPassword) {
    return c.json({ success: false, message: 'Invalid credentials.' }, 401);
  }
  const token = await sign({ sub: user.id, role: user.role, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7 }, c.env.JWT_SECRET, 'HS256');
  return c.json({ success: true, token, data: cleanUser(user) });
});

app.get('/api/auth/me', (c) => c.json({ success: true, data: cleanUser(c.get('user')) }));

app.post('/api/employees/heartbeat', async (c) => {
  const user = c.get('user');
  const lastActiveAt = await new D1Repository(c.env.DB).markUserActive(user.id);
  return c.json({ success: true, data: { lastActiveAt } });
});

app.post('/api/admin/factory-reset', async (c) => {
  const user = c.get('user');
  if (user.role !== 'admin') return c.json({ success: false, message: 'مدير النظام فقط يمكنه تنفيذ إعادة ضبط المصنع.' }, 403);
  const body = await c.req.json<{ password?: string }>();
  if (!body.password || !await verifyPassword(body.password, user.passwordSalt, user.passwordHash)) {
    return c.json({ success: false, message: 'كلمة مرور المدير غير صحيحة.' }, 401);
  }
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM transactions'),
    c.env.DB.prepare('DELETE FROM products'),
  ]);
  return c.json({ success: true, message: 'Inventory and transaction data cleared.' });
});

app.get('/api/products', requirePermission('productsRead'), async (c) => {
  const search = c.req.query('search')?.trim();
  return c.json({ success: true, data: await new D1Repository(c.env.DB).listProducts(search) });
});

app.post('/api/products', requirePermission('productsWrite'), async (c) => {
  const product = await c.req.json<Record<string, unknown>>();
  const error = validateProduct(product);
  if (error) return c.json({ success: false, message: error }, 400);
  const db = new D1Repository(c.env.DB);
  const normalized = normalizeProduct(product);
  if (await db.getProductBySku(normalized.sku)) return c.json({ success: false, message: 'SKU already exists.' }, 409);
  const document = await db.createProduct({ ...normalized, id: crypto.randomUUID() });
  return c.json({ success: true, data: document }, 201);
});

app.delete('/api/products/:id', requirePermission('productsWrite'), async (c) => {
  const result = await new D1Repository(c.env.DB).removeProduct(c.req.param('id'));
  if (!result) return c.json({ success: false, message: 'Product not found.' }, 404);
  return c.json({ success: true, data: result, message: result.archived ? 'Product was removed from inventory; its transaction history was preserved.' : 'Product deleted.' });
});

app.post('/api/employees', async (c) => {
  if (c.get('user').role !== 'admin') return c.json({ success: false, message: 'Administrator access required.' }, 403);
  const body = await c.req.json<{ name?: string; username?: string; email?: string; password?: string; phone?: string; branch?: string; jobTitle?: string; permissions?: Record<string, unknown> }>();
  const name = body.name?.trim() ?? '', username = body.username?.trim().toLowerCase() ?? '', email = body.email?.trim().toLowerCase() ?? '';
  if (!name || !/^[a-z0-9._-]{3,40}$/.test(username) || !/^\S+@\S+\.\S+$/.test(email) || (body.password?.length ?? 0) < 8) {
    return c.json({ success: false, message: 'أدخل الاسم واسم مستخدم صالحًا وبريدًا إلكترونيًا وكلمة مرور من 8 أحرف على الأقل.' }, 400);
  }
  const permissions = { ...DEFAULT_PERMISSIONS };
  for (const key of Object.keys(DEFAULT_PERMISSIONS) as Permission[]) {
    if (body.permissions?.[key] !== undefined) {
      if (typeof body.permissions[key] !== 'boolean') return c.json({ success: false, message: 'صلاحيات الموظف يجب أن تكون قيمًا منطقية.' }, 400);
      permissions[key] = body.permissions[key] as boolean;
    }
  }
  const credentials = await hashPassword(body.password!);
  try {
    const user = await new D1Repository(c.env.DB).createEmployee({ id: crypto.randomUUID(), name, username, email,
      phone: body.phone, branch: body.branch, jobTitle: body.jobTitle, ...credentials, permissions });
    return c.json({ success: true, data: user && cleanUser(user) }, 201);
  } catch (error) {
    return c.json({ success: false, message: 'اسم المستخدم أو البريد الإلكتروني مستخدم بالفعل.' }, 409);
  }
});

app.put('/api/employees/:id', async (c) => {
  if (c.get('user').role !== 'admin') return c.json({ success: false, message: 'Administrator access required.' }, 403);
  const body = await c.req.json<{ name?: string; username?: string; email?: string; phone?: string; branch?: string; jobTitle?: string; isActive?: boolean }>();
  if (body.email !== undefined && !/^\S+@\S+\.\S+$/.test(body.email.trim())) return c.json({ success: false, message: 'أدخل بريدًا إلكترونيًا صحيحًا.' }, 400);
  if (body.username !== undefined && !/^[a-z0-9._-]{3,40}$/i.test(body.username.trim())) return c.json({ success: false, message: 'اسم المستخدم يجب أن يحتوي على 3 أحرف على الأقل.' }, 400);
  const patch = { ...body, ...(body.name !== undefined ? { name: body.name.trim() } : {}), ...(body.username !== undefined ? { username: body.username.trim().toLowerCase() } : {}), ...(body.email !== undefined ? { email: body.email.trim().toLowerCase() } : {}) };
  try {
    const updated = await new D1Repository(c.env.DB).updateEmployee(c.req.param('id'), patch);
    if (!updated) return c.json({ success: false, message: 'Employee not found.' }, 404);
    return c.json({ success: true, data: cleanUser(updated) });
  } catch (error) { return c.json({ success: false, message: error instanceof Error ? error.message : 'تعذر تحديث الموظف.' }, 409); }
});

app.delete('/api/employees/:id', async (c) => {
  if (c.get('user').role !== 'admin') return c.json({ success: false, message: 'Administrator access required.' }, 403);
  const result = await new D1Repository(c.env.DB).removeEmployee(c.req.param('id'));
  if (!result) return c.json({ success: false, message: 'Employee not found.' }, 404);
  return c.json({ success: true, data: result, message: result.archived ? 'Employee has transaction history and was deactivated to preserve audit records.' : 'Employee account deleted.' });
});

app.put('/api/products/:id', requirePermission('productsWrite'), async (c) => {
  const patch = await c.req.json<Record<string, unknown>>();
  const error = validateProduct(patch, true);
  if (error) return c.json({ success: false, message: error }, 400);
  const db = new D1Repository(c.env.DB);
  const id = c.req.param('id');
  const normalized = normalizeProduct(patch);
  if (normalized.sku) {
    const duplicate = await db.getProductBySku(normalized.sku);
    if (duplicate && duplicate.id !== id) return c.json({ success: false, message: 'SKU already exists.' }, 409);
  }
  const updated = await db.updateProduct(id, normalized);
  if (!updated) return c.json({ success: false, message: 'Product not found.' }, 404);
  return c.json({ success: true, data: updated });
});

app.get('/api/employees', requirePermission('employeesRead'), async (c) => {
  const result = await new D1Repository(c.env.DB).listEmployees();
  return c.json({ success: true, data: result.map(cleanUser) });
});

app.get('/api/analytics', requirePermission('analyticsRead'), async (c) => {
  return c.json({ success: true, data: await new D1Repository(c.env.DB).analytics() });
});

app.get('/api/analytics/profits', requirePermission('analyticsRead'), async (c) => {
  const period = c.req.query('period') ?? 'monthly';
  if (!['daily', 'weekly', 'monthly', 'yearly'].includes(period)) {
    return c.json({ success: false, message: 'الفترة المطلوبة غير صالحة.' }, 400);
  }
  const data = await new D1Repository(c.env.DB).profitTimeline(period as 'daily' | 'weekly' | 'monthly' | 'yearly');
  return c.json({ success: true, data });
});

app.get('/api/transactions', requirePermission('analyticsRead'), async (c) => {
  return c.json({ success: true, data: await new D1Repository(c.env.DB).listTransactions() });
});

app.post('/api/returns', requirePermission('salesCreate'), async (c) => {
  const body = await c.req.json<{ items?: { productId: string; quantity: number; color?: string; size?: string }[]; reason?: string }>();
  if (!Array.isArray(body.items) || !body.items.length || body.items.some((x) => !x.productId || !Number.isInteger(x.quantity) || x.quantity < 1)) {
    return c.json({ success: false, message: 'حدد المنتجات والكميات الصحيحة للمرتجع.' }, 400);
  }
  const db = new D1Repository(c.env.DB); const items: { product: Product; quantity: number; color: string; size: string }[] = [];
  for (const item of body.items) {
    const product = await db.getProduct(item.productId);
    if (!product) return c.json({ success: false, message: 'أحد المنتجات غير موجود.' }, 404);
    items.push({ product, quantity: item.quantity, color: item.color ?? product.colors[0] ?? '', size: item.size ?? '' });
  }
  const transaction = await db.createReturn(c.get('user').id, items, (body.reason ?? '').slice(0, 500));
  return c.json({ success: true, data: transaction }, 201);
});

app.post('/api/legacy/import', async (c) => {
  const user = c.get('user');
  if (user.role !== 'admin') return c.json({ success: false, message: 'Administrator access required.' }, 403);
  const body = await c.req.json<{ products?: unknown[]; transactions?: unknown[] }>();
  if (!Array.isArray(body.products) || !Array.isArray(body.transactions) || body.products.length > 2000 || body.transactions.length > 10000) {
    return c.json({ success: false, message: 'بيانات الإصدار السابق غير صالحة أو أكبر من الحد المسموح.' }, 400);
  }
  const products = body.products.filter((item): item is Record<string, any> => !!item && typeof item === 'object');
  const transactions = body.transactions.filter((item): item is Record<string, any> => !!item && typeof item === 'object');
  const result = await new D1Repository(c.env.DB).importLegacyCatalog(user.id, products, transactions);
  return c.json({ success: true, data: result });
});

app.put('/api/employees/:id/permissions', async (c) => {
  if (c.get('user').role !== 'admin') return c.json({ success: false, message: 'Administrator access required.' }, 403);
  const body = await c.req.json<{ permissions?: Record<string, unknown> }>();
  const allowed = Object.keys(DEFAULT_PERMISSIONS) as Permission[];
  if (!body.permissions || allowed.some((key) => typeof body.permissions?.[key] !== 'boolean') || Object.keys(body.permissions).some((key) => !allowed.includes(key as Permission))) {
    return c.json({ success: false, message: 'Send a boolean value for every supported permission.' }, 400);
  }
  const updated = await new D1Repository(c.env.DB).updateEmployeePermissions(c.req.param('id'), body.permissions as Record<Permission, boolean>);
  if (!updated) return c.json({ success: false, message: 'Employee not found.' }, 404);
  return c.json({ success: true, data: cleanUser(updated) });
});

app.post('/api/sales', requirePermission('salesCreate'), async (c) => {
  const body = await c.req.json<{ items?: { productId: string; quantity: number; color?: string; size?: string }[] }>();
  if (!Array.isArray(body.items) || !body.items.length || body.items.some((x) => !x.productId || !Number.isInteger(x.quantity) || x.quantity < 1)) {
    return c.json({ success: false, message: 'A sale requires valid product IDs and positive integer quantities.' }, 400);
  }
  const db = new D1Repository(c.env.DB);
  try {
    const items: { product: Product; quantity: number; color: string; size: string }[] = [];
    for (const item of body.items) {
      const product = await db.getProduct(item.productId);
      if (!product) return c.json({ success: false, message: `Product ${item.productId} was not found.` }, 404);
      items.push({ product, quantity: item.quantity, color: item.color ?? product.colors[0] ?? '', size: item.size ?? '' });
    }
    const transaction = await db.createSale(c.get('user').id, items);
    return c.json({ success: true, data: transaction }, 201);
  } catch (error) {
    return c.json({ success: false, message: error instanceof Error ? error.message : 'Sale could not be completed.' }, 409);
  }
});

function validateProduct(value: Record<string, unknown>, partial = false): string | null {
  const required = ['name', 'sku', 'category', 'retailPrice', 'quantity', 'colors'];
  if (!partial && required.some((key) => value[key] === undefined)) return 'Name, SKU, category, price, quantity and colors are required.';
  if (value.name !== undefined && (typeof value.name !== 'string' || !value.name.trim())) return 'Product name is required.';
  if (value.sku !== undefined && (typeof value.sku !== 'string' || !/^[A-Za-z0-9-]+$/.test(value.sku.trim()))) return 'SKU may contain letters, numbers and hyphens.';
  if (value.category !== undefined && !['Men', 'Women', 'Kids'].includes(String(value.category))) return 'Category must be Men, Women or Kids.';
  if (value.productType !== undefined && (typeof value.productType !== 'string' || value.productType.length > 80)) return 'Product type must be 80 characters or fewer.';
  if (value.imageUrl !== undefined && (typeof value.imageUrl !== 'string' || value.imageUrl.length > 1500000 || (value.imageUrl && !/^https:\/\//i.test(value.imageUrl) && !/^data:image\/(png|jpeg|webp);base64,/i.test(value.imageUrl)))) return 'Product image must be a secure image URL or PNG/JPEG/WebP upload under 1.5 MB.';
  if (value.retailPrice !== undefined && (!Number.isFinite(Number(value.retailPrice)) || Number(value.retailPrice) < 0)) return 'Price must be zero or greater.';
  if (value.costPrice !== undefined && (!Number.isFinite(Number(value.costPrice)) || Number(value.costPrice) < 0)) return 'Cost price must be zero or greater.';
  if (value.quantity !== undefined && (!Number.isInteger(Number(value.quantity)) || Number(value.quantity) < 0)) return 'Quantity must be a non-negative integer.';
  if (value.colors !== undefined && (!Array.isArray(value.colors) || !value.colors.length || value.colors.some((x) => typeof x !== 'string' || !x.trim()))) return 'Add at least one valid color.';
  return null;
}

function normalizeProduct(value: Record<string, any>): any {
  const result = { ...value };
  if (typeof result.sku === 'string') result.sku = result.sku.trim().toUpperCase();
  if (typeof result.name === 'string') result.name = result.name.trim();
  if (typeof result.productType === 'string') result.productType = result.productType.trim() || 'general';
  if (typeof result.imageUrl === 'string') result.imageUrl = result.imageUrl.trim();
  if (Array.isArray(result.colors)) result.colors = [...new Set(result.colors.map((x: string) => x.trim()).filter(Boolean))];
  if (result.retailPrice !== undefined) result.retailPrice = Number(result.retailPrice);
  if (result.quantity !== undefined) result.quantity = Number(result.quantity);
  return result;
}

app.notFound(async (c) => {
  if (c.req.path.startsWith('/api/')) return c.json({ success: false, message: 'API route not found.' }, 404);
  const response = await c.env.ASSETS.fetch(c.req.raw);
  if (response.headers.get('content-type')?.includes('text/html')) {
    const headers = new Headers(response.headers);
    headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    headers.set('Pragma', 'no-cache');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
  return response;
});

export default app;
