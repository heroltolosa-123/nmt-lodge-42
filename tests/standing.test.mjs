/* The two tests the Lodge actually applies, which the sheet used to keep in
   two hand-typed columns that drifted apart:

     In good standing  - current on dues, and still an active member
     Qualified to vote - at least six meetings this lodge year

   Loaded from the real Apps Script source so this cannot drift from it. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert';
import { appsScriptDir, appsScriptSource } from './_appsscript.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = appsScriptDir() + '/apps-script.js';
const src = readFileSync(SRC, 'utf8');

globalThis.SpreadsheetApp = { getActiveSpreadsheet: () => ({ getSheetByName: () => null, getSpreadsheetTimeZone: () => '' }) };
globalThis.Session = { getScriptTimeZone: () => 'Asia/Manila' };
globalThis.Utilities = {}; globalThis.Logger = { log: () => {} };
const api = new Function(src + `
  return { goodStandingFor_, isActiveMember_, goodStandingFormulaFor_,
           MIN_ATTENDANCE_TO_VOTE, countAttendanceForTerm_, currentLodgeYear_ };`)();

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; };

// --- good standing: dues, but only for a brother still on the roll ---
ok(api.goodStandingFor_({ status: 'Regular',       arrears: 0 })     === 'Y', 'paid-up regular');
ok(api.goodStandingFor_({ status: 'Regular',       arrears: 12400 }) === 'N', 'regular owing dues');
ok(api.goodStandingFor_({ status: 'LML',           arrears: 0 })     === 'Y', 'life member pays no dues');
ok(api.goodStandingFor_({ status: 'Dual',          arrears: 0 })     === 'Y', 'dual member');
ok(api.goodStandingFor_({ status: 'Restored 2019', arrears: 5000 })  === 'N', 'restored but owing');
ok(api.goodStandingFor_({ status: 'Restored 2019', arrears: 0 })     === 'Y', 'restored and paid');

// The whole point: these read zero arrears because they are off the books,
// not because they paid. None of them is in good standing.
for (const status of ['Suspended', 'Expelled 2017', 'Expelled 2010', 'Deceased', 'LML or Suspended?'])
  ok(api.goodStandingFor_({ status, arrears: 0 }) === 'N', status + ' must not be in good standing');

// missing or odd values must not accidentally confer standing
ok(api.goodStandingFor_({ status: 'Deceased' })                 === 'N', 'deceased, arrears undefined');
ok(api.goodStandingFor_({ status: 'Regular', arrears: null })   === 'Y', 'regular, arrears unset');
ok(api.goodStandingFor_({ status: '',        arrears: 0 })      === 'Y', 'blank status counts as active');

// --- the sheet formula must agree with the code ---
const f = api.goodStandingFormulaFor_(7);
for (const w of ['suspend','expel','decease','dropped','demit'])
  ok(f.includes(w), 'formula misses ' + w);
ok(f.includes('$G7') && f.includes('$L7'), 'formula reads Status and arrears');
ok(/^=IF\(OR\(/.test(f), 'formula shape');

// --- qualified to vote: six meetings, counted in the lodge year ---
ok(api.MIN_ATTENDANCE_TO_VOTE === 6, 'threshold is six');
const term = api.currentLodgeYear_();
const month = (y, m) => new Date(y, m - 1, 1);
const five = [3,4,5,6,7].map(m => ({ date: month(term, m), value: 'C' }));
const six  = five.concat([{ date: month(term, 8), value: 'C' }]);
ok(api.countAttendanceForTerm_(five, term) === 5, 'five counted');
ok(api.countAttendanceForTerm_(six,  term) === 6, 'six counted');
ok((api.countAttendanceForTerm_(five, term) >= api.MIN_ATTENDANCE_TO_VOTE) === false, 'five does not qualify');
ok((api.countAttendanceForTerm_(six,  term) >= api.MIN_ATTENDANCE_TO_VOTE) === true,  'six qualifies');

// NP and blanks are not attendance; a prior term does not carry over
ok(api.countAttendanceForTerm_(six.concat([{ date: month(term, 9), value: 'NP' }]), term) === 6, 'NP not counted');
ok(api.countAttendanceForTerm_(six.concat([{ date: month(term, 9), value: '' }]),   term) === 6, 'blank not counted');
ok(api.countAttendanceForTerm_([{ date: month(term - 1, 6), value: 'C' }], term) === 0, 'previous term excluded');
ok(api.countAttendanceForTerm_([{ date: month(term, 2), value: 'C' }], term) === 0, 'February belongs to the prior term');

// standing and voting are independent: owing dues does not remove the vote
const owing = { status: 'Regular', arrears: 9000 };
ok(api.goodStandingFor_(owing) === 'N' && api.countAttendanceForTerm_(six, term) >= 6,
   'a brother in arrears can still be qualified to vote');

console.log(`PASS  ${pass} checks — good standing is dues plus active membership; the vote is six meetings`);
