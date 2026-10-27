/* Where the Apps Script source lives.

   Each test used to reach for it with its own ../../ walk, which all six
   got wrong the moment the repository was moved inside the project
   folder. The source is not in this repository at all — it holds member
   names and cannot be — so it has to be found rather than imported, and
   that search belongs in one place. */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

const CANDIDATES = [
  join(HERE, '..', '..', 'appscript'),                              // repo inside the project folder
  join(HERE, '..', '..', 'Noli Me Tangere System', 'appscript'),    // repo beside it
  join(HERE, '..', 'appscript')
];

export function appsScriptDir() {
  for (const dir of CANDIDATES) {
    if (existsSync(join(dir, 'apps-script.js'))) return resolve(dir);
  }
  throw new Error(
    'Could not find apps-script.js. Looked in:\n  ' +
    CANDIDATES.map(c => resolve(c)).join('\n  ') +
    '\nIf the project folder moved, add its path to tests/_appsscript.mjs.');
}

export function appsScriptSource(file = 'apps-script.js') {
  return readFileSync(join(appsScriptDir(), file), 'utf8');
}
