import { ROLES, json } from './_lib.mjs';

/* ---------------------------------------------------------------------
   Configuration check.

   "I cannot sign in" has several causes that look identical from the
   outside, because /api/login answers every failure the same way on
   purpose. This reports the SHAPE of the configuration and never a
   value: whether a variable is set, and whether it parses as a hash.
   Knowing PW_WM is 174 characters and starts with "scrypt:" tells an
   attacker nothing they could not guess; it tells you immediately
   whether you pasted a hash or a password.
   --------------------------------------------------------------------- */

function describeHash(v) {
  if (!v) return { set: false, problem: 'not set' };
  const s = String(v).trim();
  if (s !== String(v)) return { set: true, problem: 'has leading or trailing whitespace' };
  const parts = s.split(':');
  if (parts[0] !== 'scrypt') {
    // The commonest paste error by a distance: the value is a perfectly
    // good hash with the seven-character "scrypt:" tag missing from the
    // front, usually because the selection started after the colon.
    if (parts.length === 2 && /^[0-9a-f]{32}$/.test(parts[0]) && /^[0-9a-f]{128}$/.test(parts[1])) {
      return { set: true, length: s.length,
               problem: 'the "scrypt:" prefix is missing — the rest is correct. Put scrypt: at the front of this value.',
               fix: 'scrypt:' + '…' };
    }
    return { set: true, length: s.length,
             problem: 'does not start with "scrypt:" — this looks like a plain password, not a hash' };
  }
  if (parts.length !== 3) return { set: true, length: s.length, problem: 'wrong number of colon-separated parts' };
  if (!/^[0-9a-f]{32}$/.test(parts[1])) return { set: true, length: s.length, problem: 'salt is not 32 hex characters — likely truncated' };
  if (!/^[0-9a-f]{128}$/.test(parts[2])) {
    return { set: true, length: s.length,
             problem: `hash is ${parts[2].length} hex characters, expected 128 — likely truncated when pasted` };
  }
  return { set: true, length: s.length, ok: true };
}

export default async function handler(req, res) {
  const out = {
    appsScriptUrl: { set: !!process.env.APPS_SCRIPT_URL },
    lodgeAdminKey: { set: !!process.env.LODGE_ADMIN_KEY },
    sessionSecret: {
      set: !!process.env.SESSION_SECRET,
      lengthOk: (process.env.SESSION_SECRET || '').length >= 24
    },
    chairs: {}
  };
  for (const [role, spec] of Object.entries(ROLES)) {
    out.chairs[role] = describeHash(process.env[spec.env]);
  }
  out.readyToSignIn = out.sessionSecret.set &&
    Object.values(out.chairs).some(c => c.ok);
  json(res, 200, out);
}
