/* Reports tab: the Excel workbook writer and the attendance date filter.
   Both are pulled out of index.html itself, so this tests what ships rather
   than a copy that can drift. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert';
const HERE = dirname(fileURLToPath(import.meta.url));

// Pull the real inlined code out of index.html so this tests what ships.
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
const grabIife = name => {
  const i = js.indexOf(name);
  const end = js.indexOf('})();', i);
  assert.ok(i > -1 && end > i, 'missing iife ' + name);
  return js.slice(i, end + 5);
};
const src = [grabIife('const CRC_TABLE')].concat(['function crc32','function xmlEscape','function colName',
             'function safeSheetName','function sheetXml','function buildXlsx','function zip(',
             'function monthKey','function currentTermRange'].map(grab)).join('\n');
const MONTH_INDEX = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
const mod = new Function('MONTH_INDEX', src + '; return {buildXlsx, monthKey, currentTermRange, safeSheetName};')(MONTH_INDEX);

// --- monthKey ---
assert.strictEqual(mod.monthKey('Mar 2026'), '2026-03');
assert.strictEqual(mod.monthKey('Sep 2017'), '2017-09');
assert.strictEqual(mod.monthKey('December 2025'), '2025-12');
assert.strictEqual(mod.monthKey('rubbish'), null);
assert.strictEqual(mod.monthKey(''), null);
console.log('monthKey: Mar 2026 ->', mod.monthKey('Mar 2026'), '| sorts correctly:',
  ['Oct 2025','Mar 2026','Feb 2026'].map(mod.monthKey).sort().join(' < '));

// --- the range test the UI performs ---
const months = ['Dec 2024','Mar 2025','Nov 2025','Dec 2025','Mar 2026','Jun 2026','Sep 2026'];
const inRange = (from, to) => months.filter(l => {
  const k = mod.monthKey(l);
  if (from && (!k || k < from)) return false;
  if (to && (!k || k > to)) return false;
  return true;
});
assert.deepStrictEqual(inRange('2026-03','2027-02'), ['Mar 2026','Jun 2026','Sep 2026']);
assert.deepStrictEqual(inRange('','2025-12'), ['Dec 2024','Mar 2025','Nov 2025','Dec 2025']);
assert.deepStrictEqual(inRange('2026-01',''), ['Mar 2026','Jun 2026','Sep 2026']);
assert.deepStrictEqual(inRange('',''), months);
console.log('range filter: Mar2026-Feb2027 ->', inRange('2026-03','2027-02').join(', '));

// --- lodge year preset: March to February ---
const t = mod.currentTermRange();
assert.ok(/^\d{4}-03$/.test(t.from) && /^\d{4}-02$/.test(t.to), 'term range shape: ' + JSON.stringify(t));
assert.strictEqual(Number(t.to.slice(0,4)) - Number(t.from.slice(0,4)), 1);
console.log('this lodge year:', t.from, '->', t.to);

// --- sheet names Excel would refuse ---
const taken = new Set();
assert.strictEqual(mod.safeSheetName('Attendance', taken), 'Attendance');
assert.strictEqual(mod.safeSheetName('Attendance', taken), 'Attendance (2)');
assert.ok(!/[\\\/\?\*\[\]:]/.test(mod.safeSheetName('A/B:C*D?[E]', new Set())));
assert.ok(mod.safeSheetName('x'.repeat(60), new Set()).length <= 31);

// --- a workbook shaped like the real export ---
const bytes = mod.buildXlsx([
  { name:'Roster', header:['Member ID','Full name','Arrears'],
    rows:[['M001','Mel Deo H Abad',12400],['M002','=cmd|evil',0],['M003','Ñoño <&> "quoted"',0]] },
  { name:'Attendance', header:['Member ID','Full name','Month','Sortable month','Code'],
    rows:[['M001','Mel Deo H Abad','Mar 2026','2026-03','C']] },
  { name:'Arrears', header:['Member ID','Arrears'], rows:[['M001',12400]] },
  { name:'About', header:['Field','Value'], rows:[['Lodge','Noli Me Tangere Lodge No. 42, F. & A. M.']] }
]);
// A workbook Excel will open: zip magic, end-of-central-directory, 9 parts
assert.strictEqual(bytes[0], 0x50); assert.strictEqual(bytes[1], 0x4B);
assert.strictEqual(bytes[2], 3);    assert.strictEqual(bytes[3], 4);
const eocd = bytes.length - 22;
assert.strictEqual(bytes[eocd], 0x50); assert.strictEqual(bytes[eocd+1], 0x4B);
assert.strictEqual(bytes[eocd+2], 5);  assert.strictEqual(bytes[eocd+3], 6);
const entries = bytes[eocd+10] | (bytes[eocd+11] << 8);
assert.strictEqual(entries, 9, 'expected 9 zip entries, got ' + entries);

// Text that looks like a formula must stay text. The CSV export needs an
// apostrophe guard for this; inline strings make it impossible.
const xml = Buffer.from(bytes).toString('latin1');
assert.ok(xml.includes('t="inlineStr"'), 'strings are not inline');
assert.ok(!xml.includes('<f>'), 'a formula reached the workbook');
assert.ok(xml.includes('&amp;'), 'XML escaping missing');

console.log('PASS  workbook is a valid archive,', bytes.length, 'bytes, formulas inert');
