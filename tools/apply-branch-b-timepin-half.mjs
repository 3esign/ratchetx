#!/usr/bin/env node
// I1, TIMEPIN HALF, BRANCH B - EXECUTABLE, NOT PROSE.
//
// RUN THIS ONLY IF THE LEAD'S RULING IS STILL B. As of the last room post I
// read, three of us are blocked on one word - B or C - because 1638bbb landed
// Core's half at 8 + 268 (branch A/C shape) while the lead ruled at 17:00
// "BRANCH B. DEFER THE OBSERVATION ... TimepinNeedV2::LEN 268 -> 160, account
// 168" and restated it at 17:25 as "NEED_LEN 132 -> 168". If the ruling has
// moved to C, DELETE THIS FILE rather than adapting it: under C the eleven
// obs_ fields stay and capture_first must be made to WRITE them, which is a
// different and larger edit that this script must not be mistaken for.
//
// WHY A SCRIPT AND NOT A DIFF: I have no compiler on this mount, so every
// number below is arithmetic on the struct - and arithmetic is exactly what was
// wrong at 8 + 124 against 268. A script can at least refuse to run against a
// tree it does not recognise, and re-derive the width from the fields it leaves
// behind instead of trusting a number I typed. It does that below.
//
// WHAT IT CHANGES, and this is the whole of the Timepin half of I1:
//   lib.rs      TimepinNeedV2 loses the eleven obs_ fields          268 -> 160
//   lib.rs      open_need stops zeroing them
//   lib.rs      the frozen-length test: LEN 268 -> 160, bytes 132 -> 168  (C2)
//   lib.rs      the need() fixture drops the eleven fields
//   lifecycle.rs the WorkManifest ABI pin: 276 -> 168                     (C2)
//   lifecycle.rs the need() fixture drops the eleven fields
//   model-v2.mjs the two lengths and the encoder
// open_refs and rent_payer STAY. The lead ruled it by name, they are the only
// two fields in that block that anything writes, and M1's close_need is built
// on open_refs.
//
// C2 IS THREE LINES, NOT TWO. OpusB said so at 15:36 and he was right and I was
// counting two. The middle one - assert_eq!(need_bytes.len(), 132) in
// exact_compact_account_lengths_are_frozen - IS RED IN THE TREE RIGHT NOW,
// because the struct serialises to 276 against a pin that says 132. That is the
// pin doing precisely the job it was put there to do, and it is the reason this
// edit cannot land silently.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.argv[2] ?? path.resolve(new URL('..', import.meta.url).pathname);
const P = {
  lib: 'onchain/rcx-timepin-v2/programs/rcx-timepin-v2/src/lib.rs',
  life: 'onchain/rcx-timepin-v2/programs/rcx-timepin-v2/src/lifecycle.rs',
  model: 'onchain/rcx-timepin/model-v2.mjs',
};
const read = (k) => fs.readFileSync(path.join(ROOT, P[k]), 'utf8');
const write = (k, s) => fs.writeFileSync(path.join(ROOT, P[k]), s);

const OBS = [
  ['obs_price', 'i64', 8], ['obs_conf', 'u64', 8], ['obs_exponent', 'i32', 4],
  ['obs_publish_time', 'i64', 8], ['obs_prev_publish_time', 'i64', 8],
  ['obs_ema_price', 'i64', 8], ['obs_ema_conf', 'u64', 8],
  ['obs_posted_slot', 'u64', 8], ['obs_capture_slot', 'u64', 8],
  ['obs_capture_ts', 'i64', 8], ['obs_worker', 'Pubkey', 32],
];
const OBS_BYTES = OBS.reduce((n, [, , w]) => n + w, 0); // 108

// The header through candidate_b_hash, field by field, so the target width is
// DERIVED from the struct that survives rather than copied from the ruling.
const HEADER = 2 + 1 + 1 + 32 + 8 + 8 + 8 + 32 + 32; // 124
const RENT = 4 + 32;                                  // 36
const NEW_LEN = HEADER + RENT;                        // 160
const NEW_ACCOUNT = 8 + NEW_LEN;                      // 168
const OLD_LEN = HEADER + OBS_BYTES + RENT;            // 268

let failed = 0;
const must = (cond, what) => { if (!cond) { console.error('REFUSED: ' + what); failed += 1; } };
const sub = (src, from, to, what) => {
  const n = src.split(from).length - 1;
  must(n === 1, `${what}: expected exactly 1 occurrence, found ${n}`);
  return n === 1 ? src.split(from).join(to) : src;
};

// --- guard: is this the tree this script was written against? ---------------
let lib = read('lib');
let life = read('life');
let model = read('model');
must(lib.includes(`pub const LEN: usize = ${OLD_LEN};`), `lib.rs TimepinNeedV2::LEN is not ${OLD_LEN}`);
must(lib.includes('assert_eq!(need_bytes.len(), 132);'), 'lib.rs frozen-length pin is not the 132 I read');
must(life.includes('assert_eq!(manifest.subject_account_size, 276);'), 'lifecycle.rs ABI pin is not 276');
must(model.includes('export const TIMEPIN_NEED_V2_PAYLOAD_LEN = 268;'), 'model-v2.mjs payload length is not 268');
for (const [name] of OBS) must(lib.includes(`pub ${name}:`), `lib.rs has no field ${name}`);
if (failed) { console.error('\nNothing was written. The tree is not the one this script was written against - read it before forcing it.'); process.exit(1); }

// --- lib.rs -----------------------------------------------------------------
// the struct: the comment block and the eleven fields go together
lib = lib.replace(/\n\n {4}\/\/ ---- the observation, inline[\s\S]*?pub obs_worker: Pubkey,\n/,
  '\n\n    // THE OBSERVATION IS NOT HERE, AND THAT IS THE RULING, NOT AN OMISSION.\n'
  + '    // It was inlined here on 2026-09-05 in fe0f8e6 - eleven fields, 108 bytes -\n'
  + '    // and the capture lifecycle that would have written them was never built, so\n'
  + '    // every Need this program can create carried 108 bytes of zeros in a\n'
  + '    // PERMANENT per-target account: 395 SOL a year for a migration whose second\n'
  + '    // half does not exist. The observation lives in the CandidateV2 PDA\n'
  + '    // (lifecycle.rs:496), which capture_first and capture_conflict actually\n'
  + '    // write and which Core actually reads.\n'
  + '    //\n'
  + '    // FINISHING THAT MIGRATION IS DEFERRED, NOT REJECTED, and its reason is\n'
  + '    // written down: it is the only branch that earns the 880,287 lamports, and it\n'
  + '    // is a design change for the next generation rather than a launch change for\n'
  + '    // this one. Anyone reviving it must also answer what capture_conflict does\n'
  + '    // with the SECOND observation - with one inline slot, candidate_b_hash keeps\n'
  + '    // its commitment but loses its preimage on chain.\n'
  + '    // test/test_no_unwritten_fields_in_permanent_accounts.mjs is the gate that\n'
  + '    // stops the next such field from shipping declared and dead.\n');
must(!lib.includes('pub obs_price:'), 'lib.rs struct still has obs_price after the removal');

lib = sub(lib,
  `    // 124 (through candidate_b_hash) + 108 (the inline observation) + 36 (rent).`,
  `    // ${HEADER} (through candidate_b_hash) + ${RENT} (rent). The observation is NOT here;`
  + `\n    // see the struct comment above.`,
  'lib.rs LEN comment');
lib = sub(lib, `pub const LEN: usize = ${OLD_LEN};`, `pub const LEN: usize = ${NEW_LEN};`, 'lib.rs LEN');

// open_need stops zeroing what no longer exists
lib = lib.replace(/ {8}\/\/ No observation yet, and no reference from Core[\s\S]*?need\.obs_worker = Pubkey::default\(\);\n/,
  '        // No reference from Core until a shot seals against this target, and\n'
  + '        // rent_payer is the only address close_need will ever refund.\n');
must(!lib.includes('need.obs_price = 0;'), 'lib.rs open_need still zeroes obs_price');

// the test fixture
lib = lib.replace(/ {12}obs_price: 0,[\s\S]*?obs_worker: Pubkey::default\(\),\n/, '');

// C2, lines one and two
lib = sub(lib, `assert_eq!(TimepinNeedV2::LEN, ${OLD_LEN});`, `assert_eq!(TimepinNeedV2::LEN, ${NEW_LEN});`, 'C2 pin 1');
lib = sub(lib, 'assert_eq!(need_bytes.len(), 132);', `assert_eq!(need_bytes.len(), ${NEW_ACCOUNT});`, 'C2 pin 2');

// --- lifecycle.rs: C2 line three, and the fixture ---------------------------
life = sub(life, 'assert_eq!(manifest.subject_account_size, 276);', `assert_eq!(manifest.subject_account_size, ${NEW_ACCOUNT});`, 'C2 pin 3');
life = life.replace(/ {12}obs_price: 0,[\s\S]*?obs_worker: Pubkey::default\(\),\n/, '');

// --- model-v2.mjs -----------------------------------------------------------
model = sub(model, '// 124 (through candidateBHash) + 108 (the inline observation) + 36 (rent).',
  `// ${HEADER} (through candidateBHash) + ${RENT} (rent). The observation is NOT in the Need.`, 'model comment 1');
model = sub(model, '// MIN_CAPTURE_SPEC section 2: the observation moved out of its own PDA, where\n// every replacement minted a new permanently-rented account.',
  '// Branch B, 2026-09-05: inlining the observation was reverted before launch\n'
  + '// because nothing wrote it. It stays in the CandidateV2 PDA. This constant and\n'
  + '// rcx-timepin-v2 lib.rs TimepinNeedV2::LEN must move together or Core cannot\n'
  + '// decode a Need - test/test_foreign_timepin_abi.mjs is what says so.', 'model comment 2');
model = sub(model, 'export const TIMEPIN_NEED_V2_PAYLOAD_LEN = 268;', `export const TIMEPIN_NEED_V2_PAYLOAD_LEN = ${NEW_LEN};`, 'model payload len');
model = sub(model, 'export const TIMEPIN_NEED_V2_ACCOUNT_LEN = 276;', `export const TIMEPIN_NEED_V2_ACCOUNT_LEN = ${NEW_ACCOUNT};`, 'model account len');
model = model.replace(/ {4}\/\/ The inline observation\. Appended, never inserted[\s\S]*?bytes32\(need\.obsWorker \?\? ZERO32, 'need\.obsWorker'\),\n/,
  '    // open_refs and rent_payer only. The observation is not in the Need; see the\n'
  + '    // constant above.\n');
must(!model.includes('need.obsPrice'), 'model-v2.mjs encoder still writes obsPrice');

if (failed) { console.error('\nNothing was written.'); process.exit(1); }
write('lib', lib); write('life', life); write('model', model);
console.log(`applied: TimepinNeedV2::LEN ${OLD_LEN} -> ${NEW_LEN}, account -> ${NEW_ACCOUNT}`);
console.log('C2 pins re-derived: lib.rs LEN, lib.rs need_bytes.len(), lifecycle.rs subject_account_size');
console.log('NOT DONE HERE and still required before this compiles:');
console.log('  - Core: NEED_ACCOUNT_LEN -> 8 + ' + NEW_LEN + ', the View drops the eleven obs_ fields,');
console.log('    record_from_need reverts to reading the CandidateV2 PDA (1638bbb must be undone)');
console.log('  - svm-tests: NEED_LEN 132 -> ' + NEW_ACCOUNT + ' (the lead built the const for it in 935eb75)');
console.log('  - test/test_no_unwritten_fields_in_permanent_accounts.mjs: delete the eleven obs_ BASELINE');
console.log('    entries; the suite FAILS until you do, which is the ratchet working');
console.log('EVIDENCE TIER: none yet. This script has a compiler nowhere near it. Build before believing it.');
