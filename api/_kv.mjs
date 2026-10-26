/* ---------------------------------------------------------------------
   Upstash Redis over its REST API.

   Passwords used to live only in Vercel environment variables, which
   cannot be written while the site is running — which is why only the
   administrator could ever change one. A chair's own password now lives
   here instead, so an officer can set it themselves.

   Spoken to with fetch rather than @upstash/redis on purpose: this site
   has no package.json and no build step, and one dependency would bring
   both. Three REST calls do not need a client library.

   Everything degrades quietly. With no store configured, every read
   returns null and the environment variables carry on working exactly as
   they did — so the Lodge can sign in whether or not this is set up.
   --------------------------------------------------------------------- */

/* Two namings are in circulation for the same pair of credentials, and
   which one you get depends on how the store was attached: Upstash's own
   integration writes UPSTASH_REDIS_REST_*, while connecting the store
   from the Vercel Storage tab writes KV_REST_API_*. They are the same
   REST endpoint and the same token, so read either rather than make
   anyone rename a variable Vercel created for them. */
const URL_VARS   = ['UPSTASH_REDIS_REST_URL', 'KV_REST_API_URL'];
const TOKEN_VARS = ['UPSTASH_REDIS_REST_TOKEN', 'KV_REST_API_TOKEN'];

/* The read-only token is deliberately not a fallback: it cannot write,
   so accepting it would let an officer appear to set a password and
   silently fail. Better to report no store at all. */
const first = names => {
  for (const n of names) {
    const v = (process.env[n] || '').trim();
    if (v) return v;
  }
  return '';
};

export function kvConfigured() {
  return !!(first(URL_VARS) && first(TOKEN_VARS));
}

async function call(path, init) {
  if (!kvConfigured()) return null;
  const base = first(URL_VARS).replace(/\/+$/, '');
  const res = await fetch(base + path, {
    ...init,
    headers: { Authorization: 'Bearer ' + first(TOKEN_VARS), ...(init && init.headers) }
  });
  if (!res.ok) throw new Error('store returned ' + res.status);
  const body = await res.json();
  return body.result;
}

export async function kvGet(key) {
  return call('/get/' + encodeURIComponent(key));
}

/* The value goes in the body, not the path: a scrypt hash is 168
   characters and would otherwise have to survive URL encoding.

   `ttlSeconds` lets a value expire by itself, which is what makes an
   invitation safe to email: it stops working on its own whether or not
   anybody remembers to withdraw it. */
export async function kvSet(key, value, ttlSeconds) {
  const path = '/set/' + encodeURIComponent(key) +
               (ttlSeconds ? '?EX=' + Math.floor(ttlSeconds) : '');
  return call(path, { method: 'POST', body: String(value) });
}

export async function kvDel(key) {
  return call('/del/' + encodeURIComponent(key), { method: 'POST' });
}
