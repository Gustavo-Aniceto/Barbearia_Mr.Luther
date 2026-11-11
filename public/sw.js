/*
 * Service worker do app MR.LUDER.
 * - Arquivos estáticos (JS/CSS do build, ícones e fotos): guardados no aparelho para abrir rápido.
 * - Páginas: sempre buscadas na internet; sem conexão, mostra a tela "sem internet".
 * - API, login e pagamentos: nunca passam por cache (dados pessoais e sempre atuais).
 */
const VERSION = 'v1';
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
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok && res.type === 'basic') cache.put(req, res.clone());
        return res;
      }),
    );
  }
});
