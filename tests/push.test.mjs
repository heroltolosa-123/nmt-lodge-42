/* Notifying the brethren.

   Three things here can fail silently and expensively.

   The signature. Every push service rejects a malformed VAPID token
   with a flat 401 and no hint, and Node's default ECDSA encoding is DER
   where the spec wants raw r‖s — the same key, the same algorithm, and
   nothing works. So a token is produced and verified against the key it
   names, in both encodings, to prove the right one is used.

   Who may send. Subscribing has to be open — most brethren have no
   account — but waking every phone in the Lodge must not be, and a
   read-only chair must not be able to do it by sending the request by
   hand.

   Where the Lodge's server is willing to POST. An endpoint is supplied
   by whoever is subscribing, and the server then makes a request to it.
   Accept any URL and the Lodge becomes an open relay for pointing
   traffic at other people's servers. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert';
import { generateKeyPairSync, verify } from 'node:crypto';
const HERE = dirname(fileURLToPath(import.meta.url));

/* A key pair for this run only. Never written down, never deployed. */
const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const jwk = publicKey.export({ format: 'jwk' });
process.env.VAPID_PUBLIC_KEY = Buffer.concat([
  Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')
]).toString('base64url');
process.env.VAPID_PRIVATE_KEY =
  privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');

const push = await import('../api/_push.mjs');

/* --- the key the browser is handed --- */
assert.ok(push.pushConfigured(), 'both halves of the key are set');
const raw = Buffer.from(push.publicKey(), 'base64url');
assert.strictEqual(raw.length, 65, 'the application server key is an uncompressed P-256 point');
assert.strictEqual(raw[0], 4, 'and uncompressed points begin 0x04');

/* --- the token, verified against the key it claims --- */
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc123';
const header = push.vapidHeader(ENDPOINT, 'mailto:secretary@example.org');
assert.match(header.Authorization, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/,
  'the Authorization header is the t=…, k=… form every push service parses');

const [, token, sentKey] = header.Authorization.match(/^vapid t=(\S+), k=(\S+)$/);
assert.strictEqual(sentKey, push.publicKey(), 'k= must be the key the subscription used');

const [h, c, sig] = token.split('.');
const signed = Buffer.from(h + '.' + c);
const signature = Buffer.from(sig, 'base64url');
assert.strictEqual(signature.length, 64,
  'raw r‖s is 64 bytes; a 70-ish byte signature is DER, which every push service rejects');
assert.ok(verify('sha256', signed, { key: publicKey, dsaEncoding: 'ieee-p1363' }, signature),
  'the signature must verify against the public key the header advertises');
assert.ok(!verify('sha256', signed, { key: push.publicKeyObject(), dsaEncoding: 'ieee-p1363' },
  Buffer.alloc(64)), 'and a null signature must not');

const claims = JSON.parse(Buffer.from(c, 'base64url'));
assert.strictEqual(JSON.parse(Buffer.from(h, 'base64url')).alg, 'ES256');
assert.strictEqual(claims.aud, 'https://fcm.googleapis.com',
  'aud is the push service’s ORIGIN, not the subscription URL');
assert.strictEqual(push.audienceOf('https://web.push.apple.com/x/y/z'),
  'https://web.push.apple.com');
assert.strictEqual(claims.sub, 'mailto:secretary@example.org');
const life = claims.exp - Math.floor(Date.now() / 1000);
assert.ok(life > 0 && life <= 24 * 3600,
  'the spec caps a token at 24 hours and a dead one is a 401');

/* --- a dead subscription is pruned, a bad afternoon is not --- */
assert.ok(push.isGone(404) && push.isGone(410), 'these mean the address is gone for good');
[500, 502, 429, 401, 201].forEach(s => assert.ok(!push.isGone(s),
  s + ' must not drop a brother’s subscription'));

/* --- where the Lodge is willing to POST --- */
const { endpointAllowed } = await import('../api/push.mjs');
[
  'https://fcm.googleapis.com/fcm/send/abc',
  'https://web.push.apple.com/QRS',
  'https://updates.push.services.mozilla.com/wpush/v2/xyz',
  'https://xyz.notify.windows.com/w/?token=abc'
].forEach(u => assert.ok(endpointAllowed(u), u + ' is a real push service'));

[
  'http://fcm.googleapis.com/fcm/send/abc',          // not TLS
  'https://evil.example.com/collect',                 // somebody else's server
  'https://fcm.googleapis.com.evil.test/x',           // the suffix trick
  'https://googleapis.com.attacker.io/x',
  'file:///etc/passwd',
  'https://127.0.0.1/admin',                          // the Lodge's own network
  'https://localhost:8080/',
  'not a url at all',
  '',
  'https://fcm.googleapis.com/' + 'x'.repeat(2000)    // absurd length
].forEach(u => assert.ok(!endpointAllowed(u),
  JSON.stringify(u.slice(0, 48)) + ' must be refused — the server POSTs to whatever it stores'));

/* --- who may wake the Lodge --- */
const src = readFileSync(join(HERE, '..', 'api', 'push.mjs'), 'utf8');
const sendBranch = src.slice(src.indexOf('if (!body.send)'));
assert.match(sendBranch, /readSession\(req, secret\)/, 'sending needs a session');
assert.match(sendBranch, /if \(!canEdit\(session\.role\)\)/,
  'a read-only chair may look at the records but not summon the Lodge');
const subBranch = src.slice(src.indexOf('if (body.subscribe'), src.indexOf('if (!body.send)'));
assert.ok(!/readSession|canEdit/.test(subBranch),
  'subscribing must stay open — most brethren have no account at all');
assert.match(src, /MAX_SUBS = \d+/, 'an open endpoint needs a ceiling');

/* --- nothing identifying is stored --- */
assert.ok(!/p256dh|keys\.auth|memberId|fullName/.test(src),
  'only the endpoint is kept: a payload-free push needs no subscription keys, and ' +
  'the record must not name anybody');
const logged = src.slice(src.indexOf('console.log'), src.indexOf('}));', src.indexOf('console.log')));
assert.ok(!/endpoint/.test(logged),
  'the log is read by people and must not carry a push endpoint: ' + logged);
const replied = src.slice(src.indexOf('json(res, 200, { sent'));
assert.ok(/endpoints\.length/.test(replied) && !/endpoints\s*[,}]/.test(replied),
  'the officer is told how many, never which');

console.log('PASS  VAPID tokens verify in raw r‖s, only real push services are accepted, ' +
  'subscribing is open and sending is not');
