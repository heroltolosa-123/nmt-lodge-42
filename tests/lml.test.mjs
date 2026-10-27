/* Taking Life Membership out of the Status column.

   The honour is the Grand Lodge's to confer, so the failure that matters
   is not a missing flag — it is inventing one, or revoking one while
   tidying up. These checks are mostly about what the migration refuses
   to touch. */
import assert from 'node:assert';
import { appsScriptDir, appsScriptSource } from './_appsscript.mjs';
import { readFileSync } from 'node:fs';

const main = appsScriptSource();
const migration = readFileSync(appsScriptDir() + '/lml-migration.js', 'utf8');

const V = 22;   // column V
function makeSheet(rows, header) {
  const grid = rows.map(r => { const c = r.slice(); while (c.length < V) c.push(''); return c; });
  const head = header || [];
  while (head.length < V) head.push('');
  return {
    grid, head,
    getLastRow: () => grid.length + 1,
    getRange(row, col, numRows, numCols) {
      if (numRows !== undefined) {
        return { getValues: () => grid.slice(row - 2, row - 2 + numRows).map(r => r.slice(0, numCols)) };
      }
      const cells = row === 1 ? head : grid[row - 2];
      return {
        getValue: () => cells[col - 1],
        setValue: v => { cells[col - 1] = v; },
        getFontWeight: () => 'bold',
        setFontWeight() {}
      };
    }
  };
}

// A member row: A id, B surname, C first, D middle, E fullName, F yearRaised, G status
const member = (id, name, status, flag) => {
  const r = [id, name.split(' ').slice(-1)[0], name.split(' ')[0], '', name, 2010, status];
  while (r.length < V) r.push('');
  if (flag) r[V - 1] = flag;
  return r;
};

function run(rows, apply, header) {
  const sheet = makeSheet(rows, header);
  const lines = [];
  globalThis.SpreadsheetApp = { getActiveSpreadsheet: () => ({ getSheetByName: () => sheet }) };
  globalThis.Session = { getScriptTimeZone: () => 'Asia/Manila' };
  globalThis.Utilities = { formatDate: () => '2026-10-27' };
  globalThis.Logger = { log: m => lines.push(String(m)) };
  const api = new Function(main + '\n' + migration + '; return { lmlPreview, lmlApply, loadMembers_ };')();
  const out = apply ? api.lmlApply() : api.lmlPreview();
  return { out, lines, sheet, api };
}

const ROWS = () => [
  member('M-1', 'Arnel Cantos',  'LML'),
  member('M-2', 'Juan Abad',     'Regular'),
  member('M-3', 'Arturo Medrano','LML or Suspended?'),
  member('M-4', 'Gary Lim',      'LML'),
  member('M-5', 'Jonathan Ureta','Deceased'),
  member('M-6', 'Old Life',      'Regular', 'Y')      // already migrated
];

// ---- preview writes nothing ---------------------------------------------
let r = run(ROWS(), false);
assert.strictEqual(r.sheet.grid[0][6], 'LML', 'the Status column is untouched by a preview');
assert.strictEqual(r.sheet.grid[0][V - 1], '', 'and column V is untouched too');
assert.strictEqual(r.out.moved, 2, 'it says it would move two');
console.log('PASS  a preview reports two to move and writes nothing');

// ---- applying moves exactly the exact-LML rows ---------------------------
r = run(ROWS(), true);
assert.strictEqual(r.sheet.grid[0][V - 1], 'Y', 'Cantos gets the flag');
assert.strictEqual(r.sheet.grid[0][6], 'Regular', 'and his standing becomes Regular');
assert.strictEqual(r.sheet.grid[3][V - 1], 'Y', 'Lim gets the flag');
assert.strictEqual(r.out.moved, 2);
console.log('PASS  a Status of exactly LML moves to column V and leaves Regular behind');

// ---- the ones it must NOT touch -----------------------------------------
assert.strictEqual(r.sheet.grid[2][6], 'LML or Suspended?', 'Medrano is left exactly as he was');
assert.strictEqual(r.sheet.grid[2][V - 1], '', 'and no honour is invented for him');
assert.ok(r.out.queried.some(q => /Medrano/.test(q)), 'but he is reported by name');
assert.strictEqual(r.sheet.grid[1][6], 'Regular', 'an ordinary brother is untouched');
assert.strictEqual(r.sheet.grid[1][V - 1], '', 'and gains nothing');
assert.strictEqual(r.sheet.grid[4][6], 'Deceased', 'a deceased brother keeps his standing');
console.log('PASS  "LML or Suspended?" is reported, never guessed, and others are untouched');

// ---- the heading is written once ----------------------------------------
assert.strictEqual(r.sheet.head[V - 1], 'LML', 'column V gets a name');
const named = run(ROWS(), true, (() => { const h = []; h[V - 1] = 'LML'; return h; })());
assert.ok(!named.lines.some(l => /heading of column V/.test(l)), 'and is not rewritten when already named');
console.log('PASS  the column is given a heading, once');

// ---- running it twice changes nothing ------------------------------------
const after = r.sheet.grid.map(x => x.slice());
const again = run(after, true);
assert.strictEqual(again.out.moved, 0, 'nothing left to move');
assert.strictEqual(again.sheet.grid[0][6], 'Regular', 'and nothing is disturbed');
console.log('PASS  running the migration twice moves nothing further');

// ---- the site reads the flag, and still reads the old way before migration
const before = run(ROWS(), false);
let read = before.api.loadMembers_();
assert.strictEqual(read.find(m => m.memberId === 'M-1').lml, 'Y',
  'BEFORE migration a Status of LML must still read as a Life Member');
assert.strictEqual(read.find(m => m.memberId === 'M-6').lml, 'Y',
  'and a flag already in column V is honoured');
assert.strictEqual(read.find(m => m.memberId === 'M-2').lml, 'N');

read = run(after, false).api.loadMembers_();
assert.strictEqual(read.find(m => m.memberId === 'M-1').lml, 'Y',
  'AFTER migration the flag carries the honour');
assert.strictEqual(read.find(m => m.memberId === 'M-1').status, 'Regular');
console.log('PASS  a Life Member reads as one both before and after the migration');

// ---- the whole point: he can now be a Life Member AND deceased ----------
const both = after.map(x => x.slice());
both[0][6] = 'Deceased';                   // the ordinary edit that used to destroy it
read = run(both, false).api.loadMembers_();
const c = read.find(m => m.memberId === 'M-1');
assert.strictEqual(c.status, 'Deceased');
assert.strictEqual(c.lml, 'Y', 'marking a Life Member deceased must no longer revoke the honour');
console.log('PASS  marking a Life Member deceased no longer revokes his Life Membership');

console.log('\nall checks passed');
