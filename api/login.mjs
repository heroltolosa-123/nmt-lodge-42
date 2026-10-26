import { ROLES, requireEnv, verifyPassword, signToken, newSession,
         sessionCookie, readBody, json, resolvePassword } from './_lib.mjs';

/* A shared instance counter. Vercel may run several, so this slows an
   attacker down rather than stopping one — the real protection is that
   the passwords are set by the administrator and are not guessable.
   ponytail: per-instance, swap for a KV counter if the lodge ever grows
   past a handful of officers. */
const attempts = new Map();
const WINDOW = 10 * 60 * 1000;
const MAX_TRIES = 10;

function tooMany(ip) {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || now - rec.first > WINDOW) { attempts.set(ip, { first: now, n: 1 }); return false; }
  rec.n += 1;
  return rec.n > MAX_TRIES;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });

  let secret;
  try { secret = requireEnv('SESSION_SECRET'); }
  catch (e) { return json(res, 503, { error: 'not_configured', missing: String(e.message).split(':')[1] }); }

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (tooMany(ip)) return json(res, 429, { error: 'too_many_attempts', retryAfterMinutes: 10 });

  let body;
  try { body = await readBody(req); } catch { return json(res, 400, { error: 'bad_request' }); }

  const role = String(body.role || '').toLowerCase();
  const spec = ROLES[role];
  // A password the officer set themselves wins; the environment variable is
  // the fallback, so a chair works before the store exists and after.
  const { hash } = spec ? await resolvePassword(role) : { hash: null };

  // One message and one shape for every failure, so the response cannot
  // be used to learn which chairs have passwords set.
  if (!spec || !hash || !verifyPassword(body.password || '', hash)) {
    return json(res, 401, { error: 'invalid_credentials' });
  }

  const session = newSession(role);
  res.setHeader('Set-Cookie', sessionCookie(signToken(session, secret)));
  json(res, 200, { role, label: spec.label, canEdit: !!spec.edit, expiresAt: session.exp });
}
