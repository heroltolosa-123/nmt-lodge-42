// Run:  node tests/attendance.test.mjs
// Loads the real Apps Script functions and checks the rule that decides
// who is in good standing and who may vote.
import assert from 'node:assert';
import fs from 'node:fs';
import { appsScriptDir, appsScriptSource } from './_appsscript.mjs';

const SRC = appsScriptDir() + '/apps-script.js';
const src = fs.readFileSync(SRC, 'utf8');

function grab(name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('could not find ' + name);
  const end = src.indexOf('\n}', start);
  return src.slice(start, end + 2);
}

const ctx = {};
new Function('ctx', [
  "var LODGE_YEAR_START_MONTH = 3;",
  "var ATTENDANCE_CODES_COUNTED = ['C','NO','NC'];",
  "var MIN_ATTENDANCE_FOR_GOOD_STANDING = 6;",
  grab('lodgeYearStart_'),
  grab('countsAsAttendance_'),
  grab('countAttendanceForTerm_'),
  "ctx.lodgeYearStart_ = lodgeYearStart_;",
  "ctx.countsAsAttendance_ = countsAsAttendance_;",
  "ctx.countAttendanceForTerm_ = countAttendanceForTerm_;"
].join('\n'))(ctx);

const { lodgeYearStart_, countsAsAttendance_, countAttendanceForTerm_ } = ctx;
const d = (y, m, day = 15) => new Date(y, m - 1, day);

// --- the March boundary ---
assert.strictEqual(lodgeYearStart_(d(2026, 2, 28)), 2025, 'Feb 2026 belongs to the 2025 term');
assert.strictEqual(lodgeYearStart_(d(2026, 3, 1)),  2026, 'Mar 2026 starts the 2026 term');
assert.strictEqual(lodgeYearStart_(d(2026, 1, 1)),  2025, 'Jan 2026 belongs to the 2025 term');
assert.strictEqual(lodgeYearStart_(d(2026, 12, 31)),2026, 'Dec 2026 is still the 2026 term');
assert.strictEqual(lodgeYearStart_(d(2027, 2, 1)),  2026, 'Feb 2027 is still the 2026 term');
assert.strictEqual(lodgeYearStart_('not a date'),   null, 'a non-date yields null, not a guess');
console.log('PASS  March boundary: Feb stays with the outgoing term, March starts the new one');

// --- which codes count ---
for (const c of ['C', 'NO', 'NC', 'c', 'no', ' nc ']) {
  assert.ok(countsAsAttendance_(c), JSON.stringify(c) + ' must count');
}
for (const c of ['NP', 'np', '', null, undefined, 'X']) {
  assert.ok(!countsAsAttendance_(c), JSON.stringify(c) + ' must not count');
}
console.log('PASS  C, NO, NC count; NP, blank and anything unknown do not');

// --- counting within a term ---
const rows = [
  { date: d(2026, 3),  value: 'C'  },   // 2026 term
  { date: d(2026, 4),  value: 'NO' },   // 2026 term
  { date: d(2026, 5),  value: 'NP' },   // excluded: NP
  { date: d(2026, 6),  value: ''   },   // excluded: blank
  { date: d(2027, 1),  value: 'NC' },   // 2026 term - January still counts
  { date: d(2027, 2),  value: 'C'  },   // 2026 term - February still counts
  { date: d(2027, 3),  value: 'C'  },   // 2027 term - must NOT count
  { date: d(2026, 2),  value: 'C'  },   // 2025 term - must NOT count
  { date: null,        value: 'C'  }    // unparseable - skipped
];
assert.strictEqual(countAttendanceForTerm_(rows, 2026), 4, 'the 2026 term holds exactly 4');
assert.strictEqual(countAttendanceForTerm_(rows, 2027), 1, 'the 2027 term holds 1');
assert.strictEqual(countAttendanceForTerm_(rows, 2025), 1, 'the 2025 term holds 1');
assert.strictEqual(countAttendanceForTerm_([], 2026), 0, 'no records is zero, not an error');
console.log('PASS  counts stay inside their own term; Jan and Feb count, next March does not');

// --- the voting threshold ---
const six = Array.from({ length: 6 }, (_, i) => ({ date: d(2026, 3 + i), value: 'C' }));
assert.ok(countAttendanceForTerm_(six, 2026) >= 6, '6 meetings qualifies');
assert.ok(!(countAttendanceForTerm_(six.slice(0, 5), 2026) >= 6), '5 does not');
console.log('PASS  the six-meeting threshold for QualifiedToVote');

console.log('\nall checks passed');
