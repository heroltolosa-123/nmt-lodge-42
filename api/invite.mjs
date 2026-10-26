import { randomBytes } from 'node:crypto';
import { ROLES, VISIBLE_ROLES, readSession, readBody, json, requireEnv,
         hashPassword, kvPasswordKey, kvInvitedKey, kvRequestKey } from './_lib.mjs';
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
const REQUEST_DAYS = 30;
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
    await kvDel(kvInvitedKey(chair));             // no longer waiting
    await kvDel(kvRequestKey(chair));
    console.log(JSON.stringify({ at: new Date().toISOString(), actor: chair,
                                 action: 'redeemInvite' }));
    return json(res, 200, { done: true, chair, label: ROLES[chair].label });
  }

  /* ---- an officer asking for a link, signed in to nothing --------------

     The chairs that have never been given a password cannot sign in, so
     there is no door they could knock on from the inside. This is that
     door — and it deliberately issues NOTHING. It records that a brother
     asked, and the administrator still presses the button.

     Handing out a link here instead would mean anyone who can open the
     page could take the Master's chair by naming it and giving their own
     address, which is the whole reason it works this way.

     Three things keep it quiet without a rate limiter: only a chair that
     appears on the sign-in form can be named, so the administrator's own
     cannot; the first request for a chair is kept and later ones are
     ignored, so nobody can overwrite a brother's address with their own;
     and the answer is the same whatever is asked, so nothing can be
     learned by asking. At most one small record per chair can exist. */
  if (body.request) {
    const asked = String(body.chair || '').toLowerCase();
    const email = String(body.email || '').trim();
    const usable = VISIBLE_ROLES[asked] &&
                   email.length <= 254 &&
                   /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
    if (usable && !(await kvGet(kvRequestKey(asked)))) {
      await kvSet(kvRequestKey(asked),
                  JSON.stringify({ email, at: new Date().toISOString() }),
                  REQUEST_DAYS * 24 * 3600);
      console.log(JSON.stringify({ at: new Date().toISOString(), actor: 'anonymous',
                                   action: 'askedForLink', target: asked }));
    }
    // Always the same answer, whether or not anything was recorded.
    return json(res, 200, { asked: true });
  }

  // ---- creating: administrator only ---------------------------------
  const session = readSession(req, requireEnv('SESSION_SECRET'));
  if (!session) return json(res, 401, { error: 'not_signed_in' });
  if (session.role !== 'admin') return json(res, 403, { error: 'not_permitted' });

  const chair = String(body.chair || '').toLowerCase();
  if (!ROLES[chair]) return json(res, 400, { error: 'unknown_chair' });

  const token = randomBytes(24).toString('base64url');
  await kvSet(inviteKey(token), chair, INVITE_HOURS * 3600);
  /* So the administrator's list can show who is still waiting. Given the
     same lifetime as the invitation, so a link nobody uses stops being
     reported at the moment it stops working. */
  await kvSet(kvInvitedKey(chair), new Date().toISOString(), INVITE_HOURS * 3600);
  await kvDel(kvRequestKey(chair));   // asked and answered

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
