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
