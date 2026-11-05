/* The payment book checked against the Secretary's Financial Report.

   Eight receipts, seven of which agree with the book to the peso. The
   one that does not is the whole reason this exists, and it is the
   branch that writes — so it is the branch hardest to reach by hand and
   the one most worth pinning here.

   The other thing worth pinning is what this must NOT do. A row in the
   Dues book is a record, not a transaction: correcting an amount here
   changes what the book says and moves no money. A script that quietly
   adjusted a balance while tidying the book is how this project
   over-credited three brethren once already.

   The script lives outside this repository — it names members — so this
   skips rather than fails when it is absent, and names nobody itself. */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert';
import { appsScriptDir, appsScriptSource } from './_appsscript.mjs';

const FILE = 'receipts-2026.js';
if (!existsSync(join(appsScriptDir(), FILE))) {
  console.log('SKIP  ' + FILE + ' is not present (one-off correction, kept out of the repo)');
  process.exit(0);
}

const src = appsScriptSource(FILE);
const api = new Function(src +
  '; return { receiptCheck_, receiptNote_, SFR_OCT_2026_, SFR_OCT_2026_YEAR_ };')();
const { receiptCheck_: check, receiptNote_: note,
        SFR_OCT_2026_: SFR, SFR_OCT_2026_YEAR_: YEAR } = api;

// --- the receipts, as the report records them ---
assert.strictEqual(YEAR, 2027);
assert.strictEqual(SFR.length, 8, 'the October report lists eight annual-dues receipts');
assert.strictEqual(SFR.reduce((n, r) => n + r.amount, 0), 48160,
  'the eight receipts total 48,160 — 24,320 in cash and 23,840 deposited');
const ors = SFR.map(r => r.or);
assert.deepStrictEqual(ors, ['1651','1652','1653','1654','1655','1656','1657','1658'],
  'the receipt numbers run unbroken, which is how a missing one would show');
assert.strictEqual(new Set(ors).size, ors.length, 'no receipt number is used twice');
SFR.forEach(r => {
  assert.ok(r.amount === 6200 || r.amount === 5720,
    r.or + ': the annual dues are 6,200, or 5,720 discounted');
  assert.ok(r.how && r.name, r.or + ' must say who paid and how');
});
assert.strictEqual(new Set(SFR.map(r => r.name)).size, SFR.length, 'no brother listed twice');

// --- a row that agrees, and already cites its receipt ---
const row = (over = {}) => Object.assign(
  { sheetRow: 9, dueId: 'D01863', memberId: 'M081', year: 2027,
    amount: 6200, status: 'Paid', note: '', stamp: '' }, over);
const want = { name: 'x', amount: 5720, or: '1657', how: 'deposited, senior discount' };

assert.strictEqual(check([row({ amount: 5720, note: 'OR 1657, deposited' })], want).state,
  'agrees', 'the right figure with its receipt already cited needs nothing');

// --- a row that agrees but says nothing about where its figure came from ---
let out = check([row({ amount: 5720 })], want);
assert.strictEqual(out.state, 'agrees-unnoted');
assert.strictEqual(out.row.dueId, 'D01863');

// --- the one that disagrees: 6,200 in the book, 5,720 on the receipt ---
out = check([row()], want);
assert.strictEqual(out.state, 'differs');
assert.strictEqual(out.from, 6200);
assert.strictEqual(out.to, 5720);
assert.strictEqual(out.from - out.to, 480, 'the senior discount');

// A sheet hands back a number for one cell and text for the next.
assert.strictEqual(check([row({ amount: '6200' })], want).state, 'differs');
assert.strictEqual(check([row({ amount: '5720' })], want).state, 'agrees-unnoted',
  'a text amount that matches is a match, not a correction');

// --- no row yet: reported as waiting, never invented ---
assert.strictEqual(check([], want).state, 'waiting');
assert.strictEqual(check(null, want).state, 'waiting');
assert.strictEqual(check(undefined, want).state, 'waiting');

// --- two rows for one year: refused, not guessed at ---
out = check([row(), row({ dueId: 'D01999', sheetRow: 40 })], want);
assert.strictEqual(out.state, 'ambiguous');
assert.strictEqual(out.rows.length, 2);
assert.ok(!('to' in out), 'an ambiguous year must produce no correction at all');

// --- the note keeps what was already there ---
assert.match(note('', want), /^OR 1657, deposited, senior discount \(SFR October 2026\)$/);
assert.match(note('Annual dues for 2027', want), /^Annual dues for 2027 \| OR 1657/,
  'an existing note is kept, not replaced');

/* --- it must touch the book and nothing else ---
   Column 5 is Amount and column 7 is Note on the Dues tab. Column 12 on
   Members is the balance, and this script has no business there. */
const cols = [...src.matchAll(/getRange\([^)]*\)\.setValue/g)].length;
assert.ok(cols > 0, 'it writes something');
assert.ok(!/getSheetByName\(['"]Members['"]\)/.test(src),
  'the receipts script must never open the Members sheet — balances are balanceApply()');
[...src.matchAll(/dues\.getRange\(out\.row\.sheetRow,\s*(\d+)\)/g)].forEach(m =>
  assert.ok(m[1] === '5' || m[1] === '7',
    'it may write the Amount (5) and the Note (7), not column ' + m[1]));

console.log('PASS  ' + SFR.length + ' receipts totalling ₱' +
  SFR.reduce((n, r) => n + r.amount, 0).toLocaleString() +
  ', one amount corrected by 480, and no balance touched');
