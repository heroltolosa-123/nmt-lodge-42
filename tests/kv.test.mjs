// Run:  node tests/kv.test.mjs
/* The password store went in under one pair of variable names and arrived
   under another: attaching it from Vercel's Storage tab writes KV_REST_API_*,
   while Upstash's own integration writes UPSTASH_REDIS_REST_*. The store was
   connected correctly and the site still reported no store. These checks are
   here so that cannot happen again quietly. */
import assert from 'node:assert';

const CRED_VARS = ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN',
                   'KV_REST_API_URL', 'KV_REST_API_TOKEN',
                   'KV_REST_API_READ_ONLY_TOKEN'];
const clear = () => CRED_VARS.forEach(v => { delete process.env[v]; });

let v = 0;
const load = () => import('../api/_kv.mjs?v=' + (++v));

clear();
let kv = await load();
assert.strictEqual(kv.kvConfigured(), false, 'no variables means no store');
assert.strictEqual(await kv.kvGet('anything'), null, 'an unconfigured store reads as null, it must not throw');

// the naming this project was written against
clear();
process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io';
process.env.UPSTASH_REDIS_REST_TOKEN = 'tok-upstash';
assert.strictEqual((await load()).kvConfigured(), true, 'UPSTASH_REDIS_REST_* must be accepted');

// the naming Vercel's Storage tab actually wrote
clear();
process.env.KV_REST_API_URL = 'https://example.upstash.io';
process.env.KV_REST_API_TOKEN = 'tok-kv';
assert.strictEqual((await load()).kvConfigured(), true, 'KV_REST_API_* must be accepted too');

// half a pair is not a store
clear();
process.env.KV_REST_API_URL = 'https://example.upstash.io';
assert.strictEqual((await load()).kvConfigured(), false, 'a URL with no token is not configured');
clear();
process.env.KV_REST_API_TOKEN = 'tok-kv';
assert.strictEqual((await load()).kvConfigured(), false, 'a token with no URL is not configured');

/* The read-only token cannot write. Accepting it would let an officer set a
   password, see no error, and find himself locked out. */
clear();
process.env.KV_REST_API_URL = 'https://example.upstash.io';
process.env.KV_REST_API_READ_ONLY_TOKEN = 'tok-readonly';
assert.strictEqual((await load()).kvConfigured(), false,
  'the read-only token must never stand in for the writable one');

// an empty or blank variable is not a value
clear();
process.env.KV_REST_API_URL = '  ';
process.env.KV_REST_API_TOKEN = 'tok-kv';
assert.strictEqual((await load()).kvConfigured(), false, 'a blank variable is not a value');

/* Both namings must reach the same endpoint, with the token sent as a bearer
   and a trailing slash on the URL not doubling up. */
clear();
process.env.KV_REST_API_URL = 'https://example.upstash.io/';
process.env.KV_REST_API_TOKEN = 'tok-kv';
kv = await load();
const seen = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  seen.push({ url: String(url), auth: init.headers.Authorization, method: init.method, body: init.body });
  return { ok: true, json: async () => ({ result: 'OK' }) };
};
try {
  await kv.kvGet('nmt:pw:wm');
  await kv.kvSet('nmt:invite:abc', 'wm', 3600);
  await kv.kvDel('nmt:invite:abc');
} finally {
  globalThis.fetch = realFetch;
}

assert.strictEqual(seen[0].url, 'https://example.upstash.io/get/nmt%3Apw%3Awm', 'get must not double the slash');
assert.strictEqual(seen[0].auth, 'Bearer tok-kv', 'the token must be sent as a bearer');
assert.strictEqual(seen[1].url, 'https://example.upstash.io/set/nmt%3Ainvite%3Aabc?EX=3600', 'a TTL must be sent as EX');
assert.strictEqual(seen[1].body, 'wm', 'the value goes in the body, not the path');
assert.strictEqual(seen[2].method, 'POST', 'del must be a POST');

// a store that answers with an error must say so rather than look empty
globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({}) });
try {
  await assert.rejects(() => kv.kvGet('nmt:pw:wm'), /401/, 'a rejected token must surface, not read as absent');
} finally {
  globalThis.fetch = realFetch;
}

clear();
console.log('PASS  both UPSTASH_REDIS_REST_* and KV_REST_API_* are accepted');
console.log('PASS  half a pair, a blank value and the read-only token are all refused');
console.log('PASS  get, set with TTL and del address the store correctly');
console.log('PASS  a store error surfaces instead of looking like no store');
console.log('\nall checks passed');
