import { ROLES, requireEnv, readSession, readBody, json } from './_lib.mjs';

/* ---------------------------------------------------------------------
   Authenticated proxy to Apps Script.

   Today the officers' password travels to the browser and is posted back
   with every save, so anyone who can read the page source or watch the
   network has it. Here the browser sends only a signed session cookie;
   LODGE_ADMIN_KEY is read from the environment and never leaves the
   server.

   Actions are whitelisted rather than forwarded blindly: a proxy that
   passes through whatever it is handed is just the Apps Script endpoint
   with extra steps, and anything added to the script later would become
   reachable without anyone deciding it should be.
   --------------------------------------------------------------------- */

const WRITE_ACTIONS = new Set([
  'addMember', 'updateMember', 'addDue', 'rollCall',
  'addActivity', 'updateActivity', 'deleteActivity',
  'addOfficer', 'updateOfficer', 'deleteOfficer',
  'addAnnouncement', 'updateAnnouncement', 'deleteAnnouncement'
]);

const READ_ACTIONS = new Set(['roster', 'attendance', 'summary']);

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });

  let secret, scriptUrl, adminKey;
  try {
    secret    = requireEnv('SESSION_SECRET');
    scriptUrl = requireEnv('APPS_SCRIPT_URL');
    adminKey  = requireEnv('LODGE_ADMIN_KEY');
  } catch (e) {
    return json(res, 503, { error: 'not_configured', missing: String(e.message).split(':')[1] });
  }

  const session = readSession(req, secret);
  if (!session) return json(res, 401, { error: 'not_signed_in' });

  let body;
  try { body = await readBody(req); } catch { return json(res, 400, { error: 'bad_request' }); }

  const action = String(body.action || '');
  const isRead = READ_ACTIONS.has(action);
  if (!isRead && !WRITE_ACTIONS.has(action)) {
    return json(res, 400, { error: 'unknown_action', action });
  }

  // Every chair carries the same authority, as the Lodge asked. The role
  // is recorded so the log can say who, which a shared password never could.
  console.log(JSON.stringify({
    at: new Date().toISOString(),
    actor: session.role,
    label: ROLES[session.role].label,
    action,
    target: body.memberId || body.activityId || body.officerId ||
            body.announcementId || body.meetingMonth || null
  }));

  try {
    let upstream;
    if (isRead) {
      const url = scriptUrl + '?action=' + encodeURIComponent(action) +
                  '&key=' + encodeURIComponent(adminKey);
      upstream = await fetch(url, { redirect: 'follow' });
    } else {
      // The key is attached here, server side. Anything the browser sent
      // under that name is discarded.
      const payload = { ...body, key: adminKey };
      upstream = await fetch(scriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
        redirect: 'follow'
      });
    }
    if (!upstream.ok) return json(res, 502, { error: 'upstream_' + upstream.status });
    const data = await upstream.json();
    json(res, 200, data);
  } catch (err) {
    json(res, 502, { error: 'upstream_unavailable' });
  }
}
