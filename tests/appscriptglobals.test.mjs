/* Apps Script has no modules. Every file in the project shares one global
   scope, so a helper defined in one file is simply visible in the next —
   and a name that is misspelled, renamed or deleted is not an error until
   the Secretary runs the function and the run dies half way through,
   having already written some of what it meant to write.

   Nothing else in this project catches that: node --check parses each file
   alone, and a one-off correction script has no caller to exercise it. So
   this concatenates the whole project the way Apps Script does and checks
   that every helper and every shared constant it reaches for exists.

   Two names declared twice is the other half of the same failure. The
   second wins silently, and the first file's calls quietly go somewhere
   else.

   The scripts live outside this repository — they name members — so this
   skips rather than fails when they are not there. */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert';
import { appsScriptDir } from './_appsscript.mjs';

const dir = appsScriptDir();
if (!existsSync(join(dir, 'apps-script.js'))) {
  console.log('SKIP  the Apps Script project is not present');
  process.exit(0);
}

const files = readdirSync(dir).filter(f => f.endsWith('.js')).sort();
assert.ok(files.length >= 2, 'there should be several script files');

/* Strip comments and string literals before looking for identifiers, so a
   helper named in prose or in a log line is not mistaken for a call. */
const strip = src => src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/\/\/[^\n]*/g, ' ')
  .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
  .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
  .replace(/`(?:[^`\\]|\\.)*`/g, '``');

const code = new Map(files.map(f => [f, strip(readFileSync(join(dir, f), 'utf8'))]));

// --- what each file declares ---
const declared = new Map();              // name -> file
const duplicates = [];
for (const [file, src] of code) {
  for (const m of src.matchAll(/^(?:function\s+([A-Za-z_$][\w$]*)|var\s+([A-Z][A-Z0-9_]*))/gm)) {
    const name = m[1] || m[2];
    if (declared.has(name)) duplicates.push(`${name}: ${declared.get(name)} and ${file}`);
    declared.set(name, file);
  }
}
assert.deepStrictEqual(duplicates, [],
  'two files declare the same global; in Apps Script the second silently wins');

/* --- what each file reaches for ---
   Only the project's own two naming conventions are checked, because they
   are unambiguous: a trailing underscore marks a private helper, and a
   SCREAMING_SNAKE name with a trailing underscore marks a shared constant.
   Anything else could be a Google builtin or a local, and guessing at those
   would make this test cry wolf. */
const missing = [];
for (const [file, src] of code) {
  const local = new Set([...src.matchAll(/\b(?:var|let|const|function)\s+([A-Za-z_$][\w$]*)/g)]
    .map(m => m[1]));
  for (const m of src.matchAll(/\b([A-Za-z_$][\w$]*_)\b/g)) {
    const name = m[1];
    if (declared.has(name) || local.has(name)) continue;
    missing.push(`${file} reaches for ${name}, which nothing declares`);
  }
}
assert.deepStrictEqual([...new Set(missing)], [],
  'a reference with no declaration dies at run time, part way through a write');

/* --- every preview the orchestrator chains must exist and be a preview ---
   lodgeCheck() is the one function the Secretary is told to run. If it
   calls a preview that has been renamed, he finds out when it throws. */
if (declared.has('lodgeCheck')) {
  const src = code.get(declared.get('lodgeCheck'));
  const chained = [...src.matchAll(/^\s{2}([a-zA-Z0-9_]*Preview)\(\);/gm)].map(m => m[1]);
  assert.ok(chained.length >= 4, 'lodgeCheck should run every outstanding preview');
  chained.forEach(fn => assert.ok(declared.has(fn), 'lodgeCheck calls ' + fn + ', which is gone'));
  // It must not write. An apply reached from a "check" is the whole fear.
  assert.ok(!/^\s*[a-zA-Z0-9_]*Apply\(\);/m.test(src.slice(src.indexOf('function lodgeCheck'))),
    'lodgeCheck must never call an apply');
}

/* --- the preview/apply pair, kept honest ---
   Every apply in the project has a preview beside it. A one-off that can
   only be run blind is how the over-crediting happened. */
const applies = [...declared.keys()].filter(n => /Apply$/.test(n));
assert.ok(applies.length >= 3, 'the one-off corrections should be here');
applies.forEach(a => assert.ok(declared.has(a.replace(/Apply$/, 'Preview')),
  a + ' has no matching preview'));

console.log(`PASS  ${files.length} script files share one scope cleanly — ` +
  `${declared.size} globals, no duplicates, no dangling helpers, ` +
  `${applies.length} applies each with a preview`);
