/* The two Reports lists: brethren with no counted attendance in a chosen
   month range, and the dues entries that fall in the same range.

   Both are pulled out of index.html itself rather than copied, so a change
   to the shipped page is a change to what this tests. The dues date reader
   is pulled out of the Apps Script for the same reason. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert';
import { appsScriptSource } from './_appsscript.mjs';
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

const MONTH_INDEX = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
const ATT_COUNTED = new Set(['C', 'NO', 'NC']);
const INACTIVE_RE = /suspend|expel|decease|dropped|demit/i;

/* The page's own declarations must still say this. If someone widens the
   codes or the inactive list, the lists above move with them and this test
   should be the thing that notices. */
assert.ok(js.includes("const ATT_COUNTED = new Set(['C', 'NO', 'NC']);"), 'ATT_COUNTED moved');
assert.ok(js.includes('const INACTIVE_RE = /suspend|expel|decease|dropped|demit/i;'), 'INACTIVE_RE moved');

const src = ['function monthKey', 'function marksInRange', 'function zeroAttendance',
             'function duesInRange'].map(grab).join('\n');

let RANGE = { from: '', to: '' };
let ROSTER = [];
const build = () => new Function('MONTH_INDEX', 'ATT_COUNTED', 'INACTIVE_RE', 'range', 'fullRoster',
  src + '; return { monthKey, marksInRange, zeroAttendance, duesInRange };'
)(MONTH_INDEX, ATT_COUNTED, INACTIVE_RE, () => RANGE, ROSTER);

const month = (label, value) => ({ month: label, value });

ROSTER = [
  // present in March, absent the rest of the chosen months
  { memberId:'M1', fullName:'Abad', status:'Regular', months:[month('Mar 2026','C'), month('Jun 2026','NP')] },
  // marked NP every month: absent, and the marks say so
  { memberId:'M2', fullName:'Bravo', status:'Regular', months:[month('Jan 2026','NP'), month('Aug 2026','NP')] },
  // nothing recorded at all: also absent, a different case
  { memberId:'M3', fullName:'Cruz', status:'Regular', months:[] },
  // NO and NC count as much as C
  { memberId:'M4', fullName:'Dizon', status:'Regular', months:[month('Feb 2026','NO'), month('Sep 2026','NC')] },
  // never flagged, whatever his attendance
  { memberId:'M5', fullName:'Estrada', status:'Suspended 2025', months:[] },
  { memberId:'M6', fullName:'Flores', status:'Deceased', months:[] },
  // attended, but outside January-October
  { memberId:'M7', fullName:'Gomez', status:'Regular', months:[month('Dec 2026','C')] },
  // a month label the sheet never wrote properly cannot place him in time
  { memberId:'M8', fullName:'Hizon', status:'Regular', months:[month('rubbish','C')] }
];
const mod = build();

const names = () => mod.zeroAttendance().map(r => r.m.fullName);

// --- January to October 2026, the range the Secretary asked for ---
RANGE = { from: '2026-01', to: '2026-10' };
assert.deepStrictEqual(names(), ['Bravo', 'Cruz', 'Gomez', 'Hizon']);
console.log('Jan-Oct 2026, not once at Lodge:', names().join(', '));

// Abad's single C in March is enough to keep him off the list.
assert.ok(!names().includes('Abad'), 'one counted mark must clear a brother');
// Dizon's NO and NC count as much as a C.
assert.ok(!names().includes('Dizon'), 'NO and NC must count');
// A suspended or deceased brother has not failed to attend.
assert.ok(!names().includes('Estrada') && !names().includes('Flores'),
  'inactive brethren must never be listed');

// The marks a brother does have are kept, so NP-all-year reads differently
// from nothing-recorded-at-all.
const rows = mod.zeroAttendance();
const bravo = rows.find(r => r.m.fullName === 'Bravo');
const cruz  = rows.find(r => r.m.fullName === 'Cruz');
assert.strictEqual(bravo.marks.length, 2, 'Bravo’s two NP marks must survive');
assert.strictEqual(cruz.marks.length, 0, 'Cruz has nothing recorded');

// --- the range genuinely moves the answer ---
RANGE = { from: '2026-03', to: '2026-03' };
assert.ok(!names().includes('Abad') && names().includes('Dizon'),
  'March alone: Abad was there, Dizon was not');
RANGE = { from: '2026-11', to: '2026-12' };
assert.ok(!names().includes('Gomez'), 'December alone: Gomez was there');
RANGE = { from: '', to: '' };
assert.ok(!names().includes('Abad') && names().includes('Cruz'),
  'no range at all means every recorded month');
RANGE = { from: '2026-03', to: '2026-03' };
console.log('March alone, not once at Lodge:', names().join(', '));

// --- dues: a date is matched by month, a bare year by its year ---
RANGE = { from: '2026-01', to: '2026-10' };
const d = mod.duesInRange;
assert.ok(d({ paidOn: '2026-10-30', year: 2027 }), 'a day inside the range is in');
assert.ok(!d({ paidOn: '2026-11-02', year: 2026 }),
  'the day recorded wins over the dues year it paid for');
assert.ok(!d({ paidOn: '2025-12-31', year: 2026 }), 'a day before the range is out');
assert.ok(d({ paidOn: '', year: 2026 }), 'a bare year inside the range is in');
assert.ok(!d({ paidOn: '', year: 2025 }), 'a bare year outside the range is out');
assert.ok(!d({ paidOn: '', year: 0 }), 'undatable rows stay out of a chosen range');
RANGE = { from: '', to: '' };
assert.ok(d({ paidOn: '', year: 0 }), 'undatable rows show when no range is asked for');

// --- the Apps Script finds the day inside the note it wrote ---
const api = new Function(appsScriptSource() + '; return { duesPaidOn_ };')();
assert.strictEqual(
  api.duesPaidOn_('Paid via dashboard on 2026-10-30; arrears 6200 → 0'), '2026-10-30');
assert.strictEqual(api.duesPaidOn_('Added via dashboard on 2026-03-01'), '2026-03-01');
assert.strictEqual(api.duesPaidOn_('OR 1234'), '');
assert.strictEqual(api.duesPaidOn_(''), '');
assert.strictEqual(api.duesPaidOn_(null), '');

console.log('PASS  zero-attendance and dues range filters');
