/* A recorded payment must move the member's arrears, because good standing is
   worked out from that number. The Dues tab used to be written and never read,
   so a brother who had paid stayed "not in good standing" until somebody
   edited his arrears by hand. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert';

const HERE = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(HERE, '..', '..', 'Noli Me Tangere System', 'appscript', 'apps-script.js'), 'utf8');

// Members: A id ... L arrears(12).  Dues: A id, B memberId ... H raw(8)
const members = [['MemberID'], ['M001', 'Abad', 'Mel Deo', '', 'Mel Deo Abad', 2010, 'Regular', '', 6, 'Y', 'Y', 12400]];
const dues = [['DueID', 'MemberID', 'FullName', 'Year', 'Amount', 'Status', 'Note', 'Raw']];

const sheet = rows => ({
  rows,
  getLastRow: () => rows.length,
  getRange(r, c, nr = 1, nc = 1) {
    return {
      getValues: () => Array.from({ length: nr }, (_, i) =>
        Array.from({ length: nc }, (_, j) => (rows[r - 1 + i] || [])[c - 1 + j] ?? '')),
      getValue: () => (rows[r - 1] || [])[c - 1] ?? '',
      setValue: v => { (rows[r - 1] ||= [])[c - 1] = v; },
      setFormula: f => { (rows[r - 1] ||= [])[c - 1] = f; },
      setNumberFormat: () => {}
    };
  },
  appendRow(r) { rows.push(r); }
});
const sheets = { Members: sheet(members), Dues: sheet(dues) };
globalThis.SpreadsheetApp = { getActiveSpreadsheet: () => ({ getSheetByName: n => sheets[n], getSpreadsheetTimeZone: () => '' }), flush: () => {} };
globalThis.Session = { getScriptTimeZone: () => 'Asia/Manila' };
globalThis.Utilities = { formatDate: () => '2026-10-26' };
globalThis.Logger = { log: () => {} };
const api = new Function(src + '; return { addDue_, goodStandingFor_ };')();

const arrears = () => members[1][11];
const member  = () => ({ status: members[1][6], arrears: arrears() });

assert.strictEqual(arrears(), 12400);
assert.strictEqual(api.goodStandingFor_(member()), 'N', 'owing, so not in good standing');

// --- a part payment moves the balance but does not clear it ---
let r = api.addDue_({ memberId: 'M001', year: 2026, amount: 6200, status: 'Paid', note: 'OR 1234' });
assert.strictEqual(r.arrearsBefore, 12400);
assert.strictEqual(r.arrears, 6200);
assert.strictEqual(arrears(), 6200, 'arrears not reduced');
assert.strictEqual(api.goodStandingFor_(member()), 'N', 'still owing');
assert.ok(String(dues[1][7]).includes('12400'), 'the row must record the balance it moved');
assert.ok(String(dues[1][7]).includes('6200'));
console.log('PASS  part payment: 12,400 ->', arrears());

// --- the rest clears it, and good standing follows by itself ---
r = api.addDue_({ memberId: 'M001', year: 2026, amount: 6200, status: 'Paid' });
assert.strictEqual(arrears(), 0);
assert.strictEqual(api.goodStandingFor_(member()), 'Y', 'paid up, so in good standing');
console.log('PASS  settled: arrears 0, good standing follows without anyone typing it');

// --- the other statuses are remarks, not money ---
for (const status of ['Unpaid', 'With Notice', 'Suspended', 'Not Applicable', 'Note']) {
  const before = arrears();
  const res = api.addDue_({ memberId: 'M001', year: 2026, amount: 5000, status });
  assert.strictEqual(arrears(), before, status + ' must not move the balance');
  assert.strictEqual(res.applied, 0);
}
// a Paid row with no amount is a remark too
api.addDue_({ memberId: 'M001', year: 2026, amount: 0, status: 'Paid' });
assert.strictEqual(arrears(), 0, 'a zero payment must not move the balance');
console.log('PASS  Unpaid / With Notice / Suspended / Not Applicable / Note leave the balance alone');

// --- overpayment leaves a credit rather than being swallowed ---
api.addDue_({ memberId: 'M001', year: 2027, amount: 1500, status: 'Paid' });
assert.strictEqual(arrears(), -1500, 'a credit must be visible');
assert.strictEqual(api.goodStandingFor_(member()), 'Y');
console.log('PASS  overpayment shows as a credit of', arrears());

// --- a payment against nobody is refused, not recorded ---
const rowsBefore = dues.length;
const bad = api.addDue_({ memberId: 'NOPE', year: 2026, amount: 500, status: 'Paid' });
assert.ok(bad.error, 'an unknown member must be refused');
assert.strictEqual(dues.length, rowsBefore, 'nothing may be written for an unknown member');
console.log('PASS  payment against an unknown member refused, nothing written');

console.log('\nall checks passed');
