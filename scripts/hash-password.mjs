// Generate a password hash for a Vercel environment variable.
//
//   node scripts/hash-password.mjs "the password"
//
// Paste the whole line it prints into PW_WM / PW_SW / PW_JW / PW_SECRETARY.
// Run it again each March to hand the chairs over.

import { hashPassword } from '../api/_lib.mjs';

const pw = process.argv[2];
if (!pw) {
  console.error('Usage: node scripts/hash-password.mjs "the password"');
  process.exit(1);
}
if (pw.length < 10) {
  console.error('Too short. Use at least 10 characters — this guards the Lodge roll.');
  process.exit(1);
}
console.log(hashPassword(pw));
