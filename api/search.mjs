import { publicView, requireEnv, normalise, json } from './_lib.mjs';

/* ---------------------------------------------------------------------
   Public member search.

   The browser never receives the roster. It sends a term, this function
   does the filtering on the server and returns at most 15 public records.
   That is the whole point: a request with no term, or a two-letter term,
   gets nothing, so there is no query that returns the book.

   The roster is fetched once per warm instance and held for a minute.
   A cold start pays the Apps Script round trip; everything after it is
   served from memory, and identical searches are served from Vercel's
   edge without reaching this function at all.

   It was five minutes, with an hour of stale-while-revalidate behind it,
   which was reasonable while a member record only changed when the
   Secretary changed it. Now a brother can send his own portrait and
   watch this card for it, and being told to come back in an hour reads
   as the thing being broken. A minute costs at most one roster fetch a
   minute per warm instance, which is nothing.
   --------------------------------------------------------------------- */

const ROSTER_TTL = 60 * 1000;
let cache = { at: 0, rows: null };
let inflight = null;

async function loadRoster() {
  if (cache.rows && Date.now() - cache.at < ROSTER_TTL) return cache.rows;
  // A burst of cold requests must not become a burst of Apps Script calls.
  if (inflight) return inflight;

  inflight = (async () => {
    const url = requireEnv('APPS_SCRIPT_URL')
      + '?action=roster&key=' + encodeURIComponent(requireEnv('LODGE_ADMIN_KEY'));
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) throw new Error('UPSTREAM_' + res.status);
    const data = await res.json();
    if (data.error) throw new Error('UPSTREAM_' + data.error);
    cache = { at: Date.now(), rows: Array.isArray(data.roster) ? data.roster : [] };
    return cache.rows;
  })().finally(() => { inflight = null; });

  return inflight;
}

export default async function handler(req, res) {
  const term = normalise(req.query?.q ?? new URL(req.url, 'http://x').searchParams.get('q'));

  // Three characters, same floor as the Apps Script patch: two matched most
  // of the roll at a time, which is how a roster gets walked out the door.
  if (term.length < 3) return json(res, 200, { matches: [] });

  let roster;
  try {
    roster = await loadRoster();
  } catch (err) {
    const msg = String(err.message || err);
    if (msg.startsWith('MISSING_ENV:')) {
      // Not configured yet. The page falls back to Apps Script on this.
      return json(res, 503, { error: 'not_configured', missing: msg.split(':')[1] });
    }
    return json(res, 502, { error: 'upstream_unavailable' });
  }

  const matches = roster
    .filter(m => normalise(m.fullName).includes(term)
              || normalise(m.surname).includes(term)
              || normalise(m.firstName).includes(term))
    .slice(0, 15)
    .map(publicView);

  // Identical searches are answered by the edge for a minute, and a stale
  // answer for a minute more while a fresh one is fetched behind it.
  json(res, 200, { matches }, 'public, s-maxage=60, stale-while-revalidate=60');
}
