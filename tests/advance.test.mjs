/* Posting a dues payment onto a brother's balance, and reversing a
   posting made in error. It moves money, so it gets a check.

   The scoping test below is the one that matters. An earlier version of
   this script posted every unstamped row marked Paid belonging to a
   named member. The Dues book holds a row per brother per year and the
   legacy rows carry no stamp either, so three payments of 6,200 became
   something near 122,000 in credit. Posting is by Due ID now, and the
   first assertions here are the ones that would have caught it.

   The script itself is a one-off correction that lives outside this
   repository — it names members, and this repository is public — so the
   test skips rather than fails when it is not there. */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert';
import { appsScriptDir, appsScriptSource } from './_appsscript.mjs';

const FILE = 'advance-2026.js';
if (!existsSync(join(appsScriptDir(), FILE))) {
  console.log('SKIP  ' + FILE + ' is not present (one-off correction, kept out of the repo)');
  process.exit(0);
}

const SRC = appsScriptSource(FILE);
const api = new Function(SRC +
  '; return { advancePlan_, advanceReversal_, advanceCorrections_, POSTED_RE_,' +
  ' ADVANCE_STAMP_RE_, ADVANCE_DUE_IDS_, ADVANCE_CORRECT_ };')();
const { advancePlan_: plan, advanceReversal_: reversal, advanceCorrections_: corrections,
        POSTED_RE_: POSTED, ADVANCE_STAMP_RE_: MINE,
        ADVANCE_DUE_IDS_: IDS, ADVANCE_CORRECT_: TARGETS } = api;

const row = (o) => Object.assign(
  { sheetRow: 2, dueId: 'D1', memberId: 'M081', fullName: 'A Brother',
    year: 2027, amount: 6200, status: 'Paid', note: '', stamp: '' }, o);

// --- THE SCOPING FAULT: a member's other years must never be posted ---
// One brother, ten years of legacy dues, all marked Paid, none stamped.
// Only the row that was asked for may move.
const book = [];
for (let y = 2017; y <= 2026; y++) {
  book.push(row({ sheetRow: book.length + 2, dueId: 'L' + y, year: y, stamp: '6200' }));
}
book.push(row({ sheetRow: book.length + 2, dueId: 'D01863', year: 2027, stamp: '6200' }));

const picked = plan(book, ['D01863']).filter(p => !p.skip);
assert.strictEqual(picked.length, 1, 'exactly one row may be posted');
assert.strictEqual(picked[0].dueId, 'D01863');
assert.strictEqual(picked.reduce((n, p) => n + p.row.amount, 0), 6200,
  'ten legacy years must not come along: 6,200, not 68,200');

// --- a Due ID that is not in the book is reported, not invented ---
assert.strictEqual(plan(book, ['NOPE'])[0].skip, 'no row with that Due ID');

// --- only money marked Paid, with an amount, and not already posted ---
const guards = [
  [row({ dueId: 'A', status: 'With Notice' }), /not Paid/],
  [row({ dueId: 'B', status: 'Unpaid' }),      /not Paid/],
  [row({ dueId: 'C', amount: 0 }),             /no amount/],
  [row({ dueId: 'D', amount: -500 }),          /no amount/],
  [row({ dueId: 'E', stamp: 'Paid via dashboard on 2026-10-27; arrears 0 → -6200' }),
                                               /already posted/],
  [row({ dueId: 'F', stamp: 'Posted by advance-2026 on 2026-11-02; arrears 0 → -6200' }),
                                               /already posted/]
];
guards.forEach(([r, re]) => {
  const p = plan([r], [r.dueId])[0];
  assert.ok(p.skip && re.test(p.skip), r.dueId + ' should be skipped, got ' + p.skip);
});
// ...and a plain legacy row IS postable, which is exactly why the Due ID matters
assert.ok(!plan([row({ dueId: 'G', stamp: '6200' })], ['G'])[0].skip);

// --- the stamps are told apart ---
assert.ok(POSTED.test('Paid via dashboard on 2026-10-30; arrears 6200 → 0'));
assert.ok(!POSTED.test('Added via dashboard on 2026-03-01'));
assert.ok(!POSTED.test('6200'), 'a legacy raw value is not a posting');
assert.ok(MINE.test('Posted by advance-2026 on 2026-11-02; arrears 0 → -6200'));
assert.ok(!MINE.test('Paid via dashboard on 2026-10-30; arrears 6200 → 0'),
  'reversing this script must never unwind a payment the dashboard took');

// --- THE REVERSAL: restore the balance the brother had before any of it ---
// What the broken run left behind: ten rows chained off 0, ending at -62000.
const wrecked = [];
let running = 0;
for (let y = 2017; y <= 2026; y++) {
  const after = running - 6200;
  wrecked.push(row({ sheetRow: wrecked.length + 2, dueId: 'L' + y, year: y,
    stamp: 'Posted by advance-2026 on 2026-11-02; arrears ' + running + ' → ' + after }));
  running = after;
}
const plans = reversal(wrecked);
assert.strictEqual(plans.length, 1, 'one brother');
assert.strictEqual(plans[0].restoreTo, 0, 'restores the balance before the first posting');
assert.strictEqual(plans[0].rows.length, 10, 'every row it stamped is unstamped');
assert.strictEqual(running, -62000, 'the damage this reverses');

// Two brethren, interleaved, each restored to his own starting balance.
const mixed = [
  row({ sheetRow: 2, dueId: 'X1', memberId: 'M081', stamp: 'Posted by advance-2026 on 2026-11-02; arrears 0 → -6200' }),
  row({ sheetRow: 3, dueId: 'Y1', memberId: 'M082', stamp: 'Posted by advance-2026 on 2026-11-02; arrears 12400 → 6200' }),
  row({ sheetRow: 4, dueId: 'X2', memberId: 'M081', stamp: 'Posted by advance-2026 on 2026-11-02; arrears -6200 → -12400' }),
  row({ sheetRow: 5, dueId: 'Z1', memberId: 'M110', stamp: 'Paid via dashboard on 2026-10-27; arrears 0 → -6200' })
];
const two = reversal(mixed);
assert.deepStrictEqual(two.map(p => [p.memberId, p.restoreTo]), [['M081', 0], ['M082', 12400]]);
assert.strictEqual(two[0].rows.length, 2);
assert.ok(!two.some(p => p.memberId === 'M110'),
  'a payment the dashboard posted properly must be left alone');

// --- nothing stamped, nothing to reverse ---
assert.deepStrictEqual(reversal([row({ stamp: '6200' })]), []);
assert.deepStrictEqual(reversal([]), []);

// --- the three rows this run is actually for ---
assert.deepStrictEqual(IDS, ['D01862', 'D01863', 'D01864']);

/* --- SETTING A BALANCE OUTRIGHT ---
   Each of the three paid a year ahead, so each should hold that year's
   dues in credit and no more. A balance already right is left alone
   rather than rewritten, so the Remarks note is only ever added when
   something actually moved.

   Two of the three were out of this table while the only evidence was
   the Secretary's workbook, whose year columns for them stop at 2026.
   The Financial Report for October 2026 names all three by official
   receipt number, so all three are in now — and it puts one of them at
   the senior rate, 480 below what his Dues row says. The receipt is
   what he handed over. */
assert.strictEqual(TARGETS.length, 3, 'three brethren paid a year ahead');
assert.ok(TARGETS.every(t => t.shouldBe < 0), 'each is in credit, not in debt');
assert.deepStrictEqual(TARGETS.map(t => t.shouldBe).sort((a, b) => a - b),
  [-6200, -6200, -5720], 'two at the full year, one at the senior rate');
TARGETS.forEach(t => assert.ok(/OR \d{4}/.test(t.why),
  t.memberId + ': a balance set by hand must cite the receipt that justifies it'));
assert.strictEqual(new Set(TARGETS.map(t => t.memberId)).size, 3, 'no member listed twice');

/* The expect guard is a substring of the roll's name, and it is the only
   thing standing between an ID one digit out and a stranger's balance.
   The names themselves are not written down here — this repository is
   public — and they do not need to be: balanceRun_ reads the live roll
   and refuses when the name it finds does not contain the guard. What
   has to hold HERE is that no guard is loose enough to match another
   target's, which is the way two brethren of one family defeat it. */
TARGETS.forEach(t => {
  assert.ok(t.expect && t.expect.trim().length >= 4,
    t.memberId + ': a guard that short would match half the roll');
  TARGETS.filter(o => o !== t).forEach(o =>
    assert.ok(!o.expect.toLowerCase().includes(t.expect.toLowerCase()),
      t.memberId + ': its guard is contained in ' + o.memberId + "'s, so a wrong ID " +
      'could rewrite the wrong brother'));
});
assert.match(SRC, /expected a brother named/,
  'balanceRun_ must still refuse when the roll disagrees with the guard');

let c = corrections({ M110: -18600, M081: -6200, M082: -6200 }, TARGETS);
assert.strictEqual(c.length, 3);
assert.strictEqual(c[0].from, -18600);
assert.strictEqual(c[0].to, -6200);
assert.strictEqual(c[0].change, 12400, 'three years of credit back down to one');
assert.ok(!c[0].settled);
// the senior discount: 6,200 of credit on the books, 5,720 actually paid
assert.strictEqual(c[1].change, 480, 'the 480 he never paid comes back off his credit');
assert.ok(c[2].settled, 'the third is already right and is left alone');

// already right: reported, not rewritten, so no Remarks note is added
c = corrections({ M110: -6200, M081: -5720, M082: -6200 }, TARGETS);
assert.ok(c.every(x => x.settled), 'a second run moves nothing');
assert.ok(c.every(x => x.change === undefined));

// a balance moving the other way — someone owing, set to a credit
assert.strictEqual(corrections({ M110: 6200 }, TARGETS)[0].change, -12400);

// a member who is not on the roll is reported, never invented
assert.strictEqual(corrections({ M081: -5720 }, TARGETS)[0].skip, 'not on the roll');

// nil is a real balance, not a missing one
assert.strictEqual(corrections({ M110: 0 }, TARGETS)[0].change, -6200);

// --- a retired stamp must not be readable as a posting any more ---
const retired = 'Superseded on 2026-11-02; balance set by hand to -6200. Earlier posting ' +
  'stamp: Posted by advance-2026 on 2026-11-02; arrears -12400 \u2192 -18600';
assert.ok(!MINE.test(retired), 'advanceUndo must not wind back an overruled balance');

console.log('PASS  posts only the named rows, reverses cleanly, and sets the ' +
  TARGETS.length + ' balances the October receipts confirm');
