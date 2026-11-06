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


/* ---------------------------------------------------------------------
   BEING TOLD, AND THE COUNT ON THE ICON

   The push that arrives is EMPTY. The Lodge's server signs a token and
   nothing more, so Apple and Google carry the fact that something was
   posted and never the posting itself. This worker then fetches the
   bulletin and reads it here, on the phone.

   That is why there is a fetch in a push handler, which usually means
   somebody has done something wrong. Here it is the point.

   Apps Script answers the bulletin to anyone — it is the same list the
   front page shows a stranger — so no key travels with this request and
   none is held in this file.
   --------------------------------------------------------------------- */

const BULLETIN_URL = 'https://script.google.com/macros/s/AKfycbwUcMlS1ePkQiRNTwk8kUTilL0CX7P_-CqAuQBRp9hyj9wK69OXNobEnkFeUze5ErFu/exec?action=bulletin';

/* The page and this worker both need to know which announcements the
   brother has already seen, and they cannot share localStorage — a
   worker has none. The Cache API is the one store both can open. */
const SEEN_KEY = '/__seen-announcements';

async function readSeen() {
  try {
    const hit = await (await caches.open(CACHE)).match(SEEN_KEY);
    return hit ? new Set(await hit.json()) : new Set();
  } catch (err) { return new Set(); }
}

async function liveAnnouncements() {
  const res = await fetch(BULLETIN_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error('bulletin ' + res.status);
  const data = await res.json();
  const today = new Date().toISOString().slice(0, 10);
  // An announcement past its expiry is off the board, so it is not news.
  return (data.announcements || []).filter(a => !a.expiryDate || a.expiryDate >= today);
}

/* The number on the icon. Zero clears it rather than showing a nought. */
async function setBadge(n) {
  try {
    if (!self.registration.setAppBadge) return;
    if (n > 0) await self.registration.setAppBadge(n);
    else if (self.registration.clearAppBadge) await self.registration.clearAppBadge();
  } catch (err) { /* badging is a courtesy, never a failure */ }
}

self.addEventListener('push', event => {
  /* Every push MUST end in a visible notification. Both Chrome and
     Safari allow a handful of silent ones and then revoke permission
     for the site entirely — so the catch below still shows something,
     rather than letting a failed fetch cost the Lodge its permission. */
  event.waitUntil((async () => {
    let title = 'Noli Me Tangere Lodge No. 42';
    let body = 'A new notice is on the bulletin board.';
    let unread = 1;
    try {
      const live = await liveAnnouncements();
      const seen = await readSeen();
      const fresh = live.filter(a => !seen.has(String(a.announcementId)));
      unread = fresh.length || live.length;
      if (fresh.length === 1) {
        title = fresh[0].title || title;
        body = String(fresh[0].message || '').slice(0, 180) || body;
      } else if (fresh.length > 1) {
        body = fresh.length + ' new notices are on the bulletin board.';
      }
    } catch (err) {
      // Offline, or the script is slow. The brother still gets told.
    }
    await setBadge(unread);
    await self.registration.showNotification(title, {
      body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: 'nmt-bulletin',          // a second push replaces the first
      renotify: true,
      data: { url: '/?tab=bulletin' }
    });
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/?tab=bulletin';
  event.waitUntil((async () => {
    /* Bring the app he already has open to the front rather than opening
       a second copy of it. */
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of open) {
      if (new URL(client.url).origin === self.location.origin) {
        await client.focus();
        if (client.navigate) await client.navigate(target).catch(() => {});
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});
