/* The Attendance grid's month range, and the export buttons that sit under
   every list in the dashboard.

   The range matters because the grid is a column per month: a span that
   rolls across a year boundary, one entered back to front, and one wider
   than the page can draw all have to come out right, and none of them is
   obvious from reading the code. Three of the months the Lodge cares most
   about — December, January, February — are exactly the ones on the far
   side of a year boundary.

   The export check is structural: an empty row of buttons looks like a
   styling bug and is actually a missing call, so every export row placed
   in the page must have a wireExport for it and vice versa. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert';
const HERE = dirname(fileURLToPath(import.meta.url));

const html = readFileSync(join(HERE, '..', 'index.html'), 'utf8');
const js = html.match(/<script>([\s\S]*)<\/script>/)[1];
const grab = name => {
  const i = js.indexOf(name);
  assert.ok(i > -1, 'missing ' + name);
  let depth = 0, started = false;
  for (let p = i; p < js.length; p++) {
    if (js[p] === '{') { depth++; started = true; }
    else if (js[p] === '}') { depth--; if (started && depth === 0) return js.slice(i, p + 1); }
  }
  throw new Error('unbalanced ' + name);
};

const api = new Function(
  "const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];\n" +
  'const ATT_MAX_MONTHS = 36;\n' +
  ['function attMonthCell', 'function attMonthRange', 'function attTermMonths'].map(grab).join('\n') +
  '; return { attMonthCell, attMonthRange, attTermMonths, MONTH_SHORT, ATT_MAX_MONTHS };')();
const { attMonthRange: range, attTermMonths: term, ATT_MAX_MONTHS: CAP } = api;

const keys = list => list.map(mo => mo.key);

// --- the page's own declarations must still say this ---
assert.ok(js.includes('const ATT_MAX_MONTHS = 36;'), 'the column cap moved');
assert.ok(js.includes("const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];"),
  'MONTH_SHORT moved or is no longer calendar-ordered');

// --- a lodge year ---
const t = term(2026);
assert.strictEqual(t.length, 12);
assert.deepStrictEqual(keys(t), ['2026-03','2026-04','2026-05','2026-06','2026-07','2026-08',
  '2026-09','2026-10','2026-11','2026-12','2027-01','2027-02'],
  'March to the February following it');
assert.strictEqual(t[0].label, 'Mar');
assert.strictEqual(t[11].label, 'Feb');
assert.strictEqual(t[11].year, 2027, 'February belongs to the next calendar year');
t.forEach(mo => assert.strictEqual(mo.label, api.MONTH_SHORT[Number(mo.key.slice(5)) - 1],
  'the label on a column must name the month in its key'));

// --- one month is one column ---
assert.deepStrictEqual(keys(range('2026-10', '2026-10')), ['2026-10']);

// --- across a year boundary, which is where an off-by-one hides ---
assert.deepStrictEqual(keys(range('2026-11', '2027-02')),
  ['2026-11', '2026-12', '2027-01', '2027-02']);
assert.deepStrictEqual(keys(range('2026-12', '2027-01')), ['2026-12', '2027-01'],
  'December to January is two months, not eleven');

// --- entered back to front is a slip, not a request for nothing ---
assert.deepStrictEqual(range('2027-02', '2026-11'), range('2026-11', '2027-02'));

// --- one end only means that one month; the caller opens it out ---
assert.deepStrictEqual(keys(range('2026-05', '')), ['2026-05']);
assert.deepStrictEqual(keys(range('', '2026-05')), ['2026-05']);
assert.deepStrictEqual(range('', ''), [], 'nothing asked for is nothing shown');
assert.deepStrictEqual(range(null, undefined), []);

// --- rubbish in does not loop forever or invent columns ---
assert.deepStrictEqual(range('not-a-month', '2026-05'), [],
  'an unparseable bound gives nothing rather than a guess');

// --- the cap ---
const wide = range('2000-01', '2030-12');
assert.strictEqual(wide.length, CAP, 'a span wider than the cap is cut to it');
assert.strictEqual(wide[0].key, '2000-01', 'cut from the far end, keeping the start');
assert.strictEqual(range('2000-01', '2030-12', 1e4).length, 31 * 12,
  'the cap is a parameter, so the true length can still be measured');
assert.strictEqual(range('2026-01', '2026-12', 1).length, 1);

// --- every export row in the page is wired, and every wiring has a row ---
const rows = [...html.matchAll(/class="export-row" id="([a-z-]+)"/g)].map(m => m[1]);
const wired = [...js.matchAll(/wireExport\('([a-z-]+)'/g)].map(m => m[1]);
assert.ok(rows.length >= 8, 'the dashboard should carry an export on every screen with a list');
assert.deepStrictEqual([...rows].sort(), [...wired].sort(),
  'an export row with no wireExport renders an empty strip, and a wireExport with no row ' +
  'silently does nothing');
assert.strictEqual(new Set(rows).size, rows.length, 'an id is used once');

/* The accounts export is the one that could leak something, so it is
   pinned to the fields it may read. A password, a hash, an invitation
   token or a brother's email address reaching a cell would be a quiet
   disclosure in a file somebody then emails on. */
const acct = grab('function accountsExportBuild');
const ALLOWED = new Set(['label', 'chair', 'canEdit', 'state', 'invitePending', 'requestedBy']);
const read = [...acct.matchAll(/\bc\.([A-Za-z_$][\w$]*)/g)].map(m => m[1]);
assert.ok(read.length, 'the export reads something');
read.forEach(f => assert.ok(ALLOWED.has(f),
  'accountsExportBuild reads c.' + f + ', which is not on the list of fields it may export'));

// requestedBy IS an email address. It may say whether a brother asked for
// a link; it must never be the thing written into the cell.
[...acct.matchAll(/[^\n]*c\.requestedBy[^\n]*/g)].forEach(line =>
  assert.match(line[0], /yn\(c\.requestedBy \? 'Y' : 'N'\)/,
    'an email address must leave this export as Y or N, never as itself: ' + line[0].trim()));

assert.ok(!/data\.link|\.token|passwordHash/.test(acct),
  'no link, token or hash may be read by the accounts export');

console.log('PASS  month ranges roll across years and stop at ' + CAP +
  ', and all ' + rows.length + ' export rows are wired');
