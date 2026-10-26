import { randomBytes } from 'node:crypto';
import { ROLES, canEdit, requireEnv, readSession, readBody, json, normalise } from './_lib.mjs';
import { kvConfigured, kvGet, kvSet, kvDel } from './_kv.mjs';

/* ---------------------------------------------------------------------
   A brother's own portrait.

   Find My Status is public — no sign-in, anyone may search a surname —
   so a picture submitted there is a picture submitted by anyone at all.
   Nothing sent here is published. It waits until the Secretary, or one
   of the chairs that may change records, approves it.

   That ordering is the whole design. The alternative, publishing at once
   and taking it down afterwards, means the Lodge's own website shows
   whatever a stranger chose for as long as nobody is looking.

   The bytes live in the store under an opaque random key and are served
   back by this same route. Member ids are deliberately absent from the
   public lookup, and putting one in a portrait's address would publish
   it for every brother, so the key is random and says nothing.
   --------------------------------------------------------------------- */

const MAX_BYTES = 400 * 1024;        // a 512px JPEG is nearer 60KB
const MIN_BYTES = 500;
const PENDING_KEY = 'nmt:photoreqs'; // one record holding every request
const imageKey = key => 'nmt:img:' + key;

/* The declared type is whatever the sender typed. These are the first
   bytes of the file itself, which is what the browser will actually go
   by when it renders it. */
function sniff(buf) {
  if (buf.length > 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg';
  if (buf.length > 8 && buf.toString('hex', 0, 8) === '89504e470d0a1a0a') return 'image/png';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF'
                      && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

async function readPending() {
  try {
    const raw = await kvGet(PENDING_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}

export default async function handler(req, res) {
  /* ---- serving an approved or pending portrait, to anyone ------------
     The key is random and immutable, so it can be cached hard: a new
     picture is a new key and a new address. */
  if (req.method === 'GET') {
    const key = String((req.query && req.query.k) ||
                       (new URL(req.url, 'http://x').searchParams.get('k')) || '');
    if (!/^[0-9a-f]{24}$/.test(key)) return json(res, 400, { error: 'bad_key' });
    let stored;
    try { stored = await kvGet(imageKey(key)); } catch { return json(res, 503, { error: 'store_unavailable' }); }
    if (!stored) return json(res, 404, { error: 'no_such_photo' });
    const [type, b64] = String(stored).split('|');
    const buf = Buffer.from(b64 || '', 'base64');
    if (!sniff(buf)) return json(res, 404, { error: 'no_such_photo' });
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Content-Length', String(buf.length));
    return res.end(buf);
  }

  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
  if (!kvConfigured()) return json(res, 503, { error: 'no_photo_store' });

  let body;
  try { body = await readBody(req); } catch { return json(res, 400, { error: 'bad_request' }); }

  // ---- a brother submitting his own, signed in to nothing -------------
  if (body.submit) return submit(req, res, body);

  // ---- everything below is for the chairs that may change records -----
  let secret;
  try { secret = requireEnv('SESSION_SECRET'); } catch { return json(res, 503, { error: 'not_configured' }); }
  const session = readSession(req, secret);
  if (!session) return json(res, 401, { error: 'not_signed_in' });
  if (!canEdit(session.role)) {
    return json(res, 403, { error: 'read_only_chair',
      detail: ROLES[session.role].label + ' can view the records but not change them.' });
  }

  const pending = await readPending();

  if (body.pending) {
    return json(res, 200, { pending: Object.entries(pending).map(([k, v]) => ({ key: k, ...v })) });
  }

  if (body.reject) {
    const k = normalise(String(body.reject));
    const entry = pending[k];
    if (!entry) return json(res, 404, { error: 'no_such_request' });
    delete pending[k];
    await kvSet(PENDING_KEY, JSON.stringify(pending));
    await kvDel(imageKey(entry.photo));
    console.log(JSON.stringify({ at: new Date().toISOString(), actor: session.role,
                                 action: 'rejectPhoto', target: entry.fullName }));
    return json(res, 200, { rejected: entry.fullName });
  }

  if (body.approve) {
    const k = normalise(String(body.approve));
    const entry = pending[k];
    if (!entry) return json(res, 404, { error: 'no_such_request' });
    const memberId = String(body.memberId || '');
    if (!memberId) return json(res, 400, { error: 'member_id_required' });

    /* The sheet is written FIRST. If it fails the request stays pending,
       which can be tried again; clearing it first would lose the picture
       with nothing to show for it. */
    let scriptUrl, adminKey;
    try {
      scriptUrl = requireEnv('APPS_SCRIPT_URL');
      adminKey  = requireEnv('LODGE_ADMIN_KEY');
    } catch { return json(res, 503, { error: 'not_configured' }); }

    const origin = 'https://' + (req.headers['x-forwarded-host'] || req.headers.host);
    const photoUrl = origin + '/api/photo?k=' + entry.photo;
    try {
      const upstream = await fetch(scriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        /* The script reads body.fields — `updateMember_(body.memberId,
           body.fields || {})`. Sent flat, it finds no fields, writes
           nothing and still answers updated:true, which is how this
           shipped once reporting success and changing nothing. */
        body: JSON.stringify({ action: 'updateMember', memberId,
                               fields: { photoUrl }, key: adminKey }),
        redirect: 'follow'
      });
      if (!upstream.ok) return json(res, 502, { error: 'upstream_' + upstream.status });
      const data = await upstream.json();
      if (data.error) return json(res, 502, { error: 'upstream_refused', detail: data.error });
    } catch { return json(res, 502, { error: 'upstream_unavailable' }); }

    delete pending[k];
    await kvSet(PENDING_KEY, JSON.stringify(pending));
    console.log(JSON.stringify({ at: new Date().toISOString(), actor: session.role,
                                 action: 'approvePhoto', target: entry.fullName }));
    return json(res, 200, { approved: entry.fullName, photoUrl });
  }

  return json(res, 400, { error: 'unknown_request' });
}

/* ---------------------------------------------------------------------
   Submitting. Open to anyone, so every limit here is load-bearing.
   --------------------------------------------------------------------- */
async function submit(req, res, body) {
  const given = String(body.fullName || '').trim();
  const dataUrl = String(body.image || '');

  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) return json(res, 400, { error: 'not_an_image' });
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > MAX_BYTES) return json(res, 413, { error: 'too_large', maxBytes: MAX_BYTES });
  if (buf.length < MIN_BYTES) return json(res, 400, { error: 'not_an_image' });
  const type = sniff(buf);                       // the bytes, not the label
  if (!type) return json(res, 400, { error: 'not_an_image' });

  /* The name must belong to a brother actually on the roll. Without this
     the store would take a record for any name anyone cared to invent;
     with it, there can never be more pending requests than there are
     members. It is the same public search he just used to find himself. */
  let scriptUrl;
  try { scriptUrl = requireEnv('APPS_SCRIPT_URL'); } catch { return json(res, 503, { error: 'not_configured' }); }
  let matched = null;
  try {
    const url = scriptUrl + '?action=lookup&q=' + encodeURIComponent(given);
    const upstream = await fetch(url, { redirect: 'follow' });
    if (!upstream.ok) return json(res, 502, { error: 'upstream_' + upstream.status });
    const data = await upstream.json();
    matched = (data.matches || []).find(x => normalise(x.fullName) === normalise(given)) || null;
  } catch { return json(res, 502, { error: 'upstream_unavailable' }); }
  if (!matched) return json(res, 404, { error: 'no_such_member' });

  const key = normalise(matched.fullName);
  const pending = await readPending();

  /* Replacing his own pending picture is allowed and the old one is
     dropped; a brother who sends the wrong photograph should not have to
     ask anyone to undo it. */
  const previous = pending[key];
  const photo = randomBytes(12).toString('hex');
  await kvSet(imageKey(photo), type + '|' + buf.toString('base64'));
  pending[key] = { fullName: matched.fullName, photo, type, bytes: buf.length,
                   at: new Date().toISOString() };
  /* ponytail: one record for every request, so two brethren submitting in
     the same second could lose one. A separate key each would need an
     index to list them; revisit if the Lodge ever sees that happen. */
  await kvSet(PENDING_KEY, JSON.stringify(pending));
  if (previous) await kvDel(imageKey(previous.photo));

  console.log(JSON.stringify({ at: new Date().toISOString(), actor: 'anonymous',
                               action: 'submitPhoto', target: matched.fullName }));
  return json(res, 200, { received: true, fullName: matched.fullName });
}
