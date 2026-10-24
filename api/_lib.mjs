// Shared helpers. The leading underscore keeps Vercel from routing this file.

/* The only member fields that may ever reach an anonymous browser. This is
   the same whitelist the Apps Script patch applies, repeated here because
   this layer must not depend on that one being correct. */
export const PUBLIC_FIELDS = [
  'fullName', 'yearRaised', 'status', 'proficiency', 'attendanceTotal',
  'qualifiedToVote', 'goodStanding', 'arrears', 'lml', 'months',
  'attendanceRemarks'
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
