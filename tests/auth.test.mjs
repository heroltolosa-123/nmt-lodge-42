// Run:  node tests/auth.test.mjs
import assert from 'node:assert';
import { hashPassword, verifyPassword, signToken, verifyToken,
         newSession, readSession, sessionCookie } from '../api/_lib.mjs';

const SECRET = 'test-secret-value';

// --- password hashing ---
const h = hashPassword('correct horse battery staple');
assert.ok(h.startsWith('scrypt:'), 'hash must be tagged');
assert.ok(!h.includes('correct'), 'plaintext must not survive in the hash');
assert.ok(verifyPassword('correct horse battery staple', h), 'right password verifies');
assert.ok(!verifyPassword('Correct horse battery staple', h), 'case matters');
assert.ok(!verifyPassword('', h), 'empty rejected');
assert.ok(!verifyPassword('x', 'garbage'), 'malformed stored value rejected');
assert.ok(!verifyPassword('x', ''), 'missing stored value rejected');
assert.ok(!verifyPassword('x', 'scrypt::'), 'empty hash rejected');
assert.notStrictEqual(hashPassword('same'), hashPassword('same'), 'salt must differ per hash');
console.log('PASS  password hashing and verification');

// --- tokens ---
const tok = signToken(newSession('secretary'), SECRET);
const ok = verifyToken(tok, SECRET);
assert.strictEqual(ok.role, 'secretary');
assert.strictEqual(verifyToken(tok, 'wrong-secret'), null, 'wrong secret rejected');
assert.strictEqual(verifyToken(tok.slice(0, -2) + 'xx', SECRET), null, 'tampered signature rejected');
console.log('PASS  tokens reject a wrong secret and a tampered signature');

// forged payload with a valid-looking shape must fail without the secret
const forged = Buffer.from(JSON.stringify({role:'wm',exp:Date.now()+1e6})).toString('base64url') + '.zzzz';
assert.strictEqual(verifyToken(forged, SECRET), null, 'forged token rejected');
console.log('PASS  a forged token cannot mint a session');

// expiry is enforced
assert.strictEqual(verifyToken(signToken({role:'wm',exp:Date.now()-1}, SECRET), SECRET), null);
console.log('PASS  expired sessions rejected');

// an unknown role cannot ride in on a validly signed token
assert.strictEqual(verifyToken(signToken({role:'grandmaster',exp:Date.now()+1e6}, SECRET), SECRET), null);
console.log('PASS  unknown role rejected even when correctly signed');

// --- cookie flags ---
const c = sessionCookie('abc');
for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/'])
  assert.ok(c.includes(flag), 'cookie must set ' + flag);
assert.ok(sessionCookie(null).includes('Max-Age=0'), 'logout must clear the cookie');
console.log('PASS  cookie is HttpOnly, Secure, SameSite=Strict; logout clears it');

// --- session is read back from a cookie header ---
assert.strictEqual(readSession({headers:{cookie:'other=1; nmt_session='+tok}}, SECRET).role, 'secretary');
assert.strictEqual(readSession({headers:{cookie:'nothing=1'}}, SECRET), null);
assert.strictEqual(readSession({headers:{}}, SECRET), null);
console.log('PASS  session read from cookie header');

console.log('\nall checks passed');
