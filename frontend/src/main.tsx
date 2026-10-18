import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Html5Qrcode } from 'html5-qrcode';
import './style.css';

const API_BASE = import.meta.env.VITE_API_URL || '';

class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = 'ApiError'; }
}

type Permission = 'productsRead' | 'productsWrite' | 'salesCreate' | 'employeesRead' | 'analyticsRead';
type User = { id: string; name: string; username: string; email: string; phone?: string; branch?: string; jobTitle?: string; lastActiveAt?: string; role: 'admin' | 'employee'; permissions: Record<Permission, boolean> };
type Product = { id: string; name: string; sku: string; category: 'Men' | 'Women' | 'Kids'; productType?: string; retailPrice: number; costPrice: number; quantity: number; colors: string[]; imageUrl?: string; isActive?: boolean };
type Employee = User & { isActive: boolean };
type Transaction = { id: string; type: 'sale' | 'return'; employeeName: string; items: { productName: string; sku: string; quantity: number; unitPrice: number }[]; totalAmount: number; returnReason?: string; createdAt: string };
type AnalyticsData = { products: number; unitsInStock: number; lowStock: number; salesCount: number; revenue: number; cogs: number; returnsCount: number; returnsValue: number; inventoryCost: number; dailySales: { day: string; revenue: number; salesCount: number }[]; topProducts: { name: string; quantity: number }[] };

const permissionNames: [Permission, string][] = [['productsRead', 'عرض المنتجات'], ['productsWrite', 'إضافة وتعديل المنتجات والمخزون'], ['salesCreate', 'تسجيل المبيعات'], ['employeesRead', 'عرض الموظفين'], ['analyticsRead', 'عرض التقارير']];
const permissionDefaults: Record<Permission, boolean> = { productsRead: true, productsWrite: false, salesCreate: true, employeesRead: false, analyticsRead: false };

function App() {
  const [token, setToken] = useState(() => localStorage.getItem('apparel_token') || '');
  const [user, setUser] = useState<User | null>(() => { try { return !navigator.onLine ? JSON.parse(localStorage.getItem('apparel_user_v1') || 'null') : null; } catch { return null; } });
  const [tab, setTab] = useState<'products' | 'sales' | 'returns' | 'history' | 'analytics' | 'employees'>('products');
  const [products, setProducts] = useState<Product[]>(() => { try { return JSON.parse(localStorage.getItem('apparel_cached_products_v1') || '[]'); } catch { return []; } });
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>(() => { try { return JSON.parse(localStorage.getItem('apparel_cached_transactions_v1') || '[]'); } catch { return []; } });
  const [analytics, setAnalytics] = useState<AnalyticsData>({ products: 0, unitsInStock: 0, lowStock: 0, salesCount: 0, revenue: 0, cogs: 0, returnsCount: 0, returnsValue: 0, inventoryCost: 0, dailySales: [], topProducts: [] });
  const [analyticsTab, setAnalyticsTab] = useState<'overview' | 'reports' | 'inventory'>('overview');
  const [query, setQuery] = useState('');
  const [productCategoryFilter, setProductCategoryFilter] = useState('all');
  const [productStockFilter, setProductStockFilter] = useState('all');
  const [cart, setCart] = useState<Record<string, number>>(() => { try { return JSON.parse(localStorage.getItem('apparel_cart_v1') || '{}'); } catch { return {}; } });
  const [editing, setEditing] = useState<Product | null | 'new'>(null);
  const [productImage, setProductImage] = useState('');
  const [newEmployee, setNewEmployee] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scannerActive, setScannerActive] = useState(false);
  const [message, setMessage] = useState('');
  const [theme, setTheme] = useState(() => localStorage.getItem('apparel_theme') || 'dark');
  const [language, setLanguage] = useState(() => localStorage.getItem('apparel_lang') || 'ar');
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [offlineReady, setOfflineReady] = useState<boolean | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const [backupInterval, setBackupInterval] = useState(() => localStorage.getItem('apparel_backup_interval_v1') || 'manual');
  const [posSearch, setPosSearch] = useState('');
  const [offlinePending, setOfflinePending] = useState(() => { try { return JSON.parse(localStorage.getItem('apparel_offline_queue_v1') || '[]').length; } catch { return 0; } });
  const [returnProduct, setReturnProduct] = useState('');
  const [legacyCounts, setLegacyCounts] = useState({ products: 0, transactions: 0 });
  const [importingLegacy, setImportingLegacy] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const lastScanRef = useRef({ code: '', at: 0 });
  const can = (permission: Permission) => user?.role === 'admin' || user?.permissions?.[permission] === true;
  const cartItems = useMemo(() => products.filter((p) => cart[p.id]).map((p) => ({ ...p, count: cart[p.id] })), [products, cart]);
  const cartTotal = cartItems.reduce((sum, p) => sum + p.retailPrice * p.count, 0);
  const normalizedQuery = normalizeSearch(query);
  const visibleProducts = products.filter((product) => {
    const matchesQuery = normalizeSearch(`${product.name} ${product.sku} ${product.productType || ''}`).includes(normalizedQuery);
    const matchesCategory = productCategoryFilter === 'all' || product.category === productCategoryFilter;
    const matchesStock = productStockFilter === 'all' || (productStockFilter === 'low' ? product.quantity < 5 : product.quantity > 0);
    return matchesQuery && matchesCategory && matchesStock;
  });

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('content-type', 'application/json');
    if (token) headers.set('authorization', `Bearer ${token}`);
    let response: Response;
    try { response = await fetch(`${API_BASE}/api${path}`, { ...init, headers }); }
    catch (error) {
      const method = (init.method || 'GET').toUpperCase();
      if (!['POST', 'PUT', 'DELETE'].includes(method) || !['/sales', '/returns', '/products', ...products.map((p) => `/products/${p.id}`)].includes(path)) throw error;
      const queue = JSON.parse(localStorage.getItem('apparel_offline_queue_v1') || '[]') as { id: string; path: string; method: string; body: string; tempId?: string }[];
      let tempId: string | undefined;
      if (path === '/products') { const data = JSON.parse(String(init.body || '{}')) as Omit<Product, 'id'>; tempId = `offline-${crypto.randomUUID()}`; const cached = JSON.parse(localStorage.getItem('apparel_cached_products_v1') || '[]') as Product[]; const created: Product = { ...data, id: tempId, quantity: Number(data.quantity) || 0, retailPrice: Number(data.retailPrice) || 0, costPrice: Number(data.costPrice) || 0, colors: data.colors || [] }; const updated = [...cached, created]; localStorage.setItem('apparel_cached_products_v1', JSON.stringify(updated)); setProducts(updated); }
      queue.push({ id: crypto.randomUUID(), path, method, body: String(init.body || '{}'), ...(tempId ? { tempId } : {}) });
      localStorage.setItem('apparel_offline_queue_v1', JSON.stringify(queue)); setOfflinePending(queue.length);
      if (path === '/sales' || path === '/returns') {
        const body = JSON.parse(String(init.body || '{}')) as { items?: { productId: string; quantity: number }[] };
        const delta = path === '/sales' ? -1 : 1;
        const cached = JSON.parse(localStorage.getItem('apparel_cached_products_v1') || '[]') as Product[];
        const updated = cached.map((p) => ({ ...p, quantity: Math.max(0, p.quantity + delta * (body.items?.find((item) => item.productId === p.id)?.quantity || 0)) }));
        localStorage.setItem('apparel_cached_products_v1', JSON.stringify(updated)); setProducts(updated);
      } else if (path.startsWith('/products/') && method === 'DELETE') {
        const id = path.slice('/products/'.length);
        const cached = JSON.parse(localStorage.getItem('apparel_cached_products_v1') || '[]') as Product[];
        const updated = cached.filter((p) => p.id !== id);
        localStorage.setItem('apparel_cached_products_v1', JSON.stringify(updated)); setProducts(updated);
      } else if (path.startsWith('/products/')) {
        const payload = JSON.parse(String(init.body || '{}')) as Partial<Product>;
        const cached = JSON.parse(localStorage.getItem('apparel_cached_products_v1') || '[]') as Product[];
        const updated = cached.map((p) => p.id === path.slice('/products/'.length) ? { ...p, ...payload } : p);
        localStorage.setItem('apparel_cached_products_v1', JSON.stringify(updated)); setProducts(updated);
      }
      return { success: true, offlineQueued: true } as T;
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new ApiError(body.message || `Request failed (${response.status})`, response.status);
    return body as T;
  }

  async function loadProducts() {
    try { const response = await request<{ data: Product[] }>('/products'); setProducts(response.data ?? []); localStorage.setItem('apparel_cached_products_v1', JSON.stringify(response.data ?? [])); }
    catch (error) { const cached = JSON.parse(localStorage.getItem('apparel_cached_products_v1') || '[]') as Product[]; if ((!navigator.onLine || error instanceof TypeError) && cached.length) { setProducts(cached); return; } throw error; }
  }
  async function loadEmployees() {
    const response = await request<{ data: Employee[] }>('/employees');
    setEmployees(response.data ?? []);
  }
  async function loadAnalytics() { const result = await request<{ data: typeof analytics }>('/analytics'); setAnalytics(result.data); }
  async function loadTransactions() { try { const result = await request<{ data: Transaction[] }>('/transactions'); setTransactions(result.data ?? []); localStorage.setItem('apparel_cached_transactions_v1', JSON.stringify(result.data ?? [])); } catch (error) { const cached = JSON.parse(localStorage.getItem('apparel_cached_transactions_v1') || '[]') as Transaction[]; if (!navigator.onLine || error instanceof TypeError) { setTransactions(cached); return; } throw error; } }

  useEffect(() => { localStorage.setItem('apparel_cart_v1', JSON.stringify(cart)); }, [cart]);
  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('caches' in window)) { setOfflineReady(false); return; }
    let mounted = true;
    const inspectOfflineCache = async () => {
      try {
        const registration = await navigator.serviceWorker.ready;
        const cache = await caches.open('apparel-shell-v3');
        const shell = await cache.match(registration.scope);
        if (!shell) { if (mounted) setOfflineReady(false); return; }
        const html = await shell.clone().text();
        const assets = [...html.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css)(?:\?[^"']*)?)["']/g)].map((match) => new URL(match[1], registration.scope).href);
        const cachedAssets = await Promise.all(assets.map((url) => cache.match(url)));
        if (mounted) setOfflineReady(assets.length > 0 && cachedAssets.every(Boolean));
      } catch { if (mounted) setOfflineReady(false); }
    };
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { updateViaCache: 'none' })
      .then(inspectOfflineCache)
      .catch(() => { if (mounted) setOfflineReady(false); });
    navigator.serviceWorker.addEventListener('controllerchange', inspectOfflineCache);
    const checkTimer = window.setInterval(inspectOfflineCache, 30_000);
    return () => { mounted = false; window.clearInterval(checkTimer); navigator.serviceWorker.removeEventListener('controllerchange', inspectOfflineCache); };
  }, []);

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
    }).catch((error) => {
      let saved: User | null = null;
      try { saved = JSON.parse(localStorage.getItem('apparel_user_v1') || 'null') as User | null; } catch { /* ignore invalid cached session */ }
      if (saved && (!navigator.onLine || error instanceof TypeError || (error instanceof ApiError && error.status >= 500))) { setUser(saved); return; }
      if (error instanceof ApiError && error.status === 401) { localStorage.removeItem('apparel_token'); setToken(''); setUser(null); }
    });
  }, [token]);

  useEffect(() => { if (user) localStorage.setItem('apparel_user_v1', JSON.stringify(user)); }, [user]);
  useEffect(() => {
    let syncing = false;
    const sync = async () => {
      if (!navigator.onLine || syncing) return;
      syncing = true;
      try {
      const queue = JSON.parse(localStorage.getItem('apparel_offline_queue_v1') || '[]') as { id: string; path: string; method: string; body: string; tempId?: string }[];
      const remap = JSON.parse(localStorage.getItem('apparel_offline_id_map_v1') || '{}') as Record<string, string>;
      let changed = false;
      while (queue.length && navigator.onLine) {
        const item = queue[0];
        let path = item.path;
        for (const [from, to] of Object.entries(remap)) path = path.replaceAll(from, to);
        let body = item.body;
        try { const data = JSON.parse(body); if (Array.isArray(data.items)) data.items = data.items.map((line: { productId: string }) => ({ ...line, productId: remap[line.productId] || line.productId })); body = JSON.stringify(data); } catch { /* send the saved payload unchanged */ }
        try {
          const response = await fetch(`${API_BASE}/api${path}`, { method: item.method, headers: { 'content-type': 'application/json', authorization: `Bearer ${localStorage.getItem('apparel_token') || ''}` }, body });
          if (!response.ok) break;
          const result = await response.json().catch(() => ({}));
          if (item.method === 'POST' && item.path === '/products' && item.tempId && result.data?.id) {
            remap[item.tempId] = result.data.id; localStorage.setItem('apparel_offline_id_map_v1', JSON.stringify(remap));
            const cached = JSON.parse(localStorage.getItem('apparel_cached_products_v1') || '[]') as Product[];
            const updated = cached.map((p) => p.id === item.tempId ? result.data as Product : p);
            localStorage.setItem('apparel_cached_products_v1', JSON.stringify(updated)); setProducts(updated);
            const currentCart = JSON.parse(localStorage.getItem('apparel_cart_v1') || '{}') as Record<string, number>;
            if (currentCart[item.tempId]) { currentCart[result.data.id] = (currentCart[result.data.id] || 0) + currentCart[item.tempId]; delete currentCart[item.tempId]; localStorage.setItem('apparel_cart_v1', JSON.stringify(currentCart)); setCart(currentCart); }
          }
          queue.shift(); changed = true; localStorage.setItem('apparel_offline_queue_v1', JSON.stringify(queue)); setOfflinePending(queue.length);
        } catch { break; }
      }
      if (changed) { localStorage.removeItem('apparel_offline_id_map_v1'); loadProducts().catch(() => undefined); loadTransactions().catch(() => undefined); loadAnalytics().catch(() => undefined); }
      } finally { syncing = false; }
    };
    const onVisible = () => { if (document.visibilityState === 'visible') sync(); };
    const retry = window.setInterval(sync, 15000);
    window.addEventListener('online', sync); document.addEventListener('visibilitychange', onVisible); sync();
    return () => { window.clearInterval(retry); window.removeEventListener('online', sync); document.removeEventListener('visibilitychange', onVisible); };
  }, [token]);

  useEffect(() => { localStorage.setItem('apparel_backup_interval_v1', backupInterval); if (backupInterval === 'manual') return; const ms = backupInterval === '6h' ? 6 * 3600000 : backupInterval === 'daily' ? 86400000 : 7 * 86400000; const save = () => { const last = Number(localStorage.getItem('apparel_backup_at_v1') || 0); if (Date.now() - last < ms) return; localStorage.setItem('apparel_auto_backup_latest_v1', JSON.stringify({ version: 1, createdAt: new Date().toISOString(), products: JSON.parse(localStorage.getItem('apparel_cached_products_v1') || '[]'), transactions })); localStorage.setItem('apparel_backup_at_v1', String(Date.now())); }; save(); const id = window.setInterval(save, 60000); return () => clearInterval(id); }, [backupInterval, transactions]);

  useEffect(() => {
    if (!user) return;
    setMessage('');
    if (tab === 'products' && can('productsRead')) loadProducts().catch((e) => setMessage(e.message));
    if (tab === 'employees' && user.role === 'admin') loadEmployees().catch((e) => setMessage(e.message));
    if (tab === 'analytics' && can('analyticsRead')) { loadAnalytics().catch((e) => setMessage(e.message)); loadProducts().catch(() => undefined); loadTransactions().catch(() => undefined); }
    if (tab === 'history' && (user.role === 'admin' || can('analyticsRead'))) loadTransactions().catch((e) => setMessage(e.message));
    if (tab === 'returns' && can('salesCreate')) loadProducts().catch((e) => setMessage(e.message));
  }, [user, tab]);

  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('apparel_theme', theme); }, [theme]);
  useEffect(() => { document.documentElement.lang = language; document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr'; localStorage.setItem('apparel_lang', language); }, [language]);
  useEffect(() => { const online = () => setIsOnline(true); const offline = () => setIsOnline(false); window.addEventListener('online', online); window.addEventListener('offline', offline); return () => { window.removeEventListener('online', online); window.removeEventListener('offline', offline); }; }, []);
  useEffect(() => {
    if (!user || user.role !== 'employee') return;
    const heartbeat = () => { if (navigator.onLine && document.visibilityState === 'visible') request('/employees/heartbeat', { method: 'POST' }).catch(() => undefined); };
    const interval = window.setInterval(heartbeat, 30_000); window.addEventListener('online', heartbeat); document.addEventListener('visibilitychange', heartbeat); heartbeat();
    return () => { window.clearInterval(interval); window.removeEventListener('online', heartbeat); document.removeEventListener('visibilitychange', heartbeat); };
  }, [token, user?.id]);
  useEffect(() => {
    if (tab !== 'employees' || user?.role !== 'admin') return;
    const interval = window.setInterval(() => { if (navigator.onLine) loadEmployees().catch(() => undefined); }, 30_000);
    return () => window.clearInterval(interval);
  }, [tab, user?.role]);

  useEffect(() => () => { scannerRef.current?.stop().catch(() => undefined); }, []);
  useEffect(() => { setProductImage(editing && editing !== 'new' ? editing.imageUrl ?? '' : ''); }, [editing]);

  async function login(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage('');
    const form = new FormData(event.currentTarget);
    try {
      const result = await fetch(`${API_BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier: form.get('identifier'), password: form.get('access-code') }) });
      const body = await result.json();
      if (!result.ok) throw new Error(result.status === 401 ? 'اسم المستخدم أو كلمة المرور غير صحيحة. اكتب كلمة المرور يدويًا.' : body.message || `تعذر تسجيل الدخول (${result.status})`);
      localStorage.setItem('apparel_token', body.token); localStorage.setItem('apparel_user_v1', JSON.stringify(body.data)); setToken(body.token); setUser(body.data);
    } catch (e) { setMessage(e instanceof Error ? e.message : 'تعذر تسجيل الدخول'); }
    finally { setBusy(false); }
  }

  async function saveProduct(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!editing) return;
    const form = new FormData(event.currentTarget);
    const payload = { name: form.get('name'), sku: form.get('sku'), category: form.get('category'), productType: form.get('productType'), retailPrice: Number(form.get('retailPrice')), costPrice: Number(form.get('costPrice')), quantity: Number(form.get('quantity')), colors: String(form.get('colors')).split(',').map((x) => x.trim()).filter(Boolean), imageUrl: productImage };
    setBusy(true); setMessage('');
    try {
      const isNew = editing === 'new';
      await request(isNew ? '/products' : `/products/${editing.id}`, { method: isNew ? 'POST' : 'PUT', body: JSON.stringify(payload) });
      setEditing(null); await loadProducts(); setMessage(isNew ? 'تمت إضافة المنتج' : 'تم تحديث المنتج');
    } catch (e) { setMessage(e instanceof Error ? e.message : 'تعذر حفظ المنتج'); }
    finally { setBusy(false); }
  }

  async function deleteProduct(product: Product) {
    if (!window.confirm(`حذف المنتج «${product.name}» من المخزون؟ إذا كان له سجل مبيعات سيُخفى من المخزون مع الاحتفاظ بسجل المعاملات.`)) return;
    setBusy(true); setMessage('');
    try {
      const result = await request<{ data?: { deleted: boolean; archived: boolean }; offlineQueued?: boolean }>(`/products/${product.id}`, { method: 'DELETE' });
      setCart((current) => { const next = { ...current }; delete next[product.id]; return next; });
      if (!result.offlineQueued) await loadProducts();
      setMessage(result.offlineQueued ? `تمت إزالة ${product.name} محليًا؛ وسيُزامن الحذف عند عودة الاتصال.` : result.data?.archived ? `تمت إزالة ${product.name} من المخزون مع الاحتفاظ بسجل معاملاته.` : `تم حذف ${product.name}.`);
    } catch (e) { setMessage(e instanceof Error ? e.message : 'تعذر حذف المنتج'); }
    finally { setBusy(false); }
  }

  async function uploadProductImage(file?: File) {
    if (!file) return;
    if (!file.type.startsWith('image/')) { setMessage('اختَر ملف صورة صالحًا.'); return; }
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 1000 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      const dataUrl = canvas.toDataURL('image/webp', 0.78);
      if (dataUrl.length > 1400000) throw new Error('حجم الصورة بعد الضغط ما زال كبيرًا. اختَر صورة أصغر.');
      setProductImage(dataUrl);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'تعذر تحميل الصورة.'); }
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
      const result = await request<{ offlineQueued?: boolean; data?: Transaction }>('/sales', { method: 'POST', body: JSON.stringify({ items: cartItems.map(({ id, count }) => ({ productId: id, quantity: count })) }) });
      const localSale: Transaction = result.data ?? { id: `offline-${crypto.randomUUID()}`, type: 'sale', employeeName: user?.name || 'Offline', items: cartItems.map((p) => ({ productName: p.name, sku: p.sku, quantity: p.count, unitPrice: p.retailPrice })), totalAmount: cartTotal, createdAt: new Date().toISOString() };
      const saved = JSON.parse(localStorage.getItem('apparel_cached_transactions_v1') || '[]') as Transaction[]; const updated = [localSale, ...saved]; localStorage.setItem('apparel_cached_transactions_v1', JSON.stringify(updated)); setTransactions(updated);
      setCart({}); await loadProducts(); setMessage(result.offlineQueued ? 'تم حفظ البيع على الجهاز وسيُزامن تلقائيًا عند عودة الإنترنت.' : 'تم تسجيل البيع بنجاح');
    } catch (e) { setMessage(e instanceof Error ? e.message : 'تعذر إتمام البيع'); }
    finally { setBusy(false); }
  }

  async function processReturn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement); const product = products.find((item) => item.id === returnProduct);
    if (!product) { setMessage('اختر المنتج المرتجع أولًا.'); return; }
    setBusy(true);
    try {
      const quantity = Number(form.get('quantity'));
      const result = await request<{ offlineQueued?: boolean; data?: Transaction }>('/returns', { method: 'POST', body: JSON.stringify({ items: [{ productId: product.id, quantity, color: product.colors[0] ?? '' }], reason: form.get('reason') }) });
      const localReturn: Transaction = result.data ?? { id: `offline-${crypto.randomUUID()}`, type: 'return', employeeName: user?.name || 'Offline', items: [{ productName: product.name, sku: product.sku, quantity, unitPrice: product.retailPrice }], totalAmount: quantity * product.retailPrice, returnReason: String(form.get('reason') || ''), createdAt: new Date().toISOString() };
      const saved = JSON.parse(localStorage.getItem('apparel_cached_transactions_v1') || '[]') as Transaction[]; const updated = [localReturn, ...saved]; localStorage.setItem('apparel_cached_transactions_v1', JSON.stringify(updated)); setTransactions(updated);
      setMessage(result.offlineQueued ? 'تم حفظ المرتجع على الجهاز وسيُزامن عند عودة الإنترنت.' : 'تم تسجيل المرتجع وإضافة الكمية إلى المخزون.'); formElement.reset(); setReturnProduct(''); await loadProducts();
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

  async function setEmployeeActive(employee: Employee, isActive: boolean) {
    const action = isActive ? 'إعادة تفعيل' : 'إيقاف';
    if (!window.confirm(`${action} حساب ${employee.name}؟`)) return;
    setBusy(true);
    try {
      await request(`/employees/${employee.id}`, { method: 'PUT', body: JSON.stringify({ isActive }) });
      await loadEmployees();
      setMessage(isActive ? `تمت إعادة تفعيل حساب ${employee.name}.` : `تم إيقاف حساب ${employee.name}.`);
    } catch (e) { setMessage(e instanceof Error ? e.message : 'تعذر تحديث حالة الحساب'); }
    finally { setBusy(false); }
  }

  async function deleteEmployee(employee: Employee) {
    if (!window.confirm(`حذف حساب ${employee.name} نهائيًا؟ إذا كان لديه معاملات سابقة سيُوقف الحساب مع الاحتفاظ بالسجل.`)) return;
    setBusy(true);
    try {
      const result = await request<{ data: { deleted: boolean; archived: boolean } }>(`/employees/${employee.id}`, { method: 'DELETE' });
      await loadEmployees();
      setMessage(result.data.deleted ? `تم حذف حساب ${employee.name}.` : `لدى ${employee.name} معاملات سابقة؛ تم إيقاف الحساب مع الاحتفاظ بالسجل.`);
    } catch (e) { setMessage(e instanceof Error ? e.message : 'تعذر حذف الحساب'); }
    finally { setBusy(false); }
  }

  async function savePermissions(employee: Employee, permissions: Record<Permission, boolean>) {
    try {
      await request(`/employees/${employee.id}/permissions`, { method: 'PUT', body: JSON.stringify({ permissions }) });
      setEmployees((items) => items.map((item) => item.id === employee.id ? { ...item, permissions } : item));
      setMessage(`تم حفظ صلاحيات ${employee.name}`);
    } catch (e) { setMessage(e instanceof Error ? e.message : 'تعذر حفظ الصلاحيات'); }
  }

  async function factoryReset(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (form.get('confirmation') !== 'RESET') { setMessage('اكتب RESET للتأكيد على حذف بيانات المخزون والمعاملات.'); return; }
    setBusy(true);
    try {
      await request('/admin/factory-reset', { method: 'POST', body: JSON.stringify({ password: form.get('password') }) });
      const keys = Object.keys(localStorage).filter((key) => /^(apparel_(products|transactions|cart|cached_products|cached_transactions|offline_queue|offline_id_map|legacy_imported|auto_backup_latest|backup_at)_v1)$/.test(key));
      keys.forEach((key) => localStorage.removeItem(key));
      setCart({}); setResetOpen(false);
      if (indexedDB.databases) { const dbs = await indexedDB.databases(); await Promise.all(dbs.filter((db) => /apparel|pos/i.test(db.name || '')).map((db) => new Promise<void>((resolve) => { const deletion = indexedDB.deleteDatabase(db.name!); deletion.onsuccess = deletion.onerror = deletion.onblocked = () => resolve(); }))); }
      window.location.reload();
    } catch (e) { setMessage(e instanceof Error ? e.message : 'تعذرت إعادة الضبط'); }
    finally { setBusy(false); }
  }

  function exportBackup() {
    const content = JSON.stringify({ version: 1, createdAt: new Date().toISOString(), products, transactions }, null, 2);
    const url = URL.createObjectURL(new Blob([content], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = `apparel-backup-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(url);
  }
  async function restoreBackup(file?: File) {
    if (!file) return;
    try { const data = JSON.parse(await file.text()) as { products?: unknown[]; transactions?: unknown[] }; if (!Array.isArray(data.products) || !Array.isArray(data.transactions)) throw new Error('ملف النسخة الاحتياطية غير صالح.'); await request('/legacy/import', { method: 'POST', body: JSON.stringify(data) }); await Promise.all([loadProducts(), loadTransactions(), loadAnalytics()]); setMessage('تم استعادة البيانات من النسخة الاحتياطية.'); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'تعذرت استعادة النسخة.'); }
  }

  if (!token || !user) return <main className="login-shell"><form className="login-card" onSubmit={login} autoComplete="off"><div className="brand-mark">👕</div><p className="eyebrow">{language === 'ar' ? 'نظام إدارة الملابس' : 'CLOTHING INVENTORY'}</p><h1>مرحبًا بعودتك</h1><p className="muted">سجّل الدخول لإدارة المخزون والمبيعات</p><label>اسم المستخدم أو البريد<input name="identifier" autoComplete="off" required /></label><label>كلمة المرور<input name="access-code" type="password" autoComplete="new-password" required /></label>{message && <div className="notice error">{message}</div>}<button className="primary full" disabled={busy}>{busy ? 'جارٍ الدخول…' : 'تسجيل الدخول'} <span>←</span></button></form></main>;

  if (!can('productsRead') && user.role !== 'admin') return <main className="login-shell"><section className="login-card"><div className="brand-mark">!</div><h1>لا توجد صلاحية</h1><p className="muted">اطلب من مدير النظام منح حسابك صلاحية مناسبة.</p><button className="ghost" onClick={() => { localStorage.removeItem('apparel_token'); setToken(''); }}>تسجيل الخروج</button></section></main>;

  return <div className="app-shell">
    <aside className="sidebar"><div className="brand"><div className="brand-mark">👕</div><div><b>مخزون</b><small>{language === 'ar' ? 'نظام إدارة الملابس' : 'Clothing Management System'}</small></div></div><div className="side-label">{language === 'ar' ? 'مساحة العمل' : 'Workspace'}</div>
      {(user.role === 'admin' || can('analyticsRead')) && <button className={`nav-item secondary-nav ${tab === 'analytics' ? 'active' : ''}`} onClick={() => { setTab('analytics'); setAnalyticsTab('overview'); }}><span>▤</span> {language === 'ar' ? 'تحليل المبيعات والأرباح' : 'Sales & Profit Analysis'}</button>}
      <button className={tab === 'products' ? 'nav-item active' : 'nav-item'} onClick={() => setTab('products')}><span>▦</span> {language === 'ar' ? 'المنتجات' : 'Products'}</button>
      {can('salesCreate') && <button className={tab === 'sales' ? 'nav-item active' : 'nav-item'} onClick={() => setTab('sales')}><span>⌑</span> {language === 'ar' ? 'نقطة البيع' : 'POS'} <i>{Object.values(cart).reduce((a, b) => a + b, 0) || ''}</i></button>}
      {can('salesCreate') && <button className={tab === 'returns' ? 'nav-item active' : 'nav-item'} onClick={() => setTab('returns')}><span>↩</span> {language === 'ar' ? 'المرتجعات' : 'Returns'}</button>}
      {(user.role === 'admin' || can('analyticsRead')) && <button className={`nav-item secondary-nav ${tab === 'history' ? 'active' : ''}`} onClick={() => setTab('history')}><span>◷</span> {language === 'ar' ? 'سجل المعاملات' : 'Transactions'}</button>}
      {user.role === 'admin' && <button className={`nav-item secondary-nav ${tab === 'employees' ? 'active' : ''}`} onClick={() => setTab('employees')}><span>♙</span> {language === 'ar' ? 'الموظفون' : 'Employees'}</button>}
      <button className={`nav-item mobile-menu-button ${menuOpen ? 'active' : ''}`} onClick={() => setMenuOpen((open) => !open)}><span>☰</span> {language === 'ar' ? 'القائمة' : 'Menu'}</button>
      <div className="sidebar-foot"><div className="user-chip"><div className="avatar">{user.name.slice(0, 1)}</div><div className="user-text"><b>{user.name}</b><small>{user.role === 'admin' ? 'مدير النظام' : 'موظف'}</small></div><button title="تسجيل الخروج" onClick={() => { localStorage.removeItem('apparel_token'); setToken(''); setUser(null); }}>↪</button></div></div>
    </aside>
    <main className="main-content"><header className="topbar"><div><span className="eyebrow">{language === 'ar' ? 'مساحة العمل' : 'Workspace'} / {tab === 'products' ? (language === 'ar' ? 'المخزون' : 'Inventory') : tab === 'sales' ? (language === 'ar' ? 'نقطة البيع' : 'POS') : tab === 'returns' ? (language === 'ar' ? 'المرتجعات' : 'Returns') : tab === 'history' ? (language === 'ar' ? 'سجل المعاملات' : 'Transactions') : tab === 'analytics' ? (language === 'ar' ? 'تحليل المبيعات والأرباح' : 'Sales & Profit Analysis') : tab === 'employees' ? (language === 'ar' ? 'إدارة الفريق' : 'Team management') : ''}</span><h1>{tab === 'products' ? (language === 'ar' ? 'المنتجات' : 'Products') : tab === 'sales' ? (language === 'ar' ? 'نقطة البيع' : 'Point of Sale') : tab === 'returns' ? (language === 'ar' ? 'إدارة المرتجعات' : 'Returns') : tab === 'history' ? (language === 'ar' ? 'سجل المعاملات' : 'Transactions') : tab === 'analytics' ? (language === 'ar' ? 'تحليل المبيعات والأرباح' : 'Sales & Profit Analysis') : (language === 'ar' ? 'صلاحيات الموظفين' : 'Employee permissions')}</h1></div><div className="top-actions"><button className="icon-button" title={language === 'ar' ? 'تغيير اللغة' : 'Change language'} aria-label="Change language" onClick={() => setLanguage((value) => value === 'ar' ? 'en' : 'ar')}>{language === 'ar' ? 'EN' : 'ع'}</button><button className="icon-button" title={language === 'ar' ? 'تبديل المظهر' : 'Toggle theme'} onClick={() => setTheme((t) => t === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? '☼' : '☾'}</button><button className="icon-button menu-trigger" title={language === 'ar' ? 'القائمة' : 'Menu'} onClick={() => setMenuOpen((open) => !open)}>⋯</button><span className={`status-dot ${isOnline ? 'online' : 'offline'}`} role="status" aria-live="polite">{language === 'ar' ? (isOnline ? 'متصل بالإنترنت' : 'غير متصل / أوفلاين') : (isOnline ? 'Online' : 'Offline')}</span><div className="avatar">{user.name.slice(0, 1)}</div></div></header>
      {menuOpen && <div className="mobile-menu-popover"><button onClick={() => { setTab('history'); setMenuOpen(false); }}>◷ {language === 'ar' ? 'سجل المعاملات' : 'Transaction history'}</button>{can('analyticsRead') && <button onClick={() => { setTab('analytics'); setAnalyticsTab('overview'); setMenuOpen(false); }}>▤ {language === 'ar' ? 'تحليل المبيعات والأرباح' : 'Sales & Profit Analysis'}</button>}{user.role === 'admin' && <><button onClick={() => { setBackupOpen(true); setMenuOpen(false); }}>▧ {language === 'ar' ? 'النسخ الاحتياطي والاستعادة' : 'Backup & restore'}</button><button onClick={() => { setTab('employees'); setMenuOpen(false); }}>♙ {language === 'ar' ? 'الموظفون والصلاحيات' : 'Employees & permissions'}</button><button onClick={() => { setResetOpen(true); setMenuOpen(false); }}>⟲ {language === 'ar' ? 'إعادة ضبط المصنع' : 'Factory reset'}</button></>}<button onClick={() => { localStorage.removeItem('apparel_token'); setToken(''); setUser(null); }}>↪ {language === 'ar' ? 'تسجيل الخروج' : 'Sign out'}</button></div>}
      {!isOnline && <div className={`notice offline-notice${offlineReady === false ? ' error' : ''}`} role="status" aria-live="polite">{offlineReady === true ? (language === 'ar' ? 'أنت تعمل الآن من النسخة المحفوظة على هذا الجهاز.' : 'Running from the app saved on this device.') : offlineReady === false ? (language === 'ar' ? 'النسخة الأوفلاين غير مكتملة على هذا الجهاز. اتصل بالإنترنت وافتح الموقع حتى يكتمل حفظه، ثم أعد تحميل الصفحة.' : 'Offline files are missing. Connect and open the app until it finishes caching, then reload.') : (language === 'ar' ? 'جارٍ التحقق من ملفات النسخة المحفوظة…' : 'Checking saved app files…')}</div>}{offlinePending > 0 && <div className="notice offline-notice" role="status">{language === 'ar' ? `وضع عدم الاتصال · ${offlinePending} عمليات بانتظار المزامنة` : `Offline · ${offlinePending} changes waiting to sync`}</div>}{message && <div className="notice" role="status">{message}<button onClick={() => setMessage('')}>×</button></div>}

      {tab === 'products' && <section className="page-section">{legacyCounts.products + legacyCounts.transactions > 0 && <div className="legacy-import-banner"><div><b>{language === 'ar' ? 'بياناتك من الموقع السابق موجودة على هذا المتصفح' : 'Legacy data found in this browser'}</b><small>{legacyCounts.products} منتج · {legacyCounts.transactions} معاملة</small></div><button className="primary" disabled={importingLegacy} onClick={importLegacyData}>{importingLegacy ? 'جارٍ النقل…' : 'نقل البيانات للموقع الجديد'}</button></div>}<div className="toolbar"><div className="search-controls"><div className="search-box"><span>⌕</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={language === 'ar' ? 'ابحث بالاسم أو SKU…' : 'Search by name or SKU…'} />{query && <button type="button" className="clear-search" aria-label={language === 'ar' ? 'مسح البحث' : 'Clear search'} onClick={() => setQuery('')}>×</button>}</div><div className="search-filters"><select aria-label={language === 'ar' ? 'تصفية حسب الفئة' : 'Filter by category'} value={productCategoryFilter} onChange={(e) => setProductCategoryFilter(e.target.value)}><option value="all">{language === 'ar' ? 'كل الفئات' : 'All categories'}</option><option value="Men">{language === 'ar' ? 'رجالي' : 'Men'}</option><option value="Women">{language === 'ar' ? 'نسائي' : 'Women'}</option><option value="Kids">{language === 'ar' ? 'أطفال' : 'Kids'}</option></select><select aria-label={language === 'ar' ? 'تصفية حسب المخزون' : 'Filter by stock'} value={productStockFilter} onChange={(e) => setProductStockFilter(e.target.value)}><option value="all">{language === 'ar' ? 'كل الكميات' : 'All stock'}</option><option value="low">{language === 'ar' ? 'مخزون منخفض' : 'Low stock'}</option><option value="available">{language === 'ar' ? 'متوفر' : 'In stock'}</option></select></div></div>{can('productsWrite') && <button className="primary" onClick={() => setEditing('new')}>＋ {language === 'ar' ? 'إضافة منتج' : 'Add product'}</button>}</div><div className="products-grid">{visibleProducts.map((product) => <article className="product-card" key={product.id}><div className="product-visual"><span className="category-pill">{product.category === 'Men' ? 'رجالي' : product.category === 'Women' ? 'نسائي' : 'أطفال'}</span><ProductArtwork product={product} key={`${product.id}-${product.imageUrl || "fallback"}`} /><span className={product.quantity < 5 ? 'stock-pill low' : 'stock-pill'}>{product.quantity} قطعة</span></div><div className="product-info"><div className="product-title"><div><h3>{product.name}</h3><p className="sku">SKU · {product.sku}{product.productType && product.productType !== 'general' ? ` · ${product.productType}` : ''}</p></div><b className="price">{product.retailPrice.toFixed(2)} <small>ج.م</small></b></div><div className="product-bottom"><div className="color-dots">{product.colors.map((color) => <span title={color} key={color} />)}<small>{product.colors.join('، ')}</small></div>{can('productsWrite') && <div className="product-actions"><button className="edit-button" onClick={() => setEditing(product)}>{language === 'ar' ? 'تعديل' : 'Edit'} <span>↗</span></button><button className="danger-button product-delete-button" disabled={busy} onClick={() => deleteProduct(product)}>{language === 'ar' ? 'حذف' : 'Delete'}</button></div>}</div></div></article>)}</div>{visibleProducts.length === 0 && <div className="empty-state">{products.length === 0 ? (language === 'ar' ? 'لا توجد منتجات لعرضها' : 'No products to display') : (language === 'ar' ? 'لا توجد نتائج مطابقة. غيّر البحث أو خيارات التصفية.' : 'No matches. Change the search or filters.')}</div>}</section>}

      {tab === 'sales' && can('salesCreate') && <section className="sale-layout"><div className="sale-main card"><div className="section-heading"><div><span className="eyebrow">خطوة ١ / ٣</span><h2>{language === 'ar' ? 'امسح رمز المنتج' : 'Scan product code'}</h2><p className="muted">وجّه الكاميرا إلى QR أو الباركود لإضافته للسلة تلقائيًا.</p></div><span className="scanner-icon">⌗</span></div><label className="pos-search-label">{language === 'ar' ? 'بحث سريع عن منتج' : 'Quick product search'}<input value={posSearch} onChange={(e) => setPosSearch(e.target.value)} placeholder={language === 'ar' ? 'اكتب اسم المنتج أو SKU…' : 'Type product name or SKU…'} /></label>{posSearch && <div className="pos-search-results">{products.filter((p) => normalizeSearch(`${p.name} ${p.sku}`).includes(normalizeSearch(posSearch)) && p.quantity > 0).slice(0, 6).map((p) => <button key={p.id} onClick={() => { setCart((c) => ({ ...c, [p.id]: Math.min((c[p.id] || 0) + 1, p.quantity) })); setPosSearch(''); }}><span>{p.name}<small>{p.sku}</small></span><b>{p.retailPrice.toFixed(2)} ج.م　＋</b></button>)}</div>}<div id="qr-reader" className="qr-reader"><div className="qr-placeholder"><span>⌗</span><p>{language === 'ar' ? 'الكاميرا جاهزة للمسح' : 'Camera ready to scan'}</p></div></div><button className="primary full" onClick={toggleScanner}>{scannerActive ? 'إيقاف الكاميرا' : 'تشغيل ماسح الكاميرا'}</button><div className="manual-add"><label>أدخل SKU يدويًا<input id="manual-sku" placeholder={language === 'ar' ? 'مثال: TSH-001' : 'Example: TSH-001'} onKeyDown={(e) => { if (e.key === 'Enter') { addScannedCode((e.target as HTMLInputElement).value); (e.target as HTMLInputElement).value = ''; } }} /></label><button className="ghost" onClick={() => { const input = document.getElementById('manual-sku') as HTMLInputElement; addScannedCode(input.value); input.value = ''; }}>إضافة</button></div></div><aside className="cart-panel card"><div className="cart-heading"><div><span className="eyebrow">خطوة ٢ / ٣</span><h2>{language === 'ar' ? 'السلة' : 'Cart'}</h2></div><span className="cart-count">{cartItems.length} أصناف</span></div><div className="cart-lines">{cartItems.map((item) => <div className="cart-line" key={item.id}><div className="cart-mini"><ProductArtwork product={item} key={`${item.id}-${item.imageUrl || "fallback"}`} /></div><div className="cart-line-info"><b>{item.name}</b><small>{item.sku} · {item.retailPrice.toFixed(2)} ج.م</small></div><div className="qty-control"><button onClick={() => setCart((c) => ({ ...c, [item.id]: Math.max(0, c[item.id] - 1) }))}>−</button><b>{item.count}</b><button disabled={item.count >= item.quantity} onClick={() => setCart((c) => ({ ...c, [item.id]: c[item.id] + 1 }))}>＋</button></div></div>)}{!cartItems.length && <div className="empty-cart">امسح منتجًا لبدء البيع</div>}</div><div className="cart-total"><span>{language === 'ar' ? 'الإجمالي' : 'Total'}</span><b>{cartTotal.toFixed(2)} <small>ج.م</small></b></div><div className="checkout-step"><span className="eyebrow">خطوة ٣ / ٣</span><button className="success full" disabled={!cartItems.length || busy} onClick={checkout}>{busy ? 'جارٍ التسجيل…' : 'تأكيد البيع'} <span>←</span></button></div></aside></section>}

      {tab === 'returns' && can('salesCreate') && <section className="card return-panel"><div className="section-heading"><div><span className="eyebrow">استلام وإعادة للمخزون</span><h2>{language === 'ar' ? 'تسجيل مرتجع' : 'Record a return'}</h2><p className="muted">اختر المنتج والكمية، وسيتم تحديث المخزون وتسجيل العملية.</p></div><span className="scanner-icon">↩</span></div><form className="return-form" onSubmit={processReturn}><label>المنتج<select value={returnProduct} onChange={(e) => setReturnProduct(e.target.value)} required><option value="">اختر المنتج</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.sku}</option>)}</select></label><label>الكمية<input name="quantity" type="number" min="1" defaultValue="1" required /></label><label className="reason-field">سبب الإرجاع<input name="reason" maxLength={500} placeholder="اختياري" /></label><button className="primary" disabled={busy}>{busy ? 'جارٍ التسجيل…' : 'تأكيد المرتجع'}</button></form></section>}

      {tab === 'analytics' && can('analyticsRead') && <section className="analytics-page"><div className="print-report" dir={language === 'ar' ? 'rtl' : 'ltr'}><h1>تقرير المدير الشامل</h1><p>{new Date().toLocaleString('ar-EG')}</p><div className="print-metrics"><p>إجمالي المبيعات <b>{analytics.revenue.toFixed(2)} ج.م</b></p><p>إجمالي المرتجعات <b>{analytics.returnsValue.toFixed(2)} ج.م</b></p><p>صافي الربح التقديري <b>{(analytics.revenue-analytics.cogs-analytics.returnsValue).toFixed(2)} ج.م</b></p><p>قيمة المخزون بالتكلفة <b>{analytics.inventoryCost.toFixed(2)} ج.م</b></p></div><h2>المنتجات الأكثر مبيعًا</h2><ol>{analytics.topProducts.map((item)=><li key={item.name}>{item.name} — {item.quantity} قطعة</li>)}</ol></div><div className="analytics-tabs">{([['overview', 'نظرة عامة', 'Overview'], ['reports', 'تقارير المبيعات', 'Sales reports'], ['inventory', 'المخزون', 'Inventory']] as const).map(([key, ar, en]) => <button key={key} className={analyticsTab === key ? 'analytics-tab active' : 'analytics-tab'} onClick={() => setAnalyticsTab(key)}>{language === 'ar' ? ar : en}</button>)}</div>{analyticsTab === 'overview' && <><div className="analytics-hero"><div><span className="eyebrow">{language === 'ar' ? 'نظرة لحظية على نشاط متجرك' : 'A live view of your store'}</span><h2>{language === 'ar' ? 'أداء المتجر' : 'Store performance'}</h2><p>{language === 'ar' ? 'الأرقام محدثة مباشرة من قاعدة بيانات المبيعات والمخزون.' : 'Live figures from your sales and inventory database.'}</p></div><span className="analytics-hero-mark">↗</span></div><div className="analytics-report-actions"><button className="primary" onClick={() => window.print()}>▤ {language === 'ar' ? 'طباعة تقرير شامل' : 'Print executive report'}</button></div><section className="metrics-grid">{[[language === 'ar' ? 'إجمالي المبيعات' : 'Revenue', analytics.revenue, '↗', 'violet'], [language === 'ar' ? 'تكلفة البضاعة' : 'Cost of goods', analytics.cogs, '◈', 'amber'], [language === 'ar' ? 'صافي الربح' : 'Net profit', analytics.revenue - analytics.cogs - analytics.returnsValue, '✦', 'green'], [language === 'ar' ? 'تنبيهات المخزون' : 'Stock alerts', analytics.lowStock, '!', 'orange']].map(([label, value, icon, tone]) => <article key={String(label)} className={`metric-card ${tone}`}><span className="metric-icon">{icon}</span><small>{label}</small><strong>{tone === 'orange' ? value : `${Number(value).toFixed(2)} ج.م`}</strong></article>)}</section><section className="dashboard-grid"><article className="card dashboard-panel revenue-panel"><div className="dashboard-panel-heading"><div><span className="eyebrow">{language === 'ar' ? 'آخر ٧ أيام' : 'Last 7 days'}</span><h3>{language === 'ar' ? 'حركة المبيعات' : 'Sales activity'}</h3></div><b className="live-chip"><i />{language === 'ar' ? 'من قاعدة البيانات' : 'Live data'}</b></div>{(() => { const days = Array.from({ length: 7 }, (_, i) => { const day = new Date(Date.now() - (6 - i) * 86400000).toISOString().slice(0, 10); const point = analytics.dailySales?.find((item) => item.day === day); return { day, revenue: point?.revenue ?? 0, salesCount: point?.salesCount ?? 0 }; }); const max = Math.max(...days.map((d) => d.revenue), 1); return <div className="revenue-chart" role="img" aria-label={language === 'ar' ? 'مخطط مبيعات آخر سبعة أيام' : 'Sales chart for the last seven days'}>{days.map((d) => <div className="chart-day" key={d.day} title={`${d.revenue.toFixed(2)} ج.م · ${d.salesCount} مبيعات`}><b>{d.revenue ? `${Math.round(d.revenue)}` : '—'}</b><span className="chart-track"><i style={{ height: `${Math.max(d.revenue ? d.revenue / max * 100 : 0, 3)}%` }} /></span><small>{new Date(`${d.day}T12:00:00`).toLocaleDateString(language === 'ar' ? 'ar-EG' : 'en-US', { weekday: 'short' })}</small></div>)}</div>; })()}</article><article className="card dashboard-panel top-products-panel"><div className="dashboard-panel-heading"><div><span className="eyebrow">{language === 'ar' ? 'الأكثر طلبًا' : 'Best sellers'}</span><h3>{language === 'ar' ? 'أفضل المنتجات' : 'Top products'}</h3></div><span className="dashboard-panel-icon">✧</span></div>{(analytics.topProducts || []).slice(0, 5).map((item, index) => { const max = Math.max(...(analytics.topProducts || []).map((product) => product.quantity), 1); return <div className="top-product-row" key={item.name}><span className="top-product-rank">0{index + 1}</span><span className="top-product-name">{item.name}<i><b style={{ width: `${Math.max(item.quantity / max * 100, 4)}%` }} /></i></span><strong>{item.quantity}<small> {language === 'ar' ? 'قطعة' : 'pcs'}</small></strong></div>; })}{!analytics.topProducts?.length && <div className="chart-empty">{language === 'ar' ? 'ستظهر المنتجات بعد تسجيل أول عملية بيع.' : 'Products will appear after your first sale.'}</div>}</article></section><section className="card dashboard-stats"><div><span>▦</span><small>{language === 'ar' ? 'المنتجات' : 'Products'}</small><b>{analytics.products}</b></div><div><span>▤</span><small>{language === 'ar' ? 'الوحدات بالمخزن' : 'Units in stock'}</small><b>{analytics.unitsInStock}</b></div><div><span>↗</span><small>{language === 'ar' ? 'عدد المبيعات' : 'Sales'}</small><b>{analytics.salesCount}</b></div><div><span>↩</span><small>{language === 'ar' ? 'المرتجعات' : 'Returns'}</small><b>{analytics.returnsCount}</b></div><div><span>◈</span><small>{language === 'ar' ? 'قيمة المخزون' : 'Inventory value'}</small><b>{Number(analytics.inventoryCost || 0).toFixed(0)} <small>ج.م</small></b></div></section></>}{analyticsTab === 'reports' && <section className="history-list card"><div className="section-heading"><div><span className="eyebrow">{language === 'ar' ? 'تقارير المبيعات' : 'Sales reports'}</span><h2>{language === 'ar' ? 'المبيعات والمرتجعات' : 'Sales and returns'}</h2></div><button className="ghost" onClick={() => loadTransactions().catch((e) => setMessage(e.message))}>{language === 'ar' ? 'تحديث' : 'Refresh'}</button></div>{transactions.map((tx) => <article className="history-row" key={tx.id}><span className={tx.type === 'return' ? 'transaction-type returned' : 'transaction-type'}>{tx.type === 'return' ? 'مرتجع' : 'بيع'}</span><div className="history-detail"><b>{tx.items.map((item) => `${item.productName} × ${item.quantity}`).join('، ')}</b><small>{tx.employeeName} · {new Date(tx.createdAt).toLocaleString(language === 'ar' ? 'ar-EG' : 'en-US')}</small></div><strong>{tx.totalAmount.toFixed(2)} ج.م</strong></article>)}{transactions.length === 0 && <div className="empty-state">{language === 'ar' ? 'لا توجد مبيعات حتى الآن' : 'No sales yet'}</div>}</section>}{analyticsTab === 'inventory' && <section className="inventory-report"><div className="card analytics-summary"><span>{language === 'ar' ? 'المنتجات' : 'Products'}</span><b>{products.length}</b><span>{language === 'ar' ? 'الوحدات بالمخزن' : 'Units in stock'}</span><b>{analytics.unitsInStock}</b><span>{language === 'ar' ? 'منخفض المخزون' : 'Low stock'}</span><b>{analytics.lowStock}</b></div><div className="products-grid">{products.map((product) => <article className="product-card" key={product.id}><div className="product-visual"><ProductArtwork product={product} key={`${product.id}-${product.imageUrl || "fallback"}`} /><span className="category-pill">{product.category === 'Men' ? 'رجالي' : product.category === 'Women' ? 'نسائي' : 'أطفال'}</span><span className={product.quantity < 5 ? 'stock-pill low' : 'stock-pill'}>{product.quantity} قطعة</span></div><div className="product-info"><h3>{product.name}</h3><p className="sku">SKU · {product.sku}</p></div></article>)}</div></section>}</section>}

      {tab === 'history' && (user.role === 'admin' || can('analyticsRead')) && <section className="history-list card"><div className="section-heading"><div><span className="eyebrow">{language === 'ar' ? 'آخر ٥٠٠ معاملة' : 'Latest 500 transactions'}</span><h2>{language === 'ar' ? 'المبيعات والمرتجعات' : 'Sales and returns'}</h2></div><div className="history-actions"><button className="ghost" onClick={() => loadTransactions().catch((e) => setMessage(e.message))}>{language === 'ar' ? 'تحديث' : 'Refresh'}</button><button className="primary" onClick={() => window.print()}>▤ {language === 'ar' ? 'طباعة سجل المعاملات' : 'Print transactions'}</button></div></div><div className="history-list-summary"><span>{language === 'ar' ? 'عدد السجلات' : 'Records'} <b>{transactions.length}</b></span><span>{language === 'ar' ? 'مبيعات' : 'Sales'} <b>{transactions.filter((tx) => tx.type === 'sale').length}</b></span><span>{language === 'ar' ? 'مرتجعات' : 'Returns'} <b>{transactions.filter((tx) => tx.type === 'return').length}</b></span></div>{transactions.map((tx) => <article className="history-row" key={tx.id}><span className={tx.type === 'return' ? 'transaction-type returned' : 'transaction-type'}>{tx.type === 'return' ? (language === 'ar' ? 'مرتجع' : 'Return') : (language === 'ar' ? 'بيع' : 'Sale')}</span><div className="history-detail"><b>{tx.items.map((item) => `${item.productName} × ${item.quantity}`).join('، ')}</b><small>{tx.employeeName} · {new Date(tx.createdAt).toLocaleString(language === 'ar' ? 'ar-EG' : 'en-US')}{tx.returnReason ? ` · ${tx.returnReason}` : ''}</small></div><strong>{tx.totalAmount.toFixed(2)} ج.م</strong></article>)}{transactions.length === 0 && <div className="empty-state">{language === 'ar' ? 'لا توجد معاملات حتى الآن' : 'No transactions yet'}</div>}<div className="print-report transaction-print-report" dir={language === 'ar' ? 'rtl' : 'ltr'}><h1>{language === 'ar' ? 'سجل معاملات المتجر' : 'Store transaction ledger'}</h1><p>{language === 'ar' ? 'تاريخ الطباعة: ' : 'Printed: '}{new Date().toLocaleString(language === 'ar' ? 'ar-EG' : 'en-US')}</p><p>{language === 'ar' ? `عدد السجلات: ${transactions.length}` : `Records: ${transactions.length}`}</p><table><thead><tr><th>{language === 'ar' ? 'النوع' : 'Type'}</th><th>{language === 'ar' ? 'التفاصيل' : 'Items'}</th><th>{language === 'ar' ? 'الموظف' : 'Employee'}</th><th>{language === 'ar' ? 'التاريخ' : 'Date'}</th><th>{language === 'ar' ? 'الإجمالي' : 'Total'}</th></tr></thead><tbody>{transactions.map((tx) => <tr key={tx.id}><td>{tx.type === 'return' ? (language === 'ar' ? 'مرتجع' : 'Return') : (language === 'ar' ? 'بيع' : 'Sale')}</td><td>{tx.items.map((item) => `${item.productName} × ${item.quantity}`).join('، ')}</td><td>{tx.employeeName}</td><td>{new Date(tx.createdAt).toLocaleString(language === 'ar' ? 'ar-EG' : 'en-US')}</td><td>{tx.totalAmount.toFixed(2)} ج.م</td></tr>)}</tbody></table></div></section>}

      {tab === 'employees' && user.role === 'admin' && <section className="employees-list"><div className="employee-toolbar"><p className="muted">{language === 'ar' ? 'إدارة الموظفين وصلاحيات كل حساب.' : 'Manage employee accounts and permissions.'}</p><button className="primary" onClick={() => setNewEmployee(true)}>＋ {language === 'ar' ? 'إضافة موظف' : 'Add employee'}</button></div>{employees.map((employee) => <EmployeePermissions key={employee.id} employee={employee} language={language} onSave={savePermissions} onEdit={setEditingEmployee} onSetActive={setEmployeeActive} onDelete={deleteEmployee} />)}{!employees.length && <div className="empty-state">{language === 'ar' ? 'لا يوجد موظفون حتى الآن' : 'No employees yet'}</div>}</section>}
    </main>

    {backupOpen && <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setBackupOpen(false); }}><section className="modal card"><div className="modal-heading"><div><span className="eyebrow">إدارة البيانات</span><h2>النسخ الاحتياطي والاستعادة</h2></div><button className="close" onClick={() => setBackupOpen(false)}>×</button></div><label>النسخ التلقائي<select value={backupInterval} onChange={(e) => setBackupInterval(e.target.value)}><option value="6h">كل ٦ ساعات</option><option value="daily">يوميًا</option><option value="weekly">أسبوعيًا</option><option value="manual">يدوي</option></select></label><p className="muted">تُحفظ نسخة تلقائية محليًا في هذا المتصفح.</p><div className="modal-actions"><button className="primary" onClick={exportBackup}>تنزيل نسخة JSON</button><label className="ghost restore-file">استعادة من ملف<input type="file" accept="application/json,.json" onChange={(e) => restoreBackup(e.target.files?.[0])} /></label></div></section></div>}
    {resetOpen && <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setResetOpen(false); }}><form className="modal card" onSubmit={factoryReset}><div className="modal-heading"><div><span className="eyebrow">إجراء إداري</span><h2>إعادة ضبط المصنع</h2><p className="muted">سيتم حذف المنتجات وسجل المبيعات والمرتجعات نهائيًا. ستظل حسابات المستخدمين محفوظة.</p></div><button type="button" className="close" onClick={() => setResetOpen(false)}>×</button></div><label>كلمة مرور المدير الحالية<input name="password" type="password" required /></label><label>اكتب RESET للتأكيد<input name="confirmation" required autoComplete="off" /></label><div className="modal-actions"><button type="button" className="ghost" onClick={() => setResetOpen(false)}>إلغاء</button><button className="danger-button" disabled={busy}>{busy ? "جارٍ الحذف…" : "مسح بيانات النظام"}</button></div></form></div>}
    {editing && <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setEditing(null); }}><form className="modal card" onSubmit={saveProduct}><div className="modal-heading"><div><span className="eyebrow">إدارة المخزون</span><h2>{editing === 'new' ? 'إضافة منتج' : 'تعديل المنتج'}</h2></div><button type="button" className="close" onClick={() => setEditing(null)}>×</button></div><label>صورة المنتج: رابط أو رفع<input name="imageUrl" type="url" dir="ltr" value={productImage.startsWith("data:") ? "" : productImage} onChange={(e) => setProductImage(e.target.value)} placeholder="https://..." /></label><label className="image-upload-label">أو ارفع صورة من جهازك<input type="file" accept="image/*" onChange={(e) => uploadProductImage(e.target.files?.[0])} /></label>{productImage && <div className="image-preview-wrap"><img className="image-preview" src={productImage} alt="معاينة صورة المنتج" /><button type="button" className="ghost" onClick={() => setProductImage('')}>إزالة الصورة</button></div>}<label>اسم المنتج<input name="name" defaultValue={editing === 'new' ? '' : editing.name} required maxLength={150} /></label><div className="form-row"><label>رمز SKU<input name="sku" defaultValue={editing === 'new' ? '' : editing.sku} required pattern="[A-Za-z0-9-]+" /></label><label>الفئة<select name="category" defaultValue={editing === 'new' ? 'Men' : editing.category}><option value="Men">رجالي</option><option value="Women">نسائي</option><option value="Kids">أطفال</option></select></label></div><label>نوع القطعة (اختياري)<input name="productType" defaultValue={editing === 'new' ? '' : (editing as Product).productType ?? ''} placeholder="قمصان، بنطلونات، فساتين…" /></label><div className="form-row"><label>سعر البيع (ج.م)<input name="retailPrice" type="number" min="0" step="0.01" defaultValue={editing === 'new' ? '' : (editing as Product).retailPrice} required /></label><label>سعر التكلفة (ج.م)<input name="costPrice" type="number" min="0" step="0.01" defaultValue={editing === 'new' ? 0 : (editing as Product).costPrice ?? 0} required /></label></div><label>الكمية<input name="quantity" type="number" min="0" step="1" defaultValue={editing === 'new' ? 0 : (editing as Product).quantity} required /></label><label>الألوان المخصصة <small className="muted">افصل بين الألوان بفاصلة</small><input name="colors" placeholder="أسود، زيتي، بنفسجي" defaultValue={editing === 'new' ? '' : (editing as Product).colors.join(', ')} required /></label><div className="modal-actions"><button type="button" className="ghost" onClick={() => setEditing(null)}>إلغاء</button><button className="primary" disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'حفظ المنتج'}</button></div></form></div>}
    {newEmployee && <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setNewEmployee(false); }}><form className="modal card" onSubmit={createEmployee}><div className="modal-heading"><div><span className="eyebrow">إدارة الفريق</span><h2>إضافة موظف</h2></div><button type="button" className="close" onClick={() => setNewEmployee(false)}>×</button></div><label>الاسم<input name="name" required /></label><div className="form-row"><label>اسم المستخدم<input name="username" pattern="[a-zA-Z0-9._-]{3,40}" required /></label><label>البريد الإلكتروني<input name="email" type="email" required /></label></div><label>كلمة المرور المؤقتة<input name="password" type="password" minLength={8} required /></label><div className="form-row"><label>الهاتف<input name="phone" /></label><label>الفرع<input name="branch" /></label></div><label>المسمى الوظيفي<input name="jobTitle" /></label><div className="modal-actions"><button type="button" className="ghost" onClick={() => setNewEmployee(false)}>إلغاء</button><button className="primary" disabled={busy}>{busy ? 'جارٍ الإنشاء…' : 'إنشاء الحساب'}</button></div></form></div>}
    {editingEmployee && <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setEditingEmployee(null); }}><form className="modal card" onSubmit={updateEmployee}><div className="modal-heading"><div><span className="eyebrow">إدارة الفريق</span><h2>تعديل بيانات الموظف</h2></div><button type="button" className="close" onClick={() => setEditingEmployee(null)}>×</button></div><label>الاسم<input name="name" defaultValue={editingEmployee.name} required /></label><div className="form-row"><label>اسم المستخدم<input name="username" defaultValue={editingEmployee.username} required /></label><label>البريد الإلكتروني<input name="email" type="email" defaultValue={editingEmployee.email} required /></label></div><div className="form-row"><label>الهاتف<input name="phone" defaultValue={editingEmployee.phone} /></label><label>الفرع<input name="branch" defaultValue={editingEmployee.branch} /></label></div><label>المسمى الوظيفي<input name="jobTitle" defaultValue={editingEmployee.jobTitle} /></label><div className="modal-actions"><button type="button" className="ghost" onClick={() => setEditingEmployee(null)}>إلغاء</button><button className="primary" disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'حفظ البيانات'}</button></div></form></div>}
  </div>;
}

function ProductArtwork({ product }: { product: Product }) {
  const [failed, setFailed] = useState(false);
  if (product.imageUrl && !failed) return <img className="product-image" src={product.imageUrl} alt={product.name} loading="lazy" onError={() => setFailed(true)} />;
  return <div className="product-placeholder" role="img" aria-label={product.name}><span>{product.name}</span></div>;
}

function normalizeSearch(value: string) {
  return value.normalize('NFKD').replace(/[\u064B-\u065F\u0670]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').trim().toLocaleLowerCase();
}

function EmployeePermissions({ employee, language, onSave, onEdit, onSetActive, onDelete }: { employee: Employee; language: string; onSave: (employee: Employee, permissions: Record<Permission, boolean>) => Promise<void>; onEdit: (employee: Employee) => void; onSetActive: (employee: Employee, isActive: boolean) => void; onDelete: (employee: Employee) => void }) {
  const [permissions, setPermissions] = useState<Record<Permission, boolean>>({ ...permissionDefaults, ...employee.permissions });
  const [saving, setSaving] = useState(false);
  const changed = permissionNames.some(([key]) => permissions[key] !== (employee.permissions?.[key] ?? permissionDefaults[key]));
  async function submit() { setSaving(true); try { await onSave(employee, permissions); } finally { setSaving(false); } }
  const labels: Record<Permission, string> = language === 'ar' ? Object.fromEntries(permissionNames) as Record<Permission,string> : { productsRead: 'View products', productsWrite: 'Add/edit products and stock', salesCreate: 'Record sales', employeesRead: 'View employees', analyticsRead: 'View analytics' };
  return <article className={`employee-card card${employee.isActive ? '' : ' suspended'}`}><div className="employee-header"><div className="avatar large">{employee.name.slice(0, 1)}</div><div className="employee-identity"><h2>{employee.name}</h2><p className="muted">@{employee.username} · {employee.email} {employee.jobTitle ? `· ${employee.jobTitle}` : ''}</p></div><span className={employee.isActive ? 'employee-status' : 'employee-status inactive'}>{employee.isActive ? (employee.lastActiveAt && Date.now() - Date.parse(employee.lastActiveAt) < 90_000 ? (language === 'ar' ? 'نشط الآن / أونلاين' : 'Online now') : (language === 'ar' ? 'غير متصل' : 'Offline')) : (language === 'ar' ? 'الحساب موقوف' : 'Suspended')}</span></div><div className="permission-grid">{permissionNames.map(([key]) => <label className="permission-row" key={key}><span><b>{labels[key]}</b><small>{key}</small></span><input type="checkbox" checked={!!permissions[key]} onChange={(e) => setPermissions((p) => ({ ...p, [key]: e.target.checked }))} /></label>)}</div><div className="employee-actions"><span className="muted">{changed ? (language === 'ar' ? 'تغييرات غير محفوظة' : 'Unsaved changes') : (language === 'ar' ? 'الصلاحيات محفوظة' : 'Permissions saved')}</span><div className="employee-buttons"><button className="ghost" onClick={() => onEdit(employee)}>{language === 'ar' ? 'تعديل' : 'Edit'}</button>{employee.isActive ? <button className="ghost" onClick={() => onSetActive(employee, false)}>{language === 'ar' ? 'إيقاف الحساب' : 'Suspend'}</button> : <button className="success" onClick={() => onSetActive(employee, true)}>{language === 'ar' ? 'إعادة تفعيل' : 'Reactivate'}</button>}<button className="danger-button" onClick={() => onDelete(employee)}>{language === 'ar' ? 'حذف الحساب' : 'Delete account'}</button><button className="primary" disabled={!changed || saving} onClick={submit}>{saving ? (language === 'ar' ? 'جارٍ الحفظ…' : 'Saving…') : (language === 'ar' ? 'حفظ الصلاحيات' : 'Save permissions')}</button></div></div></article>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
