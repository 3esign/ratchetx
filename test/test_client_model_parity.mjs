// Tracker 1.2: the settlement rule, in JavaScript, must say exactly what the
// program says — and the two JavaScript models must say it to each other.
//
// There are three copies of this predicate in the tree: lifecycle.rs (the
// program), rcx-timepin/model-v2.mjs (the Timepin model the client reasons with)
// and ratchet-core-g2/model.mjs (the Core model, mirroring
// foreign_timepin.rs::validate_record_against_spec). Until this file existed,
// nothing compared them, and nothing tested the predicate at all at any level —
// which is how a rule measured at 0/25 on the real feed reached the build queue.
//
// What this file can and cannot prove, stated so nobody over-quotes it:
//   * JS <-> JS parity on the same candidate bytes: PROVEN here.
//   * the adapter constants JS shares with Rust: PROVEN here, by reading lib.rs.
//   * JS <-> Rust behavioural parity: NOT proven here and not provable without a
//     compiler. That is MIN_CAPTURE_SPEC.md section 7, at host and exact-SBF, and
//     it belongs to whoever holds cargo.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const T = await import(path.join(repo, 'onchain/rcx-timepin/model-v2.mjs'));
const C = await import(path.join(repo, 'onchain/ratchet-core-g2/model.mjs'));

const BRACKET = T.ADAPTER_PYTH_PUSH_V2;         // 1, experimental
const MINCAP  = T.ADAPTER_PYTH_MIN_CAPTURE_V2;  // 2, mainnet-class

const TARGET = 1_800_000_060n;
const spec = adapter => ({
  adapter,
  maxPreTargetGapSeconds: adapter === MINCAP ? 0 : 5,
  maxPostTargetLagSeconds: 60,
  minExponent: -12, maxExponent: -2,
  maxConfidenceBps: 10_000,
});
const need = { targetTs: TARGET, sourceDeadlineTs: TARGET + 3600n };
const cand = (publishTime, prevPublishTime) => ({
  publishTime, prevPublishTime,
  price: 10_000_000_000n, conf: 1_000n, exponent: -8,
});
const code = r => (r.ok ? 'OK' : r.code);

// ---------------------------------------------------------------- the rule

test('MIN-CAPTURE accepts publish_time == T and rejects T-1', () => {
  assert.equal(code(T.validateDecisionFields(spec(MINCAP), need, cand(TARGET, TARGET - 1n))), 'OK');
  assert.equal(code(T.validateDecisionFields(spec(MINCAP), need, cand(TARGET - 1n, TARGET - 2n))),
    'PUBLISH_BEFORE_TARGET');
});

test('MIN-CAPTURE accepts a print later than T — that is the whole point', () => {
  // Under the strict bracket this print is inadmissible, and that is why the
  // bracket measured 0/25 against a pusher posting on its own ~5 s schedule.
  const late = cand(TARGET + 4n, TARGET + 3n);
  assert.equal(code(T.validateDecisionFields(spec(MINCAP), need, late)), 'OK');
  assert.equal(code(T.validateDecisionFields(spec(BRACKET), need, late)), 'NOT_CROSSING');
});

test('the two adapters disagree on an intra-second repeat, deliberately', () => {
  // pub == prev == T. On a full-aggregate source these carry genuinely different
  // prices (20 of 98 keys, up to 3 messages). The strict `<` on the left is the
  // only thing that excludes them, and it is why the two predicates must never be
  // "unified": MIN-CAPTURE is safe from this only because the sponsored PDA it is
  // pinned to holds one message at a time.
  const repeat = cand(TARGET, TARGET);
  assert.equal(code(T.validateDecisionFields(spec(BRACKET), need, repeat)), 'NOT_CROSSING');
  assert.equal(code(T.validateDecisionFields(spec(MINCAP), need, repeat)), 'OK');
});

test('the post-target lag bound is what keeps MIN-CAPTURE finite', () => {
  const s = spec(MINCAP);
  const edge = TARGET + BigInt(s.maxPostTargetLagSeconds);
  assert.equal(code(T.validateDecisionFields(s, need, cand(edge, edge - 1n))), 'OK');
  assert.equal(code(T.validateDecisionFields(s, need, cand(edge + 1n, edge))), 'POST_LAG');
});

test('the pre-target gap bound is inert under MIN-CAPTURE and live under the bracket', () => {
  // A print whose predecessor is far behind T: the bracket rejects on PRE_GAP,
  // MIN-CAPTURE has no opinion because prev_publish_time is not in its predicate.
  const stale = cand(TARGET, TARGET - 50n);
  assert.equal(code(T.validateDecisionFields(spec(BRACKET), need, stale)), 'PRE_GAP');
  assert.equal(code(T.validateDecisionFields(spec(MINCAP), need, stale)), 'OK');
});

// -------------------------------------------------- registration-time rules

const fullSpec = adapter => ({
  schema: T.TIMEPIN_SCHEMA_V2, adapter,
  receiverProgram: T.OFFICIAL_PYTH_RECEIVER_PROGRAM,
  pushOracleProgram: T.OFFICIAL_PYTH_PUSH_ORACLE_PROGRAM,
  feedId: Buffer.alloc(32, 7), shardId: 0,
  requiredVerification: T.VERIFICATION_FULL,
  targetGridSeconds: 60, minOpenLeadSeconds: 10, maxTargetAheadSeconds: 3600,
  maxPreTargetGapSeconds: adapter === MINCAP ? 0 : 5,
  maxPostTargetLagSeconds: 60, captureGraceSeconds: 60, maxFutureSkewSeconds: 30,
  maxConfidenceBps: 100, minExponent: -12, maxExponent: -2,
  receiverProgramdataSlot: 1n, wormholeProgramdataSlot: 1n,
  receiverConfigHash: Buffer.alloc(32, 3), wormholeProgram: Buffer.alloc(32, 4),
});

test('both adapters register, and each one pins the pre-gap the other way', () => {
  assert.equal(code(T.validateEvidenceSpec(fullSpec(MINCAP))), 'OK');
  assert.equal(code(T.validateEvidenceSpec(fullSpec(BRACKET))), 'OK');
  assert.equal(code(T.validateEvidenceSpec({ ...fullSpec(MINCAP), maxPreTargetGapSeconds: 5 })),
    'PRE_GAP_MUST_BE_ZERO');
  assert.equal(code(T.validateEvidenceSpec({ ...fullSpec(BRACKET), maxPreTargetGapSeconds: 0 })),
    'ZERO_PRE_GAP');
});

test('an unknown adapter is still refused', () => {
  assert.equal(code(T.validateEvidenceSpec({ ...fullSpec(MINCAP), adapter: 3 })), 'BAD_ADAPTER');
});

// ------------------------------------------------------------- JS <-> JS

test('the Core model reaches the same verdict as the Timepin model, on the same bytes', () => {
  const programId = Buffer.alloc(32, 9);
  const needKey = Buffer.alloc(32, 5);
  const coreSpec = { ...fullSpec(MINCAP), registeredSlot: 1n };
  const coreNeed = { key: needKey, targetTs: TARGET, captureDeadlineTs: TARGET + 600n };

  const build = (publishTime, prevPublishTime) => T.encodeCandidateV2({
    schema: T.TIMEPIN_SCHEMA_V2, bump: 255, need: needKey,
    price: 10_000_000_000n, conf: 1_000n, exponent: -8,
    publishTime, prevPublishTime, emaPrice: 10_000_000_000n, emaConf: 1_000n,
    postedSlot: 10n, captureSlot: 11n, captureTs: TARGET + 1n,
  });
  const coreVerdict = (publishTime, prevPublishTime) => {
    try {
      C.authenticateTimepinCandidate({
        account: { key: Buffer.alloc(32, 1), owner: programId, data: build(publishTime, prevPublishTime) },
        timepinProgram: programId, need: coreNeed,
        expectedMessageHash: Buffer.alloc(32, 2), evidenceSpec: coreSpec,
      });
      return 'OK';
    } catch (error) { return String(error.message ?? error); }
  };

  // Accepted by both: a late print under MIN-CAPTURE.
  assert.equal(code(T.validateDecisionFields(spec(MINCAP), need, cand(TARGET + 4n, TARGET + 3n))), 'OK');
  assert.doesNotMatch(coreVerdict(TARGET + 4n, TARGET + 3n), /BRACKET|GAP/);

  // Rejected by both: a print before the target.
  assert.equal(code(T.validateDecisionFields(spec(MINCAP), need, cand(TARGET - 1n, TARGET - 2n))),
    'PUBLISH_BEFORE_TARGET');
  assert.match(coreVerdict(TARGET - 1n, TARGET - 2n), /TIMEPIN_CANDIDATE_BRACKET/);

  // The intra-second repeat: both models must ACCEPT it under MIN-CAPTURE. If one
  // of them keeps the strict `<` while the other drops it, a shot settles in the
  // client and voids on chain, or worse the reverse.
  assert.equal(code(T.validateDecisionFields(spec(MINCAP), need, cand(TARGET, TARGET))), 'OK');
  assert.doesNotMatch(coreVerdict(TARGET, TARGET), /BRACKET|GAP/);
});

// ------------------------------------------------------------ JS <-> Rust

test('every adapter constant Rust declares has the same name and value in JS', () => {
  // The join with the half that needs a compiler. It cannot go red today, and it
  // goes red the moment the two sides pick different numbers for the same rule —
  // which is the failure this whole file exists to make impossible.
  const rust = fs.readFileSync(
    path.join(repo, 'onchain/rcx-timepin-v2/programs/rcx-timepin-v2/src/lib.rs'), 'utf8');
  const declared = [...rust.matchAll(/pub const (ADAPTER_[A-Z0-9_]+)\s*:\s*u8\s*=\s*(\d+)\s*;/g)]
    .map(m => [m[1], Number(m[2])]);
  assert.ok(declared.length > 0, 'lib.rs declares no adapter constants — did the file move?');
  for (const [name, value] of declared) {
    assert.equal(T[name], value,
      `${name} is ${value} in lib.rs but ${T[name]} in model-v2.mjs`);
  }
  // And the values JS knows must be distinct, so an adapter byte names one rule.
  const js = Object.entries(T).filter(([k]) => /^ADAPTER_/.test(k)).map(([, v]) => v);
  assert.equal(new Set(js).size, js.length, 'two JS adapter constants share a value');
});
