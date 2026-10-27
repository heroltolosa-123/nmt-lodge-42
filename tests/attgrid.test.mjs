/* The attendance grid's arithmetic, taken from index.html itself so it
   cannot drift from what the page actually runs. */
import assert from 'node:assert';
import fs from 'node:fs';

const SRC = '/Users/bogart/Downloads/Noli Me Tangere System/nmt-lodge-42/index.html';
const src = fs.readFileSync(SRC, 'utf8');

function grab(name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('could not find ' + name);
  const end = src.indexOf('\n}', start);
  return src.slice(start, end + 2);
}

const ctx = {};
new Function('ctx', [
  "const ATT_MONTH_NAMES = ['Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb'];",
  "const ATT_COUNTED = new Set(['C','NO','NC']);",
  "const MONTH_INDEX = {jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};",
  grab('attTermMonths'), grab('attMoney'), grab('attGroupByMonth'),
  grab('monthKey'), grab('attStored'),
  "ctx.attTermMonths = attTermMonths; ctx.attMoney = attMoney;",
  "ctx.attGroupByMonth = attGroupByMonth; ctx.attStored = attStored;",
  "ctx.ATT_COUNTED = ATT_COUNTED;"
].join('\n'))(ctx);

// ---- a lodge year runs March to February ---------------------------------
const months = ctx.attTermMonths(2026);
assert.strictEqual(months.length, 12);
assert.strictEqual(months[0].key, '2026-03', 'it opens in March of the starting year');
assert.strictEqual(months[9].key, '2026-12', 'December is still the starting year');
assert.strictEqual(months[10].key, '2027-01', 'January belongs to the NEXT calendar year');
assert.strictEqual(months[11].key, '2027-02', 'and it closes in February');
assert.deepStrictEqual(months.map(m => m.label),
  ['Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb']);
console.log('PASS  a lodge year runs March to February, and January rolls the year');

// ---- which codes count ---------------------------------------------------
for (const c of ['C', 'NO', 'NC']) assert.ok(ctx.ATT_COUNTED.has(c), c + ' must count');
for (const c of ['NP', '', 'x']) assert.ok(!ctx.ATT_COUNTED.has(c), JSON.stringify(c) + ' must not count');
console.log('PASS  C, NO and NC count toward the six; NP and a blank do not');

// ---- money paid ahead reads as credit, not as a debt ---------------------
assert.strictEqual(ctx.attMoney(0), '₱0');
assert.strictEqual(ctx.attMoney(6200), '₱6,200');
assert.strictEqual(ctx.attMoney(-6200), '₱6,200 ahead', 'a credit must not read as a negative debt');
console.log('PASS  a credit is shown as money ahead, never as minus');

// ---- the sheet's own months are read back by key -------------------------
const stored = ctx.attStored({ months: [
  { month: 'Mar 2026', value: 'C' },
  { month: 'Apr 2026', value: 'NP' },
  { month: 'Jan 2027', value: 'NC' },
  { month: 'rubbish',  value: 'C' }     // unparseable: dropped, never guessed
]});
assert.strictEqual(stored['2026-03'], 'C');
assert.strictEqual(stored['2026-04'], 'NP');
assert.strictEqual(stored['2027-01'], 'NC', 'January of the next calendar year is kept straight');
assert.strictEqual(Object.keys(stored).length, 3, 'an unreadable label is dropped, not guessed at');
console.log('PASS  stored months are keyed correctly and bad labels are dropped');

// ---- edits are grouped per month, and a blank survives -------------------
const edits = new Map([
  ['M-1|2026-03', 'C'],
  ['M-2|2026-03', ''],          // a correction: take the mark off
  ['M-1|2026-04', 'NC']
]);
const grouped = ctx.attGroupByMonth(edits);
assert.strictEqual(grouped.size, 2, 'two months touched means two writes');
assert.deepStrictEqual(grouped.get('2026-03'),
  [{ memberId: 'M-1', code: 'C' }, { memberId: 'M-2', code: '' }]);
assert.ok(grouped.get('2026-03').some(e => e.code === ''),
  'an emptied cell must keep its empty code or the correction is lost');
assert.deepStrictEqual(grouped.get('2026-04'), [{ memberId: 'M-1', code: 'NC' }]);
console.log('PASS  edits group into one write per month, blanks included');

// ---- a member id containing a bar must not corrupt the month -------------
const odd = ctx.attGroupByMonth(new Map([['M|odd|2026-05', 'C']]));
assert.deepStrictEqual(odd.get('2026-05'), [{ memberId: 'M|odd', code: 'C' }],
  'the month is the fixed-shape half, so the key splits at the LAST bar');
console.log('PASS  an odd member id cannot corrupt the month a write goes to');

console.log('\nall checks passed');
