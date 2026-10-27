/* The status dropdown. The sheet holds standings nobody put in the list —
   "Restored 2019", "Expelled 2017", "LML or Suspended?" — and a dropdown
   that cannot show a brother's own standing will quietly replace it the
   moment anyone presses Save on his record for an unrelated reason. */
import assert from 'node:assert';
import fs from 'node:fs';

const SRC = '/Users/bogart/Downloads/Noli Me Tangere System/nmt-lodge-42/index.html';
const src = fs.readFileSync(SRC, 'utf8');

function grab(name) {
  const start = src.indexOf('function ' + name + '(');
  const end = src.indexOf('\n}', start);
  return src.slice(start, end + 2);
}
const listLine = src.match(/const STATUS_OPTIONS = \[[^\]]*\];/)[0];
const ctx = {};
new Function('ctx', listLine + '\n' + grab('statusOptionsFor') +
  '\nctx.statusOptionsFor = statusOptionsFor; ctx.STATUS_OPTIONS = STATUS_OPTIONS;')(ctx);
const { statusOptionsFor, STATUS_OPTIONS } = ctx;

// ---- LML is no longer a standing ----------------------------------------
assert.ok(!STATUS_OPTIONS.includes('LML'),
  'Life Membership is a Grand Lodge honour with its own column, not a lodge standing');
console.log('PASS  LML is no longer offered as a status');

// ---- a brother's own standing is always offered -------------------------
for (const odd of ['Restored 2019', 'Expelled 2017', 'LML or Suspended?', 'LML', 'Restored 2017']) {
  const opts = statusOptionsFor(odd);
  assert.ok(opts.includes(odd), `"${odd}" must be offered, or saving would overwrite it`);
  assert.strictEqual(opts[0], odd, 'and offered first, so it is what the browser selects');
}
console.log('PASS  a standing the list never knew about is still offered, and offered first');

// ---- a known standing is not duplicated ---------------------------------
const reg = statusOptionsFor('Regular');
assert.strictEqual(reg.filter(s => s === 'Regular').length, 1, 'no duplicate entry');
assert.deepStrictEqual(reg, STATUS_OPTIONS, 'and the list is otherwise untouched');
console.log('PASS  a standing already in the list is not duplicated');

// ---- case and spacing are not a new standing ----------------------------
assert.deepStrictEqual(statusOptionsFor('regular'), STATUS_OPTIONS,
  'different case is the same standing, not a new one');
assert.deepStrictEqual(statusOptionsFor('  Deceased  '), STATUS_OPTIONS,
  'stray spaces are not a new standing either');
console.log('PASS  case and stray spaces do not invent a new standing');

// ---- an empty standing adds nothing -------------------------------------
for (const empty of ['', null, undefined, '   ']) {
  assert.deepStrictEqual(statusOptionsFor(empty), STATUS_OPTIONS, 'nothing is added for ' + JSON.stringify(empty));
}
console.log('PASS  a blank standing adds no empty option');

console.log('\nall checks passed');
