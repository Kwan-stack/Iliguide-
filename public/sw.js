const CACHE = 'iliguide-shell-v3';
const SHELL = ['/', '/manifest.webmanifest', '/favicon.png?v=2'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key.startsWith('iliguide-shell-') && key !== CACHE).map((key) => caches.delete(key)),
  )).then(() => self.clients.claim()));
});

self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data?.json() ?? {}; } catch { payload = { body: event.data?.text() ?? '' }; }
  const title = typeof payload.title === 'string' ? payload.title.slice(0, 100) : 'Iliguide update';
  const body = typeof payload.body === 'string' ? payload.body.slice(0, 180) : 'You have a new update. Open Illiguide to view it.';
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: '/favicon.png?v=2',
    badge: '/favicon.png?v=2',
    data: { url: '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const target = new URL('/', self.location.origin).href;
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (client.url.startsWith(self.location.origin) && 'focus' in client) {
        await client.focus();
        if ('navigate' in client && client.url !== target) await client.navigate(target);
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/')));
    return;
  }

  const isShellAsset = ['script', 'style', 'image', 'font'].includes(request.destination)
    || url.pathname === '/manifest.webmanifest';
  if (!isShellAsset) return;
  event.respondWith(caches.match(request).then((cached) => {
    const fresh = fetch(request).then((response) => {
      if (response.ok) void caches.open(CACHE).then((cache) => cache.put(request, response.clone()));
      return response;
    });
    return cached || fresh;
  }).catch(() => caches.match('/')));
});
