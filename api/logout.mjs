import { sessionCookie, json } from './_lib.mjs';

export default async function handler(req, res) {
  res.setHeader('Set-Cookie', sessionCookie(null));   // Max-Age=0 clears it
  json(res, 200, { ok: true });
}
