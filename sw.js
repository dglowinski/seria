// Offline support. The app shell is cached on install; later requests are
// answered from the cache at once and refreshed in the background, so the app
// opens with no signal and picks up a new version on the next start.
// Bump VERSION whenever files change.
const VERSION = 'seria-1.0.0';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css', 'css/standalone.css',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
  'vendor/preact-htm.js',
  'js/app.js', 'js/store.js', 'js/platform.js', 'js/cloud.js',
  'js/domain/rules.js', 'js/domain/catalog.js', 'js/domain/planner.js', 'js/domain/session.js', 'js/domain/progression.js',
  'js/ai/prompts.js', 'js/ai/claude.js', 'js/ai/coach.js',
  'js/ui/kit.js', 'js/ui/plan.js', 'js/ui/coachview.js', 'js/ui/history.js', 'js/ui/equipment.js', 'js/ui/prefs.js', 'js/ui/workout.js',
];
// The Claude SDK is big and only needed online, so it is cached when first used.

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return; // API calls go straight to the network
  event.respondWith(caches.open(VERSION).then(async (cache) => {
    const cached = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
    const fresh = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
    return cached || (await fresh) || (req.mode === 'navigate' ? cache.match('index.html') : Response.error());
  }));
});
