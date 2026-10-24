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
