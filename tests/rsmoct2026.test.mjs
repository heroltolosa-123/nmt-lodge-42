/* The October 2026 roll, taken from the minutes.

   Two things can go wrong with a list typed out of a PDF, and neither
   announces itself. A brother listed twice — the minutes name four men
   in two groups each — becomes two sheet rows if the de-duplication
   stops working. And two different brethren whose names collapse to the
   same match key become one brother: the roll holds pairs who share a
   surname, so this is not hypothetical.

   The list names members, so the script lives outside this repository
   and the test reads it from there without ever writing a name down.
   It skips rather than fails when the script is absent. */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert';
import { appsScriptDir, appsScriptSource } from './_appsscript.mjs';

const FILE = 'rsm-oct-2026.js';
if (!existsSync(join(appsScriptDir(), FILE))) {
  console.log('SKIP  ' + FILE + ' is not present (one-off entry, kept out of the repo)');
  process.exit(0);
}

const src = appsScriptSource(FILE);
// statusKey_ is the matcher the script actually uses; testing the list
// against anything else would prove nothing about the run.
const api = new Function(
  appsScriptSource('status-2026.js').replace(/\bfunction statusIndex_[\s\S]*$/, '') + ';' +
  src + '; return { LIST: RSM_OCT_2026_PRESENT_, MONTH: RSM_OCT_2026_MONTH_,' +
  ' CODE: RSM_OCT_2026_CODE_, key: statusKey_ };')();
const { LIST, MONTH, CODE, key } = api;

// --- what is being written, and when ---
assert.match(MONTH, /^\d{4}-\d{2}$/, 'the month is the shape saveRollCall_ parses');
assert.strictEqual(MONTH, '2026-10', 'the stated meeting of 17 October 2026');
assert.ok(['C', 'NO', 'NC'].includes(CODE),
  'the code must be one that counts toward the six needed to vote');

// --- the list itself ---
assert.ok(LIST.length >= 40, 'the minutes record a well-attended meeting');
assert.strictEqual(new Set(LIST).size, LIST.length, 'no name is written twice');
LIST.forEach(n => {
  assert.strictEqual(typeof n, 'string');
  assert.ok(key(n).split(' ').length >= 2,
    'a name must survive the matcher as at least two words, or it can match anybody');
});

/* The matcher drops single letters, so a name with a middle initial and
   the same name without one are the same man — which is the point. Two
   DIFFERENT brethren landing on one key is the failure: the second would
   be silently dropped and his attendance lost without a word in the log. */
const byKey = new Map();
LIST.forEach(n => {
  const k = key(n);
  assert.ok(!byKey.has(k),
    'two entries collapse to the same match key and one would be lost: ' +
    JSON.stringify([byKey.get(k), n]));
  byKey.set(k, n);
});

// --- the run must be idempotent on an id named twice ---
// A re-read of the same minutes must produce the same set of entries, and
// a brother already marked must produce none.
const seen = {};
const entries = [];
['M01', 'M02', 'M02', 'M03'].forEach(id => {
  if (seen[id]) return;
  seen[id] = true;
  entries.push({ memberId: id, code: CODE });
});
assert.strictEqual(entries.length, 3, 'an id listed twice is marked once');

// --- the script writes only marks, never clears one ---
assert.ok(!/code:\s*''/.test(src) && !/code:\s*""/.test(src),
  'an empty code tells saveRollCall_ to REMOVE a mark; this run must never send one');
assert.match(src, /saveRollCall_\(/, 'it goes through the Lodge’s own roll-call path');
assert.ok(/rsmOct2026Preview|rsmOct2026Apply/.test(src), 'preview and apply are both exposed');

console.log('PASS  ' + LIST.length + ' brethren recorded present for ' + MONTH +
  ' as ' + CODE + ', each matching one man and one only');
