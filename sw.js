const VERSION = 'apparel-shell-v2';
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    const shell = await fetch(self.registration.scope, { cache: 'reload' });
    if (!shell.ok) throw new Error('App shell could not be cached');
    await cache.put(self.registration.scope, shell.clone());
    const html = await shell.text();
    const assets = [...html.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css)(?:\?[^"']*)?)["']/g)].map((match) => new URL(match[1], self.registration.scope));
    await Promise.all(assets.map(async (url) => { const response = await fetch(url, { cache: 'reload' }); if (response.ok) await cache.put(url.href, response); }));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith('apparel-shell-') && key !== VERSION).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.includes('/api/')) return;
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(VERSION);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2500);
      try {
        const response = await fetch(request, { signal: controller.signal });
        if (response.ok) { await cache.put(self.registration.scope, response.clone()); return response; }
        return (await cache.match(self.registration.scope)) || response;
      } catch {
        return (await cache.match(self.registration.scope)) || Response.error();
      } finally { clearTimeout(timeout); }
    })());
    return;
  }
  if (/\.[A-Za-z0-9_-]{8,}\.(js|css)$/.test(url.pathname) || /\.(woff2?|png|svg|webp)$/.test(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(VERSION);
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    })());
  }
});
