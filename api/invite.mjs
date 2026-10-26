import { randomBytes } from 'node:crypto';
import { ROLES, readSession, readBody, json, requireEnv,
         hashPassword, kvPasswordKey } from './_lib.mjs';
import { kvConfigured, kvGet, kvSet, kvDel } from './_kv.mjs';

/* ---------------------------------------------------------------------
   INVITATIONS — an officer sets their own password, first time included.

   Handing out an opening password means the administrator knows it, and
   it travels through Viber or a conversation on its way. An invitation
   carries no password at all: it is a one-time link that lets the holder
   choose one, and it expires by itself.

     - The link names nobody and nothing. The chair it belongs to is held
       here, against the token, never in the URL.
     - It can be used once. Redeeming it deletes it, so a link forwarded
       or left in a chat cannot be used again.
     - It expires after seven days whether or not anybody remembers.
     - Only the administrator can create one, and only for a chair.
   --------------------------------------------------------------------- */

const INVITE_HOURS = 24 * 7;
const MIN_LENGTH   = 10;
const inviteKey = token => 'nmt:invite:' + token;

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });

  try { requireEnv('SESSION_SECRET'); }
  catch { return json(res, 503, { error: 'not_configured' }); }

  if (!kvConfigured()) return json(res, 503, { error: 'no_password_store' });

  let body;
  try { body = await readBody(req); } catch { return json(res, 400, { error: 'bad_request' }); }

  // ---- redeeming: no session needed, the token is the credential -----
  if (body.token) {
    const chair = await kvGet(inviteKey(String(body.token)));
    if (!chair) return json(res, 410, { error: 'link_expired' });

    // Asking first what the link is for, so the page can greet the officer
    // by their chair before they commit to a password.
    if (!body.newPassword) {
      return json(res, 200, { chair, label: ROLES[chair] ? ROLES[chair].label : chair });
    }

    const next = String(body.newPassword);
    if (next.length < MIN_LENGTH) return json(res, 400, { error: 'too_short', minLength: MIN_LENGTH });
    if (next.trim() !== next)     return json(res, 400, { error: 'edge_whitespace' });
    if (!ROLES[chair])            return json(res, 400, { error: 'unknown_chair' });

    await kvSet(kvPasswordKey(chair), hashPassword(next));
    await kvDel(inviteKey(String(body.token)));   // one use only
    console.log(JSON.stringify({ at: new Date().toISOString(), actor: chair,
                                 action: 'redeemInvite' }));
    return json(res, 200, { done: true, chair, label: ROLES[chair].label });
  }

  // ---- creating: administrator only ---------------------------------
  const session = readSession(req, requireEnv('SESSION_SECRET'));
  if (!session) return json(res, 401, { error: 'not_signed_in' });
  if (session.role !== 'admin') return json(res, 403, { error: 'not_permitted' });

  const chair = String(body.chair || '').toLowerCase();
  if (!ROLES[chair]) return json(res, 400, { error: 'unknown_chair' });

  const token = randomBytes(24).toString('base64url');
  await kvSet(inviteKey(token), chair, INVITE_HOURS * 3600);

  const origin = 'https://' + (req.headers['x-forwarded-host'] || req.headers.host);
  const link = origin + '/#invite=' + token;

  let emailed = null;
  if (body.email) emailed = await sendInvite(String(body.email), ROLES[chair].label, link);

  console.log(JSON.stringify({ at: new Date().toISOString(), actor: session.role,
                               action: 'createInvite', target: chair,
                               emailed: emailed && emailed.sent ? true : false }));

  return json(res, 200, { chair, label: ROLES[chair].label, link, expiresInHours: INVITE_HOURS, emailed });
}

/* Brevo, because it will verify a single address and this Lodge has no domain
   of its own — the providers that want a domain cannot be used here. Spoken to
   over REST, so no dependency. Without a key the link is simply returned for
   the administrator to pass on however the Lodge usually does. */
async function sendInvite(to, label, link) {
  const key = process.env.BREVO_API_KEY;
  const from = process.env.MAIL_FROM;
  if (!key || !from) return { sent: false, reason: 'email_not_configured' };
  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': key, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        sender: { email: from, name: 'Noli Me Tangere Lodge No. 42' },
        to: [{ email: to }],
        subject: 'Your sign-in for Noli Me Tangere Lodge No. 42',
        textContent:
          'Brethren,\n\nYou can now sign in to the Lodge records as ' + label + '.\n\n' +
          'Open this link and choose your own password:\n\n' + link + '\n\n' +
          'The link works once and expires in seven days. Nobody else knows the\n' +
          'password you choose, including the Lodge Administrator.\n\n' +
          'Fraternally,\nNoli Me Tangere Lodge No. 42, F. & A. M.\n'
      })
    });
    if (!res.ok) return { sent: false, reason: 'provider returned ' + res.status };
    return { sent: true, to };
  } catch (err) {
    return { sent: false, reason: String(err.message) };
  }
}
