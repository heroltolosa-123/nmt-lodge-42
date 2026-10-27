/* The projection. It will be quoted at a stated meeting, so the
   arithmetic has to behave sensibly at the edges as well as the middle. */
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
new Function('ctx', [grab('annualMortality'), grab('forecast'), grab('fcNeeded'),
  'ctx.annualMortality = annualMortality; ctx.forecast = forecast; ctx.fcNeeded = fcNeeded;'
].join('\n'))(ctx);
const { annualMortality, forecast, fcNeeded } = ctx;

// ---- the death rate must behave like one --------------------------------
assert.ok(annualMortality(30) < annualMortality(60), 'it rises with age');
assert.ok(annualMortality(60) < annualMortality(85), 'and keeps rising');
for (const a of [-5, 0, 20, 50, 90, 130, NaN, null, undefined]) {
  const q = annualMortality(a);
  assert.ok(q >= 0 && q <= 0.5, 'it stays a probability for age ' + a + ' (got ' + q + ')');
}
assert.ok(annualMortality(40) < 0.01, 'a man of forty is not dying at one percent a year');
assert.ok(annualMortality(80) > 0.03, 'a man of eighty plainly is at some real rate');
console.log('PASS  the death rate rises with age and stays a probability at every input');

// ---- a roll with nobody raised must shrink ------------------------------
const ages = Array.from({ length: 95 }, (_, i) => 30 + (i % 50));
let p = forecast(ages, { years: 10, raisings: 0, lapsePercent: 0 });
assert.strictEqual(p.length, 11, 'year nought plus ten');
assert.strictEqual(Math.round(p[0].total), 95, 'it starts where the Lodge is');
assert.ok(p[10].total < p[0].total, 'with nobody raised the roll falls');
for (let i = 1; i <= 10; i++) assert.ok(p[i].total <= p[i - 1].total, 'and falls every single year');
console.log('PASS  with no raisings the roll only ever falls');

// ---- raising more men cannot make the roll smaller ----------------------
const slow = forecast(ages, { years: 10, raisings: 1, lapsePercent: 1.5 });
const fast = forecast(ages, { years: 10, raisings: 4, lapsePercent: 1.5 });
assert.ok(fast[10].total > slow[10].total, 'raising more leaves more');
console.log('PASS  raising more brethren always leaves more brethren');

// ---- lapsing more cannot leave more -------------------------------------
const steady = forecast(ages, { years: 10, raisings: 2, lapsePercent: 0 });
const leaky  = forecast(ages, { years: 10, raisings: 2, lapsePercent: 5 });
assert.ok(leaky[10].total < steady[10].total, 'a higher lapse rate leaves fewer');
console.log('PASS  a higher lapse rate always leaves fewer');

// ---- an old lodge declines faster than a young one ----------------------
const young = forecast(Array(60).fill(35), { years: 10, raisings: 0, lapsePercent: 0 });
const old   = forecast(Array(60).fill(75), { years: 10, raisings: 0, lapsePercent: 0 });
assert.ok(old[10].total < young[10].total * 0.9, 'age structure drives the decline, not just headcount');
console.log('PASS  an older roll declines faster than a younger one of the same size');

// ---- the "how many must we raise" answer actually holds -----------------
const target = 95;
const need = fcNeeded(ages, 1.5, target, 10);
const check = forecast(ages, { years: 10, raisings: need, lapsePercent: 1.5 });
assert.ok(Math.abs(check[10].total - target) < 1.5,
  `raising ${need.toFixed(2)} a year should land near ${target}, got ${check[10].total.toFixed(1)}`);
const under = forecast(ages, { years: 10, raisings: Math.max(0, need - 1), lapsePercent: 1.5 });
assert.ok(under[10].total < target, 'one fewer a year must fall short, or the answer is not tight');
console.log('PASS  the raisings-needed figure lands on the target, and one fewer does not');

// ---- degenerate inputs must not explode ---------------------------------
assert.strictEqual(forecast([], { years: 10, raisings: 0, lapsePercent: 0 })[10].total, 0,
  'an empty roll stays empty');
const silly = forecast(ages, { years: 10, raisings: -5, lapsePercent: 500 });
assert.ok(silly.every(x => x.total >= 0 && Number.isFinite(x.total)),
  'nonsense settings must not produce negative or infinite brethren');
console.log('PASS  an empty roll and nonsense settings are handled without absurdity');

console.log('\nall checks passed');
