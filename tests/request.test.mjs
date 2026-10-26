/* An officer with no password asking for a link. This route is reachable by
   anyone at all, so what it must NOT do is the point of these checks: it
   issues no link, no token and no password, and it cannot be aimed at the
   administrator's chair. */
import assert from 'node:assert';

process.env.SESSION_SECRET = 'r'.repeat(32);
process.env.UPSTASH_REDIS_REST_URL = 'https://store.example';
process.env.UPSTASH_REDIS_REST_TOKEN = 'tok';
delete process.env.BREVO_API_KEY;

const store = new Map();
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url);
  const [, verb, rawKey] = u.pathname.split('/');
  const key = decodeURIComponent(rawKey || '');
  if (verb === 'get') return { ok: true, json: async () => ({ result: store.get(key) ?? null }) };
  if (verb === 'set') { store.set(key, init.body); return { ok: true, json: async () => ({ result: 'OK' }) }; }
  if (verb === 'del') { store.delete(key); return { ok: true, json: async () => ({ result: 1 }) }; }
  throw new Error('unexpected ' + verb);
};

const { signToken, newSession, kvRequestKey, kvPasswordKey } = await import('../api/_lib.mjs');
const { default: invite } = await import('../api/invite.mjs');
const { default: password } = await import('../api/password.mjs');

const call = async (handler, body, role) => {
  const req = { method: 'POST',
    headers: { host: 'nmt-lodge-42.vercel.app',
               ...(role ? { cookie: 'nmt_session=' + signToken(newSession(role), process.env.SESSION_SECRET) } : {}) },
    async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body)); } };
  const res = { statusCode: 0, body: null, setHeader() {}, end(b) { this.body = JSON.parse(b); } };
  await handler(req, res);
  return res;
};
const ask = (chair, email) => call(invite, { request: true, chair, email }, null);
const listing = async () => (await call(password, { list: true }, 'admin')).body.chairs;
const find = (rows, chair) => rows.find(c => c.chair === chair);

// ---- it hands back nothing usable ---------------------------------------
let r = await ask('sw', 'warden@example.org');
assert.strictEqual(r.statusCode, 200);
assert.deepStrictEqual(r.body, { asked: true }, 'the answer carries nothing but an acknowledgement');
const dumped = JSON.stringify(r.body);
assert.ok(!/invite=|token|link|password/i.test(dumped), 'no link, token or password may come back');
console.log('PASS  asking returns an acknowledgement and nothing usable');

// ---- the administrator's chair cannot be named --------------------------
r = await ask('admin', 'someone@example.org');
assert.deepStrictEqual(r.body, { asked: true }, 'the answer must not differ for the hidden chair');
assert.strictEqual(store.get(kvRequestKey('admin')), undefined,
  'nothing may be recorded against the administrator chair');
r = await ask('not-a-chair', 'someone@example.org');
assert.deepStrictEqual(r.body, { asked: true }, 'nor for a chair that does not exist');
assert.strictEqual(store.get(kvRequestKey('not-a-chair')), undefined);
console.log('PASS  the hidden chair and invented chairs record nothing, and answer the same');

// ---- a malformed address records nothing, and still answers the same ----
for (const bad of ['', 'not-an-address', 'a@b', 'x'.repeat(250) + '@example.org']) {
  const res = await ask('jw', bad);
  assert.deepStrictEqual(res.body, { asked: true }, 'the answer must not reveal the address was rejected');
}
assert.strictEqual(store.get(kvRequestKey('jw')), undefined, 'no malformed address is kept');
console.log('PASS  a malformed address is dropped silently, with the same answer');

// ---- the first request for a chair wins ---------------------------------
await ask('sw', 'impostor@example.net');
assert.strictEqual(JSON.parse(store.get(kvRequestKey('sw'))).email, 'warden@example.org',
  'a later request must not overwrite the address already on file');
console.log('PASS  a later request cannot overwrite the address already recorded');

// ---- the administrator sees it, and only the administrator --------------
let rows = await listing();
assert.strictEqual(find(rows, 'sw').requestedBy, 'warden@example.org', 'the request reaches the administrator');
assert.strictEqual(find(rows, 'jw').requestedBy, null, 'a chair nobody asked for shows nothing');
for (const role of [null, 'secretary', 'wm']) {
  const res = await call(password, { list: true }, role);
  assert.ok(res.statusCode === 401 || res.statusCode === 403, role + ' must not read the requests');
  assert.ok(!JSON.stringify(res.body).includes('warden@example.org'),
    'no email address may reach ' + role);
}
console.log('PASS  only the administrator can see who asked, and at which address');

// ---- issuing the link answers the request -------------------------------
const made = await call(invite, { chair: 'sw' }, 'admin');
assert.strictEqual(made.statusCode, 200);
rows = await listing();
assert.strictEqual(find(rows, 'sw').requestedBy, null, 'making the link clears the request');
assert.strictEqual(find(rows, 'sw').invitePending, true, 'and the chair now shows as waiting');
console.log('PASS  creating the link answers the request');

// ---- and so does using it ------------------------------------------------
await ask('tyler', 'tyler@example.org');
const t = await call(invite, { chair: 'tyler' }, 'admin');
const token = t.body.link.split('#invite=')[1];
await call(invite, { token, newPassword: 'a-password-of-his-own' }, null);
rows = await listing();
assert.strictEqual(find(rows, 'tyler').requestedBy, null);
assert.strictEqual(find(rows, 'tyler').state, 'chosen');
assert.ok(store.get(kvPasswordKey('tyler')).startsWith('scrypt:'), 'only a hash is ever stored');
assert.ok(!store.get(kvPasswordKey('tyler')).includes('a-password-of-his-own'),
  'the password itself is never stored');
console.log('PASS  redeeming clears the request and stores only a hash');

console.log('\nall checks passed');
