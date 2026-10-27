/* The roster filters, and the export that must agree with them.

   The one that bites: a brother who has PAID AHEAD carries negative
   arrears. He is neither owing nor square, and sorting him into either
   bucket reports a man who paid early as one who has not paid at all. */
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
new Function('ctx', grab('rosterMatches') + '\n' + grab('rosterMoney') +
  '\nctx.rosterMatches = rosterMatches; ctx.rosterMoney = rosterMoney;')(ctx);
const { rosterMatches, rosterMoney } = ctx;

const ROLL = [
  { fullName: 'Arnel D Cantos',       status: 'Regular',   lml: 'Y', goodStanding: 'Y', qualifiedToVote: 'Y', arrears: 0 },
  { fullName: 'Andrew Omel',          status: 'Regular',   lml: 'N', goodStanding: 'N', qualifiedToVote: 'N', arrears: 6200 },
  { fullName: 'Domingo B Sumayo, Jr', status: 'Regular',   lml: 'N', goodStanding: 'Y', qualifiedToVote: 'N', arrears: -6200 },
  { fullName: 'Bernandino L Cabiles', status: 'Suspended', lml: 'N', goodStanding: 'N', qualifiedToVote: 'N', arrears: 0 },
  { fullName: 'Gary U Lim',           status: 'Regular',   lml: 'Y', goodStanding: 'Y', qualifiedToVote: 'N', arrears: 0 }
];
const F = (o) => Object.assign({ search:'', status:'', goodStanding:'', vote:'', money:'', lml:'' }, o);
const names = f => ROLL.filter(m => rosterMatches(m, F(f))).map(m => m.fullName);

// ---- no filter shows everyone -------------------------------------------
assert.strictEqual(names({}).length, 5, 'an empty filter hides nobody');
console.log('PASS  with nothing set, the whole roll is shown');

// ---- the three figures on the cards --------------------------------------
assert.deepStrictEqual(names({ goodStanding: 'Y' }),
  ['Arnel D Cantos', 'Domingo B Sumayo, Jr', 'Gary U Lim']);
assert.deepStrictEqual(names({ vote: 'Y' }), ['Arnel D Cantos']);
assert.deepStrictEqual(names({ money: 'owing' }), ['Andrew Omel'],
  'owed to the Lodge means arrears above nil, and nothing else');
console.log('PASS  good standing, qualified to vote and owing each give the right brethren');

// ---- THE ONE THAT MATTERS: paid ahead is its own thing -------------------
assert.deepStrictEqual(names({ money: 'ahead' }), ['Domingo B Sumayo, Jr'],
  'a credit is "paid ahead"');
assert.ok(!names({ money: 'owing' }).includes('Domingo B Sumayo, Jr'),
  'a man who paid early must never appear among those who owe');
assert.ok(!names({ money: 'clear' }).includes('Domingo B Sumayo, Jr'),
  'nor among those who are merely square — he is ahead of them');
assert.deepStrictEqual(names({ money: 'clear' }),
  ['Arnel D Cantos', 'Bernandino L Cabiles', 'Gary U Lim']);
console.log('PASS  a brother paid ahead is counted as ahead, never as owing or square');

// ---- Life Membership is not a status -------------------------------------
assert.deepStrictEqual(names({ lml: 'Y' }), ['Arnel D Cantos', 'Gary U Lim']);
assert.deepStrictEqual(names({ status: 'Regular', lml: 'Y' }), ['Arnel D Cantos', 'Gary U Lim'],
  'a Life Member still carries his ordinary standing');
assert.ok(names({ status: 'Suspended' }).includes('Bernandino L Cabiles'));
console.log('PASS  Life Membership filters apart from standing, as it is now stored');

// ---- a missing flag is not a Life Member ---------------------------------
assert.ok(rosterMatches({ fullName: 'No Flag', arrears: 0 }, F({ lml: 'N' })),
  'a brother with no LML field is simply not a Life Member');
assert.ok(!rosterMatches({ fullName: 'No Flag', arrears: 0 }, F({ lml: 'Y' })),
  'and must not be swept in as one');
console.log('PASS  a record with no LML field is treated as not a Life Member');

// ---- filters combine ------------------------------------------------------
assert.deepStrictEqual(names({ goodStanding: 'Y', lml: 'Y', money: 'clear' }),
  ['Arnel D Cantos', 'Gary U Lim'], 'filters narrow together, they do not replace one another');
assert.deepStrictEqual(names({ search: 'lim' }), ['Gary U Lim']);
assert.deepStrictEqual(names({ search: 'LIM' }), [], 'the search term arrives already lowercased');
console.log('PASS  filters combine, and the search is matched as given');

// ---- odd arrears values must not throw ------------------------------------
for (const a of [null, undefined, '', 'rubbish', NaN]) {
  assert.ok(rosterMatches({ fullName: 'Odd', arrears: a }, F({ money: 'clear' })),
    'an unreadable arrears figure counts as owing nothing, not as a debt');
  assert.ok(!rosterMatches({ fullName: 'Odd', arrears: a }, F({ money: 'owing' })));
}
console.log('PASS  an unreadable arrears figure never invents a debt');

/* ---- what the Lodge is owed ------------------------------------------
   Adding every arrears field together lets one brother who has paid a
   year ahead cancel out another brother's debt. The headline then reads
   "owed nothing" while a man owes 6,200 — which is what it did on the
   day the first advance payment was recorded. */
let money = rosterMoney(ROLL);
assert.strictEqual(money.owed, 6200, 'only debts are owed to the Lodge');
assert.strictEqual(money.credit, 6200, 'and the credit is counted separately');
assert.notStrictEqual(money.owed, ROLL.reduce((n, m) => n + m.arrears, 0),
  'the plain sum is 0 here, which is the whole bug');
console.log('PASS  a credit never cancels another brother\'s debt');

money = rosterMoney([{ arrears: 1000 }, { arrears: 2000 }]);
assert.deepStrictEqual(money, { owed: 3000, credit: 0 }, 'debts add up');
money = rosterMoney([{ arrears: -500 }, { arrears: -1500 }]);
assert.deepStrictEqual(money, { owed: 0, credit: 2000 }, 'credits add up, and as a positive figure');
assert.deepStrictEqual(rosterMoney([]), { owed: 0, credit: 0 }, 'an empty roll owes nothing');
assert.deepStrictEqual(rosterMoney(), { owed: 0, credit: 0 }, 'and no roll at all does not throw');
assert.deepStrictEqual(rosterMoney([{ arrears: 'rubbish' }, { arrears: null }, {}]),
  { owed: 0, credit: 0 }, 'unreadable figures add nothing either way');
console.log('PASS  debts and credits each add up on their own, and rubbish adds nothing');

console.log('\nall checks passed');
