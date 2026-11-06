/* ---------------------------------------------------------------------
   Web Push, without a library.

   The usual way to send a push is the `web-push` package. This site has
   no package.json and no build step, and one dependency would bring
   both — so the question was whether the standard can be met with
   node:crypto alone. It can, because of one decision made upstream:

   NOTHING IS SENT IN THE PUSH ITSELF.

   A push carrying a message has to be encrypted end to end for the push
   service to relay it — RFC 8291: an ECDH exchange, HKDF, AES-128-GCM,
   and a per-subscription key pair. That is the part worth a library.

   A push carrying NO body needs none of it. It is one POST with a
   signed token (RFC 8292) saying who is asking, and the phone's own
   service worker then fetches the announcement itself. So this file is
   a JWT signer and nothing more.

   It is also the more private arrangement. Apple's and Google's push
   servers see that this Lodge woke a handset; they never see the
   announcement, because it does not travel through them.

   WHAT A SUBSCRIPTION IS HERE

   Just the endpoint URL — an opaque address at Apple or Google. The
   p256dh and auth keys a browser also offers are only needed to encrypt
   a payload, so they are never asked for and never stored. The record
   kept for a brother is a URL that names no one.
   --------------------------------------------------------------------- */
import { createPrivateKey, createPublicKey, sign } from 'node:crypto';

const b64url = buf => Buffer.from(buf).toString('base64url');

export function pushConfigured() {
  return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

/* The key the browser is handed to subscribe with: the public point,
   uncompressed, 65 bytes. Public by design — it is what identifies this
   Lodge to the push service, not a secret. */
export function publicKey() {
  return (process.env.VAPID_PUBLIC_KEY || '').trim();
}

function privateKey() {
  const der = Buffer.from((process.env.VAPID_PRIVATE_KEY || '').trim(), 'base64');
  return createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
}

/* The token is good for one push service, not for a subscription: every
   endpoint at fcm.googleapis.com shares one `aud`, so one token covers
   every brother on that service. Twelve hours is the longest the spec
   allows. */
export function audienceOf(endpoint) {
  const u = new URL(endpoint);
  return u.origin;
}

export function vapidHeader(endpoint, subject, now = Date.now()) {
  const header = b64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64url(JSON.stringify({
    aud: audienceOf(endpoint),
    exp: Math.floor(now / 1000) + 12 * 3600,
    sub: subject
  }));
  const input = Buffer.from(header + '.' + claims);
  /* ieee-p1363 is the raw r‖s pair the spec asks for. Node's default is
     DER, which every push service rejects — and rejects with a flat 401,
     giving no hint that the signature was merely the wrong shape. */
  const sig = sign('sha256', input, { key: privateKey(), dsaEncoding: 'ieee-p1363' });
  return {
    Authorization: `vapid t=${header}.${claims}.${b64url(sig)}, k=${publicKey()}`
  };
}

/* 404 and 410 are the push service saying this address is dead — the app
   was deleted, or the browser dropped the subscription. Anything else
   might be a bad afternoon at Google, so the row stays. */
export const isGone = status => status === 404 || status === 410;

export async function sendOne(endpoint, subject, ttlSeconds = 86400) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      ...vapidHeader(endpoint, subject),
      TTL: String(ttlSeconds),
      // No body, so the service must still be told the length is nil.
      'Content-Length': '0'
    }
  });
  return { status: res.status, ok: res.ok, gone: isGone(res.status) };
}

/* Exported for the key generator and for the tests, which check that a
   token this file produced verifies against the key it claims. */
export function publicKeyObject() {
  const raw = Buffer.from(publicKey(), 'base64url');
  return createPublicKey({
    key: { kty: 'EC', crv: 'P-256',
           x: b64url(raw.subarray(1, 33)), y: b64url(raw.subarray(33, 65)) },
    format: 'jwk'
  });
}
