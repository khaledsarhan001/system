import type { Permission, User } from './types';

export type Product = {
  id: string; name: string; sku: string; category: 'Men' | 'Women' | 'Kids'; productType: string;
  retailPrice: number; costPrice: number; quantity: number; colors: string[]; imageUrl?: string; isActive: boolean;
  createdAt: string; updatedAt: string;
};

type UserRow = {
  id: string; name: string; username: string; email: string; role: 'admin' | 'employee';
  phone: string; branch: string; job_title: string;
  is_active: number; permissions_json: string; password_hash: string; password_salt: string;
  created_at: string; updated_at: string; last_active_at?: string | null;
};

type ProductRow = {
  id: string; name: string; sku: string; category: Product['category']; retail_price: number; cost_price: number;
  quantity: number; colors_json: string; product_type: string; image_url: string; is_active: number; created_at: string; updated_at: string;
};

const permissionDefaults: Record<Permission, boolean> = {
  productsRead: true, productsWrite: false, salesCreate: true, employeesRead: false, analyticsRead: false,
};

function decodeUser(row: UserRow): User & { passwordHash: string; passwordSalt: string } {
  let permissions = permissionDefaults;
  try { permissions = { ...permissionDefaults, ...JSON.parse(row.permissions_json) }; } catch { /* preserve secure defaults */ }
  return {
    id: row.id, name: row.name, username: row.username, email: row.email, role: row.role,
    phone: row.phone ?? '', branch: row.branch ?? '', jobTitle: row.job_title ?? '',
    isActive: row.is_active === 1, lastActiveAt: row.last_active_at ?? undefined, permissions,
    passwordHash: row.password_hash, passwordSalt: row.password_salt,
  };
}

function decodeProduct(row: ProductRow): Product {
  let colors: string[] = [];
  try { colors = JSON.parse(row.colors_json); } catch { /* empty color list */ }
  return {
    id: row.id, name: row.name, sku: row.sku, category: row.category, productType: row.product_type ?? 'general',
    retailPrice: row.retail_price, costPrice: row.cost_price ?? 0, quantity: row.quantity, colors,
    imageUrl: row.image_url ?? '', isActive: row.is_active === 1, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export class D1Repository {
  constructor(private readonly db: D1Database) {}

  async getUserById(id: string) {
    const row = await this.db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>();
    return row ? decodeUser(row) : null;
  }

  async getUserByIdentifier(identifier: string) {
    const row = await this.db.prepare('SELECT * FROM users WHERE username = ? OR email = ? LIMIT 1')
      .bind(identifier, identifier).first<UserRow>();
    return row ? decodeUser(row) : null;
  }

  async listProducts(search = '') {
    const rows = await this.db.prepare(`
      SELECT * FROM products WHERE is_active = 1
      AND (? = '' OR name LIKE '%' || ? || '%' OR sku LIKE '%' || ? || '%')
      ORDER BY created_at DESC LIMIT 500
    `).bind(search, search, search).all<ProductRow>();
    return (rows.results ?? []).map(decodeProduct);
  }

  async getProduct(id: string) {
    const row = await this.db.prepare('SELECT * FROM products WHERE id = ? AND is_active = 1').bind(id).first<ProductRow>();
    return row ? decodeProduct(row) : null;
  }

  async getProductBySku(sku: string) {
    const row = await this.db.prepare('SELECT * FROM products WHERE sku = ? AND is_active = 1').bind(sku).first<ProductRow>();
    return row ? decodeProduct(row) : null;
  }

  async createProduct(product: Omit<Product, 'createdAt' | 'updatedAt' | 'isActive'>) {
    const now = new Date().toISOString();
    await this.db.prepare(`INSERT INTO products
      (id,name,sku,category,product_type,retail_price,cost_price,quantity,colors_json,image_url,is_active,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?)`)
      .bind(product.id, product.name, product.sku, product.category, product.productType ?? 'general', product.retailPrice,
        product.costPrice ?? 0, product.quantity, JSON.stringify(product.colors), product.imageUrl ?? '', now, now).run();
    return { ...product, isActive: true, createdAt: now, updatedAt: now };
  }

  async updateProduct(id: string, patch: Partial<Product>) {
    const fields: [keyof Product, string, (value: any) => unknown][] = [
      ['name', 'name', (v) => v], ['sku', 'sku', (v) => v], ['category', 'category', (v) => v], ['productType', 'product_type', (v) => v],
      ['retailPrice', 'retail_price', Number], ['costPrice', 'cost_price', Number], ['quantity', 'quantity', Number],
      ['colors', 'colors_json', JSON.stringify],
      ['imageUrl', 'image_url', (v) => v],
    ];
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const [key, column, convert] of fields) {
      if (patch[key] !== undefined) { sets.push(`${column} = ?`); values.push(convert(patch[key])); }
    }
    if (!sets.length) return this.getProduct(id);
    sets.push('updated_at = ?'); values.push(new Date().toISOString(), id);
    const result = await this.db.prepare(`UPDATE products SET ${sets.join(', ')} WHERE id = ? AND is_active = 1`).bind(...values).run();
    if (!result.meta.changes) return null;
    return this.getProduct(id);
  }

  async removeProduct(id: string) {
    const existing = await this.db.prepare('SELECT id FROM products WHERE id = ? AND is_active = 1').bind(id).first<{ id: string }>();
    if (!existing) return null;
    const removed = await this.db.prepare(`DELETE FROM products WHERE id = ? AND is_active = 1 AND NOT EXISTS (
      SELECT 1 FROM transactions t, json_each(t.items_json) item
      WHERE json_extract(item.value, '$.productId') = ?
    )`).bind(id, id).run();
    if (removed.meta.changes > 0) return { deleted: true, archived: false };
    await this.db.prepare('UPDATE products SET is_active = 0, updated_at = ? WHERE id = ? AND is_active = 1')
      .bind(new Date().toISOString(), id).run();
    return { deleted: false, archived: true };
  }

  async listEmployees() {
    const rows = await this.db.prepare("SELECT * FROM users WHERE role = 'employee' ORDER BY name").all<UserRow>();
    return (rows.results ?? []).map(decodeUser);
  }

  async markUserActive(id: string) {
    const timestamp = new Date().toISOString();
    await this.db.prepare('UPDATE users SET last_active_at=? WHERE id=? AND is_active=1').bind(timestamp, id).run();
    return timestamp;
  }

  async createEmployee(employee: { id: string; name: string; username: string; email: string; phone?: string; branch?: string; jobTitle?: string; passwordHash: string; passwordSalt: string; permissions: Record<Permission, boolean> }) {
    const now = new Date().toISOString();
    await this.db.prepare(`INSERT INTO users
      (id,name,username,email,role,password_hash,password_salt,is_active,permissions_json,phone,branch,job_title,created_at,updated_at)
      VALUES (?,?,?,?,'employee',?,?,1,?,?,?,?,?,?)`)
      .bind(employee.id, employee.name, employee.username, employee.email, employee.passwordHash, employee.passwordSalt,
        JSON.stringify(employee.permissions), employee.phone ?? '', employee.branch ?? '', employee.jobTitle ?? '', now, now).run();
    return this.getUserById(employee.id);
  }

  async updateEmployee(id: string, patch: { name?: string; username?: string; email?: string; phone?: string; branch?: string; jobTitle?: string; isActive?: boolean }) {
    const columns: [keyof typeof patch, string][] = [['name','name'],['username','username'],['email','email'],['phone','phone'],['branch','branch'],['jobTitle','job_title']];
    const sets: string[] = []; const values: unknown[] = [];
    for (const [key, column] of columns) if (patch[key] !== undefined) { sets.push(`${column}=?`); values.push(patch[key]); }
    if (patch.isActive !== undefined) { sets.push('is_active=?'); values.push(patch.isActive ? 1 : 0); }
    if (!sets.length) return this.getUserById(id);
    sets.push('updated_at=?'); values.push(new Date().toISOString(), id);
    try {
      const result = await this.db.prepare(`UPDATE users SET ${sets.join(',')} WHERE id=? AND role='employee'`).bind(...values).run();
      return result.meta.changes ? this.getUserById(id) : null;
    } catch { throw new Error('Username or email is already in use.'); }
  }

  async removeEmployee(id: string) {
    const existing = await this.db.prepare("SELECT id FROM users WHERE id=? AND role='employee'").bind(id).first<{id:string}>();
    if (!existing) return null;
    const removed = await this.db.prepare("DELETE FROM users WHERE id=? AND role='employee' AND NOT EXISTS (SELECT 1 FROM transactions WHERE employee_id=?)").bind(id, id).run();
    if (removed.meta.changes > 0) return { deleted: true, archived: false };
    await this.db.prepare("UPDATE users SET is_active=0,updated_at=? WHERE id=? AND role='employee'").bind(new Date().toISOString(), id).run();
    return { deleted: false, archived: true };
  }

  async updateEmployeePermissions(id: string, permissions: Record<Permission, boolean>) {
    const result = await this.db.prepare("UPDATE users SET permissions_json = ?, updated_at = ? WHERE id = ? AND role = 'employee'")
      .bind(JSON.stringify(permissions), new Date().toISOString(), id).run();
    return result.meta.changes ? this.getUserById(id) : null;
  }

  async analytics() {
    const row = await this.db.prepare(`SELECT
      (SELECT COUNT(*) FROM products WHERE is_active = 1) AS products,
      (SELECT COALESCE(SUM(quantity),0) FROM products WHERE is_active = 1) AS unitsInStock,
      (SELECT COUNT(*) FROM products WHERE is_active = 1 AND quantity < 5) AS lowStock,
      (SELECT COUNT(*) FROM transactions WHERE type = 'sale') AS salesCount,
      (SELECT COALESCE(SUM(total_amount),0) FROM transactions WHERE type = 'sale') AS revenue,
      (SELECT COALESCE(SUM(json_extract(item.value,'$.costPriceAtSale') * json_extract(item.value,'$.quantity')),0)
        FROM transactions AS t, json_each(t.items_json) AS item WHERE t.type = 'sale') AS cogs,
      (SELECT COUNT(*) FROM transactions WHERE type = 'return') AS returnsCount,
      (SELECT COALESCE(SUM(total_amount),0) FROM transactions WHERE type = 'return') AS returnsValue,
      (SELECT COALESCE(SUM(quantity * cost_price),0) FROM products WHERE is_active = 1) AS inventoryCost
    `).first<{ products: number; unitsInStock: number; lowStock: number; salesCount: number; revenue: number; cogs: number; returnsCount: number; returnsValue: number; inventoryCost: number }>();
    const [daily, popular] = await Promise.all([
      this.db.prepare(`SELECT date(created_at) AS day, COALESCE(SUM(CASE WHEN type='sale' THEN total_amount ELSE -total_amount END),0) AS revenue,
        SUM(CASE WHEN type='sale' THEN 1 ELSE 0 END) AS salesCount
        FROM transactions WHERE date(created_at) >= date('now','-6 days')
        GROUP BY date(created_at) ORDER BY day`).all<{ day: string; revenue: number; salesCount: number }>(),
      this.db.prepare(`SELECT json_extract(item.value,'$.productName') AS name,
        SUM(json_extract(item.value,'$.quantity')) AS quantity
        FROM transactions t, json_each(t.items_json) item WHERE t.type='sale'
        GROUP BY name ORDER BY quantity DESC LIMIT 5`).all<{ name: string; quantity: number }>(),
    ]);
    return { ...row, dailySales: daily.results ?? [], topProducts: popular.results ?? [] };
  }

  async profitTimeline(period: 'daily' | 'weekly' | 'monthly' | 'yearly') {
    const config = {
      daily: { bucket: "%Y-%m-%dT%H:00:00", since: '-24 hours' },
      weekly: { bucket: '%Y-%m-%d', since: '-6 days' },
      monthly: { bucket: '%Y-%m-%d', since: '-29 days' },
      yearly: { bucket: '%Y-%m', since: '-11 months' },
    }[period];
    const result = await this.db.prepare(`SELECT strftime(?, t.created_at) AS period,
      COALESCE(SUM(CASE WHEN t.type='sale' THEN json_extract(item.value,'$.unitPrice') * json_extract(item.value,'$.quantity') ELSE 0 END),0) AS revenue,
      COALESCE(SUM((CASE WHEN t.type='sale' THEN 1 ELSE -1 END) *
        (json_extract(item.value,'$.unitPrice') - json_extract(item.value,'$.costPriceAtSale')) * json_extract(item.value,'$.quantity')),0) AS profit,
      COUNT(DISTINCT CASE WHEN t.type='sale' THEN t.id END) AS salesCount,
      COUNT(DISTINCT CASE WHEN t.type='return' THEN t.id END) AS returnsCount
      FROM transactions t, json_each(t.items_json) item
      WHERE t.created_at >= datetime('now', ?) GROUP BY period ORDER BY period`)
      .bind(config.bucket, config.since).all<{ period: string; revenue: number; profit: number; salesCount: number; returnsCount: number }>();
    return result.results ?? [];
  }

  async listTransactions() {
    const rows = await this.db.prepare(`SELECT t.*, u.name AS employee_name FROM transactions t
      LEFT JOIN users u ON u.id=t.employee_id ORDER BY t.created_at DESC LIMIT 500`).all<any>();
    return (rows.results ?? []).map((row) => ({ id: row.id, type: row.type, employeeId: row.employee_id,
      employeeName: row.employee_name_snapshot || row.employee_name || '', items: JSON.parse(row.items_json), totalAmount: row.total_amount,
      returnReason: row.return_reason ?? '', createdAt: row.created_at }));
  }

  async importLegacyCatalog(employeeId: string, products: any[], transactions: any[]) {
    const existing = await this.db.prepare('SELECT sku,id FROM products').all<{ sku: string; id: string }>();
    const bySku = new Map((existing.results ?? []).map((row) => [row.sku.toUpperCase(), row.id]));
    const idMap = new Map<string, string>(); let productsAdded = 0;
    for (const old of products) {
      const sku = String(old.sku ?? '').trim().toUpperCase();
      if (!sku || bySku.has(sku)) { if (old.id && bySku.has(sku)) idMap.set(String(old.id), bySku.get(sku)!); continue; }
      const category = (['Men','Women','Kids'].includes(old.audience ?? old.category) ? (old.audience ?? old.category) : 'Men') as Product['category'];
      const productType = ['Men','Women','Kids'].includes(old.category) ? (old.productType ?? 'general') : String(old.category ?? 'general').slice(0,80);
      const product = { id: crypto.randomUUID(), name: String(old.name ?? 'منتج سابق').slice(0,150), sku,
        category, productType, retailPrice: Math.max(0, Number(old.retailPrice) || 0), costPrice: Math.max(0, Number(old.costPrice) || 0),
        quantity: Math.max(0, Math.floor(Number(old.quantity) || 0)), colors: Array.isArray(old.colors) ? old.colors.map(String).slice(0,40) : [], imageUrl: typeof old.imageUrl === 'string' ? old.imageUrl.slice(0, 1_500_000) : '' };
      await this.createProduct(product);
      if (old.id) idMap.set(String(old.id), product.id);
      bySku.set(sku, product.id); productsAdded++;
    }
    let transactionsAdded = 0;
    for (const old of transactions) {
      if (!['sale','return'].includes(old.type)) continue;
      const sourceId = old.id ? String(old.id).slice(0,200) : null;
      if (sourceId && await this.db.prepare('SELECT 1 AS found FROM transactions WHERE legacy_source_id=?').bind(sourceId).first()) continue;
      const oldItems = Array.isArray(old.items) ? old.items : [old];
      const items = oldItems.map((source: any) => {
        const productId = idMap.get(String(source.productId ?? '')) ?? '';
        const quantity = Math.max(1, Math.floor(Number(source.quantity) || 1));
        return { productId, productName: String(source.productName ?? 'منتج سابق'), sku: String(source.sku ?? ''), quantity,
          unitPrice: Math.max(0, Number(source.unitPrice) || 0), costPriceAtSale: Math.max(0, Number(source.costPriceAtSale ?? source.costPrice) || 0), color: String(source.color ?? ''), size: String(source.size ?? '') };
      });
      const createdAt = Number.isFinite(Date.parse(old.createdAt)) ? new Date(old.createdAt).toISOString() : new Date().toISOString();
      await this.db.prepare(`INSERT INTO transactions (id,type,employee_id,items_json,total_amount,return_reason,employee_name_snapshot,legacy_source_id,created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), old.type, employeeId, JSON.stringify(items),
          Math.max(0, Number(old.totalAmount ?? old.totalPrice ?? old.total) || items.reduce((sum: number, item: any) => sum + item.unitPrice * item.quantity, 0)), String(old.returnReason ?? old.reason ?? '').slice(0,500), String(old.employeeName ?? old.employee ?? '').slice(0,100), sourceId, createdAt).run();
      transactionsAdded++;
    }
    return { productsAdded, transactionsAdded };
  }

  async createReturn(employeeId: string, items: { product: Product; quantity: number; color: string; size: string }[], reason: string) {
    const id = crypto.randomUUID(); const now = new Date().toISOString();
    const snapshot = items.map(({ product, quantity, color, size }) => ({ productId: product.id, productName: product.name,
      sku: product.sku, quantity, color, size, unitPrice: product.retailPrice, costPriceAtSale: product.costPrice }));
    const statements = items.map(({ product, quantity }) => this.db.prepare(
      'UPDATE products SET quantity=quantity+?,updated_at=? WHERE id=? AND is_active=1').bind(quantity, now, product.id));
    await this.db.batch(statements);
    try {
      await this.db.prepare(`INSERT INTO transactions (id,type,employee_id,items_json,total_amount,return_reason,created_at)
        VALUES (?,'return',?,?,?,?,?)`).bind(id, employeeId, JSON.stringify(snapshot), items.reduce((s, x) => s + x.product.retailPrice*x.quantity, 0), reason, now).run();
    } catch (error) {
      await this.db.batch(items.map(({ product, quantity }) => this.db.prepare(
        'UPDATE products SET quantity=MAX(0,quantity-?),updated_at=? WHERE id=?').bind(quantity, new Date().toISOString(), product.id)));
      throw error;
    }
    return { id, type: 'return', employeeId, items: snapshot, totalAmount: items.reduce((s, x) => s + x.product.retailPrice*x.quantity, 0), returnReason: reason, createdAt: now };
  }

  async createSale(employeeId: string, items: { product: Product; quantity: number; color: string; size: string }[]) {
    const saleId = crypto.randomUUID();
    const now = new Date().toISOString();
    const transactionItems = items.map(({ product, quantity, color, size }) => ({
      productId: product.id, productName: product.name, sku: product.sku, quantity, color, size,
      unitPrice: product.retailPrice, costPriceAtSale: product.costPrice,
    }));
    const totalAmount = items.reduce((sum, item) => sum + item.product.retailPrice * item.quantity, 0);
    const stockStatements = items.map(({ product, quantity }) => this.db.prepare(
      'UPDATE products SET quantity = quantity - ?, updated_at = ? WHERE id = ? AND is_active = 1 AND quantity >= ?'
    ).bind(quantity, now, product.id, quantity));
    const changed = await this.db.batch(stockStatements);
    const failedAt = changed.findIndex((result) => result.meta.changes !== 1);
    if (failedAt !== -1) {
      const rollback = items.filter((_, index) => changed[index].meta.changes === 1).map(({ product, quantity }) => this.db.prepare(
        'UPDATE products SET quantity = quantity + ?, updated_at = ? WHERE id = ?'
      ).bind(quantity, new Date().toISOString(), product.id));
      if (rollback.length) await this.db.batch(rollback);
      throw new Error(`Insufficient stock for ${items[failedAt].product.name}.`);
    }
    try {
      await this.db.prepare(`INSERT INTO transactions (id,type,employee_id,items_json,total_amount,created_at)
        VALUES (?,'sale',?,?,?,?)`).bind(saleId, employeeId, JSON.stringify(transactionItems), totalAmount, now).run();
    } catch (error) {
      const rollback = items.map(({ product, quantity }) => this.db.prepare(
        'UPDATE products SET quantity = quantity + ?, updated_at = ? WHERE id = ?'
      ).bind(quantity, new Date().toISOString(), product.id));
      await this.db.batch(rollback);
      throw error;
    }
    return { id: saleId, type: 'sale', employeeId, items: transactionItems, totalAmount, createdAt: now };
  }
}
