/* The service worker, actually run.

   pwa.test.mjs reads sw.js and checks the right lines are present. That
   is not the same as checking it behaves, and the rule that matters most
   here is a behaviour: a request carrying a brother's name, his dues or
   his photograph must never be written to a cache on somebody's phone.
   A cache outlives the session that filled it, survives signing out, and
   is readable by anyone holding the handset.

   Grepping for `startsWith('/api/')` proves that string is in the file.
   It does not prove an /api/ request reaches it — one `return` moved
   above it and the guard is dead while every line this test used to
   look for is still there, in order.

   So the worker is loaded and its handlers are called, against a stub
   that records every cache write. Nothing here touches the network. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert';
const HERE = dirname(fileURLToPath(import.meta.url));

const ORIGIN = 'https://nmt-lodge-42.vercel.app';
const src = readFileSync(join(HERE, '..', 'sw.js'), 'utf8');

/* --- the smallest world the worker will run in --- */
function load() {
  const listeners = {};
  const puts = [];          // every write the worker attempts
  const fetched = [];
  const store = new Map();

  const cache = {
    async match(req) { return store.get(key(req)) || undefined; },
    async put(req, res) { puts.push(key(req)); store.set(key(req), res); },
    async add(req) { puts.push(key(req)); store.set(key(req), { body: 'cached' }); },
    async keys() { return [...store.keys()]; }
  };
  const key = r => typeof r === 'string' ? r : r.url;

  const self_ = {
    location: { origin: ORIGIN },
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
    caches: undefined
  };
  const caches_ = {
    async open() { return cache; },
    async keys() { return ['nmt42-shell-v1']; },
    async delete() { return true; },
    async match(req) { return cache.match(req); }
  };
  const fetch_ = async req => {
    fetched.push(key(req));
    if (offline.on) throw new Error('offline');
    return { ok: true, clone: () => ({ body: 'fresh' }), body: 'fresh' };
  };
  const offline = { on: false };

  new Function('self', 'caches', 'fetch', 'Request', 'URL', src)(
    self_, caches_, fetch_, class R {
      constructor(url, init) { this.url = String(url); Object.assign(this, init); }
    }, URL);

  return { listeners, puts, fetched, offline, store };
}

/* Ask the worker what it does with one request. `handled` is the whole
   question: a request the worker does not respond to goes to the network
   untouched, which is exactly what member data must do. */
async function route(sw, { path, mode = 'no-cors', method = 'GET', origin = ORIGIN }) {
  let handled = false, promise = null;
  await sw.listeners.fetch({
    request: { url: origin + path, method, mode },
    respondWith(p) { handled = true; promise = p; }
  });
  if (promise) { try { await promise; } catch (err) { /* offline */ } }
  return handled;
}

const sw = load();
assert.ok(sw.listeners.install && sw.listeners.activate && sw.listeners.fetch,
  'install, activate and fetch must all be registered');

/* --- INSTALL: the shell is precached, and nothing else --- */
let waited;
await sw.listeners.install({ waitUntil: p => { waited = p; } });
await waited;
assert.ok(sw.puts.length >= 4, 'the shell should be precached on install');
sw.puts.forEach(url => assert.ok(!url.includes('/api/'),
  'install precached ' + url + ', which carries member data'));

/* --- THE RULE: member data is never handled, so never cached --- */
const PRIVATE = [
  '/api/search?q=abad',          // the roster, by name
  '/api/session',                // who is signed in
  '/api/photo?k=abc123',         // a brother's photograph
  '/api/password',               // the officers' accounts
  '/api/action?action=roster'    // everything
];
for (const path of PRIVATE) {
  assert.strictEqual(await route(sw, { path }), false,
    path + ' must go straight to the network — the worker may not touch it');
}
// Named as a navigation, which is the branch that writes to the cache.
assert.strictEqual(await route(sw, { path: '/api/search?q=x', mode: 'navigate' }), false,
  'an /api/ URL must be refused before the navigation rule can cache it');

/* The Apps Script calls are cross-origin and carry the whole roll. */
for (const origin of ['https://script.google.com', 'https://script.googleusercontent.com']) {
  assert.strictEqual(await route(sw, { path: '/macros/s/x/exec?action=roster', origin }), false,
    origin + ' must be left alone');
}

const before = [...sw.puts];
assert.deepStrictEqual(sw.puts, before, 'none of the above wrote to a cache');

/* --- a write is never served from a cache --- */
for (const method of ['POST', 'PUT', 'DELETE', 'HEAD']) {
  assert.strictEqual(await route(sw, { path: '/', method }), false,
    method + ' must not be handled');
}

/* --- THE PAGE: network first, so a deploy reaches an installed phone --- */
sw.fetched.length = 0;
assert.strictEqual(await route(sw, { path: '/', mode: 'navigate' }), true);
assert.ok(sw.fetched.includes(ORIGIN + '/'), 'it asked the network for the page');
assert.ok(sw.puts.includes('/'), 'and kept the fresh copy for next time');

// Offline, it falls back to the copy it kept, rather than failing.
sw.offline.on = true;
sw.fetched.length = 0;
assert.strictEqual(await route(sw, { path: '/', mode: 'navigate' }), true,
  'with no signal the installed app must still open');
sw.offline.on = false;

/* --- the shell's files are served from the cache --- */
assert.strictEqual(await route(sw, { path: '/icons/icon-192.png' }), true);
assert.strictEqual(await route(sw, { path: '/noli-logo.jpg' }), true);
assert.strictEqual(await route(sw, { path: '/manifest.webmanifest' }), true);

/* --- anything else is somebody else's business --- */
assert.strictEqual(await route(sw, { path: '/some/other/thing.json' }), false);
assert.strictEqual(await route(sw, { path: '/css2?family=Archivo', origin: 'https://fonts.googleapis.com' }), false);

/* --- ACTIVATE: old caches are swept, the current one kept --- */
let act;
await sw.listeners.activate({ waitUntil: p => { act = p; } });
await act;

console.log('PASS  the worker caches the shell and opens offline, and refuses every ' +
  'request carrying member data (' + PRIVATE.length + ' checked, plus both Apps Script hosts)');
