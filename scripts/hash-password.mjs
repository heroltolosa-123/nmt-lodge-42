// Generate a password hash for a Vercel environment variable.
//
//   node scripts/hash-password.mjs
//
// It asks for the password rather than taking it as an argument, because
// an argument is expanded by the shell before Node ever sees it — a
// password containing $ or ! or a backtick gets silently mangled, and you
// end up hashing something other than what you typed. An argument also
// lands in your shell history and in the process list.
//
// Paste the whole scrypt: line it prints into PW_WM / PW_SW / PW_JW /
// PW_SECRETARY in Vercel. Run it again each March to hand the chairs over.

import readline from 'node:readline';
import { hashPassword, verifyPassword } from '../api/_lib.mjs';

if (process.argv[2]) {
  console.error('Do not pass the password as an argument — the shell may change it.');
  console.error('Run:  node scripts/hash-password.mjs');
  process.exit(1);
}

async function readPasswords() {
  // Piped in (two lines) or typed at a prompt — both work.
  if (!process.stdin.isTTY) {
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    const lines = Buffer.concat(chunks).toString('utf8').split(/\r?\n/);
    return [lines[0] || '', lines.length > 1 ? lines[1] : (lines[0] || '')];
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = q => new Promise(r => rl.question(q, r));
  const a = await ask('Password for this chair: ');
  const b = await ask('Type it once more:      ');
  rl.close();
  return [a, b];
}

const [pw, again] = await readPasswords();

if (pw.length < 10) {
  console.error('\nToo short. Use at least 10 characters — this guards the Lodge roll.');
  process.exit(1);
}
if (pw !== again) {
  console.error('\nThose did not match. Nothing generated.');
  process.exit(1);
}

const hash = hashPassword(pw);
// Prove the hash verifies before anyone pastes it into Vercel.
if (!verifyPassword(pw, hash)) {
  console.error('\nThe generated hash failed to verify. Do not use it. Please report this.');
  process.exit(1);
}

console.log('\nPaste this entire line as the value in Vercel:\n');
console.log(hash);
console.log('\nLength: ' + hash.length + ' characters. If Vercel shows fewer, it was truncated.');
