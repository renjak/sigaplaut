// SIGAP LAUT service worker — simpan shell aplikasi agar bisa dibuka luring.
// Data live (/api/*) selalu lewat jaringan, tidak di-cache (prakiraan tidak boleh basi).
const C = 'sigap-laut-v1';
const CORE = ['/', '/index.html', '/manifest.json',
  '/lib/geo.js', '/lib/route.js', '/lib/wpio.js', '/lib/hazard.js', '/lib/specparse.js',
  '/data/bmkg-ports.json', '/icons/icon-192.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(C).then(c => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const u = new URL(e.request.url);
  if (u.pathname.startsWith('/api/')) return;                 // biarkan jaringan menangani data live
  if (u.origin !== location.origin) return;                   // aset pihak ketiga (peta, font) biarkan apa adanya
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      const copy = res.clone(); caches.open(C).then(c => c.put(e.request, copy)); return res;
    }).catch(() => caches.match('/index.html')))
  );
});
