// Run:  node tests/health.test.mjs
import assert from 'node:assert';
import { hashPassword } from '../api/_lib.mjs';

process.env.SESSION_SECRET = 'x'.repeat(32);
const good = hashPassword('a-real-password');
process.env.PW_SECRETARY = good;
process.env.PW_WM        = 'my-plain-password';          // pasted the password
process.env.PW_SW        = good.slice(0, 120);           // truncated on paste
process.env.PW_JW        = '  ' + good + ' ';            // stray whitespace
process.env.APPS_SCRIPT_URL = 'https://x/exec';
process.env.LODGE_ADMIN_KEY = 'a-realistic-admin-key-value';

const { default: handler } = await import('../api/health.mjs');
const res = { headers:{}, statusCode:0, body:null,
  setHeader(k,v){this.headers[k]=v}, end(b){this.body=JSON.parse(b)} };
await handler({}, res);
const c = res.body.chairs;

assert.ok(c.secretary.ok, 'a correct hash must report ok');
assert.ok(/plain password/.test(c.wm.problem), 'a pasted password must be named as such');
assert.ok(/truncated/.test(c.sw.problem), 'a truncated hash must be named as such');
assert.ok(/whitespace/.test(c.jw.problem), 'stray whitespace must be named as such');
assert.strictEqual(res.body.readyToSignIn, true, 'one good chair is enough to sign in');

// nothing secret may appear anywhere in the response
const dumped = JSON.stringify(res.body);
for (const secret of [good, 'my-plain-password', 'a-real-password', process.env.SESSION_SECRET, 'a-realistic-admin-key-value'])
  assert.ok(!dumped.includes(secret), 'health must not echo a secret value');

console.log('PASS  correct hash reported ok');
console.log('PASS  pasted password, truncated hash and stray whitespace each named');
console.log('PASS  no secret value appears in the response');
console.log('\nall checks passed');

// the commonest paste error: hash with the scrypt: tag chopped off
process.env.PW_WM = good.slice('scrypt:'.length);
const res2 = { headers:{}, statusCode:0, body:null, setHeader(){}, end(b){this.body=JSON.parse(b)} };
const { default: h2 } = await import('../api/health.mjs?v=2');
await h2({}, res2);
assert.strictEqual(res2.body.chairs.wm.length, 161, 'a de-prefixed hash is 161 characters');
assert.ok(/prefix is missing/.test(res2.body.chairs.wm.problem),
  'a de-prefixed hash must be named exactly, not called a plain password');
console.log('PASS  a hash missing its scrypt: prefix is diagnosed precisely');

/* The administrator's chair is not on the sign-in form; listing it in a public
   health report would put it straight back. It is reported to a caller who is
   already signed in, so it can still be diagnosed. */
import { ROLES, signToken, newSession } from '../api/_lib.mjs';
process.env.PW_ADMIN = good;

const anon = { headers:{}, statusCode:0, body:null, setHeader(){}, end(b){this.body=JSON.parse(b)} };
const { default: h3 } = await import('../api/health.mjs?v=3');
await h3({ headers: {} }, anon);
assert.strictEqual(anon.body.chairs.admin, undefined, 'a hidden chair must not appear publicly');
for (const [role, spec] of Object.entries(ROLES))
  if (!spec.hidden) assert.ok(anon.body.chairs[role], 'a visible chair must still be reported: ' + role);
// (lodgeAdminKey legitimately contains "admin", so check the chairs alone)
for (const [role, spec] of Object.entries(ROLES))
  if (spec.hidden) assert.ok(!JSON.stringify(anon.body.chairs).includes(role),
    'the public chair list must not name ' + role);

const cookie = 'nmt_session=' + signToken(newSession('wm'), process.env.SESSION_SECRET);
const inside = { headers:{}, statusCode:0, body:null, setHeader(){}, end(b){this.body=JSON.parse(b)} };
await h3({ headers: { cookie } }, inside);
assert.ok(inside.body.chairs.admin, 'a signed-in caller must be able to diagnose the hidden chair');
assert.ok(inside.body.chairs.admin.ok, 'and see whether its hash parses');
console.log('PASS  hidden chair invisible to the public, diagnosable once signed in');

/* Email: optional, so "not configured" is a note and not a fault. The one
   thing that must never happen is the Lodge's own address being published
   from a public endpoint, so assert the value itself stays out. */
async function emailReport(v) {
  const r = { headers:{}, statusCode:0, body:null, setHeader(){}, end(b){this.body=JSON.parse(b)} };
  const { default: h } = await import('../api/health.mjs?v=' + v);
  await h({ headers: {} }, r);
  return r.body;
}

delete process.env.BREVO_API_KEY;
delete process.env.MAIL_FROM;
let b = await emailReport('e1');
assert.strictEqual(b.email.set, false, 'no email configuration is not an error');
assert.ok(/by hand/.test(b.email.note), 'it must say what happens without email');

process.env.BREVO_API_KEY = 'xkeysib-' + 'a'.repeat(64);
process.env.MAIL_FROM = 'lodge@example.org';
b = await emailReport('e2');
assert.strictEqual(b.email.set, true, 'a key plus a sender is configured');
assert.ok(!b.email.key.problem && !b.email.from.problem, 'a good pair must report no problem');
assert.ok(!JSON.stringify(b).includes('lodge@example.org'), 'health must not publish MAIL_FROM');
assert.ok(!JSON.stringify(b).includes(process.env.BREVO_API_KEY), 'health must not echo the API key');

process.env.BREVO_API_KEY = 'some-other-providers-key';
b = await emailReport('e3');
assert.ok(/xkeysib/.test(b.email.key.problem), 'a non-Brevo key must be named as such');

process.env.BREVO_API_KEY = 'xkeysib-' + 'a'.repeat(64);
process.env.MAIL_FROM = 'not-an-address';
b = await emailReport('e4');
assert.ok(/email address/.test(b.email.from.problem), 'a malformed sender must be named');

delete process.env.MAIL_FROM;
b = await emailReport('e5');
assert.strictEqual(b.email.set, false, 'a key with no sender is not configured');
assert.ok(/MAIL_FROM is missing/.test(b.email.problem), 'the missing half must be named');

console.log('PASS  email reported by shape: unset, good, wrong key, bad sender, half-set');
console.log('PASS  neither the API key nor the sender address is ever published');
