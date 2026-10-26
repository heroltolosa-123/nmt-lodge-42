import { ROLES, canEdit, requireEnv, readSession, json } from './_lib.mjs';

export default async function handler(req, res) {
  let secret;
  try { secret = requireEnv('SESSION_SECRET'); }
  catch (e) { return json(res, 503, { error: 'not_configured', missing: String(e.message).split(':')[1] }); }

  const s = readSession(req, secret);
  if (!s) return json(res, 200, { signedIn: false });
  json(res, 200, { signedIn: true, role: s.role, label: ROLES[s.role].label,
                   canEdit: canEdit(s.role), expiresAt: s.exp });
}
