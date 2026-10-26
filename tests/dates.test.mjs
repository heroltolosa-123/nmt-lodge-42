/* Meeting dates are stored as whole spreadsheet serials, not Date objects.
   A Date is midnight in the SCRIPT's timezone; read against the spreadsheet's
   own clock it can land on the last day of the previous month, which made
   COUNTIFS miss every March — the first month of the lodge year, and the
   best-attended meeting of the year. A whole number has no timezone. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert';
const HERE = dirname(fileURLToPath(import.meta.url));
globalThis.SpreadsheetApp = { getActiveSpreadsheet: () => ({ getSheetByName: () => null, getSpreadsheetTimeZone: () => '' }) };
globalThis.Session = { getScriptTimeZone: () => 'Asia/Manila' };
globalThis.Utilities = {};
globalThis.Logger = { log: () => {} };
const main = readFileSync(join(HERE, '..', '..', 'Noli Me Tangere System', 'appscript', 'apps-script.js'), 'utf8');
eval(main + '\nglobalThis.monthSerial_ = monthSerial_;');

// Serials Google Sheets is known to produce (epoch 1899-12-30 = 0)
const KNOWN = [[1900,1,2],[2000,1,36526],[2024,1,45292],[2025,1,45658],[2026,1,46023],[2026,3,46082],[2027,3,46447]];
for (const [y,m,want] of KNOWN) {
  const got = monthSerial_(y,m);
  console.log(`${y}-${String(m).padStart(2,'0')}-01 -> ${got} (expected ${want})`);
  assert.strictEqual(got, want, `serial wrong for ${y}-${m}`);
}
// whole numbers only — this is the whole point
for (let y=2017; y<=2030; y++) for (let m=1; m<=12; m++)
  assert.ok(Number.isInteger(monthSerial_(y,m)), `non-integer serial at ${y}-${m}`);

// EDATE(DATE(2026,3,1),12) == DATE(2027,3,1): a March row must sit ON the lower
// bound and strictly below the upper one, which is what COUNTIFS tests.
const s = monthSerial_(2026,3), end = monthSerial_(2027,3);
assert.ok(s >= s && s < end, 'March fails its own term boundary');
for (const m of [3,4,5,6,7,8,9,10,11,12]) {
  const v = monthSerial_(2026,m);
  assert.ok(v >= s && v < end, `${2026}-${m} outside the term`);
}
for (const [y,m] of [[2026,1],[2026,2],[2027,3]]) {
  const v = monthSerial_(y,m);
  assert.ok(!(v >= s && v < end), `${y}-${m} wrongly inside the term`);
}
// round-trip: serial -> month must return the same month
for (let y=2024; y<=2027; y++) for (let m=1; m<=12; m++) {
  const back = new Date(Date.UTC(1899,11,30) + monthSerial_(y,m)*86400000);
  assert.strictEqual(back.getUTCFullYear(), y);
  assert.strictEqual(back.getUTCMonth()+1, m);
}
console.log('PASS  serials are whole numbers, match Sheets, and bracket the lodge year');
