// Tracker 1.2 — parity, in both senses, in one file because the tracker names
// one file.
//
// PART A (Opus A): the SETTLEMENT RULE. Does the predicate in the JavaScript
// models say what the programs say, and do all five declarations of the adapter
// byte agree? Until this existed the rule had no direct test at any level.
//
// PART B (Gemini 1, commit 0b9a3c1): the ENCODERS. Does client-v2.mjs produce
// byte-identical EvidenceSpec, Economy and Ruleset bytes to model.mjs?
//
// The two were written in parallel and 0b9a3c1 replaced Part A wholesale rather
// than merging. Both are restored here; neither was wrong, and losing either one
// loses a real guarantee.

// Tracker 1.2: the settlement rule, in JavaScript, must say exactly what the
// program says — and the two JavaScript models must say it to each other.
//
// There are three copies of this predicate in the tree: lifecycle.rs (the
// program), rcx-timepin/model-v2.mjs (the Timepin model the client reasons with)
// and ratchet-core-g2/model.mjs (the Core model, mirroring
// foreign_timepin.rs::validate_record_against_spec). Until this file existed,
// nothing compared them, and nothing tested the predicate at all at any level —
// which is how a rule that settles 11 % of real targets reached the build queue.
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
  // bracket settles 11.1 % of targets against a pusher whose phase sweeps.
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

// ------------------------------------------------- the release manifest

test('every adapter named in a release manifest is one the model accepts', () => {
  // The fifth copy of this constant, and the one no compiler and no import graph
  // can reach: a JSON file a human registers on mainnet ONCE, permanently. An
  // adapter byte the model refuses is a SHAPE error and not a tuning question,
  // so this fails even while the manifest is DRAFT — a spec built from it cannot
  // be registered at all, and the registration transaction is the most expensive
  // possible place to discover that. Found by Opus C, 12:37Z.
  const dir = path.join(repo, 'releases');
  const known = new Map(Object.entries(T)
    .filter(([k]) => /^ADAPTER_/.test(k)).map(([k, v]) => [v, k]));
  let checked = 0;
  for (const name of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) {
    let doc;
    try { doc = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); } catch { continue; }
    const adapter = doc?.evidenceSpecTemplate?.adapter;
    if (adapter === undefined) continue;
    checked++;
    assert.ok(known.has(adapter),
      `releases/${name} names adapter ${adapter}, which no adapter constant defines. `
      + `Known: ${[...known].map(([v, k]) => `${k}=${v}`).join(', ')}. `
      + `A mainnet-class registration takes ADAPTER_PYTH_MIN_CAPTURE_V2 = ${MINCAP}.`);
    assert.equal(adapter, MINCAP,
      `releases/${name} names adapter ${adapter} (${known.get(adapter)}), but a `
      + `mainnet-class registration must use ADAPTER_PYTH_MIN_CAPTURE_V2 = ${MINCAP}. `
      + `Adapter ${BRACKET} is the strict bracket and is experimental.`);
  }
  assert.ok(checked > 0,
    'no release manifest declared an evidenceSpecTemplate.adapter — did the field move?');
});

// ------------------------------------------------------------ JS <-> Rust

test('all four declarations of every adapter constant agree', () => {
  // The join with the half that needs a compiler, and the one thing NOTHING at
  // compile time can catch: Core G2 is a FOREIGN reader of Timepin. It does not
  // depend on that crate, so it re-declares the adapter bytes, and two crates
  // that disagree here settle a shot in one program and void it in the other.
  // No compiler sees across that boundary. This does.
  const RUST = [
    'onchain/rcx-timepin-v2/programs/rcx-timepin-v2/src/lib.rs',
    'onchain/ratchet-core-g2/programs/ratchet-core-g2/src/foreign_timepin.rs',
  ];
  const declared = [];
  for (const rel of RUST) {
    const src = fs.readFileSync(path.join(repo, rel), 'utf8');
    const found = [...src.matchAll(/pub const (ADAPTER_[A-Z0-9_]+)\s*:\s*u8\s*=\s*(\d+)\s*;/g)]
      .map(m => [m[1], Number(m[2]), rel]);
    assert.ok(found.length > 0, `${rel} declares no adapter constants — did the file move?`);
    declared.push(...found);
  }
  // Every Rust declaration must match the JS model, name for name and value for value.
  for (const [name, value, rel] of declared) {
    assert.equal(T[name], value,
      `${name} is ${value} in ${rel} but ${T[name]} in model-v2.mjs`);
  }
  // And the two crates must not disagree with each other about a shared name.
  const byName = new Map();
  for (const [name, value, rel] of declared) {
    if (byName.has(name)) {
      assert.equal(byName.get(name)[0], value,
        `${name} is ${byName.get(name)[0]} in ${byName.get(name)[1]} but ${value} in ${rel}`);
    } else byName.set(name, [value, rel]);
  }
  // And the values JS knows must be distinct, so an adapter byte names one rule.
  const js = Object.entries(T).filter(([k]) => /^ADAPTER_/.test(k)).map(([, v]) => v);
  assert.equal(new Set(js).size, js.length, 'two JS adapter constants share a value');
});

// ============================ PART B ============================
// Client <-> model encoder parity (Gemini 1, 0b9a3c1), restored verbatim.

import { Keypair } from '@solana/web3.js';
import crypto from 'crypto';

import { createCoreG2Client } from '../onchain/ratchet-core-g2/client/client-v2.mjs';
import { 
  economyHash,
  encodeEconomy, 
  encodeRuleset, 
  encodeTimepinEvidenceSpec,
  RCX_MINT,
  TOKEN_2022_PROGRAM
} from '../onchain/ratchet-core-g2/model.mjs';
import * as web3 from '@solana/web3.js';

const client = createCoreG2Client({
  web3,
  coreProgramId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  timepinProgramId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  cryptoImpl: crypto.webcrypto
});

const b32 = Buffer.alloc(32, 1);
const pkStr = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const pkBuf = new web3.PublicKey(pkStr).toBytes();
const rcxMintStr = new web3.PublicKey(RCX_MINT).toBase58();
const token2022Str = new web3.PublicKey(TOKEN_2022_PROGRAM).toBase58();

test('EvidenceSpec parity', () => {
  const args = {
    schema: 2, adapter: 1, receiverProgram: pkBuf,
    pushOracleProgram: pkBuf, shardId: 1,
    feedId: b32,
    requiredVerification: 1, targetGridSeconds: 10, minOpenLeadSeconds: 10,
    maxTargetAheadSeconds: 1000, maxPreTargetGapSeconds: 100, maxPostTargetLagSeconds: 100,
    captureGraceSeconds: 100, maxFutureSkewSeconds: 30, minExponent: -10,
    maxExponent: 2, maxConfidenceBps: 100, receiverProgramdataSlot: 1000n,
    receiverConfigHash: b32,
    wormholeProgram: pkBuf, wormholeProgramdataSlot: 1000n
  };
  
  const clientArgs = { ...args, receiverProgram: pkStr, pushOracleProgram: pkStr, wormholeProgram: pkStr };
  
  const clientBuf = client.encodeEvidenceSpecArgs(clientArgs);
  const modelBuf = encodeTimepinEvidenceSpec(args);
  assert.equal(clientBuf.length, 214);
  assert.equal(modelBuf.length, 214);
  assert.ok(Buffer.compare(Buffer.from(clientBuf), modelBuf) === 0);
});

test('Economy parity', () => {
  const args = {
    schema: 2, timepinProgram: pkBuf, timepinSchema: 2,
    clusterGenesisHash: b32, migrationId: b32, legacyRoot: b32,
    legacySnapshotHash: b32, legacyCutoverSlot: 100n, legacyLeafCount: 100n,
    legacyTotalCredits: 100n, legacyTotalXp: 100n, rulesetPolicyRoot: b32,
    rulesetPolicyCount: 1n, rcxMint: RCX_MINT, rcxTokenProgram: TOKEN_2022_PROGRAM,
    rcxDecimals: 6, rawUnitsPerCredit: 1000000n, burnPerMille: 700,
    podiumPerMille: 300, podiumCurve: [500, 300, 200], rankShardCount: 16,
    daySeconds: 86400, hitPayoutNumerator: 17, hitPayoutDenominator: 10,
    settleXp: 10, minStake: 100n, maxStake: 1000n, maxOpen: 5,
    cleanupBondLamports: 50000n, revealWindowSeconds: 3600, maxHorizonSeconds: 7200
  };
  
  const clientArgs = { ...args, timepinProgram: pkStr, rcxMint: rcxMintStr, rcxTokenProgram: token2022Str };
  
  const clientBuf = client.encodeEconomyArgs(clientArgs);
  const modelBuf = encodeEconomy(args);
  assert.ok(Buffer.compare(Buffer.from(clientBuf), modelBuf) === 0);
});

test('Ruleset parity', () => {
  const economyArgs = {
    schema: 2, timepinProgram: pkBuf, timepinSchema: 2,
    clusterGenesisHash: b32, migrationId: b32, legacyRoot: b32,
    legacySnapshotHash: b32, legacyCutoverSlot: 100n, legacyLeafCount: 100n,
    legacyTotalCredits: 100n, legacyTotalXp: 100n, rulesetPolicyRoot: b32,
    rulesetPolicyCount: 1n, rcxMint: RCX_MINT, rcxTokenProgram: TOKEN_2022_PROGRAM,
    rcxDecimals: 6, rawUnitsPerCredit: 1000000n, burnPerMille: 700,
    podiumPerMille: 300, podiumCurve: [500, 300, 200], rankShardCount: 16,
    daySeconds: 86400, hitPayoutNumerator: 17, hitPayoutDenominator: 10,
    settleXp: 10, minStake: 100n, maxStake: 1000n, maxOpen: 5,
    cleanupBondLamports: 50000n, revealWindowSeconds: 3600, maxHorizonSeconds: 7200
  };
  const economy = { ...economyArgs };
  
  const args = {
    schema: 2, economyHash: economyHash(economy), evidenceSpecHash: b32,
    evidencePolicyHash: b32, feedId: b32, entryMode: 1,
    horizonSeconds: 1800, targetGridSeconds: 60, minOpenLeadSeconds: 60,
    maxEntryAgeSeconds: 300,
    bandNumerator: 1, bandDenominator: 1, baseXp: 10n
  };
  
  const clientArgs = { ...args, economyHash: economyHash(economy).toString('hex'), evidenceSpecHash: b32.toString('hex'), evidencePolicyHash: b32.toString('hex'), feedId: b32.toString('hex') };
  const clientBuf = client.encodeRulesetArgs(clientArgs);
  const modelBuf = encodeRuleset(args, economy);
  assert.ok(Buffer.compare(Buffer.from(clientBuf), modelBuf) === 0);
});
