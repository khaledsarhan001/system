import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Html5Qrcode } from 'html5-qrcode';
import './style.css';

const API_BASE = import.meta.env.VITE_API_URL || '';

type Permission = 'productsRead' | 'productsWrite' | 'salesCreate' | 'employeesRead' | 'analyticsRead';
type User = { id: string; name: string; username: string; email: string; phone?: string; branch?: string; jobTitle?: string; role: 'admin' | 'employee'; permissions: Record<Permission, boolean> };
type Product = { id: string; name: string; sku: string; category: 'Men' | 'Women' | 'Kids'; productType?: string; retailPrice: number; costPrice: number; quantity: number; colors: string[]; isActive?: boolean };
type Employee = User & { isActive: boolean };
type Transaction = { id: string; type: 'sale' | 'return'; employeeName: string; items: { productName: string; sku: string; quantity: number; unitPrice: number }[]; totalAmount: number; returnReason?: string; createdAt: string };

const permissionNames: [Permission, string][] = [['productsRead', 'عرض المنتجات'], ['productsWrite', 'إضافة وتعديل المنتجات والمخزون'], ['salesCreate', 'تسجيل المبيعات'], ['employeesRead', 'عرض الموظفين'], ['analyticsRead', 'عرض التقارير']];
const permissionDefaults: Record<Permission, boolean> = { productsRead: true, productsWrite: false, salesCreate: true, employeesRead: false, analyticsRead: false };

function App() {
  const [token, setToken] = useState(() => localStorage.getItem('apparel_token') || '');
  const [user, setUser] = useState<User | null>(null);
  const [tab, setTab] = useState<'products' | 'sales' | 'returns' | 'history' | 'analytics' | 'employees'>('products');
  const [products, setProducts] = useState<Product[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [analytics, setAnalytics] = useState({ products: 0, unitsInStock: 0, lowStock: 0, salesCount: 0, revenue: 0, cogs: 0, returnsCount: 0 });
  const [query, setQuery] = useState('');
  const [cart, setCart] = useState<Record<string, number>>({});
  const [editing, setEditing] = useState<Product | null | 'new'>(null);
  const [newEmployee, setNewEmployee] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scannerActive, setScannerActive] = useState(false);
  const [message, setMessage] = useState('');
  const [theme, setTheme] = useState(() => localStorage.getItem('apparel_theme') || 'dark');
  const [returnProduct, setReturnProduct] = useState('');
  const [legacyCounts, setLegacyCounts] = useState({ products: 0, transactions: 0 });
  const [importingLegacy, setImportingLegacy] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const lastScanRef = useRef({ code: '', at: 0 });
  const can = (permission: Permission) => user?.role === 'admin' || user?.permissions?.[permission] === true;
  const cartItems = useMemo(() => products.filter((p) => cart[p.id]).map((p) => ({ ...p, count: cart[p.id] })), [products, cart]);
  const cartTotal = cartItems.reduce((sum, p) => sum + p.retailPrice * p.count, 0);

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('content-type', 'application/json');
    if (token) headers.set('authorization', `Bearer ${token}`);
    const response = await fetch(`${API_BASE}/api${path}`, { ...init, headers });
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
  async function loadAnalytics() { const result = await request<{ data: typeof analytics }>('/analytics'); setAnalytics(result.data); }
  async function loadTransactions() { const result = await request<{ data: Transaction[] }>('/transactions'); setTransactions(result.data ?? []); }

  useEffect(() => {
    if (!token) return;
    request<{ data: User }>('/auth/me').then(({ data }) => {
      setUser(data);
      if (data.role === 'admin' && !localStorage.getItem('apparel_legacy_imported_v1')) {
        try {
          const oldProducts = JSON.parse(localStorage.getItem('apparel_products_v1') || '[]');
          const oldTransactions = JSON.parse(localStorage.getItem('apparel_transactions_v1') || '[]');
          setLegacyCounts({ products: Array.isArray(oldProducts) ? oldProducts.length : 0, transactions: Array.isArray(oldTransactions) ? oldTransactions.length : 0 });
        } catch { setLegacyCounts({ products: 0, transactions: 0 }); }
      }
    }).catch(() => { localStorage.removeItem('apparel_token'); setToken(''); setUser(null); });
  }, [token]);

  useEffect(() => {
    if (!user) return;
    setMessage('');
    if (tab === 'products' && can('productsRead')) loadProducts().catch((e) => setMessage(e.message));
    if (tab === 'employees' && user.role === 'admin') loadEmployees().catch((e) => setMessage(e.message));
    if (tab === 'analytics' && can('analyticsRead')) loadAnalytics().catch((e) => setMessage(e.message));
    if (tab === 'history' && (user.role === 'admin' || can('analyticsRead'))) loadTransactions().catch((e) => setMessage(e.message));
    if (tab === 'returns' && can('salesCreate')) loadProducts().catch((e) => setMessage(e.message));
  }, [user, tab]);

  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('apparel_theme', theme); }, [theme]);

  useEffect(() => () => { scannerRef.current?.stop().catch(() => undefined); }, []);

  async function login(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage('');
    const form = new FormData(event.currentTarget);
    try {
      const result = await fetch(`${API_BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier: form.get('identifier'), password: form.get('access-code') }) });
      const body = await result.json();
      if (!result.ok) throw new Error(result.status === 401 ? 'اسم المستخدم أو كلمة المرور غير صحيحة. اكتب كلمة المرور يدويًا.' : body.message || `تعذر تسجيل الدخول (${result.status})`);
      localStorage.setItem('apparel_token', body.token); setToken(body.token); setUser(body.data);
    } catch (e) { setMessage(e instanceof Error ? e.message : 'تعذر تسجيل الدخول'); }
    finally { setBusy(false); }
  }

  async function saveProduct(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!editing) return;
    const form = new FormData(event.currentTarget);
    const payload = { name: form.get('name'), sku: form.get('sku'), category: form.get('category'), productType: form.get('productType'), retailPrice: Number(form.get('retailPrice')), costPrice: Number(form.get('costPrice')), quantity: Number(form.get('quantity')), colors: String(form.get('colors')).split(',').map((x) => x.trim()).filter(Boolean) };
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

  async function processReturn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement); const product = products.find((item) => item.id === returnProduct);
    if (!product) { setMessage('اختر المنتج المرتجع أولًا.'); return; }
    setBusy(true);
    try {
      await request('/returns', { method: 'POST', body: JSON.stringify({ items: [{ productId: product.id, quantity: Number(form.get('quantity')), color: product.colors[0] ?? '' }], reason: form.get('reason') }) });
      setMessage('تم تسجيل المرتجع وإضافة الكمية إلى المخزون.'); formElement.reset(); setReturnProduct(''); await loadProducts();
    } catch (e) { setMessage(e instanceof Error ? e.message : 'تعذر تسجيل المرتجع'); }
    finally { setBusy(false); }
  }

  async function createEmployee(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); setBusy(true);
    try {
      await request('/employees', { method: 'POST', body: JSON.stringify({ name: form.get('name'), username: form.get('username'), email: form.get('email'), password: form.get('password'), phone: form.get('phone'), branch: form.get('branch'), jobTitle: form.get('jobTitle') }) });
      setNewEmployee(false); await loadEmployees(); setMessage('تمت إضافة الموظف.');
    } catch (e) { setMessage(e instanceof Error ? e.message : 'تعذرت إضافة الموظف'); }
    finally { setBusy(false); }
  }

  async function importLegacyData() {
    setImportingLegacy(true);
    try {
      const products = JSON.parse(localStorage.getItem('apparel_products_v1') || '[]');
      const transactions = JSON.parse(localStorage.getItem('apparel_transactions_v1') || '[]');
      const result = await request<{ data: { productsAdded: number; transactionsAdded: number } }>('/legacy/import', { method: 'POST', body: JSON.stringify({ products, transactions }) });
      localStorage.setItem('apparel_legacy_imported_v1', '1'); setLegacyCounts({ products: 0, transactions: 0 });
      await loadProducts(); await loadAnalytics().catch(() => undefined); await loadTransactions().catch(() => undefined);
      setMessage(`تم نقل ${result.data.productsAdded} منتج و${result.data.transactionsAdded} معاملة من النسخة السابقة.`);
    } catch (e) { setMessage(e instanceof Error ? e.message : 'تعذر نقل بيانات النسخة السابقة'); }
    finally { setImportingLegacy(false); }
  }

  async function updateEmployee(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!editingEmployee) return; const form = new FormData(event.currentTarget); setBusy(true);
    try {
      await request(`/employees/${editingEmployee.id}`, { method: 'PUT', body: JSON.stringify({ name: form.get('name'), username: form.get('username'), email: form.get('email'), phone: form.get('phone'), branch: form.get('branch'), jobTitle: form.get('jobTitle') }) });
      setEditingEmployee(null); await loadEmployees(); setMessage('تم تحديث بيانات الموظف.');
    } catch (e) { setMessage(e instanceof Error ? e.message : 'تعذر تحديث الموظف'); }
    finally { setBusy(false); }
  }

  async function deactivateEmployee(employee: Employee) {
    if (!window.confirm(`إيقاف حساب ${employee.name}؟ سيظل سجل معاملاته محفوظًا.`)) return;
    try { await request(`/employees/${employee.id}`, { method: 'DELETE' }); await loadEmployees(); setMessage('تم إيقاف الحساب مع حفظ السجلات.'); }
    catch (e) { setMessage(e instanceof Error ? e.message : 'تعذر إيقاف الحساب'); }
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
      {can('salesCreate') && <button className={tab === 'returns' ? 'nav-item active' : 'nav-item'} onClick={() => setTab('returns')}><span>↩</span> المرتجعات</button>}
      {(user.role === 'admin' || can('analyticsRead')) && <><button className={`nav-item secondary-nav ${tab === 'history' ? 'active' : ''}`} onClick={() => setTab('history')}><span>◷</span> سجل المعاملات</button><button className={`nav-item secondary-nav ${tab === 'analytics' ? 'active' : ''}`} onClick={() => setTab('analytics')}><span>▤</span> التحليلات</button></>}
      {user.role === 'admin' && <button className={`nav-item secondary-nav ${tab === 'employees' ? 'active' : ''}`} onClick={() => setTab('employees')}><span>♙</span> الموظفون</button>}
      <button className={`nav-item mobile-menu-button ${menuOpen ? 'active' : ''}`} onClick={() => setMenuOpen((open) => !open)}><span>☰</span> القائمة</button>
      <div className="sidebar-foot"><div className="user-chip"><div className="avatar">{user.name.slice(0, 1)}</div><div className="user-text"><b>{user.name}</b><small>{user.role === 'admin' ? 'مدير النظام' : 'موظف'}</small></div><button title="تسجيل الخروج" onClick={() => { localStorage.removeItem('apparel_token'); setToken(''); setUser(null); }}>↪</button></div></div>
    </aside>
    <main className="main-content"><header className="topbar"><div><span className="eyebrow">مساحة العمل / {tab === 'products' ? 'المخزون' : tab === 'sales' ? 'نقطة البيع' : tab === 'returns' ? 'المرتجعات' : tab === 'history' ? 'سجل المعاملات' : tab === 'analytics' ? 'التحليلات' : tab === 'employees' ? 'إدارة الفريق' : ''}</span><h1>{tab === 'products' ? 'المنتجات' : tab === 'sales' ? 'نقطة البيع' : tab === 'returns' ? 'إدارة المرتجعات' : tab === 'history' ? 'سجل المعاملات' : tab === 'analytics' ? 'لوحة التحليلات' : 'صلاحيات الموظفين'}</h1></div><div className="top-actions"><button className="icon-button" title="تبديل المظهر" onClick={() => setTheme((t) => t === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? '☼' : '☾'}</button><span className="status-dot">النظام متصل</span><div className="avatar">{user.name.slice(0, 1)}</div></div></header>
      {menuOpen && <div className="mobile-menu-popover"><button onClick={() => { setTab('history'); setMenuOpen(false); }}>◷ سجل المعاملات</button>{can('analyticsRead') && <button onClick={() => { setTab('analytics'); setMenuOpen(false); }}>▤ التحليلات</button>}{user.role === 'admin' && <button onClick={() => { setTab('employees'); setMenuOpen(false); }}>♙ الموظفون والصلاحيات</button>}<button onClick={() => { localStorage.removeItem('apparel_token'); setToken(''); setUser(null); }}>↪ تسجيل الخروج</button></div>}
      {message && <div className="notice" role="status">{message}<button onClick={() => setMessage('')}>×</button></div>}

      {tab === 'products' && <section className="page-section">{legacyCounts.products + legacyCounts.transactions > 0 && <div className="legacy-import-banner"><div><b>بياناتك من الموقع السابق موجودة على هذا المتصفح</b><small>{legacyCounts.products} منتج · {legacyCounts.transactions} معاملة</small></div><button className="primary" disabled={importingLegacy} onClick={importLegacyData}>{importingLegacy ? 'جارٍ النقل…' : 'نقل البيانات للموقع الجديد'}</button></div>}<div className="toolbar"><div className="search-box"><span>⌕</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ابحث بالاسم أو SKU…" /></div>{can('productsWrite') && <button className="primary" onClick={() => setEditing('new')}>＋ إضافة منتج</button>}</div><div className="products-grid">{products.filter((p) => `${p.name} ${p.sku}`.toLowerCase().includes(query.toLowerCase())).map((product) => <article className="product-card" key={product.id}><div className="product-visual"><span className="category-pill">{product.category === 'Men' ? 'رجالي' : product.category === 'Women' ? 'نسائي' : 'أطفال'}</span><span className="product-glyph">✧</span><span className={product.quantity < 5 ? 'stock-pill low' : 'stock-pill'}>{product.quantity} قطعة</span></div><div className="product-info"><div className="product-title"><div><h3>{product.name}</h3><p className="sku">SKU · {product.sku}{product.productType && product.productType !== 'general' ? ` · ${product.productType}` : ''}</p></div><b className="price">{product.retailPrice.toFixed(2)} <small>ج.م</small></b></div><div className="product-bottom"><div className="color-dots">{product.colors.map((color) => <span title={color} key={color} />)}<small>{product.colors.join('، ')}</small></div>{can('productsWrite') && <button className="edit-button" onClick={() => setEditing(product)}>تعديل <span>↗</span></button>}</div></div></article>)}</div>{products.length === 0 && <div className="empty-state">لا توجد منتجات لعرضها</div>}</section>}

      {tab === 'sales' && can('salesCreate') && <section className="sale-layout"><div className="sale-main card"><div className="section-heading"><div><span className="eyebrow">خطوة ١ / ٣</span><h2>امسح رمز المنتج</h2><p className="muted">وجّه الكاميرا إلى QR أو الباركود لإضافته للسلة تلقائيًا.</p></div><span className="scanner-icon">⌗</span></div><div id="qr-reader" className="qr-reader"><div className="qr-placeholder"><span>⌗</span><p>الكاميرا جاهزة للمسح</p></div></div><button className="primary full" onClick={toggleScanner}>{scannerActive ? 'إيقاف الكاميرا' : 'تشغيل ماسح الكاميرا'}</button><div className="manual-add"><label>أدخل SKU يدويًا<input id="manual-sku" placeholder="مثال: TSH-001" onKeyDown={(e) => { if (e.key === 'Enter') { addScannedCode((e.target as HTMLInputElement).value); (e.target as HTMLInputElement).value = ''; } }} /></label><button className="ghost" onClick={() => { const input = document.getElementById('manual-sku') as HTMLInputElement; addScannedCode(input.value); input.value = ''; }}>إضافة</button></div></div><aside className="cart-panel card"><div className="cart-heading"><div><span className="eyebrow">خطوة ٢ / ٣</span><h2>السلة</h2></div><span className="cart-count">{cartItems.length} أصناف</span></div><div className="cart-lines">{cartItems.map((item) => <div className="cart-line" key={item.id}><div className="cart-mini">✧</div><div className="cart-line-info"><b>{item.name}</b><small>{item.sku} · {item.retailPrice.toFixed(2)} ج.م</small></div><div className="qty-control"><button onClick={() => setCart((c) => ({ ...c, [item.id]: Math.max(0, c[item.id] - 1) }))}>−</button><b>{item.count}</b><button disabled={item.count >= item.quantity} onClick={() => setCart((c) => ({ ...c, [item.id]: c[item.id] + 1 }))}>＋</button></div></div>)}{!cartItems.length && <div className="empty-cart">امسح منتجًا لبدء البيع</div>}</div><div className="cart-total"><span>الإجمالي</span><b>{cartTotal.toFixed(2)} <small>ج.م</small></b></div><div className="checkout-step"><span className="eyebrow">خطوة ٣ / ٣</span><button className="success full" disabled={!cartItems.length || busy} onClick={checkout}>{busy ? 'جارٍ التسجيل…' : 'تأكيد البيع'} <span>←</span></button></div></aside></section>}

      {tab === 'returns' && can('salesCreate') && <section className="card return-panel"><div className="section-heading"><div><span className="eyebrow">استلام وإعادة للمخزون</span><h2>تسجيل مرتجع</h2><p className="muted">اختر المنتج والكمية، وسيتم تحديث المخزون وتسجيل العملية.</p></div><span className="scanner-icon">↩</span></div><form className="return-form" onSubmit={processReturn}><label>المنتج<select value={returnProduct} onChange={(e) => setReturnProduct(e.target.value)} required><option value="">اختر المنتج</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.sku}</option>)}</select></label><label>الكمية<input name="quantity" type="number" min="1" defaultValue="1" required /></label><label className="reason-field">سبب الإرجاع<input name="reason" maxLength={500} placeholder="اختياري" /></label><button className="primary" disabled={busy}>{busy ? 'جارٍ التسجيل…' : 'تأكيد المرتجع'}</button></form></section>}

      {tab === 'analytics' && can('analyticsRead') && <section className="metrics-grid">{[['الإيرادات', analytics.revenue, '↑', 'violet'], ['تكلفة البضاعة', analytics.cogs, '◈', 'amber'], ['صافي الربح', analytics.revenue - analytics.cogs, '↗', 'green'], ['تنبيهات المخزون', analytics.lowStock, '!', 'orange']].map(([label, value, icon, tone]) => <article key={String(label)} className={`metric-card ${tone}`}><span className="metric-icon">{icon}</span><small>{label}</small><strong>{tone === 'orange' ? value : `${Number(value).toFixed(2)} ج.م`}</strong></article>)}<div className="card analytics-summary"><span>المنتجات</span><b>{analytics.products}</b><span>الوحدات بالمخزن</span><b>{analytics.unitsInStock}</b><span>المبيعات</span><b>{analytics.salesCount}</b><span>المرتجعات</span><b>{analytics.returnsCount}</b></div></section>}

      {tab === 'history' && (user.role === 'admin' || can('analyticsRead')) && <section className="history-list card"><div className="section-heading"><div><span className="eyebrow">آخر ٥٠٠ معاملة</span><h2>المبيعات والمرتجعات</h2></div><button className="ghost" onClick={() => loadTransactions().catch((e) => setMessage(e.message))}>تحديث</button></div>{transactions.map((tx) => <article className="history-row" key={tx.id}><span className={tx.type === 'return' ? 'transaction-type returned' : 'transaction-type'}>{tx.type === 'return' ? 'مرتجع' : 'بيع'}</span><div className="history-detail"><b>{tx.items.map((item) => `${item.productName} × ${item.quantity}`).join('، ')}</b><small>{tx.employeeName} · {new Date(tx.createdAt).toLocaleString('ar-EG')}{tx.returnReason ? ` · ${tx.returnReason}` : ''}</small></div><strong>{tx.totalAmount.toFixed(2)} ج.م</strong></article>)}{transactions.length === 0 && <div className="empty-state">لا توجد معاملات حتى الآن</div>}</section>}

      {tab === 'employees' && user.role === 'admin' && <section className="employees-list"><div className="employee-toolbar"><p className="muted">إدارة الموظفين وصلاحيات كل حساب.</p><button className="primary" onClick={() => setNewEmployee(true)}>＋ إضافة موظف</button></div>{employees.map((employee) => <EmployeePermissions key={employee.id} employee={employee} onSave={savePermissions} onEdit={setEditingEmployee} onDeactivate={deactivateEmployee} />)}{!employees.length && <div className="empty-state">لا يوجد موظفون حتى الآن</div>}</section>}
    </main>

    {editing && <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setEditing(null); }}><form className="modal card" onSubmit={saveProduct}><div className="modal-heading"><div><span className="eyebrow">إدارة المخزون</span><h2>{editing === 'new' ? 'إضافة منتج' : 'تعديل المنتج'}</h2></div><button type="button" className="close" onClick={() => setEditing(null)}>×</button></div><label>اسم المنتج<input name="name" defaultValue={editing === 'new' ? '' : editing.name} required maxLength={150} /></label><div className="form-row"><label>رمز SKU<input name="sku" defaultValue={editing === 'new' ? '' : editing.sku} required pattern="[A-Za-z0-9-]+" /></label><label>الفئة<select name="category" defaultValue={editing === 'new' ? 'Men' : editing.category}><option value="Men">رجالي</option><option value="Women">نسائي</option><option value="Kids">أطفال</option></select></label></div><label>نوع القطعة (اختياري)<input name="productType" defaultValue={editing === 'new' ? '' : (editing as Product).productType ?? ''} placeholder="قمصان، بنطلونات، فساتين…" /></label><div className="form-row"><label>سعر البيع (ج.م)<input name="retailPrice" type="number" min="0" step="0.01" defaultValue={editing === 'new' ? '' : (editing as Product).retailPrice} required /></label><label>سعر التكلفة (ج.م)<input name="costPrice" type="number" min="0" step="0.01" defaultValue={editing === 'new' ? 0 : (editing as Product).costPrice ?? 0} required /></label></div><label>الكمية<input name="quantity" type="number" min="0" step="1" defaultValue={editing === 'new' ? 0 : (editing as Product).quantity} required /></label><label>الألوان المخصصة <small className="muted">افصل بين الألوان بفاصلة</small><input name="colors" placeholder="أسود، زيتي، بنفسجي" defaultValue={editing === 'new' ? '' : (editing as Product).colors.join(', ')} required /></label><div className="modal-actions"><button type="button" className="ghost" onClick={() => setEditing(null)}>إلغاء</button><button className="primary" disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'حفظ المنتج'}</button></div></form></div>}
    {newEmployee && <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setNewEmployee(false); }}><form className="modal card" onSubmit={createEmployee}><div className="modal-heading"><div><span className="eyebrow">إدارة الفريق</span><h2>إضافة موظف</h2></div><button type="button" className="close" onClick={() => setNewEmployee(false)}>×</button></div><label>الاسم<input name="name" required /></label><div className="form-row"><label>اسم المستخدم<input name="username" pattern="[a-zA-Z0-9._-]{3,40}" required /></label><label>البريد الإلكتروني<input name="email" type="email" required /></label></div><label>كلمة المرور المؤقتة<input name="password" type="password" minLength={8} required /></label><div className="form-row"><label>الهاتف<input name="phone" /></label><label>الفرع<input name="branch" /></label></div><label>المسمى الوظيفي<input name="jobTitle" /></label><div className="modal-actions"><button type="button" className="ghost" onClick={() => setNewEmployee(false)}>إلغاء</button><button className="primary" disabled={busy}>{busy ? 'جارٍ الإنشاء…' : 'إنشاء الحساب'}</button></div></form></div>}
    {editingEmployee && <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setEditingEmployee(null); }}><form className="modal card" onSubmit={updateEmployee}><div className="modal-heading"><div><span className="eyebrow">إدارة الفريق</span><h2>تعديل بيانات الموظف</h2></div><button type="button" className="close" onClick={() => setEditingEmployee(null)}>×</button></div><label>الاسم<input name="name" defaultValue={editingEmployee.name} required /></label><div className="form-row"><label>اسم المستخدم<input name="username" defaultValue={editingEmployee.username} required /></label><label>البريد الإلكتروني<input name="email" type="email" defaultValue={editingEmployee.email} required /></label></div><div className="form-row"><label>الهاتف<input name="phone" defaultValue={editingEmployee.phone} /></label><label>الفرع<input name="branch" defaultValue={editingEmployee.branch} /></label></div><label>المسمى الوظيفي<input name="jobTitle" defaultValue={editingEmployee.jobTitle} /></label><div className="modal-actions"><button type="button" className="ghost" onClick={() => setEditingEmployee(null)}>إلغاء</button><button className="primary" disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'حفظ البيانات'}</button></div></form></div>}
  </div>;
}

function EmployeePermissions({ employee, onSave, onEdit, onDeactivate }: { employee: Employee; onSave: (employee: Employee, permissions: Record<Permission, boolean>) => Promise<void>; onEdit: (employee: Employee) => void; onDeactivate: (employee: Employee) => void }) {
  const [permissions, setPermissions] = useState<Record<Permission, boolean>>({ ...permissionDefaults, ...employee.permissions });
  const [saving, setSaving] = useState(false);
  const changed = permissionNames.some(([key]) => permissions[key] !== (employee.permissions?.[key] ?? permissionDefaults[key]));
  async function submit() { setSaving(true); try { await onSave(employee, permissions); } finally { setSaving(false); } }
  return <article className="employee-card card"><div className="employee-header"><div className="avatar large">{employee.name.slice(0, 1)}</div><div><h2>{employee.name}</h2><p className="muted">@{employee.username} · {employee.email} {employee.jobTitle ? `· ${employee.jobTitle}` : ''}</p></div><span className={employee.isActive ? 'employee-status' : 'employee-status inactive'}>{employee.isActive ? 'نشط' : 'موقوف'}</span></div><div className="permission-grid">{permissionNames.map(([key, label]) => <label className="permission-row" key={key}><span><b>{label}</b><small>{key}</small></span><input type="checkbox" checked={!!permissions[key]} onChange={(e) => setPermissions((p) => ({ ...p, [key]: e.target.checked }))} /></label>)}</div><div className="employee-actions"><span className="muted">{changed ? 'تغييرات غير محفوظة' : 'الصلاحيات محفوظة'}</span><div className="employee-buttons"><button className="ghost" onClick={() => onEdit(employee)}>تعديل</button>{employee.isActive && <button className="danger-button" onClick={() => onDeactivate(employee)}>إيقاف</button>}<button className="primary" disabled={!changed || saving} onClick={submit}>{saving ? 'جارٍ الحفظ…' : 'حفظ الصلاحيات'}</button></div></div></article>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
