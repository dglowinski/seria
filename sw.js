// Offline support. The app shell is cached on install; later requests are
// answered from the cache at once and refreshed in the background, so the app
// opens with no signal. A new version is fetched whole when it is installed,
// past the browser's own cache, and the page then loads it by itself (app.js).
// Bump VERSION whenever files change.
const VERSION = 'seria-1.7.0';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css', 'css/standalone.css',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
  'vendor/preact-htm.js',
  'js/app.js', 'js/store.js', 'js/platform.js', 'js/cloud.js',
  'js/domain/rules.js', 'js/domain/catalog.js', 'js/domain/planner.js', 'js/domain/schedule.js', 'js/domain/session.js', 'js/domain/progression.js',
  'js/ai/ai.js', 'js/ai/errors.js', 'js/ai/prompts.js', 'js/ai/claude.js', 'js/ai/openai.js', 'js/ai/coach.js',
  'js/ui/kit.js', 'js/ui/voice.js', 'js/ui/sketch.js', 'js/ui/plan.js', 'js/ui/coachview.js', 'js/ui/history.js', 'js/ui/equipment.js', 'js/ui/prefs.js', 'js/ui/workout.js', 'js/ui/weights.js', 'js/ui/past.js',
];
// The Claude and OpenAI SDKs are big and only needed online, so they are cached when first used.

self.addEventListener('install', (event) => {
  // 'reload' goes past the browser's cache: a copy fetched minutes before a release must not end up in the new version.
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' })))).then(() => self.skipWaiting()));
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
    // 'no-cache' asks the server each time, so an older copy the browser still holds cannot replace a newer one here.
    const fresh = fetch(req.url, { cache: 'no-cache' }).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
    return cached || (await fresh) || (req.mode === 'navigate' ? cache.match('index.html') : Response.error());
  }));
});

// Tapping the "rest over" notification brings the workout back to the front.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const client of list) if ('focus' in client) return client.focus();
    return self.clients.openWindow ? self.clients.openWindow('./') : null;
  }));
});
