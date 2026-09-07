// One program has one identity. Nine files say what it is. Nothing compared them.
//
// Opus B found on 2026-09-05 that BUILD_G2.cmd, the economy manifest and the
// mainnet gate all name ANVGVtDr... as the Core program, while
// ratchet-core-g2/src/lib.rs declares cGfHiC6.... Verified independently here.
// The split is not three stray files, it is TWO INTERNALLY CONSISTENT HALVES
// THAT NEVER MEET: everything that compiles or is tested says one id, and
// everything that builds, releases or gates says the other.
//
// They never meet because nothing in this repository compared an id in a
// release artifact to an id in a declare_id!. This file is that comparison.
//
// It is deliberately NOT an opinion about WHICH id is right. That is an
// identity decision, it belongs to whoever holds the keypair, and getting it
// wrong is a permanent new generation. This file only insists that every file
// agrees with the SOURCE, whichever way the source is settled - so the decision
// gets made once, on purpose, instead of being discovered by a deploy.
//
// Evidence tier: host. Reads files as text; compiles nothing.

import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => {
  const path = join(ROOT, rel);
  assert.ok(existsSync(path), `${rel} is gone; this check no longer covers it`);
  return readFileSync(path, 'utf8');
};

let checks = 0;
const one = (source, pattern, what) => {
  const found = [...source.matchAll(pattern)].map(m => m[1]);
  assert.ok(found.length > 0, `no program id found for ${what}`);
  const distinct = [...new Set(found)];
  assert.equal(distinct.length, 1,
    `${what} names ${distinct.length} different ids: ${distinct.join(', ')}`);
  checks += 1;
  return distinct[0];
};

// --- the authority: what the programs actually declare ------------------------
// declare_id! is not one opinion among nine. It is the only one that is compiled
// into the artifact and therefore the only one a validator will ever agree with.

const CORE_SRC = 'onchain/ratchet-core-g2/programs/ratchet-core-g2/src/lib.rs';
const TIMEPIN_SRC = 'onchain/rcx-timepin-v2/programs/rcx-timepin-v2/src/lib.rs';
const declareId = /declare_id!\("([1-9A-HJ-NP-Za-km-z]{32,44})"\)/g;

const DECLARED = {
  core: one(read(CORE_SRC), declareId, `declare_id! in ${CORE_SRC}`),
  timepin: one(read(TIMEPIN_SRC), declareId, `declare_id! in ${TIMEPIN_SRC}`),
};

checks += 1;
assert.notEqual(DECLARED.core, DECLARED.timepin,
  'the two programs declare the SAME id, which cannot be right');

// --- every other file that names one, and how it names it --------------------
// Listed one by one on purpose. A regex loose enough to find them automatically
// would also match mints, feed accounts and PDAs - and a check that matches the
// wrong string is how this whole class of defect works.

const CLAIMS = [
  ['core', 'onchain/ratchet-core-g2/Anchor.toml',
    /ratchet_core_g2\s*=\s*"([1-9A-HJ-NP-Za-km-z]{32,44})"/g],
  ['timepin', 'onchain/rcx-timepin-v2/Anchor.toml',
    /rcx_timepin_v2\s*=\s*"([1-9A-HJ-NP-Za-km-z]{32,44})"/g],
  ['core', 'BUILD_G2.cmd',
    /set CORE_ID=([1-9A-HJ-NP-Za-km-z]{32,44})/g],
  ['timepin', 'BUILD_G2.cmd',
    /set TIMEPIN_ID=([1-9A-HJ-NP-Za-km-z]{32,44})/g],
  ['core', 'releases/g2-mainnet-economy.json',
    /"core"\s*:\s*"([1-9A-HJ-NP-Za-km-z]{32,44})"/g],
  ['timepin', 'releases/g2-mainnet-economy.json',
    /"timepin"\s*:\s*"([1-9A-HJ-NP-Za-km-z]{32,44})"/g],
  ['core', 'onchain/ratchet-core-g2/legacy-snapshot.mjs',
    /CORE_G2_PROGRAM_ID\s*=\s*'([1-9A-HJ-NP-Za-km-z]{32,44})'/g],
  // Anchored on the FUNCTION, not on Pubkey::from_str - that file constructs
  // thirteen different pubkeys that way, including the system program and the
  // forbidden US517 identity, and a pattern loose enough to catch them all is
  // exactly the kind of check this file exists to replace.
  ['core', 'onchain/ratchet-core-g2/svm-tests/tests/core_g2_lifecycle.rs',
    /fn core_program\(\) -> Pubkey \{\s*Pubkey::from_str\("([1-9A-HJ-NP-Za-km-z]{32,44})"\)/g],
  ['timepin', 'onchain/ratchet-core-g2/svm-tests/tests/core_g2_lifecycle.rs',
    /fn timepin_program\(\) -> Pubkey \{\s*Pubkey::from_str\("([1-9A-HJ-NP-Za-km-z]{32,44})"\)/g],
];

const disagreements = [];
for (const [program, file, pattern] of CLAIMS) {
  const claimed = one(read(file), pattern, `${program} in ${file}`);
  if (claimed !== DECLARED[program]) {
    disagreements.push(`${file} says ${program} is ${claimed}`);
  }
}

// The gate names both ids in one table, so it is read as a pair rather than
// with two separate patterns.
const gate = read('tools/mainnet-go-check.mjs');
const gateIds = [...gate.matchAll(
  /(?:core|timepin):\s*'([1-9A-HJ-NP-Za-km-z]{32,44})',/g,
)].map(m => m[1]);
checks += 1;
assert.equal(gateIds.length, 2,
  `expected the gate's two artifact-identity ids, found ${gateIds.length}. ` +
  'If that table moved, this check is looking at the wrong thing and is worth ' +
  'less than nothing.');
if (!gateIds.includes(DECLARED.timepin)) {
  disagreements.push(
    `tools/mainnet-go-check.mjs does not name timepin ${DECLARED.timepin}`);
}
if (!gateIds.includes(DECLARED.core)) {
  disagreements.push(
    `tools/mainnet-go-check.mjs says core is ${
      gateIds.find(id => id !== DECLARED.timepin)}`);
}

checks += 1;
assert.deepEqual(disagreements, [],
  '\n\nPROGRAM IDENTITY DISAGREES WITH THE SOURCE.\n\n' +
  `The programs declare:\n  core    ${DECLARED.core}\n  timepin ` +
  `${DECLARED.timepin}\n\nThese files say otherwise:\n  ` +
  `${disagreements.join('\n  ')}\n\n` +
  'THIS IS A DECISION, NOT A BUG TO PATCH, and it is not this test\'s to make.\n' +
  'Either the source keeps the id it declares and the files above are corrected\n' +
  'to match it - a one-line edit each - or the source is retargeted, which is a\n' +
  'NEW GENERATION: every PDA address derived from the program id moves, and so\n' +
  'do commitment_hash, game_result_hash, completion_result_hash and\n' +
  'reload_route_memo, which bind crate::ID directly. economy_hash and\n' +
  'ruleset_hash do NOT move - neither binds a core program id - unless the\n' +
  'legacy migration is non-empty, because legacy_leaf() binds crate::ID and\n' +
  'legacy_root is an EconomyArgs field.\n\n' +
  'Whoever holds the keypair decides. Until then this stays red, because an\n' +
  'artifact built from this source will not verify against the id the build\n' +
  'script, the manifest and the gate are all expecting.\n');

console.log(
  `program identity is one fact: ${checks} checks passed ` +
  `(host tier; core ${DECLARED.core.slice(0, 8)}..., ` +
  `timepin ${DECLARED.timepin.slice(0, 8)}...)`,
);
