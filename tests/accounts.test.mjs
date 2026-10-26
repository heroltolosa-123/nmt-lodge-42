/* The administrator's list of chairs. It exists so the Secretary can see at a
   glance who can sign in and who is still waiting — so what it must never do
   is report a password, or report one chair's state as another's. */
import assert from 'node:assert';

process.env.SESSION_SECRET = 'z'.repeat(32);
process.env.UPSTASH_REDIS_REST_URL = 'https://store.example';
process.env.UPSTASH_REDIS_REST_TOKEN = 'tok';

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

const { ROLES, VISIBLE_ROLES, signToken, newSession, hashPassword,
        kvPasswordKey, kvInvitedKey } = await import('../api/_lib.mjs');
const { default: password } = await import('../api/password.mjs');
const { default: invite } = await import('../api/invite.mjs');

const call = async (handler, body, role) => {
  const req = { method: 'POST',
    headers: { host: 'nmt-lodge-42.vercel.app',
               ...(role ? { cookie: 'nmt_session=' + signToken(newSession(role), process.env.SESSION_SECRET) } : {}) },
    async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body)); } };
  const res = { statusCode: 0, body: null, setHeader() {}, end(b) { this.body = JSON.parse(b); } };
  await handler(req, res);
  return res;
};
const list = role => call(password, { list: true }, role);
const byChair = (body, chair) => body.chairs.find(c => c.chair === chair);

// ---- only the administrator may see it ----------------------------------
assert.strictEqual((await list(null)).statusCode, 401, 'a stranger must not get the list');
for (const role of ['secretary', 'wm', 'treasurer', 'tyler']) {
  const r = await list(role);
  assert.strictEqual(r.statusCode, 403, role + ' must not get the list');
  assert.strictEqual(r.body.chairs, undefined, role + ' must receive no chairs at all');
}
console.log('PASS  the list is refused to every chair but the administrator');

// ---- the hidden chair stays hidden --------------------------------------
let r = await list('admin');
assert.strictEqual(r.statusCode, 200);
assert.strictEqual(byChair(r.body, 'admin'), undefined, 'the administrator chair must not be listed');
assert.strictEqual(r.body.chairs.length, Object.keys(VISIBLE_ROLES).length,
  'every visible chair is listed, and only those');
console.log('PASS  all 22 visible chairs listed, the hidden one absent');

// ---- the three states ----------------------------------------------------
delete process.env.PW_TYLER;
process.env.PW_WM = hashPassword('an-opening-password');
store.set(kvPasswordKey('secretary'), hashPassword('one-he-chose-himself'));

r = await list('admin');
assert.strictEqual(byChair(r.body, 'tyler').state, 'none', 'no variable and no stored password is "none"');
assert.strictEqual(byChair(r.body, 'wm').state, 'opening', 'a variable alone is "opening"');
assert.strictEqual(byChair(r.body, 'secretary').state, 'chosen', 'a stored password is "chosen"');
assert.strictEqual(byChair(r.body, 'secretary').canEdit, true, 'the Secretary may edit');
assert.strictEqual(byChair(r.body, 'tyler').canEdit, false, 'the Tyler may not');
console.log('PASS  none / opening / chosen reported correctly, with edit rights');

// ---- no password, hashed or otherwise, may appear ------------------------
const dumped = JSON.stringify(r.body);
for (const secret of [process.env.PW_WM, store.get(kvPasswordKey('secretary')),
                      'an-opening-password', 'one-he-chose-himself'])
  assert.ok(!dumped.includes(secret), 'the list must never carry a password or a hash');
assert.ok(!/PW_/.test(dumped), 'nor the names of the environment variables');
console.log('PASS  neither a password nor a hash appears in the list');

// ---- waiting on a link ---------------------------------------------------
const made = await call(invite, { chair: 'tyler' }, 'admin');
assert.strictEqual(made.statusCode, 200);
r = await list('admin');
assert.strictEqual(byChair(r.body, 'tyler').invitePending, true, 'an unused link must show as pending');
assert.strictEqual(byChair(r.body, 'secretary').invitePending, false,
  'one chair being invited must not mark another');

const token = made.body.link.split('#invite=')[1];
await call(invite, { token, newPassword: 'the-tylers-own-password' }, null);
r = await list('admin');
assert.strictEqual(byChair(r.body, 'tyler').invitePending, false, 'a used link stops being pending');
assert.strictEqual(byChair(r.body, 'tyler').state, 'chosen', 'and the chair now has a password');
console.log('PASS  a pending invitation is shown, and clears when the link is used');

// ---- clearing a chair ----------------------------------------------------
await call(invite, { chair: 'wm' }, 'admin');          // leave a marker behind
const cleared = await call(password, { reset: 'tyler' }, 'admin');
assert.strictEqual(cleared.statusCode, 200);
r = await list('admin');
assert.strictEqual(byChair(r.body, 'tyler').state, 'none',
  'cleared, with no variable set, the Tyler has no account again');
assert.strictEqual(byChair(r.body, 'tyler').invitePending, false,
  'clearing must not leave a stale "waiting" against the chair');
assert.strictEqual(byChair(r.body, 'wm').invitePending, true,
  'and must not clear a different chair that really is waiting');
console.log('PASS  clearing a chair resets its state and leaves other chairs alone');

console.log('\nall checks passed');
