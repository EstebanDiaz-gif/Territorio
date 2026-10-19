// Guarda la app en el celular para que abra sin señal.
// Cada vez que publiques cambios, subí el número de VERSION.
const VERSION = 'territorio-v14';
const ARCHIVOS = [
  './', './index.html', './manifest.json', './css/app.css',
  './js/app.js', './js/config.js', './js/roles.js', './js/importers.js', './js/store-demo.js', './js/store-firebase.js',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // Firebase maneja su propia caché
  if (/googleapis\.com\/(identitytoolkit|google\.firestore)|firestore\.googleapis|securetoken/.test(url.href)) return;
  const propio = url.origin === location.origin;
  const libreria = /cdnjs\.cloudflare\.com|gstatic\.com|fonts\.googleapis\.com/.test(url.host);
  if (!propio && !libreria) return;
  // Primero la red (para tener siempre lo último); si no hay señal, lo guardado
  // Los archivos propios se piden siempre frescos (sin la caché del navegador) para ver la última versión
  const pedido = propio ? new Request(e.request, { cache: 'no-cache' }) : e.request;
  e.respondWith(
    fetch(pedido).then((r) => {
      if (r.ok || r.type === 'opaque') { const copia = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, copia)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true })
      .then((r) => r || (e.request.mode === 'navigate' ? caches.match('./index.html') : Response.error())))
  );
});
