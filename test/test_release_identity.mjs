// The deploy check this project relies on is `/api/game?action=board` -> v.
// It only works if `v` names the BUILD. On 2026-08-28 five of nine endpoints
// still reported h70-2026-08-25 while the site served h73, because each file
// carried its own hand-maintained string and they drifted apart. A deploy that
// fails silently — which has happened here — is then indistinguishable from one
// that worked, and that is the exact failure this marker exists to catch.
//
// So the marker lives in one file, and this suite makes the drift impossible to
// reintroduce quietly.

import fs from 'node:fs';
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

let pass = 0, failn = 0;
const ok = (c, l) => { if (c) { pass++; console.log('PASS  ' + l); } else { failn++; console.log('FAIL  ' + l); } };

const at = p => new URL('../' + p, import.meta.url);
const read = p => fs.readFileSync(at(p), 'utf8');

const { RELEASE } = require('../lib/release.js');
ok(/^h\d+-\d{4}-\d{2}-\d{2}$/.test(RELEASE), `the release marker has the agreed shape (${RELEASE})`);
const deploy = read('DEPLOY.cmd');
ok(/call npm test/.test(deploy), 'the one-command deploy runs the complete release gate first');
ok(/require\('\.\/lib\/release\.js'\)\.RELEASE/.test(deploy),
  'the deploy verifies production against the shared release marker');
ok(!/"v":"h\d+-\d{4}-\d{2}-\d{2}"/.test(deploy),
  'the deploy script contains no hand-maintained release literal');

// Instrument versions are a different axis on a different schedule: they roll
// when the RULES of that instrument change, not when a build ships. They are
// named here so that allowing them stays a decision rather than a loophole.
const INSTRUMENT = new Set(['api/ledger.js', 'api/log.js']);

const apis = readdirSync(at('api')).filter(f => f.endsWith('.js')).map(f => 'api/' + f);
ok(apis.length >= 8, `found the api surface (${apis.length} files)`);

for (const f of apis) {
  const src = read(f);
  if (!/const\s+(\{\s*RELEASE[^}]*\}|VERSION)\s*=/.test(src)) continue;   // no marker at all is fine
  const literal = src.match(/^const VERSION = '([^']*)';/m);
  if (INSTRUMENT.has(f)) {
    ok(!!literal, `${f} keeps its own instrument version on purpose`);
    ok(!/^h\d+-/.test(literal ? literal[1] : ''),
      `${f}'s instrument version is not dressed up as a release marker`);
    continue;
  }
  ok(!literal,
    `${f} takes the release marker from lib/release.js instead of declaring its own` +
    (literal ? ` — found '${literal[1]}', which is how five endpoints ended up three releases behind` : ''));
  ok(src.includes("require('../lib/release.js')"),
    `${f} imports the shared release marker`);
}

console.log(`\n${pass} passed, ${failn} failed`);
process.exit(failn ? 1 : 0);
