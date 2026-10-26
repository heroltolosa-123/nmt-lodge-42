// Run:  node tests/search.test.mjs      (from the repo root)
// No framework, no install. Stubs fetch, exercises the real handler.
import assert from 'node:assert';

// stub the roster Apps Script would return — note the private fields
const ROSTER = [
  { memberId:'M1', surname:'Santos', firstName:'Manuel', fullName:'Manuel de Santos',
    yearRaised:1918, status:'Regular', proficiency:'MM', attendanceTotal:4,
    qualifiedToVote:'Y', goodStanding:'Y', arrears:0, lml:'N',
    months:[{month:'Mar 2025',value:'C'}], attendanceRemarks:'',
    dateOfBirth:'1880-01-01', contactNumber:'09171234567', email:'x@y.com',
    address:'Libertad St, Pasay', occupation:'Printer', photoUrl:'http://x' },
  { memberId:'M2', surname:'Tanner', firstName:'Adam', fullName:'Adam T. Tanner',
    yearRaised:1918, status:'Regular', arrears:500, goodStanding:'N',
    months:[], dateOfBirth:'1885-02-02', email:'t@y.com' },
  ...Array.from({length:30},(_,i)=>({ memberId:'X'+i, surname:'Cruz', firstName:'J'+i,
    fullName:'J'+i+' Cruz', months:[], arrears:0, email:'leak'+i+'@y.com' }))
];

globalThis.fetch = async () => ({ ok:true, json: async () => ({ roster: ROSTER }) });
process.env.APPS_SCRIPT_URL = 'https://example.test/exec';
process.env.LODGE_ADMIN_KEY = 'test-key';

const { default: handler } = await import('../api/search.mjs');

function mockRes(){ const r={headers:{},statusCode:0,body:null,
  setHeader(k,v){this.headers[k.toLowerCase()]=v}, end(b){this.body=JSON.parse(b)}}; return r; }
async function call(q){ const res=mockRes(); await handler({query:{q}, url:'/api/search'}, res); return res; }

// 1. short terms return nothing — no query returns the roster
for (const q of ['', 'a', 'ab', '  ', null]) {
  const r = await call(q);
  assert.deepStrictEqual(r.body.matches, [], `short term ${JSON.stringify(q)} must return nothing`);
}
console.log('PASS  terms under 3 chars return nothing');

// 2. a real search returns matches
const r1 = await call('santos');
assert.strictEqual(r1.body.matches.length, 1);
assert.strictEqual(r1.body.matches[0].fullName, 'Manuel de Santos');
console.log('PASS  search by surname works');

// 3. THE guarantee: private fields never leave
const PRIVATE = ['memberId','surname','firstName','middleName','dateOfBirth',
                 'contactNumber','email','address','occupation','remarks'];
// photoUrl is deliberately public - Find My Status shows the portrait. Asserted
// below so it cannot be dropped again by tightening the whitelist.
const REQUIRED_PUBLIC = ['photoUrl'];
const all = (await call('cru')).body.matches.concat(r1.body.matches);
for (const m of all) for (const f of PRIVATE)
  assert.ok(!(f in m), `LEAK: ${f} reached the client`);
console.log('PASS  no private field reaches the client');

// 3b. the portrait must survive the whitelist, or Find My Status loses its faces
const withPhoto = all.find(m => m.fullName === 'Manuel de Santos');
for (const f of REQUIRED_PUBLIC)
  assert.ok(withPhoto && f in withPhoto, `${f} was stripped - Find My Status shows no photo`);
console.log('PASS  photoUrl survives the whitelist');

// 4. capped at 15 even though 30 match
const r2 = await call('cruz');
assert.strictEqual(r2.body.matches.length, 15, 'must cap at 15');
console.log('PASS  results capped at 15 (30 matched)');

// 5. case and whitespace behave
assert.strictEqual((await call('  SANTOS  ')).body.matches.length, 1);
console.log('PASS  case and surrounding whitespace normalised');

// 6. unconfigured env reports 503 so the page can fall back
delete process.env.LODGE_ADMIN_KEY;
const mod2 = await import('../api/search.mjs?v=2');
const res2 = mockRes();
await mod2.default({query:{q:'santos'}, url:'/api/search'}, res2);
assert.strictEqual(res2.statusCode, 503);
assert.strictEqual(res2.body.error, 'not_configured');
console.log('PASS  missing env returns 503 not_configured');

console.log('\nall checks passed');
