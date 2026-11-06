/* Installing the site as a phone app.

   Almost everything here is a rule somebody else's software enforces —
   Chrome's install criteria, Android's icon mask, Safari's refusal to
   read a manifest — and each one fails in the same quiet way: the site
   keeps working perfectly in a desktop browser and simply never offers
   to install, or installs with a cropped seal. None of that shows up in
   any other test, and none of it shows up on the machine it was built
   on.

   The one that is ours rather than a vendor's is the last: the worker
   must never put a member's name in a cache on somebody's phone. */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert';
const HERE = dirname(fileURLToPath(import.meta.url));
const root = f => join(HERE, '..', f);

const html = readFileSync(root('index.html'), 'utf8');
const sw = readFileSync(root('sw.js'), 'utf8');
const manifest = JSON.parse(readFileSync(root('manifest.webmanifest'), 'utf8'));
const vercel = JSON.parse(readFileSync(root('vercel.json'), 'utf8'));

/* --- what Chrome requires before it will offer to install --- */
assert.ok(manifest.name && manifest.short_name, 'a name and a short name');
assert.ok(manifest.short_name.length <= 12,
  'a short name over 12 characters is truncated under the home-screen icon');
assert.strictEqual(manifest.start_url, '/');
assert.strictEqual(manifest.scope, '/');
assert.ok(['standalone', 'fullscreen', 'minimal-ui'].includes(manifest.display),
  'display:browser is not installable');
assert.match(manifest.background_color, /^#[0-9a-f]{6}$/i);
assert.match(manifest.theme_color, /^#[0-9a-f]{6}$/i);

const sizes = manifest.icons.map(i => i.sizes);
assert.ok(sizes.includes('192x192'), 'Chrome requires a 192');
assert.ok(sizes.includes('512x512'), 'Chrome requires a 512');
assert.ok(manifest.icons.some(i => (i.purpose || 'any').split(' ').includes('maskable')),
  'without a maskable icon Android crops the plain one and takes the ribbon off the seal');
assert.ok(manifest.icons.some(i => (i.purpose || 'any').split(' ').includes('any')),
  'a maskable icon alone is padded twice over everywhere else');

/* --- the icons exist, are PNG, and are the size they claim --- */
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const pngSize = buf => [buf.readUInt32BE(16), buf.readUInt32BE(20)];
const files = [...manifest.icons.map(i => i.src), '/icons/apple-touch-icon.png'];
files.forEach(src => {
  const path = root(src.replace(/^\//, ''));
  assert.ok(existsSync(path), src + ' is named in the manifest but is not in the repo');
  const buf = readFileSync(path);
  assert.ok(buf.subarray(0, 4).equals(PNG), src + ' must really be a PNG');
  const want = manifest.icons.find(i => i.src === src);
  if (want) {
    const [w, h] = pngSize(buf);
    assert.strictEqual(`${w}x${h}`, want.sizes,
      src + ' claims ' + want.sizes + ' and is ' + w + 'x' + h);
  }
  assert.ok(statSync(path).size < 400_000, src + ' is too heavy for an icon');
});

/* --- iOS reads none of the above --- */
assert.match(html, /<link rel="apple-touch-icon" href="\/icons\/apple-touch-icon\.png">/,
  'Safari will not take a home-screen icon from the manifest');
assert.match(html, /name="apple-mobile-web-app-capable" content="yes"/,
  'without this iOS opens the shortcut in Safari, with its chrome');
assert.match(html, /name="apple-mobile-web-app-title"/, 'the name under the iOS icon');
assert.match(html, /name="mobile-web-app-capable" content="yes"/,
  'the standard spelling, which replaced the apple- one');
assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest">/);
assert.match(html, /<meta name="theme-color" content="#070907">/);
assert.strictEqual(manifest.theme_color.toLowerCase(), '#070907',
  'the manifest and the meta tag must agree, or the status bar changes colour on load');

/* --- drawing under the notch --- */
assert.match(html, /viewport-fit=cover/,
  'without it an installed app is letterboxed on a notched phone');
assert.match(html, /@media \(display-mode:standalone\)/,
  'and with it, content runs under the notch unless the insets are applied');
assert.ok(/safe-area-inset-bottom/.test(html) && /safe-area-inset-top/.test(html),
  'both ends of the screen need keeping clear');

/* --- the shortcuts have somewhere to go --- */
(manifest.shortcuts || []).forEach(s => {
  const tab = new URL(s.url, 'https://x/').searchParams.get('tab');
  assert.ok(tab, s.name + ': a shortcut must name a tab');
  assert.ok(html.includes(`class="ribbon-btn main-tab" role="tab" id="tab-${tab}"`),
    s.name + ' opens ?tab=' + tab + ', and no such tab exists on the page');
  assert.ok(s.short_name.length <= 12, s.name + ': too long for the long-press menu');
});
assert.match(html, /\.main-tab\[data-panel="' \+ CSS\.escape\(tab\)/,
  'the page must read ?tab= and press the tab, or every shortcut opens the front page');
assert.ok(!(manifest.shortcuts || []).some(s => /admin/.test(s.url)),
  'the officers’ door is behind a password and is not a home-screen shortcut');

/* --- the worker: what it may keep, and what it may never keep --- */
assert.match(sw, /url\.origin !== self\.location\.origin\) return/,
  'the Apps Script calls are cross-origin and carry the roster');
assert.match(sw, /url\.pathname\.startsWith\('\/api\/'\)\) return/,
  'every /api/ route is session-authenticated and answers with member data');
assert.match(sw, /req\.method !== 'GET'\) return/, 'a write is never served from a cache');
const shell = [...sw.matchAll(/^\s*'(\/[^']*)',?$/gm)].map(m => m[1]);
assert.ok(shell.length >= 4, 'the shell list should be in sw.js');
shell.forEach(url => {
  assert.ok(url === '/' || existsSync(root(url.replace(/^\//, ''))),
    'the worker caches ' + url + ', which is not in the repo — install would skip it');
  assert.ok(!url.startsWith('/api/'), url + ' must never be precached');
});

/* The page is fetched from the network first. Cache-first on the document
   would pin every installed phone to the deploy it first saw. */
assert.match(sw, /req\.mode === 'navigate'/, 'the document needs its own rule');
const nav = sw.slice(sw.indexOf("req.mode === 'navigate'"));
assert.ok(nav.indexOf('await fetch(req)') < nav.indexOf('caches.match'),
  'the document must try the network before the cache, or a deploy never reaches a phone');

/* --- the two headers Vercel will not set on its own --- */
const header = src => (vercel.headers.find(h => h.source === src) || {}).headers || [];
const value = (src, key) => (header(src).find(h => h.key === key) || {}).value || '';
assert.match(value('/manifest.webmanifest', 'Content-Type'), /application\/manifest\+json/,
  'served as a generic file the manifest is ignored and the site is not installable');
assert.match(value('/sw.js', 'Cache-Control'), /max-age=0|no-cache|no-store/,
  'a phone holding a stale sw.js keeps serving a stale app, and nothing can tell it otherwise');

console.log('PASS  installable on Android and iOS, ' + manifest.icons.length +
  ' icons + the one Safari needs, ' + (manifest.shortcuts || []).length +
  ' shortcuts that land on real tabs, and no member data in any cache');
