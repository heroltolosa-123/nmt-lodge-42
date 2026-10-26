/* A brother's own portrait.

   Find My Status is public, so this route accepts uploads from anyone at
   all. These checks are mostly about what it must REFUSE to do: publish
   anything before a chair approves it, believe the file type it is told,
   accept a name that is not on the roll, or put a member id into an
   address the public can read. */
import assert from 'node:assert';

process.env.SESSION_SECRET = 'p'.repeat(32);
process.env.UPSTASH_REDIS_REST_URL = 'https://store.example';
process.env.UPSTASH_REDIS_REST_TOKEN = 'tok';
process.env.APPS_SCRIPT_URL = 'https://script.example/exec';
process.env.LODGE_ADMIN_KEY = 'the-lodge-key';

const ROLL = ['Juan P. Abad', 'Gregory Ong', 'Hero L. Tolosa'];
const store = new Map();
let upstreamCalls = [];
let upstreamOk = true;

globalThis.fetch = async (url, init = {}) => {
  const s = String(url);

  if (s.startsWith('https://script.example')) {
    if (s.includes('action=lookup')) {
      const q = decodeURIComponent(new URL(s).searchParams.get('q') || '').toLowerCase();
      const matches = ROLL.filter(n => n.toLowerCase().includes(q))
                          .map(n => ({ fullName: n, status: 'Active' }));   // public view: no id
      return { ok: true, json: async () => ({ matches }) };
    }
    upstreamCalls.push(JSON.parse(init.body));
    if (!upstreamOk) return { ok: false, status: 500, json: async () => ({}) };
    return { ok: true, json: async () => ({ ok: true }) };
  }

  const u = new URL(s);
  const [, verb, rawKey] = u.pathname.split('/');
  const key = decodeURIComponent(rawKey || '');
  if (verb === 'get') return { ok: true, json: async () => ({ result: store.get(key) ?? null }) };
  if (verb === 'set') { store.set(key, init.body); return { ok: true, json: async () => ({ result: 'OK' }) }; }
  if (verb === 'del') { store.delete(key); return { ok: true, json: async () => ({ result: 1 }) }; }
  throw new Error('unexpected ' + verb);
};

const { signToken, newSession, normalise } = await import('../api/_lib.mjs');
const { default: photo } = await import('../api/photo.mjs');

// Real files, built byte by byte, so the sniffing is tested against the
// thing itself and not against a label.
const jpeg = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(2000, 7)]);
const png  = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(2000, 7)]);
const notAnImage = Buffer.from('<?php echo "hello"; ?>'.padEnd(2000, ' '));
const dataUrl = (type, buf) => 'data:image/' + type + ';base64,' + buf.toString('base64');

const post = async (body, role) => {
  const req = { method: 'POST', url: '/api/photo',
    headers: { host: 'nmt-lodge-42.vercel.app',
               ...(role ? { cookie: 'nmt_session=' + signToken(newSession(role), process.env.SESSION_SECRET) } : {}) },
    async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body)); } };
  const res = { statusCode: 0, headers: {}, body: null,
                setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
                end(b) { try { this.body = JSON.parse(b); } catch { this.body = b; } } };
  await photo(req, res);
  return res;
};
const get = async k => {
  const res = { statusCode: 200, headers: {}, body: null,
                setHeader(a, v) { this.headers[a.toLowerCase()] = v; },
                end(b) { this.body = b; } };
  await photo({ method: 'GET', url: '/api/photo?k=' + k, headers: {} }, res);
  return res;
};
const pendingOf = async role => (await post({ pending: true }, role)).body;

// ---- a submission is accepted, and published to nobody ------------------
let r = await post({ submit: true, fullName: 'Juan P. Abad', image: dataUrl('jpeg', jpeg) });
assert.strictEqual(r.statusCode, 200, 'a brother on the roll may submit');
assert.strictEqual(r.body.received, true);
assert.strictEqual(upstreamCalls.length, 0, 'NOTHING may be written to the sheet on submission');
console.log('PASS  a submitted portrait is stored and written nowhere');

// ---- the file type comes from the bytes, never from the label -----------
for (const [label, buf, why] of [
  ['jpeg', notAnImage, 'a script dressed as a jpeg'],
  ['png',  jpeg,       'a jpeg labelled as a png is still not a png'],
]) {
  const bad = await post({ submit: true, fullName: 'Gregory Ong', image: dataUrl(label, buf) });
  if (why.startsWith('a jpeg labelled')) {
    // sniffing wins: it is stored as what it really is, never as claimed
    assert.strictEqual(bad.body.received, true);
    const kept = JSON.parse(store.get('nmt:photoreqs'))[normalise('Gregory Ong')];
    assert.strictEqual(kept.type, 'image/jpeg', 'the stored type must be the real one');
  } else {
    assert.strictEqual(bad.statusCode, 400, why);
    assert.strictEqual(bad.body.error, 'not_an_image');
  }
}
console.log('PASS  the type is taken from the first bytes, not the label');

// ---- sizes ---------------------------------------------------------------
const huge = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(500 * 1024, 1)]);
r = await post({ submit: true, fullName: 'Juan P. Abad', image: dataUrl('jpeg', huge) });
assert.strictEqual(r.statusCode, 413, 'an oversized file is refused');
r = await post({ submit: true, fullName: 'Juan P. Abad', image: dataUrl('jpeg', Buffer.from([0xFF, 0xD8, 0xFF])) });
assert.strictEqual(r.statusCode, 400, 'a file too small to be a photograph is refused');
r = await post({ submit: true, fullName: 'Juan P. Abad', image: 'https://example.org/me.jpg' });
assert.strictEqual(r.statusCode, 400, 'a link is not an upload');
console.log('PASS  oversized, undersized and non-image submissions are refused');

// ---- the name must be on the roll ---------------------------------------
const before = JSON.parse(store.get('nmt:photoreqs'));
r = await post({ submit: true, fullName: 'Somebody Invented', image: dataUrl('jpeg', jpeg) });
assert.strictEqual(r.statusCode, 404, 'a name not on the roll is refused');
assert.deepStrictEqual(JSON.parse(store.get('nmt:photoreqs')), before,
  'and nothing whatever is recorded for it');
console.log('PASS  a name that is not on the roll records nothing');

// ---- replacing his own pending picture drops the old one ----------------
let reqs = JSON.parse(store.get('nmt:photoreqs'));
const firstPhoto = reqs[normalise('Juan P. Abad')].photo;
await post({ submit: true, fullName: 'juan p. abad', image: dataUrl('png', png) });
reqs = JSON.parse(store.get('nmt:photoreqs'));
assert.strictEqual(Object.keys(reqs).filter(k => k === normalise('Juan P. Abad')).length, 1,
  'he still has exactly one request');
assert.notStrictEqual(reqs[normalise('Juan P. Abad')].photo, firstPhoto, 'it is the new picture');
assert.strictEqual(store.get('nmt:img:' + firstPhoto), undefined, 'and the old one is gone from the store');
console.log('PASS  a second submission replaces the first and discards it');

// ---- who may see the queue ----------------------------------------------
assert.strictEqual((await post({ pending: true }, null)).statusCode, 401, 'a stranger sees no queue');
let ro = await post({ pending: true }, 'tyler');
assert.strictEqual(ro.statusCode, 403, 'a view-only chair sees no queue');
assert.strictEqual(ro.body.pending, undefined);
for (const role of ['secretary', 'wm', 'admin']) {
  assert.strictEqual((await post({ pending: true }, role)).statusCode, 200, role + ' may see the queue');
}
console.log('PASS  only the chairs that may change records can see the queue');

// ---- approving writes the sheet, then clears the request ----------------
upstreamCalls = [];
r = await post({ approve: 'Juan P. Abad', memberId: 'M-0042' }, 'secretary');
assert.strictEqual(r.statusCode, 200);
assert.strictEqual(upstreamCalls.length, 1, 'the sheet is written exactly once');
assert.strictEqual(upstreamCalls[0].action, 'updateMember');
assert.strictEqual(upstreamCalls[0].memberId, 'M-0042');
assert.strictEqual(upstreamCalls[0].key, 'the-lodge-key', 'the Lodge key is attached server side');

/* The Apps Script reads body.fields and nothing else:
     updateMember_(body.memberId, body.fields || {})
   Sent flat, it writes nothing and still answers updated:true. This
   shipped once and reported success while changing nothing, so the
   assertion is on the nesting, not merely on the value being present
   somewhere in the payload. */
assert.ok(upstreamCalls[0].fields, 'the payload must carry a fields object');
assert.strictEqual(upstreamCalls[0].photoUrl, undefined,
  'a flat photoUrl is silently ignored by the script — it must be nested');
const sentUrl = upstreamCalls[0].fields.photoUrl;
assert.ok(/^https:\/\/nmt-lodge-42\.vercel\.app\/api\/photo\?k=[0-9a-f]{24}$/.test(sentUrl),
  'the portrait address is this site and an opaque key');
assert.ok(!sentUrl.includes('M-0042'),
  'a member id must never appear in a public portrait address');
assert.strictEqual(JSON.parse(store.get('nmt:photoreqs'))[normalise('Juan P. Abad')], undefined,
  'the request is cleared once the sheet has it');
console.log('PASS  approving writes the sheet once, with an opaque address, then clears the request');

// ---- the approved portrait is served ------------------------------------
const key = upstreamCalls[0].fields.photoUrl.split('k=')[1];
let img = await get(key);
assert.ok(Buffer.isBuffer(img.body), 'the bytes come back');
assert.strictEqual(img.headers['content-type'], 'image/png');
assert.ok(/immutable/.test(img.headers['cache-control']), 'an opaque key may be cached hard');
assert.strictEqual(img.body.length, png.length, 'byte for byte what was sent');
assert.strictEqual((await get('zz')).statusCode, 400, 'a malformed key is refused');
assert.strictEqual((await get('0'.repeat(24))).statusCode, 404, 'an unknown key is not found');
console.log('PASS  an approved portrait is served from its key, and nothing else is');

// ---- a failed sheet write leaves the request to try again ---------------
await post({ submit: true, fullName: 'Hero L. Tolosa', image: dataUrl('jpeg', jpeg) });
upstreamOk = false;
upstreamCalls = [];
r = await post({ approve: 'Hero L. Tolosa', memberId: 'M-0001' }, 'wm');
assert.strictEqual(r.statusCode, 502, 'the failure is reported');
assert.ok(JSON.parse(store.get('nmt:photoreqs'))[normalise('Hero L. Tolosa')],
  'the request survives a failed write, so it can be approved again');
upstreamOk = true;
console.log('PASS  a failed sheet write loses nothing and can be retried');

// ---- rejecting removes the request and the picture ----------------------
reqs = JSON.parse(store.get('nmt:photoreqs'));
const rejectedPhoto = reqs[normalise('Hero L. Tolosa')].photo;
assert.strictEqual((await post({ reject: 'Hero L. Tolosa' }, 'tyler')).statusCode, 403,
  'a view-only chair cannot reject either');
r = await post({ reject: 'hero l. tolosa' }, 'secretary');
assert.strictEqual(r.statusCode, 200);
assert.strictEqual(JSON.parse(store.get('nmt:photoreqs'))[normalise('Hero L. Tolosa')], undefined);
assert.strictEqual(store.get('nmt:img:' + rejectedPhoto), undefined, 'the picture itself is deleted');
assert.strictEqual((await get(rejectedPhoto)).statusCode, 404, 'and can no longer be served');
assert.strictEqual((await post({ reject: 'Nobody At All' }, 'secretary')).statusCode, 404);
console.log('PASS  rejecting deletes the request and the picture with it');

console.log('\nall checks passed');
