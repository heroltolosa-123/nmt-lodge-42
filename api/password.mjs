import { ROLES, VISIBLE_ROLES, readSession, readBody, json, requireEnv,
         verifyPassword, hashPassword, resolvePassword, kvPasswordKey,
         kvInvitedKey } from './_lib.mjs';
import { kvConfigured, kvGet, kvSet, kvDel } from './_kv.mjs';

/* ---------------------------------------------------------------------
   An officer sets their own password.

   Rules worth stating because they are the whole security of this route:

     - You must already be signed in, and you change YOUR OWN chair. The
       role comes from the session cookie, never from the request body, so
       asking to change someone else's is not something the shape of this
       request can express.
     - You must give the current password again. A session left open on a
       shared machine should not be enough to take the chair for good.
     - The administrator may clear another chair, which falls that chair
       back to its environment variable. That is the way back in when an
       officer forgets what they set; it cannot set a password, only
       restore the one the administrator controls.
   --------------------------------------------------------------------- */

const MIN_LENGTH = 10;

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });

  let secret;
  try { secret = requireEnv('SESSION_SECRET'); }
  catch { return json(res, 503, { error: 'not_configured' }); }

  const session = readSession(req, secret);
  if (!session) return json(res, 401, { error: 'not_signed_in' });

  if (!kvConfigured()) {
    return json(res, 503, {
      error: 'no_password_store',
      detail: 'Add the Upstash integration on Vercel; until then passwords stay in the environment variables.'
    });
  }

  let body;
  try { body = await readBody(req); } catch { return json(res, 400, { error: 'bad_request' }); }

  /* --- the administrator looking at every chair at once ---------------

     Who already has an account, who has been sent a link, and who has
     nothing yet. Reports the STATE of each chair and never a hash: a
     password cannot be read back out of here, only replaced.

     'chosen' means the password lives in the store, which is where both
     a password the officer set and an opening one the administrator gave
     end up — the two cannot be told apart, and claiming otherwise would
     be a lie the Secretary might act on. */
  if (body.list) {
    if (session.role !== 'admin') return json(res, 403, { error: 'not_permitted' });
    const chairs = await Promise.all(Object.entries(VISIBLE_ROLES).map(async ([role, spec]) => {
      const [stored, invited] = await Promise.all([
        kvGet(kvPasswordKey(role)).catch(() => null),
        kvGet(kvInvitedKey(role)).catch(() => null)
      ]);
      return {
        chair: role,
        label: spec.label,
        canEdit: !!spec.edit,
        state: stored ? 'chosen' : (process.env[spec.env] ? 'opening' : 'none'),
        invitePending: !stored && !!invited
      };
    }));
    return json(res, 200, { chairs, minLength: MIN_LENGTH });
  }

  // --- the administrator clearing someone else's chair ---------------
  if (body.reset) {
    if (session.role !== 'admin') return json(res, 403, { error: 'not_permitted' });
    const target = String(body.reset).toLowerCase();
    if (!ROLES[target]) return json(res, 400, { error: 'unknown_chair' });
    if (target === 'admin') return json(res, 400, { error: 'cannot_reset_own_chair_this_way' });
    await kvDel(kvPasswordKey(target));
    await kvDel(kvInvitedKey(target));
    console.log(JSON.stringify({ at: new Date().toISOString(), actor: session.role,
                                 action: 'resetPassword', target }));
    return json(res, 200, {
      reset: target,
      detail: ROLES[target].label + ' is back to the password in ' + ROLES[target].env + '.'
    });
  }

  // --- the administrator giving a chair its opening password ----------
  if (body.setFor) {
    if (session.role !== 'admin') return json(res, 403, { error: 'not_permitted' });
    const target = String(body.setFor).toLowerCase();
    if (!ROLES[target]) return json(res, 400, { error: 'unknown_chair' });
    const given = String(body.newPassword || '');
    if (given.length < MIN_LENGTH) return json(res, 400, { error: 'too_short', minLength: MIN_LENGTH });
    if (given.trim() !== given) return json(res, 400, { error: 'edge_whitespace' });
    await kvSet(kvPasswordKey(target), hashPassword(given));
    console.log(JSON.stringify({ at: new Date().toISOString(), actor: session.role,
                                 action: 'setPasswordFor', target }));
    return json(res, 200, {
      setFor: target, label: ROLES[target].label,
      detail: 'Give this password to the officer. They can change it themselves once signed in.'
    });
  }

  // --- an officer changing their own ---------------------------------
  const current = String(body.currentPassword || '');
  const next    = String(body.newPassword || '');

  if (next.length < MIN_LENGTH)
    return json(res, 400, { error: 'too_short', minLength: MIN_LENGTH });
  if (next === current)
    return json(res, 400, { error: 'unchanged' });
  if (next.trim() !== next)
    return json(res, 400, { error: 'edge_whitespace',
      detail: 'Leading or trailing spaces are too easy to lose when retyping.' });

  const { hash } = await resolvePassword(session.role);
  if (!hash || !verifyPassword(current, hash))
    return json(res, 401, { error: 'current_password_wrong' });

  await kvSet(kvPasswordKey(session.role), hashPassword(next));
  console.log(JSON.stringify({ at: new Date().toISOString(), actor: session.role,
                               action: 'changeOwnPassword' }));

  return json(res, 200, { changed: true, role: session.role, label: ROLES[session.role].label });
}
