/*
 * Service worker do app MR.LUDER.
 * - Arquivos estáticos (JS/CSS do build, ícones e fotos): guardados no aparelho para abrir rápido.
 * - Páginas: sempre buscadas na internet; sem conexão, mostra a tela "sem internet".
 * - API, login e pagamentos: nunca passam por cache (dados pessoais e sempre atuais).
 * - Notificações do app (Web Push): mostra o aviso e, ao tocar, abre a tela certa.
 */
const VERSION = 'v3';
const STATIC = `mrluder-static-${VERSION}`;
const PAGES = `mrluder-pages-${VERSION}`;
const OFFLINE = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(PAGES).then((c) => c.addAll([OFFLINE, '/app/icon-192.png'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('mrluder-') && k !== STATIC && k !== PAGES).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  // Páginas: rede primeiro; sem internet, a tela offline.
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match(OFFLINE)));
    return;
  }

  // Estáticos com nome versionado e imagens públicas: cache primeiro.
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/app/') || url.pathname.startsWith('/img/')) {
    event.respondWith(
      caches.open(STATIC).then(async (cache) => {
        const hit = await caches.match(req);
        if (hit) return hit;
        try {
          const res = await fetch(req);
          if (res.ok && res.type === 'basic') cache.put(req, res.clone());
          return res;
        } catch {
          return Response.error();
        }
      }),
    );
  }
});

// ---------------------------------------------------------------- notificações do app
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data && event.data.text() }; }
  const title = data.title || 'MR.LUDER Barbearia';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    icon: '/app/icon-192.png',
    badge: '/app/icon-192.png',
    tag: data.tag || undefined,
    renotify: !!data.tag,
    data: { url: data.url || '/conta' },
    lang: 'pt-BR',
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (new URL(w.url).origin === self.location.origin) { await w.focus(); return w.navigate(target); }
    }
    return self.clients.openWindow(target);
  })());
});
