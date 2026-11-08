/* DIOS Amplifier service worker: makes the site installable and lets the app open offline.
   Network first, so a revoked key or a new deploy always wins while online; the cache is only a fallback. */
const CACHE = 'dios-amp-v1';
const SHELL = ['/', '/index.html', '/amp.js', '/amp.css', '/glass.css', '/board.js', '/board.css', '/yt.html',
  '/sounds/venix-theri-vili.mp3', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', e => {
  self.skipWaiting();
  // best effort: files behind the key screen only cache once you are unlocked
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u =>
    fetch(u, { credentials: 'same-origin', redirect: 'manual' }).then(r => r.ok && r.type === 'basic' ? c.put(u, r) : null).catch(() => null)))));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  if (req.headers.has('range')) return;   // audio seeking: let the browser handle partial requests
  e.respondWith(fetch(req).then(res => {
    // keep only real pages and files, never the key screen a redirect lands on
    if (res.ok && !res.redirected && res.type === 'basic' && !url.pathname.startsWith('/unlock')) {
      const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy));
    }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: req.mode === 'navigate' }).then(r => r || (req.mode === 'navigate' ? caches.match('/') : undefined))
    .then(r => r || new Response('Offline', { status: 503, headers: { 'content-type': 'text/plain' } }))));
});
