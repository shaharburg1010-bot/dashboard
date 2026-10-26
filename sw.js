// Service Worker — the app's own files, plus the Google font files (so it looks the same offline).
// It never touches Drive/Calendar traffic: your data lives in IndexedDB and Drive, not here.
const VERSION = 'dash-app-v6';
const FILES = [
  './', './index.html', './styles.css', './finance.css', './boot.js', './legacy.js', './model.js', './sync.js', './store.js',
  './drive.js', './auth.js', './calendar.js', './config.js', './memfile.js', './memdrive.js', './sections.js', './inbox.js', './prices.js',
  './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-maskable-512.png', './apple-touch-icon.png',
];
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== 'fonts').map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;

  // Fonts: saved copy first (they never change), network only the first time.
  if (FONT_HOSTS.includes(url.hostname)) {
    e.respondWith(caches.open('fonts').then((c) => c.match(e.request).then((hit) => hit ||
      fetch(e.request).then((res) => { if (res.ok || res.type === 'opaque') c.put(e.request, res.clone()); return res; }))));
    return;
  }
  if (url.origin !== self.location.origin) return; // Google Drive / Calendar / sign-in: hands off

  // Our files: newest when online, saved copy when offline.
  // cache:'no-cache' = always ask GitHub "is there a newer version?" (cheap ETag check),
  // so an update shows up on the next open instead of after the browser's 10-minute cache.
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })
        .then((hit) => hit || (e.request.mode === 'navigate' ? caches.match('./index.html') : undefined)))
  );
});
