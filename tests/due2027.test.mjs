/* Recording the 2027 dues that were paid but never entered.

   The guard is the whole point: the table names every brother the
   workbook says has paid, including the three who already have a row in
   the book, and the book is what decides. Running it twice must record
   nothing the second time — a dues payment entered twice is money the
   Lodge never received.

   The script lives outside this repository (it names members, and this
   repository is public), so the test skips rather than fails when it is
   not there. */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert';
import { appsScriptDir, appsScriptSource } from './_appsscript.mjs';

const FILE = 'due2027.js';
if (!existsSync(join(appsScriptDir(), FILE))) {
  console.log('SKIP  ' + FILE + ' is not present (one-off correction, kept out of the repo)');
  process.exit(0);
}

const api = new Function(appsScriptSource(FILE) +
  '; return { due2027Existing_, DUE_2027_, DUE_2027_YEAR_, DUE_2027_NOTE_ };')();
const { due2027Existing_: existing, DUE_2027_: TABLE,
        DUE_2027_YEAR_: YEAR, DUE_2027_NOTE_: NOTE } = api;

// --- the figures, as the workbook records them ---
assert.strictEqual(YEAR, 2027);
assert.strictEqual(TABLE.length, 10, 'ten brethren have a 2027 figure in the workbook');
const byAmount = TABLE.reduce((a, d) => (a[d.amount] = (a[d.amount] || 0) + 1, a), {});
assert.deepStrictEqual(byAmount, { 6200: 7, 5720: 3 },
  'seven paid 6,200 and three paid 5,720 — the amounts are not normalised');
assert.strictEqual(TABLE.reduce((n, d) => n + d.amount, 0), 60560,
  'the Lodge holds 60,560 for 2027');
TABLE.forEach(d => {
  assert.ok(d.name && d.name.trim(), 'every entry is named');
  assert.ok(d.amount > 0, d.name + ' must have an amount');
});
assert.strictEqual(new Set(TABLE.map(d => d.name)).size, TABLE.length, 'no name listed twice');
assert.ok(/2027/.test(NOTE) && /advance/i.test(NOTE), 'the note says what the money is');

// --- the guard: a brother who already has a 2027 row is left alone ---
const book = [
  { dueId: 'D01862', memberId: 'M110', year: 2027, amount: 6200, status: 'Paid' },
  { dueId: 'D01863', memberId: 'M081', year: 2027, amount: 6200, status: 'Paid' },
  { dueId: 'D01700', memberId: 'M044', year: 2026, amount: 6200, status: 'Paid' }
];
assert.strictEqual(existing(book, 'M110', 2027).length, 1, 'his row is found');
assert.strictEqual(existing(book, 'M081', 2027).length, 1);
assert.strictEqual(existing(book, 'M044', 2027).length, 0, 'a 2026 row is not a 2027 row');
assert.strictEqual(existing(book, 'M999', 2027).length, 0, 'a stranger has nothing');
assert.strictEqual(existing([], 'M110', 2027).length, 0);
assert.strictEqual(existing(null, 'M110', 2027).length, 0, 'an unread book holds nobody back');

// A row of any status counts: somebody has already been over this year for him.
['Unpaid', 'With Notice', 'Not Applicable', 'Note'].forEach(status => {
  assert.strictEqual(
    existing([{ dueId: 'X', memberId: 'M050', year: 2027, amount: 0, status }], 'M050', 2027).length,
    1, 'a ' + status + ' row for 2027 must still hold the payment back');
});

// Ids and years are compared as values, not as types — the sheet hands
// back a number for one and a string for the other depending on the cell.
assert.strictEqual(existing([{ memberId: 110, year: '2027', amount: 6200, status: 'Paid' }],
  '110', 2027).length, 1, 'a numeric id and a text year must still match');

// --- running it twice records nothing the second time ---
const idOf = d => 'M' + (TABLE.indexOf(d) + 1);
const already = [TABLE[0], TABLE[4]].map((d, i) => ({
  dueId: 'D0186' + i, memberId: idOf(d), year: YEAR, amount: d.amount, status: 'Paid' }));
const firstPass = TABLE.filter(d => !existing(already, idOf(d), YEAR).length);
assert.strictEqual(firstPass.length, TABLE.length - 2, 'the two already in the book are held back');
const afterRun = already.concat(firstPass.map((d, i) => ({
  dueId: 'N' + i, memberId: idOf(d), year: YEAR, amount: d.amount, status: 'Paid' })));
assert.strictEqual(TABLE.filter(d => !existing(afterRun, idOf(d), YEAR).length).length, 0,
  'a second run must record nothing');

console.log('PASS  ' + TABLE.length + ' brethren, ₱' +
  TABLE.reduce((n, d) => n + d.amount, 0).toLocaleString() +
  ' for 2027, and no payment recorded twice');
