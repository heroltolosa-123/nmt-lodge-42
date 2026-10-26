// Shared helpers. The leading underscore keeps Vercel from routing this file.

/* The only member fields that may ever reach an anonymous browser. This is
   the same whitelist the Apps Script patch applies, repeated here because
   this layer must not depend on that one being correct. */
/* What a name search may return to anyone, signed in or not.
   photoUrl is here on purpose: Find My Status shows the brother's portrait,
   and the page is public, so the portrait is public too - the same as the
   officers' photographs already on the Officers page. Everything omitted
   here - address, contact number, email, date of birth, occupation - stays
   omitted. */
export const PUBLIC_FIELDS = [
  'fullName', 'yearRaised', 'status', 'proficiency', 'attendanceTotal',
  'qualifiedToVote', 'goodStanding', 'arrears', 'lml', 'months',
  'attendanceRemarks', 'photoUrl'
];

export function publicView(m) {
  const out = {};
  for (const f of PUBLIC_FIELDS) if (m[f] !== undefined) out[f] = m[f];
  return out;
}

export function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error('MISSING_ENV:' + name);
  return v;
}

/* Normalise the way Apps Script does, so a search here matches a search
   there: trimmed, lowercased, runs of whitespace collapsed. */
export function normalise(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function json(res, status, body, cacheControl) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  // Nothing from this API may be stored by a shared proxy unless we say so.
  res.setHeader('Cache-Control', cacheControl || 'no-store');
  res.end(JSON.stringify(body));
}

/* =====================================================================
   SESSIONS

   Accounts keyed to the chair rather than the person, so an
   installation in March is a password handover and not four new
   accounts. Passwords are scrypt hashes in the Vercel environment:
   a leak of those settings must not hand someone a password that an
   officer also used on their email.
   ===================================================================== */
import crypto from 'node:crypto';
import { kvGet } from './_kv.mjs';

/* Every chair of the 2026-2027 line. Keyed to the chair, never to the brother
   holding it, so a handover in March is a new password rather than a new
   account.

   `edit` is the whole access model. The Master, the Wardens, the Secretary and
   the Treasurer run the Lodge's records and may change them. Every other
   officer signs in and sees the same roster, attendance and arrears, and can
   change nothing — asked for in those words: full control for the three lights
   and the Secretary, the rest to view only.

   A chair with no password set simply cannot be signed into. The seventeen
   added here have none until the administrator gives them one, so listing a
   chair does not open it. */
export const ROLES = {
  // the chairs that may change records
  wm:         { label: 'Worshipful Master', env: 'PW_WM',        edit: true },
  sw:         { label: 'Senior Warden',     env: 'PW_SW',        edit: true },
  jw:         { label: 'Junior Warden',     env: 'PW_JW',        edit: true },
  secretary:  { label: 'Secretary',         env: 'PW_SECRETARY', edit: true },
  treasurer:  { label: 'Treasurer',         env: 'PW_TREASURER', edit: true },

  // the rest of the line: the same view, nothing to change
  auditor:    { label: 'Auditor',             env: 'PW_AUDITOR' },
  harmony:    { label: 'Harmony Officer',     env: 'PW_HARMONY' },
  chaplain:   { label: 'Chaplain',            env: 'PW_CHAPLAIN' },
  marshal:    { label: 'Marshal',             env: 'PW_MARSHAL' },
  sd:         { label: 'Senior Deacon',       env: 'PW_SD' },
  jd:         { label: 'Junior Deacon',       env: 'PW_JD' },
  ss:         { label: 'Senior Steward',      env: 'PW_SS' },
  js:         { label: 'Junior Steward',      env: 'PW_JS' },
  organist:   { label: 'Organist',            env: 'PW_ORGANIST' },
  biblebearer:{ label: 'Bible Bearer',        env: 'PW_BIBLEBEARER' },
  almoner:    { label: 'Almoner',             env: 'PW_ALMONER' },
  orator:     { label: 'Orator',              env: 'PW_ORATOR' },
  lecturer:   { label: 'Lecturer',            env: 'PW_LECTURER' },
  historian:  { label: 'Historian',           env: 'PW_HISTORIAN' },
  custodian:  { label: 'Custodian of Works',  env: 'PW_CUSTODIAN' },
  property:   { label: 'Property Custodian',  env: 'PW_PROPERTY' },
  tyler:      { label: 'Tyler',               env: 'PW_TYLER' },

  /* Not offered on the sign-in form, for the brother who keeps the system
     rather than holding a chair. `hidden` only keeps it out of the form and
     out of the public health report — it is not what makes it safe. The
     password is. /api/login answers unknown chair, unset password and wrong
     password with the same 401, so the name cannot be found by probing. */
  admin:      { label: 'Lodge Administrator', env: 'PW_ADMIN', edit: true, hidden: true }
};

/* May this chair change the Lodge's records? */
export function canEdit(role) {
  return !!(ROLES[role] && ROLES[role].edit);
}

/* The chairs the sign-in form offers. */
export const VISIBLE_ROLES = Object.fromEntries(
  Object.entries(ROLES).filter(([, spec]) => !spec.hidden)
);

const SESSION_COOKIE = 'nmt_session';
const SESSION_HOURS  = 8;

/* Where a chair's password actually comes from.

   A password the officer set themselves lives in the store and wins. The
   environment variable stays as the fallback, so every chair keeps working
   before the store exists and still works if it is ever removed — and it is
   the way back in if an officer forgets what they set: clear the stored one
   and the variable applies again. */
export const kvPasswordKey = role => 'nmt:pw:' + role;

/* Set when a chair is invited and cleared when the link is used, purely so
   the administrator can see who is still waiting. It expires with the
   invitation itself, so a link left unused simply stops being mentioned. */
export const kvInvitedKey = role => 'nmt:invited:' + role;

/* An officer with no password cannot sign in to ask for one, so the sign-in
   screen lets him leave the request here. It is a request and nothing more:
   no link, no password, nothing he could use. The administrator sees it and
   decides. */
export const kvRequestKey = role => 'nmt:askedfor:' + role;

export async function resolvePassword(role) {
  const spec = ROLES[role];
  if (!spec) return { hash: null, source: null };
  try {
    const stored = await kvGet(kvPasswordKey(role));
    if (stored) return { hash: String(stored), source: 'set by the officer' };
  } catch {
    // The store being unreachable must not lock the Lodge out.
  }
  const env = process.env[spec.env];
  return env ? { hash: env, source: 'environment variable' } : { hash: null, source: null };
}

export function hashPassword(plain) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(plain), salt, 64);
  return 'scrypt:' + salt.toString('hex') + ':' + hash.toString('hex');
}

export function verifyPassword(plain, stored) {
  const parts = String(stored || '').split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  let expected;
  try { expected = Buffer.from(parts[2], 'hex'); } catch { return false; }
  if (!expected.length) return false;
  const actual = crypto.scryptSync(String(plain), Buffer.from(parts[1], 'hex'), expected.length);
  // Length is equal by construction, but timingSafeEqual throws if it is not.
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

const b64u = buf => Buffer.from(buf).toString('base64url');

export function signToken(payload, secret) {
  const body = b64u(JSON.stringify(payload));
  const sig  = b64u(crypto.createHmac('sha256', secret).update(body).digest());
  return body + '.' + sig;
}

export function verifyToken(token, secret) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const expected = b64u(crypto.createHmac('sha256', secret).update(body).digest());
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); }
  catch { return null; }
  if (!payload || typeof payload.exp !== 'number' || Date.now() > payload.exp) return null;
  if (!ROLES[payload.role]) return null;
  return payload;
}

export function sessionCookie(token) {
  // HttpOnly so no page script can read it, which is what keeps an XSS
  // from walking off with an officer's session.
  const age = token ? SESSION_HOURS * 3600 : 0;
  return SESSION_COOKIE + '=' + (token || '') +
    '; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=' + age;
}

export function readSession(req, secret) {
  const raw = req.headers?.cookie || '';
  const hit = raw.split(';')
    .map(c => c.trim())
    .find(c => c.startsWith(SESSION_COOKIE + '='));
  if (!hit) return null;
  return verifyToken(hit.slice(SESSION_COOKIE.length + 1), secret);
}

export function newSession(role) {
  return { role, exp: Date.now() + SESSION_HOURS * 3600 * 1000 };
}

export async function readBody(req) {
  if (req.body) return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}
