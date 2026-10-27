/* Lending a brother's own portrait to his officer card.

   The hazard here is not a missing picture, it is the wrong one. A
   surname-only match once put one brother's birthday onto another's
   record in this project; the same mistake on a photograph would put a
   man's face on someone else's card, in public, on the Lodge's own site.
   These checks exist for that. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert';
import { appsScriptDir, appsScriptSource } from './_appsscript.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = appsScriptDir() + '/apps-script.js';
const src = readFileSync(SRC, 'utf8');

let MEMBERS = [];
let OFFICER_ROWS = [];

globalThis.SpreadsheetApp = {
  getActiveSpreadsheet: () => ({
    getSheetByName: name => name !== 'Officers' ? null : {
      getLastRow: () => OFFICER_ROWS.length + 1,
      getRange: () => ({ getValues: () => OFFICER_ROWS })
    },
    getSpreadsheetTimeZone: () => ''
  })
};
globalThis.Session = { getScriptTimeZone: () => 'Asia/Manila' };
globalThis.Utilities = {}; globalThis.Logger = { log: () => {} };

const api = new Function(src + `
  loadMembers_ = function () { return globalThis.__members; };
  return { getOfficers, photoNameKey_, memberPhotosByName_ };`)();

const officer = (id, position, fullName, photoUrl) =>
  [id, position, fullName, '2026-2027', 'Current', photoUrl || '', ''];
const run = () => { globalThis.__members = MEMBERS; return api.getOfficers(); };
const card = (out, name) => out.current.find(o => o.fullName === name);

// ---- an initial in one place and not the other still matches ------------
MEMBERS = [{ fullName: 'Charlie C Barinque', photoUrl: 'https://nmt/api/photo?k=aaa' }];
OFFICER_ROWS = [officer('O-1', 'Secretary', 'Charlie Barinque', '')];
assert.strictEqual(card(run(), 'Charlie Barinque').photoUrl, 'https://nmt/api/photo?k=aaa',
  'the roll writes an initial the Officers sheet does not — it is still the same man');
console.log('PASS  a middle initial on one side only still matches');

// ---- the Officers sheet always wins -------------------------------------
OFFICER_ROWS = [officer('O-1', 'Secretary', 'Charlie Barinque', 'https://posed/portrait.jpg')];
assert.strictEqual(card(run(), 'Charlie Barinque').photoUrl, 'https://posed/portrait.jpg',
  'a portrait taken for the line is the better picture and must not be replaced');
console.log('PASS  a photograph already on the officer row is never overwritten');

// ---- a brother with no picture gets none --------------------------------
MEMBERS = [{ fullName: 'Charlie C Barinque', photoUrl: '' }];
OFFICER_ROWS = [officer('O-1', 'Secretary', 'Charlie Barinque', '')];
assert.strictEqual(card(run(), 'Charlie Barinque').photoUrl, '', 'no picture anywhere is no picture');
console.log('PASS  no portrait anywhere leaves the card with initials');

// ---- THE ONE THAT MATTERS: never guess between two brethren -------------
MEMBERS = [
  { fullName: 'Gregory Ong',        photoUrl: 'https://nmt/api/photo?k=senior' },
  { fullName: 'Gregory Jr. Ong II', photoUrl: 'https://nmt/api/photo?k=junior' }
];
OFFICER_ROWS = [officer('O-1', 'Junior Warden', 'Gregory Ong', ''),
                officer('O-2', 'Marshal',       'Gregory Jr. Ong II', '')];
let out = run();
assert.strictEqual(card(out, 'Gregory Ong').photoUrl, 'https://nmt/api/photo?k=senior',
  'father and son are different keys and must each keep their own face');
assert.strictEqual(card(out, 'Gregory Jr. Ong II').photoUrl, 'https://nmt/api/photo?k=junior');

// two brethren who really do reduce to the same key: show neither
MEMBERS = [
  { fullName: 'Juan A Cruz', photoUrl: 'https://nmt/api/photo?k=one' },
  { fullName: 'Juan B Cruz', photoUrl: 'https://nmt/api/photo?k=two' }
];
OFFICER_ROWS = [officer('O-1', 'Tyler', 'Juan Cruz', '')];
assert.strictEqual(card(run(), 'Juan Cruz').photoUrl, '',
  'an ambiguous name must show no face at all rather than risk the wrong one');
console.log('PASS  an ambiguous name shows no face rather than the wrong one');

// ---- a surname alone is never enough ------------------------------------
MEMBERS = [{ fullName: 'Antonio D. Evangelista', photoUrl: 'https://nmt/api/photo?k=antonio' }];
OFFICER_ROWS = [officer('O-1', 'Orator', 'Kherwin Evangelista', '')];
assert.strictEqual(card(run(), 'Kherwin Evangelista').photoUrl, '',
  'a shared surname is not the same brother — this exact pair was mismatched once before');
console.log('PASS  a shared surname alone never lends a face');

// ---- punctuation and spacing are not differences ------------------------
MEMBERS = [{ fullName: 'Manuel C. Bahena,  Jr.', photoUrl: 'https://nmt/api/photo?k=manuel' }];
OFFICER_ROWS = [officer('O-1', 'Almoner', 'Manuel Bahena Jr', '')];
assert.strictEqual(card(run(), 'Manuel Bahena Jr').photoUrl, 'https://nmt/api/photo?k=manuel',
  'commas, stops and doubled spaces are not a different man');
console.log('PASS  punctuation and spacing are ignored');

// ---- past officers are lent a portrait too ------------------------------
MEMBERS = [{ fullName: 'Hero L Tolosa', photoUrl: 'https://nmt/api/photo?k=hero' }];
OFFICER_ROWS = [[ 'O-9', 'Worshipful Master', 'Hero Tolosa', '2024-2025', 'Past', '', '' ]];
out = run();
assert.strictEqual(out.past[0].photoUrl, 'https://nmt/api/photo?k=hero',
  'a past Master keeps his face on the past-terms list as well');
console.log('PASS  past officers are lent a portrait as well as the sitting line');

console.log('\nall checks passed');
