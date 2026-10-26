/* An officer setting their own password. The security of this route is its
   rules, so each one is checked: you must be signed in, you change your own
   chair and only your own, and you must give the current password again. */
import assert from 'node:assert';

process.env.SESSION_SECRET = 'y'.repeat(32);
process.env.UPSTASH_REDIS_REST_URL = 'https://store.example';
process.env.UPSTASH_REDIS_REST_TOKEN = 'tok';

// A stand-in for Upstash, speaking its REST shape.
const store = new Map();
globalThis.fetch = async (url, init = {}) => {
  assert.strictEqual(init.headers?.Authorization, 'Bearer tok', 'store called without its token');
  const u = new URL(url);
  const [, verb, rawKey] = u.pathname.split('/');
  const key = decodeURIComponent(rawKey || '');
  if (verb === 'get') return { ok: true, json: async () => ({ result: store.get(key) ?? null }) };
  if (verb === 'set') { store.set(key, init.body); return { ok: true, json: async () => ({ result: 'OK' }) }; }
  if (verb === 'del') { store.delete(key); return { ok: true, json: async () => ({ result: 1 }) }; }
  throw new Error('unexpected ' + verb);
};

const { hashPassword, verifyPassword, signToken, newSession, resolvePassword,
        kvPasswordKey } = await import('../api/_lib.mjs');
const { default: handler } = await import('../api/password.mjs');

const ORIGINAL = 'the-original-password';
process.env.PW_SECRETARY = hashPassword(ORIGINAL);
process.env.PW_WM        = hashPassword('wm-original-password');
process.env.PW_ADMIN     = hashPassword('admin-original-password');

const cookieFor = role => 'nmt_session=' + signToken(newSession(role), process.env.SESSION_SECRET);
const post = async (body, cookie) => {
  const req = { method: 'POST', headers: cookie ? { cookie } : {},
                async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body)); } };
  const res = { statusCode: 0, body: null, setHeader() {}, end(b) { this.body = JSON.parse(b); } };
  await handler(req, res);
  return res;
};

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; };

// --- you must be signed in ---
ok((await post({ currentPassword: ORIGINAL, newPassword: 'a-new-password' })).statusCode === 401,
   'an anonymous caller must not change a password');

// --- the current password must be right ---
let r = await post({ currentPassword: 'not-it', newPassword: 'a-new-password' }, cookieFor('secretary'));
ok(r.statusCode === 401 && r.body.error === 'current_password_wrong', 'wrong current password must be refused');
ok(store.size === 0, 'nothing may be written on a failed attempt');

// --- a new password has to be worth having ---
r = await post({ currentPassword: ORIGINAL, newPassword: 'short' }, cookieFor('secretary'));
ok(r.statusCode === 400 && r.body.error === 'too_short', 'a short password must be refused');
r = await post({ currentPassword: ORIGINAL, newPassword: ORIGINAL }, cookieFor('secretary'));
ok(r.statusCode === 400 && r.body.error === 'unchanged', 'reusing the same password must be refused');
r = await post({ currentPassword: ORIGINAL, newPassword: ' padded-password ' }, cookieFor('secretary'));
ok(r.statusCode === 400 && r.body.error === 'edge_whitespace', 'edge whitespace must be refused');
ok(store.size === 0, 'still nothing written');
console.log('PASS  signed in, current password correct, new one worth having');

// --- the change itself ---
const NEW = 'a-brand-new-password';
r = await post({ currentPassword: ORIGINAL, newPassword: NEW }, cookieFor('secretary'));
ok(r.statusCode === 200 && r.body.changed === true, 'the change must succeed');
const saved = store.get(kvPasswordKey('secretary'));
ok(!!saved, 'the new password must reach the store');
ok(saved.startsWith('scrypt:') && saved.length === 168, 'it must be stored as a hash, never as typed');
ok(!saved.includes(NEW), 'the plain password must never be stored');
ok(verifyPassword(NEW, saved), 'the stored hash must verify the new password');
ok(!verifyPassword(ORIGINAL, saved), 'the old password must stop working');

// resolvePassword must now prefer what the officer set
const resolved = await resolvePassword('secretary');
ok(resolved.hash === saved && resolved.source === 'set by the officer', 'the stored password must win');
// ...and the other chairs must be untouched
ok((await resolvePassword('wm')).source === 'environment variable', 'another chair must be unaffected');
console.log('PASS  stored as a hash, takes effect, leaves other chairs alone');

// --- you cannot change a chair that is not yours ---
r = await post({ role: 'wm', currentPassword: 'wm-original-password', newPassword: 'trying-it-on' },
               cookieFor('secretary'));
ok(r.statusCode === 401, 'a role in the body must not be honoured');
ok(!store.get(kvPasswordKey('wm')), "another chair's password must not be written");
console.log('PASS  the chair comes from the session, never from the request');

// --- the administrator may clear a chair, nobody else ---
r = await post({ reset: 'secretary' }, cookieFor('wm'));
ok(r.statusCode === 403, 'an ordinary chair must not reset another');
ok(!!store.get(kvPasswordKey('secretary')), 'and must not have cleared it');

r = await post({ reset: 'secretary' }, cookieFor('admin'));
ok(r.statusCode === 200 && r.body.reset === 'secretary', 'the administrator may clear a chair');
ok(!store.get(kvPasswordKey('secretary')), 'the stored password must be gone');
ok((await resolvePassword('secretary')).source === 'environment variable',
   'the chair must fall back to the variable the administrator controls');
ok(verifyPassword(ORIGINAL, (await resolvePassword('secretary')).hash), 'and that password works again');

r = await post({ reset: 'nosuchchair' }, cookieFor('admin'));
ok(r.statusCode === 400, 'an unknown chair must be refused');
console.log('PASS  only the administrator resets, and a reset restores the variable');

console.log(`\nall ${pass} checks passed`);
