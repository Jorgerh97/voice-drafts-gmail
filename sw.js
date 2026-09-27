// Service worker: carga rápida, app instalable y recepción de archivos desde «Compartir» en Android.
// Solo cachea los archivos de la propia app; las llamadas a Google y al proxy pasan siempre por la red.
const CACHE = 'vdg-v4';
const FILES = ['./', 'index.html', 'manifest.json', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('vdg-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// ---- IndexedDB (la misma base que usa la app para los adjuntos) ----
function idb(mode, fn) {
  return new Promise((res, rej) => {
    const r = indexedDB.open('vdg', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onerror = () => rej(r.error);
    r.onsuccess = () => {
      const t = r.result.transaction('kv', mode), q = fn(t.objectStore('kv'));
      t.oncomplete = () => res(q.result); t.onerror = () => rej(t.error);
    };
  });
}

// Android envía aquí (POST) los archivos compartidos con la app: se guardan como adjuntos
// y se abre la app, que los muestra listos para dictar el correo.
async function receiveShare(request) {
  const home = new URL('./', self.registration.scope);
  try {
    const form = await request.formData();
    const got = form.getAll('files').filter(f => typeof f !== 'string' && f.size > 0);
    const current = (await idb('readonly', s => s.get('files'))) || [];
    got.forEach(f => current.push({ name: f.name || 'archivo', type: f.type || 'application/octet-stream', size: f.size, blob: f, fresh: true }));
    await idb('readwrite', s => s.put(current, 'files'));
    home.searchParams.set('shared', String(got.length));
  } catch {
    home.searchParams.set('shared', 'error');
  }
  return Response.redirect(home.href, 303);
}

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  if (e.request.method === 'POST' && url.pathname.endsWith('/share-target')) { e.respondWith(receiveShare(e.request)); return; }
  if (e.request.method !== 'GET') return;
  // Red primero (para ver siempre la última versión), caché si no hay conexión.
  e.respondWith(
    fetch(e.request)
      .then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return res; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('./')))
  );
});
