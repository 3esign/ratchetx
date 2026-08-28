// The kill switch, tested as the thing it actually is.
//
// After 2026-09-08 the Seal v2 program cannot be changed by anyone, us
// included. If it turns out to be wrong, the only move left is to stop arming
// it: the site reads `RATCHET_SEAL_PROGRAM_ID`, and without it no seal is ever
// offered. That single environment variable is the entire escape hatch of an
// otherwise irreversible decision, so it deserves a suite rather than a
// sentence.
//
// Three things have to hold, and the third is the one that was broken.
//   1. The switch is real: one variable disarms the whole mirror path.
//   2. Pulling it cannot break anything else — the game does not depend on it.
//   3. The documentation names the variable the CODE reads. On 2026-08-27 it
//      did not: a rebrand had rewritten `RATCHET_` to `RatchetX_` in prose
//      across README.md, docs/FREEZE.md and docs/ONCHAIN.md, while the code
//      kept reading `RATCHET_`. Ten names, including `RATCHET_MINT`. An
//      operator following the freeze document in an emergency would have unset
//      a variable that does not exist and watched nothing happen.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readdirSync } from 'node:fs';

const at = p => new URL('../' + p, import.meta.url);
const read = p => fs.readFileSync(at(p), 'utf8');

const game = read('api/game.js');
const proof = read('api/proof.js');

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };

// ---------------------------------------------------------------- 1. the switch
ok(/const MIRROR_PROGRAM_ID = process\.env\.RATCHET_SEAL_PROGRAM_ID/.test(game),
  'the mirror program id comes from RATCHET_SEAL_PROGRAM_ID');
ok(/const MIRROR_ENABLED = !!\(MIRROR_PROGRAM_ID && MIRROR_RPC_URL\)/.test(game),
  'arming requires the program id; clearing it alone disarms');

const guards = game.match(/if \(!MIRROR_ENABLED\) return res\.status\(503\)/g) || [];
ok(guards.length === 2,
  `both mirror actions refuse when disarmed (found ${guards.length} guards, expected 2)`);

for (const action of ['mirror_build', 'mirror_confirm']) {
  const i = game.indexOf(`if (action === '${action}')`);
  ok(i > -1, `${action} exists`);
  const head = game.slice(i, i + 400);
  ok(/if \(!MIRROR_ENABLED\)/.test(head),
    `${action} checks the switch before doing any work`);
}

ok(/async function mirrorRpc[\s\S]{0,120}if \(!MIRROR_ENABLED\) return undefined;/.test(game),
  'a disarmed site makes no RPC calls at all, not merely refuses at the edge');

// ------------------------------------------------- 2. pulling it breaks nothing
// Every mention of MIRROR_ENABLED must be one of: the definition, the RPC guard,
// a status report, or one of the two action guards. If it ever gates a credit,
// a settlement or a shot, disarming would take the game down with it — which
// would make the escape hatch unusable exactly when it is needed.
const ALLOWED = [
  /^const MIRROR_ENABLED = /,
  /^if \(!MIRROR_ENABLED\) return undefined;$/,
  /^onchainSeal: MIRROR_ENABLED \? /,
  /^mirror: \{ enabled: MIRROR_ENABLED,/,
  /^programId: MIRROR_ENABLED \? MIRROR_PROGRAM_ID : null,$/,
  /^cluster: MIRROR_ENABLED \? MIRROR_CLUSTER : null, feeds: MIRROR_ENABLED \? \[\.\.\.MIRROR_FEEDS\] : \[\] \},$/,
  /^if \(!MIRROR_ENABLED\) return res\.status\(503\)/,
];
const mentions = game.split('\n')
  .map((line, n) => ({ n: n + 1, t: line.trim() }))
  .filter(l => l.t.includes('MIRROR_ENABLED'));
ok(mentions.length > 0, 'the switch is referenced at all');
for (const m of mentions) {
  ok(ALLOWED.some(rx => rx.test(m.t)),
    `api/game.js:${m.n} gates something new on MIRROR_ENABLED — if it is a game path, ` +
    `disarming the mirror would break the game: ${m.t.slice(0, 90)}`);
}

// The public status must tell the truth about being disarmed rather than going quiet.
ok(/onchainSeal: MIRROR_ENABLED \? 'optional-mainnet-beta' : 'disabled'/.test(game),
  'the game reports the mirror as disabled rather than omitting it');
ok(/onchainSeal:SEAL_PROGRAM_ID \? `optional-\$\{SEAL_CLUSTER\}` : 'disabled'/.test(proof),
  'the proof page reports the mirror as disabled rather than omitting it');

// ------------------------------------------- 3. the docs name the real variable
// Every markdown file in the repo, not just README and docs/. The first version of
// this suite scanned those two and passed, while mcp/README.md quietly told external
// agent developers to set RatchetX_WALLET_KEYPAIR -- a variable nothing reads, in the
// one document whose whole job is onboarding the players we do not have.
// ops/heartbeat-worker/ is listed explicitly: readdirSync('ops') returns the
// directory entry, not the README inside it, so the worker's documentation was
// outside every scan this suite ran. The reverse check added below caught that
// on its first run, by reporting TARGET as undocumented while it sat in a table
// in ops/heartbeat-worker/README.md. Same lesson as entry 3, third time: a
// scan shallower than the thing it scans reports confident nonsense.
const MD_DIRS = ['.', 'docs', 'mcp', 'token', 'agent', 'ops', 'ops/heartbeat-worker'];
const DOCS = MD_DIRS.flatMap(d => {
  let names = [];
  try { names = readdirSync(at(d)); } catch { return []; }
  return names.filter(f => f.endsWith('.md')).map(f => (d === '.' ? '' : d + '/') + f);
});
// mcp/ belongs here too: widening the DOCS scan without widening the CODE scan made
// this suite report RATCHET_DEMO_HANDLE as undocumented-by-code when mcp/ratchet-mcp.mjs
// reads it on line 61. A checker with a narrower view than the thing it checks produces
// confident false findings, which is worse than not checking.
const code = ['api', 'lib', 'tools', 'mcp']
  .flatMap(d => readdirSync(at(d)).filter(f => /\.(js|mjs)$/.test(f)).map(f => d + '/' + f))
  .map(read).join('\n');

for (const d of DOCS) {
  const text = read(d);
  const drifted = text.match(/RatchetX_[A-Z][A-Z0-9_]{2,}/g) || [];
  ok(drifted.length === 0,
    `${d} names ${[...new Set(drifted)].join(', ')} — the code has no such variable. ` +
    `Environment variables in this project are RATCHET_*; the rebrand must not follow them into prose.`);
}

// Any environment variable a document tells someone to set must be one the code
// actually reads. Backticks are the filter: prose mentions RATCHET|v2| and other
// protocol constants, but a name in code font is an instruction.
const named = new Set();
for (const d of DOCS) {
  for (const m of read(d).matchAll(/`(RATCHET_[A-Z0-9_]{3,})`/g)) named.add(m[1]);
}
ok(named.size >= 5, `documents name at least a few env vars (found ${named.size})`);
for (const name of [...named].sort()) {
  ok(code.includes('process.env.' + name),
    `the docs tell an operator to set ${name}, but no code reads it`);
}

// --------------------------------------------- 4. the code names no secret var
// The scan above runs docs -> code: every variable a document tells you to set
// must exist in the code. It was one-directional, and on 2026-08-28 the missing
// direction cost something real.
//
// `ops/heartbeat-worker/worker.js` reads `env.SOLANA_WS` to choose the websocket
// it subscribes on. Unset, it falls back to three PUBLIC Solana RPCs. No
// document mentioned the variable, so nobody could know the knob existed --
// and measurement that day found the capture stream silently missing
// account notifications while minute polling saw the same accounts fresh
// (JUP: 323s behind in the stream, account written 80s earlier).
//
// A configuration switch nobody wrote down is a switch nobody can check. So the
// scan now runs both ways.
const CODE_DIRS = ['api', 'lib', 'tools', 'mcp', 'agent', 'ops/heartbeat-worker'];
// HOME is the operating system's, not ours: nothing to document and nothing to
// set. It is the only exemption, and it is named rather than pattern-matched so
// that adding a second one has to be a deliberate act.
const NOT_OURS = new Set(['HOME']);

const readVars = text => {
  const out = new Set();
  for (const m of text.matchAll(/process\.env\.([A-Z][A-Z0-9_]{2,})/g)) out.add(m[1]);
  return out;
};
const codeVars = new Map();
for (const d of CODE_DIRS) {
  let names = [];
  try { names = readdirSync(at(d)); } catch { continue; }
  for (const f of names.filter(n => /\.(js|mjs)$/.test(n))) {
    const rel = d + '/' + f, text = read(rel);
    const found = readVars(text);
    // Cloudflare Workers take configuration off the `env` argument, not
    // process.env, so the worker's whole config surface is invisible to the
    // pattern above -- which is exactly where SOLANA_WS was hiding.
    if (d.startsWith('ops/'))
      for (const m of text.matchAll(/\benv\.([A-Z][A-Z0-9_]{2,})/g)) found.add(m[1]);
    for (const v of found) {
      if (NOT_OURS.has(v)) continue;
      if (!codeVars.has(v)) codeVars.set(v, []);
      codeVars.get(v).push(rel);
    }
  }
}
const allDocs = DOCS.map(read).join('\n');
ok(codeVars.size >= 10, `the code reads a real config surface (found ${codeVars.size})`);
for (const [name, where] of [...codeVars].sort()) {
  ok(allDocs.includes(name),
    `${where.join(', ')} reads ${name}, but no document names it — a switch ` +
    `nobody wrote down is a switch nobody can check, and an unset one fails silently`);
}

console.log(`KILL SWITCH OK — ${checks} checks, ${named.size} documented env vars verified `
  + `against the code, ${codeVars.size} code-read env vars verified against the docs`);
