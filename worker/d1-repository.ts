import type { Permission, User } from './types';

export type Product = {
  id: string; name: string; sku: string; category: 'Men' | 'Women' | 'Kids';
  retailPrice: number; quantity: number; colors: string[]; isActive: boolean;
  createdAt: string; updatedAt: string;
};

type UserRow = {
  id: string; name: string; username: string; email: string; role: 'admin' | 'employee';
  is_active: number; permissions_json: string; password_hash: string; password_salt: string;
  created_at: string; updated_at: string;
};

type ProductRow = {
  id: string; name: string; sku: string; category: Product['category']; retail_price: number;
  quantity: number; colors_json: string; is_active: number; created_at: string; updated_at: string;
};

const permissionDefaults: Record<Permission, boolean> = {
  productsRead: true, productsWrite: false, salesCreate: true, employeesRead: false, analyticsRead: false,
};

function decodeUser(row: UserRow): User & { passwordHash: string; passwordSalt: string } {
  let permissions = permissionDefaults;
  try { permissions = { ...permissionDefaults, ...JSON.parse(row.permissions_json) }; } catch { /* preserve secure defaults */ }
  return {
    id: row.id, name: row.name, username: row.username, email: row.email, role: row.role,
    isActive: row.is_active === 1, permissions,
    passwordHash: row.password_hash, passwordSalt: row.password_salt,
  };
}

function decodeProduct(row: ProductRow): Product {
  let colors: string[] = [];
  try { colors = JSON.parse(row.colors_json); } catch { /* empty color list */ }
  return {
    id: row.id, name: row.name, sku: row.sku, category: row.category,
    retailPrice: row.retail_price, quantity: row.quantity, colors,
    isActive: row.is_active === 1, createdAt: row.created_at, updatedAt: row.updated_at,
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
      (id,name,sku,category,retail_price,quantity,colors_json,is_active,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,1,?,?)`)
      .bind(product.id, product.name, product.sku, product.category, product.retailPrice,
        product.quantity, JSON.stringify(product.colors), now, now).run();
    return { ...product, isActive: true, createdAt: now, updatedAt: now };
  }

  async updateProduct(id: string, patch: Partial<Product>) {
    const fields: [keyof Product, string, (value: any) => unknown][] = [
      ['name', 'name', (v) => v], ['sku', 'sku', (v) => v], ['category', 'category', (v) => v],
      ['retailPrice', 'retail_price', Number], ['quantity', 'quantity', Number],
      ['colors', 'colors_json', JSON.stringify],
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

  async listEmployees() {
    const rows = await this.db.prepare("SELECT * FROM users WHERE role = 'employee' ORDER BY name").all<UserRow>();
    return (rows.results ?? []).map(decodeUser);
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
      (SELECT COALESCE(SUM(total_amount),0) FROM transactions WHERE type = 'sale') AS revenue
    `).first<{ products: number; unitsInStock: number; lowStock: number; salesCount: number; revenue: number }>();
    return row;
  }

  async createSale(employeeId: string, items: { product: Product; quantity: number; color: string; size: string }[]) {
    const saleId = crypto.randomUUID();
    const now = new Date().toISOString();
    const transactionItems = items.map(({ product, quantity, color, size }) => ({
      productId: product.id, productName: product.name, sku: product.sku, quantity, color, size, unitPrice: product.retailPrice,
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
