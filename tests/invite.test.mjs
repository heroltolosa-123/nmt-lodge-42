/* Invitations. The link is the credential, so its rules are the security:
   one use, it expires, only the administrator makes one, and it names nobody. */
import assert from 'node:assert';

process.env.SESSION_SECRET = 'q'.repeat(32);
process.env.UPSTASH_REDIS_REST_URL = 'https://store.example';
process.env.UPSTASH_REDIS_REST_TOKEN = 'tok';
delete process.env.BREVO_API_KEY;

const store = new Map();
const expiries = new Map();
let mailSent = null;
globalThis.fetch = async (url, init = {}) => {
  if (String(url).includes('brevo')) { mailSent = JSON.parse(init.body); return { ok: true, json: async () => ({}) }; }
  const u = new URL(url);
  const [, verb, rawKey] = u.pathname.split('/');
  const key = decodeURIComponent(rawKey || '');
  if (verb === 'get') return { ok: true, json: async () => ({ result: store.get(key) ?? null }) };
  if (verb === 'set') {
    store.set(key, init.body);
    if (u.searchParams.get('EX')) expiries.set(key, Number(u.searchParams.get('EX')));
    return { ok: true, json: async () => ({ result: 'OK' }) };
  }
  if (verb === 'del') { store.delete(key); return { ok: true, json: async () => ({ result: 1 }) }; }
  throw new Error('unexpected ' + verb);
};

const { signToken, newSession, verifyPassword, resolvePassword, kvPasswordKey } = await import('../api/_lib.mjs');
const { default: invite } = await import('../api/invite.mjs');

const post = async (body, role) => {
  const req = { method: 'POST',
    headers: { host: 'nmt-lodge-42.vercel.app',
               ...(role ? { cookie: 'nmt_session=' + signToken(newSession(role), process.env.SESSION_SECRET) } : {}) },
    async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body)); } };
  const res = { statusCode: 0, body: null, setHeader() {}, end(b) { this.body = JSON.parse(b); } };
  await invite(req, res);
  return res;
};

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; };

// --- only the administrator may invite ---
ok((await post({ chair: 'organist' })).statusCode === 401, 'anonymous must not create an invitation');
ok((await post({ chair: 'organist' }, 'secretary')).statusCode === 403, 'the Secretary must not either');
ok((await post({ chair: 'organist' }, 'wm')).statusCode === 403, 'nor the Master');
ok((await post({ chair: 'nosuchchair' }, 'admin')).statusCode === 400, 'an unknown chair is refused');
ok(store.size === 0, 'nothing written on a refused attempt');
console.log('PASS  only the administrator can invite, and only to a real chair');

// --- the link itself ---
const made = await post({ chair: 'organist' }, 'admin');
ok(made.statusCode === 200, 'the administrator can invite');
const link = made.body.link;
ok(/^https:\/\/nmt-lodge-42\.vercel\.app\/#invite=[A-Za-z0-9_-]{20,}$/.test(link), 'link shape: ' + link);
const token = link.split('=')[1];
ok(!link.includes('organist'), 'the link must not name the chair');
ok(!link.toLowerCase().includes('password'), 'the link must carry no password');
ok(expiries.get('nmt:invite:' + token) === 7 * 24 * 3600, 'the invitation must expire in seven days');
ok(made.body.emailed === null, 'with no address given, nothing is emailed');
const noProvider = await post({ chair: 'almoner', email: 'x@example.com' }, 'admin');
ok(noProvider.body.emailed.sent === false && noProvider.body.emailed.reason === 'email_not_configured',
   'an address with no mail provider reports why, and still returns the link');
ok(!!noProvider.body.link, 'the link is returned regardless');
console.log('PASS  link is opaque, carries nothing, expires in seven days');

// --- it tells the officer which chair, before they commit ---
const asked = await post({ token });
ok(asked.statusCode === 200 && asked.body.chair === 'organist' && asked.body.label === 'Organist',
   'the officer is told which chair the link is for');

// --- a weak password is refused and the link survives ---
ok((await post({ token, newPassword: 'short' })).statusCode === 400, 'short password refused');
ok((await post({ token, newPassword: ' padded one ' })).statusCode === 400, 'edge whitespace refused');
ok(!!store.get('nmt:invite:' + token), 'a refused attempt must not burn the link');
ok(!store.get(kvPasswordKey('organist')), 'and must not set a password');

// --- redeeming ---
const NEW = 'organist-own-password';
const done = await post({ token, newPassword: NEW });
ok(done.statusCode === 200 && done.body.done === true, 'the officer can set their password');
const saved = store.get(kvPasswordKey('organist'));
ok(saved && saved.startsWith('scrypt:') && saved.length === 168, 'stored as a hash');
ok(!saved.includes(NEW), 'the plain password is never stored');
ok(verifyPassword(NEW, saved), 'and it is the password they chose');
ok((await resolvePassword('organist')).source === 'set by the officer', 'the chair now uses it');
console.log('PASS  the officer sets their own, stored only as a hash');

// --- one use only ---
ok(!store.get('nmt:invite:' + token), 'the link is consumed');
const again = await post({ token, newPassword: 'another-password-x' });
ok(again.statusCode === 410 && again.body.error === 'link_expired', 'a used link must not work again');
ok(verifyPassword(NEW, store.get(kvPasswordKey('organist'))), 'and must not have changed the password');
ok((await post({ token: 'completely-made-up' })).statusCode === 410, 'an invented token is refused');
console.log('PASS  a link works once; a used or invented one does nothing');

// --- email, when a provider is configured ---
process.env.BREVO_API_KEY = 'key';
process.env.MAIL_FROM = 'secretary@example.com';
const mailed = await post({ chair: 'tyler', email: 'brother@example.com' }, 'admin');
ok(mailed.body.emailed.sent === true, 'it sends when configured');
ok(mailSent.to[0].email === 'brother@example.com', 'to the right brother');
ok(mailSent.textContent.includes(mailed.body.link), 'the message carries the link');
ok(!mailSent.textContent.toLowerCase().includes('scrypt'), 'and no hash');
console.log('PASS  emails the link when a provider is set, returns it when not');

console.log(`\nall ${pass} checks passed`);
