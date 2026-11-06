/* The service worker. Its whole job is to let the installed app open
   when the phone has no signal, and to stay out of the way otherwise.

   WHAT IS CACHED: the shell. index.html, the emblem, the icons, the
   manifest. Those are the same for every brother and change only when
   the site is deployed.

   WHAT IS NEVER CACHED: anything carrying member data. /api/* is
   session-authenticated and returns the roster, photographs, dues and
   attendance; the Apps Script calls are cross-origin and do the same.
   A cache is a file on a phone that outlives the session that filled
   it, and the Lodge book does not belong there. Those requests are not
   handled by this worker at all — they go straight to the network, and
   if there is no network they fail, which is the honest answer.

   STALENESS: the page is one 340 KB file with everything inline, so
   there are no separate scripts that could fall out of step with it.
   That makes the safe choice the simple one — take the new worker
   immediately, claim the open pages, and always try the network first
   for the page itself. The cache answers only when the network does
   not. A brother who opens the app online always gets what was last
   deployed; a brother on the train gets the last page he was served. */

const CACHE = 'nmt42-shell-v1';

const SHELL = [
  '/',
  '/noli-logo.jpg',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // One bad entry must not fail the whole install and leave the app
    // with no worker at all, so each is fetched on its own.
    await Promise.all(SHELL.map(url =>
      cache.add(new Request(url, { cache: 'reload' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

/* A page asking this worker to step aside after a deploy. */
self.addEventListener('message', event => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

const isShell = url =>
  url.pathname === '/' || url.pathname === '/index.html' ||
  url.pathname === '/manifest.webmanifest' ||
  url.pathname === '/noli-logo.jpg' || url.pathname === '/charter-1918.webp' ||
  url.pathname.startsWith('/icons/');

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Someone else's server, including the Apps Script calls and the fonts.
  if (url.origin !== self.location.origin) return;
  // Member data. Never ours to keep.
  if (url.pathname.startsWith('/api/')) return;

  /* The page itself: network first, so a deploy is picked up the next
     time the app is opened with a signal. The cache is the fallback,
     not the source. */
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put('/', fresh.clone());
        return fresh;
      } catch (err) {
        const hit = await caches.match('/', { ignoreSearch: true });
        if (hit) return hit;
        throw err;
      }
    })());
    return;
  }

  /* The shell's own files: serve from the cache so the app opens at
     once, and refresh the copy in the background for next time. */
  if (isShell(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req);
      const net = fetch(req).then(res => {
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => hit);
      return hit || net;
    })());
  }
  // Everything else: left alone.
});
