// Offline support for the app's own code. Audio never passes through here.
// Network-first, so a new version on GitHub Pages shows up on the next online visit.
const CACHE = 'alto-v5';
const FILES = [
  'alto.html',
  'manifest.webmanifest',
  'css/styles.css',
  'fonts/Geist-Variable.woff2',
  'fonts/GeistMono-Variable.woff2',
  'icons/icon.svg',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'js/analysis.js',
  'js/app.js',
  'js/audio.js',
  'js/capture-worklet.js',
  'js/chart.js',
  'js/content.js',
  'js/formants.js',
  'js/pitch.js',
  'js/plan.js',
  'js/resonance.js',
  'js/spectrum.js',
  'js/store.js',
  'js/ui.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== location.origin) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request)),
  );
});
