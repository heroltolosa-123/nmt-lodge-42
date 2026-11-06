import { ROLES, canEdit, readSession, readBody, json } from './_lib.mjs';
import { kvSAdd, kvSRem, kvSMembers, kvSCard, kvConfigured } from './_kv.mjs';
import { pushConfigured, publicKey, sendOne } from './_push.mjs';

/* ---------------------------------------------------------------------
   NOTIFYING THE BRETHREN

   GET                      the public key, and whether this is set up
   POST {subscribe}         a phone asking to be told        — open
   POST {unsubscribe}       the same phone asking to stop    — open
   POST {send}              wake every phone                 — officers

   WHY SUBSCRIBING IS OPEN

   It takes no session because it needs none. What is stored is a push
   endpoint — an opaque URL at Apple or Google naming nobody — and what
   it earns you is the Lodge's public announcements, which are already
   on the front page for anyone to read. Requiring a sign-in would mean
   only the twenty-three chairs could be notified, when the people who
   need telling are the hundred-odd brethren who have no account at all.

   Sending is a different matter and takes an editing chair, the same as
   posting the announcement in the first place.

   WHAT IS NOT HERE

   No way to notify one brother. The store holds endpoints and nothing
   that ties one to a name, so the only thing that can be sent is a
   general summons — which is all a bulletin board ever was.
   --------------------------------------------------------------------- */

const SUBS_KEY = 'nmt:push:subs';

/* A stranger can subscribe, so the set must not be able to grow without
   end. Twice the roll is room for every brother with a phone and a
   tablet, and far short of anything worth paying for. */
const MAX_SUBS = 300;

/* An endpoint that is not one of theirs is somebody using this as a way
   to make the Lodge's server POST wherever they like. */
const ALLOWED_HOSTS = [
  /\.googleapis\.com$/,        // Chrome, Edge, and Android generally
  /\.mozilla\.com$/,           // Firefox
  /\.windows\.com$/,           // Edge legacy
  /\.apple\.com$/              // Safari, iOS
];

export function endpointAllowed(endpoint) {
  let u;
  try { u = new URL(String(endpoint)); } catch { return false; }
  if (u.protocol !== 'https:') return false;
  if (endpoint.length > 1000) return false;
  return ALLOWED_HOSTS.some(re => re.test(u.hostname));
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return json(res, 200, {
      configured: pushConfigured() && kvConfigured(),
      key: pushConfigured() ? publicKey() : null
    });
  }
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });

  let body;
  try { body = await readBody(req); } catch { return json(res, 400, { error: 'bad_request' }); }

  // ---- a phone asking to be told, or to stop ----
  if (body.subscribe || body.unsubscribe) {
    const endpoint = String(body.subscribe || body.unsubscribe);
    if (!endpointAllowed(endpoint)) return json(res, 400, { error: 'bad_endpoint' });
    if (!kvConfigured()) return json(res, 503, { error: 'no_store' });

    if (body.unsubscribe) {
      await kvSRem(SUBS_KEY, endpoint);
      return json(res, 200, { subscribed: false });
    }
    if (await kvSCard(SUBS_KEY) >= MAX_SUBS) return json(res, 507, { error: 'full' });
    await kvSAdd(SUBS_KEY, endpoint);
    return json(res, 200, { subscribed: true });
  }

  // ---- an officer waking every phone ----
  if (!body.send) return json(res, 400, { error: 'unknown_action' });

  const secret = process.env.SESSION_SECRET;
  const session = secret && readSession(req, secret);
  if (!session) return json(res, 401, { error: 'not_signed_in' });
  if (!canEdit(session.role)) {
    return json(res, 403, {
      error: 'read_only_chair',
      detail: ROLES[session.role].label + ' can view the records but not notify the brethren.'
    });
  }
  if (!pushConfigured()) return json(res, 503, { error: 'no_keys' });

  const subject = process.env.VAPID_SUBJECT || 'mailto:secretary@nmt-lodge-42.vercel.app';
  const endpoints = await kvSMembers(SUBS_KEY);

  /* One at a time. A hundred and twenty-seven is not a number that needs
     a queue, and sending in sequence means a push service that is having
     a slow minute delays the rest rather than being hammered by all of
     them at once. */
  let sent = 0, pruned = 0, failed = 0;
  for (const endpoint of endpoints) {
    try {
      const out = await sendOne(endpoint, subject);
      if (out.ok) sent++;
      else if (out.gone) { await kvSRem(SUBS_KEY, endpoint); pruned++; }
      else failed++;
    } catch { failed++; }
  }

  // The role is recorded, never the endpoints: the log is read by people.
  console.log(JSON.stringify({
    at: new Date().toISOString(), actor: session.role,
    action: 'notifyBrethren', sent, pruned, failed
  }));

  json(res, 200, { sent, pruned, failed, total: endpoints.length });
}
