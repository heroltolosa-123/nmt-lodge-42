/* Who may change the Lodge's records.

   Full control for the three lights, the Secretary and the Treasurer; every
   other officer sees the same records and changes nothing. Enforced in
   /api/action, not in the page: hiding a button stops nobody who can send a
   request by hand, so that is what this tests. */
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ROLES, VISIBLE_ROLES, canEdit, signToken, newSession } from '../api/_lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
process.env.SESSION_SECRET  = 'z'.repeat(32);
process.env.APPS_SCRIPT_URL = 'https://script.example/exec';
process.env.LODGE_ADMIN_KEY = 'a-key';

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; };

// --- the list itself ---
const editors = Object.keys(ROLES).filter(canEdit).sort();
assert.deepStrictEqual(editors, ['admin', 'jw', 'secretary', 'sw', 'treasurer', 'wm'],
  'only the three lights, Secretary, Treasurer and the administrator may edit');
ok(Object.keys(ROLES).length === 23, '23 chairs in all');
ok(Object.keys(VISIBLE_ROLES).length === 22, '22 on the sign-in form');
ok(!canEdit('organist') && !canEdit('tyler') && !canEdit('almoner'), 'the rest are view-only');
ok(!canEdit('nosuchchair'), 'an unknown chair may not edit');
console.log('PASS  6 chairs may edit, 17 may only look');

// --- every chair must be able to hold a session ---
for (const role of Object.keys(ROLES))
  ok(newSession(role).role === role, role + ' cannot hold a session');

// --- the API refuses a write from a view-only chair ---
let upstreamCalled = false;
globalThis.fetch = async () => { upstreamCalled = true; return { ok: true, json: async () => ({}), text: async () => '{}' }; };
const { default: action } = await import('../api/action.mjs');

const callAs = async (role, body) => {
  const req = { method: 'POST', headers: { cookie: 'nmt_session=' + signToken(newSession(role), process.env.SESSION_SECRET) },
                async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body)); } };
  const res = { statusCode: 0, body: null, setHeader() {}, end(b) { this.body = JSON.parse(b); } };
  await action(req, res);
  return res;
};

const WRITES = [
  { action: 'updateMember', memberId: 'M001', fields: { remarks: 'changed' } },
  { action: 'rollCall', meetingMonth: '2026-10', entries: [] },
  { action: 'addDue', due: { memberId: 'M001', amount: 1000, status: 'Paid' } },
  { action: 'addMember', member: { surname: 'Test' } },
  { action: 'deleteActivity', activityId: 'A1' }
];

for (const role of ['organist', 'tyler', 'almoner', 'historian', 'chaplain']) {
  for (const body of WRITES) {
    upstreamCalled = false;
    const res = await callAs(role, body);
    ok(res.statusCode === 403 && res.body.error === 'read_only_chair',
       role + ' must not be able to ' + body.action + ' (got ' + res.statusCode + ')');
    ok(!upstreamCalled, role + ' must not reach the spreadsheet at all for ' + body.action);
  }
}
console.log('PASS  a view-only chair is refused every write, and never reaches the spreadsheet');

// --- but reading is open to everyone ---
for (const role of ['organist', 'tyler', 'secretary']) {
  const res = await callAs(role, { action: 'roster' });
  ok(res.statusCode !== 403, role + ' must be able to read the roster');
}
console.log('PASS  every chair may read the roster');

// --- and the chairs that run the Lodge are not blocked ---
for (const role of ['wm', 'sw', 'jw', 'secretary', 'treasurer']) {
  const res = await callAs(role, WRITES[0]);
  ok(res.statusCode !== 403, role + ' must be able to edit (got ' + res.statusCode + ')');
}
console.log('PASS  the three lights, Secretary and Treasurer may still edit');

// --- the page must not be the only thing stopping them ---
const html = readFileSync(join(HERE, '..', 'index.html'), 'utf8');
ok(/\.view-only \.editors-only\{\s*display:none/.test(html), 'the hiding rule must exist');
ok(html.includes('canEditRecords'), 'the page must know what the chair may do');
for (const sub of ['rollcall', 'dues', 'addmember'])
  ok(new RegExp('editors-only[^>]*data-sub="' + sub + '"').test(html),
     'the ' + sub + ' tab must be marked for editors');
console.log('PASS  the page hides what it should, as a courtesy on top');

console.log(`\nall ${pass} checks passed`);
