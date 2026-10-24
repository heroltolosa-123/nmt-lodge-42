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

  /* ?check=upstream also asks Apps Script whether LODGE_ADMIN_KEY is the
     password it expects. Opt-in, because it costs a 3-4s round trip and
     this endpoint is otherwise instant. Reports only whether the key was
     accepted — never the key, never a member. */
  // Vercel populates req.query; req.url may or may not carry the string,
  // so read both rather than depending on which.
  const wantsUpstream = (req.query && req.query.check === 'upstream')
    || /[?&]check=upstream/.test(req.url || '');

  /* ?check=codes&head=<deploymentId> asks the @HEAD deployment for the
     Lookups sheet and the attendance code distribution, using the admin
     key this function already holds. Temporary: it exists so the
     attendance calculation can be corrected from fact rather than from a
     guess about what "NC" means. Remove with the inspect action. */
  const codesHead = (req.query && req.query.head) ||
    (/[?&]head=([A-Za-z0-9_-]+)/.exec(req.url || '') || [])[1];
  if (codesHead && process.env.APPS_SCRIPT_URL && process.env.LODGE_ADMIN_KEY) {
    try {
      const base = process.env.APPS_SCRIPT_URL.replace(/\/s\/[^/]+\//, '/s/' + codesHead + '/');
      const r = await fetch(base + '?action=inspect&key=' + encodeURIComponent(process.env.LODGE_ADMIN_KEY),
                            { redirect: 'follow' });
      const t = await r.text();
      try { out.inspect = JSON.parse(t); }
      catch { out.inspect = { error: 'not JSON', head: t.slice(0, 200) }; }
    } catch (err) {
      out.inspect = { error: String(err.message || err) };
    }
  }
  if (wantsUpstream) {
    if (!process.env.APPS_SCRIPT_URL || !process.env.LODGE_ADMIN_KEY) {
      out.upstream = { checked: false, reason: 'APPS_SCRIPT_URL or LODGE_ADMIN_KEY not set' };
    } else {
      try {
        const url = process.env.APPS_SCRIPT_URL
          + '?action=roster&key=' + encodeURIComponent(process.env.LODGE_ADMIN_KEY);
        const r = await fetch(url, { redirect: 'follow' });
        const text = await r.text();
        let data = null;
        try { data = JSON.parse(text); } catch { /* Apps Script returned a page, not JSON */ }

        if (!data) {
          out.upstream = { checked: true, keyAccepted: false,
            reason: 'Apps Script did not return JSON. Is the /exec URL correct and the deployment public?' };
        } else if (data.error) {
          out.upstream = { checked: true, keyAccepted: false, appsScriptSaid: data.error,
            reason: data.error === 'Unauthorized'
              ? 'Apps Script rejected the key. LODGE_ADMIN_KEY in Vercel must match ADMIN_KEY in Script Properties exactly.'
              : 'Apps Script returned an error.' };
        } else {
          out.upstream = { checked: true, keyAccepted: true,
            rosterRows: Array.isArray(data.roster) ? data.roster.length : 0 };
        }
      } catch (err) {
        out.upstream = { checked: true, keyAccepted: false, reason: 'Could not reach Apps Script.' };
      }
    }
  }

  json(res, 200, out);
}
