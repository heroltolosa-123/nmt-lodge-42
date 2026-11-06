/* The Lodge's push signing key.
 *
 *   node scripts/make-vapid.mjs
 *
 * Run it ONCE. Paste the two lines it prints into Vercel's environment
 * variables, then redeploy.
 *
 * Generating a second pair does not add a key, it replaces one: every
 * brother who has already allowed notifications is subscribed against
 * the old public key, and the push service will refuse a token signed by
 * the new one. They would each have to turn notifications off and on
 * again, and nobody would tell them to, because nothing visibly breaks —
 * the pushes simply stop arriving. So: once, and keep it.
 *
 * The public key is not a secret. It is what identifies this Lodge to
 * Apple and Google, and the browser is handed it openly. The private key
 * is the secret, and it only ever exists in Vercel.
 */
import { generateKeyPairSync } from 'node:crypto';

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const jwk = publicKey.export({ format: 'jwk' });

// What the browser's pushManager.subscribe() wants: the uncompressed
// point, 0x04 then x then y, 65 bytes.
const point = Buffer.concat([
  Buffer.from([4]),
  Buffer.from(jwk.x, 'base64url'),
  Buffer.from(jwk.y, 'base64url')
]);

const pub = point.toString('base64url');
const priv = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');

console.log(`
Add these to Vercel → Settings → Environment Variables, then redeploy.

VAPID_PUBLIC_KEY=${pub}

VAPID_PRIVATE_KEY=${priv}

And one more, so the push services have somebody to write to if this
Lodge ever floods them. It must be a real address you read:

VAPID_SUBJECT=mailto:secretary@example.org

Keep VAPID_PRIVATE_KEY out of the repository, out of chat, and out of
screenshots. Anyone holding it can send a notification to every brother
who has turned them on.
`);
