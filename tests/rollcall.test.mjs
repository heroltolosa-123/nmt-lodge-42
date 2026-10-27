/* Roll call writes. The one that matters is clearing: a mark set by
   mistake used to be unreachable from the dashboard, so the only way to
   take it off was to open the spreadsheet. An empty code now means
   "no mark for this month" — but a MISSING code must still mean
   "leave this brother alone", or any caller that omits the field would
   quietly wipe the roll. */
import { readFileSync } from 'node:fs';
import assert from 'node:assert';
import { appsScriptDir, appsScriptSource } from './_appsscript.mjs';

const SRC = appsScriptDir() + '/apps-script.js';
const src = readFileSync(SRC, 'utf8');

// Attendance sheet: A id, B memberId, C name, D month, E code, F note
function makeSheet(rows) {
  const grid = rows.map(r => r.slice());
  return {
    grid,
    getLastRow: () => grid.length + 1,
    getRange(row, col, numRows, numCols) {
      if (numRows !== undefined) {
        return { getValues: () => grid.slice(row - 2, row - 2 + numRows).map(r => r.slice(0, numCols)),
                 setValue(){}, setNumberFormat(){} };
      }
      return {
        getValue: () => grid[row - 2][col - 1],
        setValue: v => { grid[row - 2][col - 1] = v; },
        setNumberFormat(){}
      };
    },
    appendRow(r) { grid.push(r.slice()); },
    getRange_: null
  };
}

function run(rows, meetingMonth, entries) {
  const sheet = makeSheet(rows);
  globalThis.SpreadsheetApp = { getActiveSpreadsheet: () => ({ getSheetByName: () => sheet }) };
  globalThis.Session = { getScriptTimeZone: () => 'Asia/Manila' };
  globalThis.Utilities = { formatDate: () => '2026-10-27' };
  globalThis.Logger = { log(){} };
  const api = new Function(src + '; return { saveRollCall_ };')();
  const out = api.saveRollCall_(meetingMonth, entries);
  return { out, grid: sheet.grid };
}

const SEP = new Date(Date.UTC(2026, 8, 1));
const base = () => [
  ['A-001', 'M-1', 'Juan Abad',    new Date(SEP), 'C',  ''],
  ['A-002', 'M-2', 'Gregory Ong',  new Date(SEP), 'NC', ''],
  ['A-003', 'M-3', 'Hero Tolosa',  new Date(Date.UTC(2026, 7, 1)), 'C', '']   // August, must not be touched
];

// ---- an empty code clears that month's mark ------------------------------
let r = run(base(), '2026-09-01', [{ memberId: 'M-1', code: '' }]);
assert.strictEqual(r.grid[0][4], '', 'the mark is taken off');
assert.strictEqual(r.out.cleared, 1, 'and reported as cleared');
assert.strictEqual(r.grid[1][4], 'NC', 'a brother not named is untouched');
assert.strictEqual(r.grid[2][4], 'C', 'and another month is untouched');
console.log('PASS  an empty code clears that one mark and nothing else');

// ---- a MISSING code still means "leave him alone" ------------------------
r = run(base(), '2026-09-01', [{ memberId: 'M-1' }, { memberId: 'M-2', code: 'C' }]);
assert.strictEqual(r.grid[0][4], 'C', 'a brother sent with no code keeps his mark');
assert.strictEqual(r.out.cleared, 0, 'nothing is reported cleared');
assert.strictEqual(r.grid[1][4], 'C', 'the one with a code is updated');
assert.strictEqual(r.out.updated, 1);
console.log('PASS  a missing code leaves the brother exactly as he was');

// ---- clearing a brother who has no row does nothing ----------------------
r = run(base(), '2026-09-01', [{ memberId: 'M-99', code: '' }]);
assert.strictEqual(r.out.cleared, 0, 'there was nothing to clear');
assert.strictEqual(r.grid.length, 3, 'and no row is invented for him');
console.log('PASS  clearing someone with no mark adds nothing');

// ---- a normal update still works -----------------------------------------
r = run(base(), '2026-09-01', [{ memberId: 'M-2', code: 'C' }]);
assert.strictEqual(r.grid[1][4], 'C');
assert.strictEqual(r.out.updated, 1);
assert.strictEqual(r.out.added, 0);
console.log('PASS  an ordinary update is unchanged');

// ---- a new month adds, it does not overwrite another month ---------------
r = run(base(), '2026-10-01', [{ memberId: 'M-1', code: 'C' }]);
assert.strictEqual(r.out.added, 1, 'October is a new row');
assert.strictEqual(r.grid[0][4], 'C', 'September is left alone');
assert.strictEqual(r.grid.length, 4);
console.log('PASS  a different month adds a row rather than overwriting');

// ---- clearing everyone at once, which is what a correction pass looks like
r = run(base(), '2026-09-01', [{ memberId: 'M-1', code: '' }, { memberId: 'M-2', code: '' }]);
assert.strictEqual(r.out.cleared, 2);
assert.strictEqual(r.grid[2][4], 'C', 'August still untouched');
console.log('PASS  a whole month can be cleared without touching other months');

console.log('\nall checks passed');
