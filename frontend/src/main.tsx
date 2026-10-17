import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Html5Qrcode } from 'html5-qrcode';
import './style.css';

type Permission = 'productsRead' | 'productsWrite' | 'salesCreate' | 'employeesRead' | 'analyticsRead';
type User = { id: string; name: string; username: string; email: string; role: 'admin' | 'employee'; permissions: Record<Permission, boolean> };
type Product = { id: string; name: string; sku: string; category: 'Men' | 'Women' | 'Kids'; retailPrice: number; quantity: number; colors: string[]; isActive?: boolean };
type Employee = User & { isActive: boolean };

const permissionNames: [Permission, string][] = [['productsRead', 'عرض المنتجات'], ['productsWrite', 'إضافة وتعديل المنتجات والمخزون'], ['salesCreate', 'تسجيل المبيعات'], ['employeesRead', 'عرض الموظفين'], ['analyticsRead', 'عرض التقارير']];
const permissionDefaults: Record<Permission, boolean> = { productsRead: true, productsWrite: false, salesCreate: true, employeesRead: false, analyticsRead: false };

function App() {
  const [token, setToken] = useState(() => localStorage.getItem('apparel_token') || '');
  const [user, setUser] = useState<User | null>(null);
  const [tab, setTab] = useState<'products' | 'sales' | 'employees'>('products');
  const [products, setProducts] = useState<Product[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [query, setQuery] = useState('');
  const [cart, setCart] = useState<Record<string, number>>({});
  const [editing, setEditing] = useState<Product | null | 'new'>(null);
  const [busy, setBusy] = useState(false);
  const [scannerActive, setScannerActive] = useState(false);
  const [message, setMessage] = useState('');
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const lastScanRef = useRef({ code: '', at: 0 });
  const can = (permission: Permission) => user?.role === 'admin' || user?.permissions?.[permission] === true;
  const cartItems = useMemo(() => products.filter((p) => cart[p.id]).map((p) => ({ ...p, count: cart[p.id] })), [products, cart]);
  const cartTotal = cartItems.reduce((sum, p) => sum + p.retailPrice * p.count, 0);

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('content-type', 'application/json');
    if (token) headers.set('authorization', `Bearer ${token}`);
    const response = await fetch(`/api${path}`, { ...init, headers });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || `Request failed (${response.status})`);
    return body as T;
  }

  async function loadProducts() {
    const response = await request<{ data: Product[] }>('/products');
    setProducts(response.data ?? []);
  }
  async function loadEmployees() {
    const response = await request<{ data: Employee[] }>('/employees');
    setEmployees(response.data ?? []);
  }

  useEffect(() => {
    if (!token) return;
    request<{ data: User }>('/auth/me').then(({ data }) => setUser(data)).catch(() => { localStorage.removeItem('apparel_token'); setToken(''); setUser(null); });
  }, [token]);

  useEffect(() => {
    if (!user) return;
    setMessage('');
    if (tab === 'products' && can('productsRead')) loadProducts().catch((e) => setMessage(e.message));
    if (tab === 'employees' && user.role === 'admin') loadEmployees().catch((e) => setMessage(e.message));
  }, [user, tab]);

  useEffect(() => () => { scannerRef.current?.stop().catch(() => undefined); }, []);

  async function login(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage('');
    const form = new FormData(event.currentTarget);
    try {
      const result = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier: form.get('identifier'), password: form.get('access-code') }) });
      const body = await result.json();
      if (!result.ok) throw new Error(result.status === 401 ? 'اسم المستخدم أو كلمة المرور غير صحيحة. اكتب كلمة المرور يدويًا.' : body.message || `تعذر تسجيل الدخول (${result.status})`);
      localStorage.setItem('apparel_token', body.token); setToken(body.token); setUser(body.data);
    } catch (e) { setMessage(e instanceof Error ? e.message : 'تعذر تسجيل الدخول'); }
    finally { setBusy(false); }
  }

  async function saveProduct(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!editing) return;
    const form = new FormData(event.currentTarget);
    const payload = { name: form.get('name'), sku: form.get('sku'), category: form.get('category'), retailPrice: Number(form.get('retailPrice')), quantity: Number(form.get('quantity')), colors: String(form.get('colors')).split(',').map((x) => x.trim()).filter(Boolean) };
    setBusy(true); setMessage('');
    try {
      const isNew = editing === 'new';
      await request(isNew ? '/products' : `/products/${editing.id}`, { method: isNew ? 'POST' : 'PUT', body: JSON.stringify(payload) });
      setEditing(null); await loadProducts(); setMessage(isNew ? 'تمت إضافة المنتج' : 'تم تحديث المنتج');
    } catch (e) { setMessage(e instanceof Error ? e.message : 'تعذر حفظ المنتج'); }
    finally { setBusy(false); }
  }

  function addScannedCode(raw: string) {
    const code = raw.trim().toUpperCase();
    const now = Date.now();
    if (lastScanRef.current.code === code && now - lastScanRef.current.at < 1800) return;
    lastScanRef.current = { code, at: now };
    const product = products.find((p) => p.sku.toUpperCase() === code);
    if (!product) { setMessage(`لم يتم العثور على SKU: ${code}`); return; }
    setCart((current) => ({ ...current, [product.id]: Math.min((current[product.id] || 0) + 1, product.quantity) }));
    setMessage(`أضيف ${product.name} إلى السلة`);
    try { scannerRef.current?.pause(true); window.setTimeout(() => { try { scannerRef.current?.resume(); } catch { /* scanner was stopped */ } }, 900); } catch { /* scanner is not active */ }
  }

  async function toggleScanner() {
    if (scannerRef.current) {
      const current = scannerRef.current; scannerRef.current = null;
      try { await current.stop(); await current.clear(); } catch { /* scanner may already be stopped */ }
      setScannerActive(false);
      return;
    }
    const scanner = new Html5Qrcode('qr-reader'); scannerRef.current = scanner;
    try {
      await scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 230, height: 180 }, aspectRatio: 1.33 }, (decoded) => { addScannedCode(decoded); }, () => undefined);
      setScannerActive(true);
    } catch (e) { scannerRef.current = null; setScannerActive(false); setMessage(e instanceof Error ? e.message : 'تعذر تشغيل الكاميرا'); }
  }

  async function checkout() {
    setBusy(true); setMessage('');
    try {
      await request('/sales', { method: 'POST', body: JSON.stringify({ items: cartItems.map(({ id, count }) => ({ productId: id, quantity: count })) }) });
      setCart({}); await loadProducts(); setMessage('تم تسجيل البيع بنجاح');
    } catch (e) { setMessage(e instanceof Error ? e.message : 'تعذر إتمام البيع'); }
    finally { setBusy(false); }
  }

  async function savePermissions(employee: Employee, permissions: Record<Permission, boolean>) {
    try {
      await request(`/employees/${employee.id}/permissions`, { method: 'PUT', body: JSON.stringify({ permissions }) });
      setEmployees((items) => items.map((item) => item.id === employee.id ? { ...item, permissions } : item));
      setMessage(`تم حفظ صلاحيات ${employee.name}`);
    } catch (e) { setMessage(e instanceof Error ? e.message : 'تعذر حفظ الصلاحيات'); }
  }

  if (!token || !user) return <main className="login-shell"><form className="login-card" onSubmit={login} autoComplete="off"><div className="brand-mark">✦</div><p className="eyebrow">APPAREL INVENTORY</p><h1>مرحبًا بعودتك</h1><p className="muted">سجّل الدخول لإدارة المخزون والمبيعات</p><label>اسم المستخدم أو البريد<input name="identifier" autoComplete="off" required /></label><label>كلمة المرور<input name="access-code" type="password" autoComplete="new-password" required /></label>{message && <div className="notice error">{message}</div>}<button className="primary full" disabled={busy}>{busy ? 'جارٍ الدخول…' : 'تسجيل الدخول'} <span>←</span></button></form></main>;

  if (!can('productsRead') && user.role !== 'admin') return <main className="login-shell"><section className="login-card"><div className="brand-mark">!</div><h1>لا توجد صلاحية</h1><p className="muted">اطلب من مدير النظام منح حسابك صلاحية مناسبة.</p><button className="ghost" onClick={() => { localStorage.removeItem('apparel_token'); setToken(''); }}>تسجيل الخروج</button></section></main>;

  return <div className="app-shell">
    <aside className="sidebar"><div className="brand"><div className="brand-mark">✦</div><div><b>مخزون</b><small>APPAREL SYSTEM</small></div></div><div className="side-label">مساحة العمل</div>
      <button className={tab === 'products' ? 'nav-item active' : 'nav-item'} onClick={() => setTab('products')}><span>▦</span> المنتجات</button>
      {can('salesCreate') && <button className={tab === 'sales' ? 'nav-item active' : 'nav-item'} onClick={() => setTab('sales')}><span>⌑</span> نقطة البيع <i>{Object.values(cart).reduce((a, b) => a + b, 0) || ''}</i></button>}
      {user.role === 'admin' && <button className={tab === 'employees' ? 'nav-item active' : 'nav-item'} onClick={() => setTab('employees')}><span>♙</span> الموظفون</button>}
      <div className="sidebar-foot"><div className="user-chip"><div className="avatar">{user.name.slice(0, 1)}</div><div className="user-text"><b>{user.name}</b><small>{user.role === 'admin' ? 'مدير النظام' : 'موظف'}</small></div><button title="تسجيل الخروج" onClick={() => { localStorage.removeItem('apparel_token'); setToken(''); setUser(null); }}>↪</button></div></div>
    </aside>
    <main className="main-content"><header className="topbar"><div><span className="eyebrow">مساحة العمل / {tab === 'products' ? 'المخزون' : tab === 'sales' ? 'نقطة البيع' : 'إدارة الفريق'}</span><h1>{tab === 'products' ? 'المنتجات' : tab === 'sales' ? 'نقطة البيع' : 'صلاحيات الموظفين'}</h1></div><div className="top-actions"><span className="status-dot">النظام متصل</span><div className="avatar">{user.name.slice(0, 1)}</div></div></header>
      {message && <div className="notice" role="status">{message}<button onClick={() => setMessage('')}>×</button></div>}

      {tab === 'products' && <section className="page-section"><div className="toolbar"><div className="search-box"><span>⌕</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ابحث بالاسم أو SKU…" /></div>{can('productsWrite') && <button className="primary" onClick={() => setEditing('new')}>＋ إضافة منتج</button>}</div><div className="products-grid">{products.filter((p) => `${p.name} ${p.sku}`.toLowerCase().includes(query.toLowerCase())).map((product) => <article className="product-card" key={product.id}><div className="product-visual"><span className="category-pill">{product.category === 'Men' ? 'رجالي' : product.category === 'Women' ? 'نسائي' : 'أطفال'}</span><span className="product-glyph">✧</span><span className={product.quantity < 5 ? 'stock-pill low' : 'stock-pill'}>{product.quantity} قطعة</span></div><div className="product-info"><div className="product-title"><div><h3>{product.name}</h3><p className="sku">SKU · {product.sku}</p></div><b className="price">{product.retailPrice.toFixed(2)} <small>ج.م</small></b></div><div className="product-bottom"><div className="color-dots">{product.colors.map((color) => <span title={color} key={color} />)}<small>{product.colors.join('، ')}</small></div>{can('productsWrite') && <button className="edit-button" onClick={() => setEditing(product)}>تعديل <span>↗</span></button>}</div></div></article>)}</div>{products.length === 0 && <div className="empty-state">لا توجد منتجات لعرضها</div>}</section>}

      {tab === 'sales' && can('salesCreate') && <section className="sale-layout"><div className="sale-main card"><div className="section-heading"><div><span className="eyebrow">خطوة ١ / ٣</span><h2>امسح رمز المنتج</h2><p className="muted">وجّه الكاميرا إلى QR أو الباركود لإضافته للسلة تلقائيًا.</p></div><span className="scanner-icon">⌗</span></div><div id="qr-reader" className="qr-reader"><div className="qr-placeholder"><span>⌗</span><p>الكاميرا جاهزة للمسح</p></div></div><button className="primary full" onClick={toggleScanner}>{scannerActive ? 'إيقاف الكاميرا' : 'تشغيل ماسح الكاميرا'}</button><div className="manual-add"><label>أدخل SKU يدويًا<input id="manual-sku" placeholder="مثال: TSH-001" onKeyDown={(e) => { if (e.key === 'Enter') { addScannedCode((e.target as HTMLInputElement).value); (e.target as HTMLInputElement).value = ''; } }} /></label><button className="ghost" onClick={() => { const input = document.getElementById('manual-sku') as HTMLInputElement; addScannedCode(input.value); input.value = ''; }}>إضافة</button></div></div><aside className="cart-panel card"><div className="cart-heading"><div><span className="eyebrow">خطوة ٢ / ٣</span><h2>السلة</h2></div><span className="cart-count">{cartItems.length} أصناف</span></div><div className="cart-lines">{cartItems.map((item) => <div className="cart-line" key={item.id}><div className="cart-mini">✧</div><div className="cart-line-info"><b>{item.name}</b><small>{item.sku} · {item.retailPrice.toFixed(2)} ج.م</small></div><div className="qty-control"><button onClick={() => setCart((c) => ({ ...c, [item.id]: Math.max(0, c[item.id] - 1) }))}>−</button><b>{item.count}</b><button disabled={item.count >= item.quantity} onClick={() => setCart((c) => ({ ...c, [item.id]: c[item.id] + 1 }))}>＋</button></div></div>)}{!cartItems.length && <div className="empty-cart">امسح منتجًا لبدء البيع</div>}</div><div className="cart-total"><span>الإجمالي</span><b>{cartTotal.toFixed(2)} <small>ج.م</small></b></div><div className="checkout-step"><span className="eyebrow">خطوة ٣ / ٣</span><button className="success full" disabled={!cartItems.length || busy} onClick={checkout}>{busy ? 'جارٍ التسجيل…' : 'تأكيد البيع'} <span>←</span></button></div></aside></section>}

      {tab === 'employees' && user.role === 'admin' && <section className="employees-list">{employees.map((employee) => <EmployeePermissions key={employee.id} employee={employee} onSave={savePermissions} />)}{!employees.length && <div className="empty-state">لا يوجد موظفون حتى الآن</div>}</section>}
    </main>

    {editing && <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setEditing(null); }}><form className="modal card" onSubmit={saveProduct}><div className="modal-heading"><div><span className="eyebrow">إدارة المخزون</span><h2>{editing === 'new' ? 'إضافة منتج' : 'تعديل المنتج'}</h2></div><button type="button" className="close" onClick={() => setEditing(null)}>×</button></div><label>اسم المنتج<input name="name" defaultValue={editing === 'new' ? '' : editing.name} required maxLength={150} /></label><div className="form-row"><label>رمز SKU<input name="sku" defaultValue={editing === 'new' ? '' : editing.sku} required pattern="[A-Za-z0-9-]+" /></label><label>الفئة<select name="category" defaultValue={editing === 'new' ? 'Men' : editing.category}><option value="Men">رجالي</option><option value="Women">نسائي</option><option value="Kids">أطفال</option></select></label></div><div className="form-row"><label>السعر (ج.م)<input name="retailPrice" type="number" min="0" step="0.01" defaultValue={editing === 'new' ? '' : editing.retailPrice} required /></label><label>الكمية<input name="quantity" type="number" min="0" step="1" defaultValue={editing === 'new' ? 0 : editing.quantity} required /></label></div><label>الألوان المخصصة <small className="muted">افصل بين الألوان بفاصلة</small><input name="colors" placeholder="أسود، زيتي، بنفسجي" defaultValue={editing === 'new' ? '' : editing.colors.join(', ')} required /></label><div className="modal-actions"><button type="button" className="ghost" onClick={() => setEditing(null)}>إلغاء</button><button className="primary" disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'حفظ المنتج'}</button></div></form></div>}
  </div>;
}

function EmployeePermissions({ employee, onSave }: { employee: Employee; onSave: (employee: Employee, permissions: Record<Permission, boolean>) => Promise<void> }) {
  const [permissions, setPermissions] = useState<Record<Permission, boolean>>({ ...permissionDefaults, ...employee.permissions });
  const [saving, setSaving] = useState(false);
  const changed = permissionNames.some(([key]) => permissions[key] !== (employee.permissions?.[key] ?? permissionDefaults[key]));
  async function submit() { setSaving(true); try { await onSave(employee, permissions); } finally { setSaving(false); } }
  return <article className="employee-card card"><div className="employee-header"><div className="avatar large">{employee.name.slice(0, 1)}</div><div><h2>{employee.name}</h2><p className="muted">@{employee.username} · {employee.email}</p></div><span className="employee-status">{employee.isActive ? 'نشط' : 'موقوف'}</span></div><div className="permission-grid">{permissionNames.map(([key, label]) => <label className="permission-row" key={key}><span><b>{label}</b><small>{key}</small></span><input type="checkbox" checked={!!permissions[key]} onChange={(e) => setPermissions((p) => ({ ...p, [key]: e.target.checked }))} /></label>)}</div><div className="employee-actions"><span className="muted">{changed ? 'تغييرات غير محفوظة' : 'الصلاحيات محفوظة'}</span><button className="primary" disabled={!changed || saving} onClick={submit}>{saving ? 'جارٍ الحفظ…' : 'حفظ الصلاحيات'}</button></div></article>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
