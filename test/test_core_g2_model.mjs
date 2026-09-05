import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import {
  CORE_G2_SCHEMA,
  COMPLETION_SCHEMA,
  ECONOMY_CANONICAL_LEN,
  ECONOMY_ACCOUNT_LEN,
  RULESET_CANONICAL_LEN,
  RULESET_ACCOUNT_LEN,
  RULESET_POLICY_CANONICAL_LEN,
  SHOT_RESULT_LEN,
  GAME_RESULT_FACTS_LEN,
  HISTORY_PAGE_CAP,
  HISTORY_PAGE_LEN,
  HISTORY_PAGE_BASE_LEN,
  HISTORY_PAGE_MAX_LEN,
  HISTORY_PAGE_PRE_M3_MAX_LEN,
  historyRowHash,
  historyChainFold,
  encodeShotResult,
  popcount16,
  RELOAD_HISTORY_PAGE_CAP,
  RELOAD_RECORD_LEN,
  RELOAD_HISTORY_PAGE_BASE_LEN,
  RELOAD_HISTORY_PAGE_MAX_LEN,
  WORK_PAGE_CAP,
  WORK_RECORD_LEN,
  WORK_PAGE_BASE_LEN,
  WORK_PAGE_MAX_LEN,
  CORE_MIN_EXPONENT,
  CORE_MAX_EXPONENT,
  RCX_DECIMALS,
  RCX_RAW_UNITS_PER_CREDIT,
  RCX_MINT,
  TOKEN_2022_PROGRAM,
  CURRENT_RELOAD_PARITY,
  TIMEPIN_SCHEMA_V2,
  TIMEPIN_EVIDENCE_POLICY_CANONICAL_LEN,
  TIMEPIN_EVIDENCE_SPEC_CANONICAL_LEN,
  TIMEPIN_EVIDENCE_SPEC_ACCOUNT_LEN,
  TIMEPIN_NEED_ACCOUNT_LEN,
  TIMEPIN_CANDIDATE_ACCOUNT_LEN,
  ENTRY_MODE,
  RELOAD_ACTION,
  WORK_KIND,
  RECEIPT_DISPOSITION,
  SIDE,
  SHOT_STATE,
  TIMEPIN_STATE,
  VOID_REASON,
  CoreG2Error,
  RatchetCoreG2Model,
  encodeEconomy,
  economyHash,
  encodeRuleset,
  rulesetHash,
  encodeRulesetPolicy,
  rulesetPolicyHash,
  rulesetPolicyMerkleParent,
  legacyLeafHash,
  legacyMerkleParent,
  commitmentHash,
  makeEconomyAccount,
  makeRulesetAccount,
  encodeTimepinEvidencePolicy,
  timepinEvidencePolicyHash,
  encodeTimepinEvidenceSpec,
  timepinEvidenceSpecHash,
  makeTimepinEvidenceSpecAccount,
  authenticateTimepinEvidenceSpec,
  deriveEconomyPda,
  deriveRulesetPda,
  deriveLedgerPda,
  deriveShotPda,
  deriveHistoryPagePda,
  deriveReloadHistoryPagePda,
  deriveWorkPagePda,
  deriveTimepinEvidenceSpecPda,
  authenticateTerminalFact,
  timepinResultHash,
  scaleToE12,
  compareExactPrices,
  sealXp,
  skillXp,
  terminalXpReserve,
  hitPayout,
  brierScore,
  resolutionHash,
  compactResultCommit,
  gameResultHash,
  verifyGameResult,
  completionResultHash,
  historyPageSerializedLen,
  reloadRecordAccounting,
  reloadHistoryPageSerializedLen,
  workPageSerializedLen,
  requireLedgerConservation,
} from '../onchain/ratchet-core-g2/model.mjs';

let checks = 0;
const ok = (value, message) => {
  assert.ok(value, message);
  checks += 1;
};
const eq = (actual, expected, message) => {
  assert.deepStrictEqual(actual, expected, message);
  checks += 1;
};
const neq = (actual, expected, message) => {
  assert.notDeepStrictEqual(actual, expected, message);
  checks += 1;
};
const throwsCode = (fn, code) => {
  assert.throws(fn, error => error instanceof CoreG2Error && error.code === code);
  checks += 1;
};
const noMutation = (model, fn, code) => {
  const revision = model.revision;
  const before = model.snapshot();
  throwsCode(fn, code);
  eq(model.revision, revision, code + ' revision');
  eq(model.snapshot(), before, code + ' state');
};

const sha256 = value => createHash('sha256').update(value).digest();
const pk = label => sha256(Buffer.from('core-g2-test:' + label));
const zero32 = Buffer.alloc(32);
const disc = name => sha256(Buffer.from('account:' + name)).subarray(0, 8);
const NEED_DISC = disc('TimepinNeedV2');
const CANDIDATE_DISC = disc('CandidateV2');
const MSG_DOMAIN = Buffer.from('rcx-timepin:pyth-price-message:v2\0');

const u8 = n => {
  const out = Buffer.alloc(1); out.writeUInt8(Number(n)); return out;
};
const u16 = n => {
  const out = Buffer.alloc(2); out.writeUInt16LE(Number(n)); return out;
};
const u32 = n => {
  const out = Buffer.alloc(4); out.writeUInt32LE(Number(n)); return out;
};
const i32 = n => {
  const out = Buffer.alloc(4); out.writeInt32LE(Number(n)); return out;
};
const u64 = n => {
  const out = Buffer.alloc(8); out.writeBigUInt64LE(BigInt(n)); return out;
};
const i64 = n => {
  const out = Buffer.alloc(8); out.writeBigInt64LE(BigInt(n)); return out;
};
const pda = (program, seeds) => {
  const [key, bump] = PublicKey.findProgramAddressSync(
    seeds.map(seed => Buffer.from(seed)), new PublicKey(program),
  );
  return { key: key.toBuffer(), bump };
};
const account = (key, owner, data) => ({
  key: Buffer.from(key), owner: Buffer.from(owner), executable: false,
  data: Buffer.from(data),
});
const mutate = (value, update) => {
  const out = structuredClone(value);
  out.key = Buffer.from(value.key);
  out.owner = Buffer.from(value.owner);
  out.data = Buffer.from(value.data);
  update(out);
  return out;
};

const makeRecord = ({
  feedId, price, conf = 10n, exponent = -2,
  publishTime, prevPublishTime, postedSlot = 10n, captureSlot = 11n,
  captureTs,
}) => {
  const record = {
    feedId: Buffer.from(feedId), price: BigInt(price), conf: BigInt(conf),
    exponent, publishTime: BigInt(publishTime),
    prevPublishTime: BigInt(prevPublishTime),
    emaPrice: BigInt(price), emaConf: BigInt(conf),
  };
  record.messageHash = sha256(Buffer.concat([
    MSG_DOMAIN, record.feedId, i64(record.price), u64(record.conf),
    i32(record.exponent), i64(record.publishTime),
    i64(record.prevPublishTime), i64(record.emaPrice), u64(record.emaConf),
  ]));
  return { ...record, postedSlot: BigInt(postedSlot),
    captureSlot: BigInt(captureSlot), captureTs: BigInt(captureTs) };
};

const needKey = (timepinProgram, evidenceSpecHash, targetTs) =>
  pda(timepinProgram, [
    Buffer.from('need'), u16(TIMEPIN_SCHEMA_V2),
    evidenceSpecHash, i64(targetTs),
  ]);

const makeNeed = ({
  timepinProgram, evidenceSpecHash, targetTs, state,
  candidateAHash = zero32, candidateBHash = zero32,
  sourceDeadlineTs = BigInt(targetTs) + 10n,
  captureDeadlineTs = BigInt(targetTs) + 20n,
}) => {
  const derived = needKey(timepinProgram, evidenceSpecHash, targetTs);
  const data = Buffer.concat([
    NEED_DISC, u16(TIMEPIN_SCHEMA_V2), u8(derived.bump), u8(state),
    evidenceSpecHash, i64(targetTs), i64(sourceDeadlineTs),
    i64(captureDeadlineTs), candidateAHash, candidateBHash,
    // The two rent fields, 4 + 32. The 108 bytes of inline observation that used
    // to be appended here are gone from the account: nothing ever wrote them, and
    // MIN_CAPTURE_SPEC section 2 described a migration whose second half never
    // landed. Zeroed on purpose - Core reads the header, and a fixture that
    // filled these in would stop testing what it was written to test.
    Buffer.alloc(36),
  ]);
  eq(data.length, TIMEPIN_NEED_ACCOUNT_LEN, 'Need byte length');
  return account(derived.key, timepinProgram, data);
};

const makeCandidate = ({ timepinProgram, need, record }) => {
  const derived = pda(timepinProgram, [
    Buffer.from('candidate'), need.key, record.messageHash,
  ]);
  const data = Buffer.concat([
    CANDIDATE_DISC, u16(TIMEPIN_SCHEMA_V2), u8(derived.bump), need.key,
    i64(record.price), u64(record.conf),
    i32(record.exponent), i64(record.publishTime),
    i64(record.prevPublishTime), i64(record.emaPrice), u64(record.emaConf),
    u64(record.postedSlot), u64(record.captureSlot), i64(record.captureTs),
  ]);
  eq(data.length, TIMEPIN_CANDIDATE_ACCOUNT_LEN, 'Candidate byte length');
  return account(derived.key, timepinProgram, data);
};

const openNeed = (ctx, targetTs) => makeNeed({
  timepinProgram: ctx.timepinProgram,
  evidenceSpecHash: ctx.evidenceSpecHash,
  targetTs,
  state: TIMEPIN_STATE.OPEN,
});

const finalFact = (ctx, targetTs, options = {}) => {
  const record = makeRecord({
    feedId: ctx.feedId,
    price: options.price ?? 10_000n,
    conf: options.conf ?? 10n,
    exponent: options.exponent ?? -2,
    publishTime: options.publishTime ?? BigInt(targetTs) + 1n,
    prevPublishTime: options.prevPublishTime ?? BigInt(targetTs) - 1n,
    captureTs: options.captureTs ?? BigInt(targetTs) + 2n,
    postedSlot: options.postedSlot ?? 10n,
    captureSlot: options.captureSlot ?? 11n,
  });
  const need = makeNeed({
    timepinProgram: ctx.timepinProgram,
    evidenceSpecHash: ctx.evidenceSpecHash,
    targetTs,
    state: TIMEPIN_STATE.FINAL,
    candidateAHash: record.messageHash,
  });
  const candidate = makeCandidate({
    timepinProgram: ctx.timepinProgram, need, record,
  });
  return { need, candidate };
};

const voidFact = (ctx, targetTs, kind) => {
  let a = zero32;
  let b = zero32;
  if (kind === TIMEPIN_STATE.AMBIGUOUS) {
    const values = [pk('ambiguous-a:' + targetTs), pk('ambiguous-b:' + targetTs)]
      .sort(Buffer.compare);
    [a, b] = values;
  }
  const need = makeNeed({
    timepinProgram: ctx.timepinProgram,
    evidenceSpecHash: ctx.evidenceSpecHash,
    targetTs,
    state: kind,
    candidateAHash: a,
    candidateBHash: b,
  });
  return { need };
};

const programId = pk('core-program');
const timepinProgram = pk('timepin-program');
const feedId = pk('feed');
const evidenceSpec = {
  schema: TIMEPIN_SCHEMA_V2,
  adapter: 1,
  receiverProgram: pk('pyth-receiver-program'),
  pushOracleProgram: pk('pyth-push-oracle-program'),
  shardId: 0,
  feedId,
  requiredVerification: 1,
  targetGridSeconds: 60,
  minOpenLeadSeconds: 30,
  maxTargetAheadSeconds: 7_200,
  maxPreTargetGapSeconds: 120,
  maxPostTargetLagSeconds: 10,
  captureGraceSeconds: 10,
  maxFutureSkewSeconds: 5,
  minExponent: CORE_MIN_EXPONENT,
  maxExponent: CORE_MAX_EXPONENT,
  maxConfidenceBps: 1_000,
  receiverProgramdataSlot: 5n,
  receiverConfigHash: pk('pyth-receiver-config-generation-a'),
  wormholeProgram: pk('wormhole-program'),
  wormholeProgramdataSlot: 6n,
  registeredSlot: 9n,
};
const evidencePolicyHash = timepinEvidencePolicyHash(evidenceSpec);
const evidenceSpecHash = timepinEvidenceSpecHash(evidenceSpec);
const evidenceSpecAccount = makeTimepinEvidenceSpecAccount(
  timepinProgram, evidenceSpec,
);
const legacyPlayer = pk('legacy-player');
const clusterGenesisHash = pk('cluster-genesis');
const migrationId = pk('migration-id');
const legacySnapshotHash = pk('legacy-snapshot');
const legacyCutoverSlot = 90n;
const legacyCredits = 250n;
const legacyXp = 75n;
const legacyLeaf = legacyLeafHash({
  programId, clusterGenesisHash, migrationId,
  snapshotHash: legacySnapshotHash, cutoverSlot: legacyCutoverSlot,
  player: legacyPlayer, credits: legacyCredits, xp: legacyXp,
});

const policyContext = { maxHorizonSeconds: 7_200 };
const policyBase = {
  schema: CORE_G2_SCHEMA,
  economyHash: zero32,
  evidenceSpecHash,
  evidencePolicyHash,
  feedId,
  horizonSeconds: 600,
  targetGridSeconds: 60,
  minOpenLeadSeconds: 30,
  bandNumerator: 2,
  bandDenominator: 1,
  baseXp: 20n,
};
const observedPolicy = {
  ...policyBase,
  entryMode: ENTRY_MODE.OBSERVED_ENTRY,
  maxEntryAgeSeconds: 120,
};
const forwardPolicy = {
  ...policyBase,
  entryMode: ENTRY_MODE.FORWARD_ENTRY,
  maxEntryAgeSeconds: 0,
};
const observedLeaf = rulesetPolicyHash(observedPolicy, policyContext);
const forwardLeaf = rulesetPolicyHash(forwardPolicy, policyContext);
const policyRoot = rulesetPolicyMerkleParent(observedLeaf, forwardLeaf);

const economySpec = {
  schema: CORE_G2_SCHEMA,
  timepinProgram,
  timepinSchema: TIMEPIN_SCHEMA_V2,
  clusterGenesisHash,
  migrationId,
  legacyRoot: legacyLeaf,
  legacySnapshotHash,
  legacyCutoverSlot,
  legacyLeafCount: 1,
  legacyTotalCredits: legacyCredits,
  legacyTotalXp: legacyXp,
  rulesetPolicyRoot: policyRoot,
  rulesetPolicyCount: 2,
  rcxMint: RCX_MINT,
  rcxTokenProgram: TOKEN_2022_PROGRAM,
  rcxDecimals: RCX_DECIMALS,
  rawUnitsPerCredit: RCX_RAW_UNITS_PER_CREDIT,
  burnPerMille: 700,
  podiumPerMille: 300,
  podiumCurve: [500, 300, 200],
  rankShardCount: 16,
  daySeconds: 86_400,
  hitPayoutNumerator: 2n,
  hitPayoutDenominator: 1n,
  settleXp: 10n,
  minStake: 1n,
  maxStake: 100n,
  maxOpen: 64,
  cleanupBondLamports: 100_000n,
  revealWindowSeconds: 60,
  maxHorizonSeconds: 7_200,
};
const economyHashValue = economyHash(economySpec);
const observedRuleset = { ...observedPolicy, economyHash: economyHashValue };
const forwardRuleset = { ...forwardPolicy, economyHash: economyHashValue };
const observedRulesetHash = rulesetHash(observedRuleset, economySpec);
const forwardRulesetHash = rulesetHash(forwardRuleset, economySpec);
const ctx = { timepinProgram, evidenceSpecHash, evidencePolicyHash,
  evidenceSpec, feedId };

const registerKernel = () => {
  const model = new RatchetCoreG2Model({ programId });
  model.registerEconomy({
    spec: economySpec,
    account: makeEconomyAccount(programId, economySpec),
    timepinProgram,
    timepinExecutable: true,
    currentSlot: 100n,
  });
  model.registerRuleset({
    spec: observedRuleset,
    economyHash: economyHashValue,
    account: makeRulesetAccount(programId, observedRuleset, economySpec),
    evidenceSpecAccount,
    policyProof: [forwardLeaf],
  });
  model.registerRuleset({
    spec: forwardRuleset,
    economyHash: economyHashValue,
    account: makeRulesetAccount(programId, forwardRuleset, economySpec),
    evidenceSpecAccount,
    policyProof: [observedLeaf],
  });
  return model;
};

eq(CORE_G2_SCHEMA, 2, 'Core schema is 2');
eq(COMPLETION_SCHEMA, 1, 'completion schema is 1');
eq(CORE_MIN_EXPONENT, -12, 'minimum exponent');
eq(CORE_MAX_EXPONENT, 2, 'maximum exponent');
eq(RCX_DECIMALS, 6, 'RCX decimals');
eq(RCX_RAW_UNITS_PER_CREDIT, 1_000_000n, 'raw units per credit');
eq(CURRENT_RELOAD_PARITY.finalArchitectureCompatible, true,
  'Rust reload matches the final 70/30 distribution architecture');
eq(CURRENT_RELOAD_PARITY.rustBurnBps, 7_000, 'current Rust burn parity');
eq(CURRENT_RELOAD_PARITY.rustPodiumBps, 3_000, 'current Rust podium parity');
eq(CURRENT_RELOAD_PARITY.finalBurnBps, 7_000, 'frozen final burn share');
eq(CURRENT_RELOAD_PARITY.finalPodiumBps, 3_000, 'frozen final podium share');
eq(CURRENT_RELOAD_PARITY.finalPodiumSeatBps, [5_000, 3_000, 2_000],
  'frozen podium split is 50/30/20');
eq(CURRENT_RELOAD_PARITY.finalTeamBps, 0, 'frozen team share is zero');
eq(CURRENT_RELOAD_PARITY.finalSelfSeatRetained, true,
  'self-seat remains payable');
eq(CURRENT_RELOAD_PARITY.finalMissingSeatsAndDustBurned, true,
  'missing seats and dust return to burn');
eq(encodeEconomy(economySpec).length, ECONOMY_CANONICAL_LEN, 'economy canonical');
eq(makeEconomyAccount(programId, economySpec).data.length,
  ECONOMY_ACCOUNT_LEN, 'economy account');
eq(encodeRuleset(observedRuleset, economySpec).length,
  RULESET_CANONICAL_LEN, 'ruleset canonical');
eq(RULESET_CANONICAL_LEN, 163, 'RulesetArgs canonical bytes');
eq(encodeRulesetPolicy(observedRuleset, economySpec).length,
  RULESET_POLICY_CANONICAL_LEN, 'policy canonical');
eq(makeRulesetAccount(programId, observedRuleset, economySpec).data.length,
  RULESET_ACCOUNT_LEN, 'ruleset account');
eq(SHOT_RESULT_LEN, 165, 'compact terminal ShotResult exact bytes');
eq(GAME_RESULT_FACTS_LEN, 82, 'transient GameResultFacts exact bytes');
eq(HISTORY_PAGE_CAP, 16, 'HistoryPage has sixteen nonce slots');
// M3. The page is a fixed-size commitment; base and max are the SAME number,
// and their being equal is the ABI statement - a page whose base and max differ
// again is a page that grows.
eq(HISTORY_PAGE_LEN, 110, 'HistoryPage fixed account bytes');
eq(HISTORY_PAGE_LEN, 2 + 1 + 32 + 32 + 8 + 1 + 2 + 32,
  'HistoryPage bytes follow from its fields, not from a literal');
eq(HISTORY_PAGE_BASE_LEN, HISTORY_PAGE_LEN, 'BASE_LEN is an alias of LEN');
eq(HISTORY_PAGE_MAX_LEN, HISTORY_PAGE_LEN, 'MAX_LEN is an alias of LEN');
eq(HISTORY_PAGE_PRE_M3_MAX_LEN, 2_735, 'the page cost 2,735 bytes before M3');
eq(HISTORY_PAGE_PRE_M3_MAX_LEN - HISTORY_PAGE_LEN, 2_625,
  'M3 removes 2,625 bytes of permanent rent per page');
// The length does not move with the contents. That is the whole change.
eq(historyPageSerializedLen({ pendingCount: 0, terminalMask: 0 }),
  HISTORY_PAGE_LEN, 'an empty page is 110 bytes');
eq(historyPageSerializedLen({ pendingCount: 16, terminalMask: 0xffff }),
  HISTORY_PAGE_LEN, 'a full, fully terminal page is the same 110 bytes');
throwsCode(() => historyPageSerializedLen({ pendingCount: 17, terminalMask: 0 }),
  'INVALID_HISTORY_PAGE');
throwsCode(() => historyPageSerializedLen({ pendingCount: 1, terminalMask: 0b10 }),
  'INVALID_HISTORY_PAGE');
eq(popcount16(0), 0, 'no terminal rows');
eq(popcount16(0b1010_0000_0000_0001), 3, 'three terminal rows: bits 0, 13 and 15');
eq(popcount16(0xffff), 16, 'a fully terminal page');
const reloadFixtureRecord = {
  day: 1n,
  dayFinalHash: pk('reload-day-final'),
  gross: 10n * RCX_RAW_UNITS_PER_CREDIT,
  actions: [RELOAD_ACTION.BURN, RELOAD_ACTION.ROUTE, RELOAD_ACTION.RETAIN],
};
eq(RELOAD_RECORD_LEN, 51, 'packed ReloadRecord exact bytes');
eq(RELOAD_HISTORY_PAGE_CAP, 32, 'ReloadHistoryPage has thirty-two records');
eq(RELOAD_HISTORY_PAGE_BASE_LEN, 87, 'ReloadHistoryPage full base account');
eq(RELOAD_HISTORY_PAGE_MAX_LEN, 1_719, 'full packed reload page bytes');
eq(reloadHistoryPageSerializedLen([]), RELOAD_HISTORY_PAGE_BASE_LEN,
  'empty reload page exact bytes');
eq(reloadHistoryPageSerializedLen([reloadFixtureRecord]), 138,
  'one packed reload record exact bytes');
eq(reloadRecordAccounting(reloadFixtureRecord), {
  dayFinalHash: reloadFixtureRecord.dayFinalHash,
  actions: reloadFixtureRecord.actions,
  gross: 10_000_000n,
  rawBurned: 8_500_000n,
  rawRouted: 900_000n,
  rawRetained: 600_000n,
  consumed: 9_400_000n,
  credits: 9n,
}, 'reload accounting derives all omitted receipt fields');
throwsCode(() => reloadRecordAccounting({
  ...reloadFixtureRecord, dayFinalHash: zero32,
}), 'ZERO_IDENTITY');
throwsCode(() => reloadRecordAccounting({
  ...reloadFixtureRecord, actions: [RELOAD_ACTION.BURN, 0, RELOAD_ACTION.ROUTE],
}), 'INVALID_RELOAD_RECORD');
throwsCode(() => reloadHistoryPageSerializedLen(
  Array(RELOAD_HISTORY_PAGE_CAP + 1).fill(reloadFixtureRecord),
), 'RELOAD_HISTORY_PAGE_FULL');
eq(WORK_RECORD_LEN, 106, 'generic WorkRecord exact bytes');
eq(WORK_PAGE_CAP, 48, 'WorkPage holds three work kinds per shot page');
eq(WORK_PAGE_BASE_LEN, 79, 'WorkPage fixed account prefix');
eq(WORK_PAGE_MAX_LEN, 5_167, 'WorkPage maximum account bytes');
eq(workPageSerializedLen(Array(48).fill(null)), WORK_PAGE_MAX_LEN,
  'forty-eight generic work records reach exact max length');
eq(TIMEPIN_EVIDENCE_POLICY_CANONICAL_LEN, 134,
  'generation-independent Timepin policy bytes');
eq(TIMEPIN_EVIDENCE_SPEC_CANONICAL_LEN, 214,
  'exact Timepin generation canonical bytes');
eq(TIMEPIN_EVIDENCE_SPEC_ACCOUNT_LEN, 262,
  'Timepin EvidenceSpec account bytes');
// 168, and the name of the old expectation is the whole story: "terminal-in-Need"
// described a Need that carried the observation. It never did - the eleven obs_
// fields were declared and written as zeros, and they are gone now. 8 + 124
// header + 4 open_refs + 32 rent_payer = 168, and the Rust constant this mirrors
// is foreign_timepin.rs NEED_ACCOUNT_LEN.
eq(TIMEPIN_NEED_ACCOUNT_LEN, 168, 'Need account bytes: header plus the two rent fields');
eq(TIMEPIN_CANDIDATE_ACCOUNT_LEN, 119, 'compact Candidate account bytes');
eq(encodeTimepinEvidencePolicy(evidenceSpec).length, 134,
  'Timepin policy encoding exact');
eq(encodeTimepinEvidenceSpec(evidenceSpec).length, 214,
  'Timepin exact generation encoding exact');
eq(evidenceSpecAccount.data.length, 262, 'EvidenceSpec fixture exact account');
eq(authenticateTimepinEvidenceSpec({
  account: evidenceSpecAccount,
  timepinProgram,
  evidenceSpecHash,
}).evidencePolicyHash, evidencePolicyHash,
'EvidenceSpec independently authenticates policy and generation');
eq(rulesetPolicyHash(observedPolicy, policyContext), observedLeaf,
  'policy leaf deterministic');
eq(
  rulesetPolicyHash({ ...observedPolicy, economyHash: pk('other-economy') },
    policyContext),
  observedLeaf,
  'policy leaf excludes economy hash',
);
const evidenceSpecGenerationB = {
  ...evidenceSpec,
  receiverProgramdataSlot: 7n,
  receiverConfigHash: pk('pyth-receiver-config-generation-b'),
  wormholeProgramdataSlot: 8n,
};
const evidenceSpecHashB = timepinEvidenceSpecHash(evidenceSpecGenerationB);
const evidenceSpecAccountB = makeTimepinEvidenceSpecAccount(
  timepinProgram, evidenceSpecGenerationB,
);
const observedRulesetGenerationB = {
  ...observedRuleset,
  evidenceSpecHash: evidenceSpecHashB,
};
eq(timepinEvidencePolicyHash(evidenceSpecGenerationB), evidencePolicyHash,
  'generation change preserves semantic evidence policy');
neq(evidenceSpecHashB, evidenceSpecHash,
  'generation change produces a distinct exact spec hash');
eq(rulesetPolicyHash(observedRulesetGenerationB, economySpec), observedLeaf,
  'compatible new generation remains in the frozen Merkle policy');
neq(rulesetHash(observedRulesetGenerationB, economySpec), observedRulesetHash,
  'full ruleset hash opts into the exact Timepin generation');
const evidenceSpecPolicyChanged = {
  ...evidenceSpec,
  maxConfidenceBps: evidenceSpec.maxConfidenceBps - 1,
};
const evidencePolicyHashChanged = timepinEvidencePolicyHash(
  evidenceSpecPolicyChanged,
);
const evidenceSpecHashPolicyChanged = timepinEvidenceSpecHash(
  evidenceSpecPolicyChanged,
);
neq(evidencePolicyHashChanged, evidencePolicyHash,
  'source-quality change cannot reuse the policy leaf');
throwsCode(() => authenticateTimepinEvidenceSpec({
  account: mutate(evidenceSpecAccount, value => {
    value.owner = pk('wrong-timepin-owner');
  }),
  timepinProgram,
  evidenceSpecHash,
}), 'TIMEPIN_SPEC_OWNER');
throwsCode(() => authenticateTimepinEvidenceSpec({
  account: mutate(evidenceSpecAccount, value => { value.data[110] ^= 1; }),
  timepinProgram,
  evidenceSpecHash,
}), 'TIMEPIN_SPEC_POLICY_HASH');
throwsCode(() => authenticateTimepinEvidenceSpec({
  account: mutate(evidenceSpecAccount, value => { value.data[182] ^= 1; }),
  timepinProgram,
  evidenceSpecHash,
}), 'TIMEPIN_SPEC_HASH');
const generationModel = new RatchetCoreG2Model({ programId });
generationModel.registerEconomy({
  spec: economySpec,
  account: makeEconomyAccount(programId, economySpec),
  timepinProgram,
  timepinExecutable: true,
  currentSlot: 100n,
});
generationModel.registerRuleset({
  spec: observedRulesetGenerationB,
  economyHash: economyHashValue,
  account: makeRulesetAccount(
    programId, observedRulesetGenerationB, economySpec,
  ),
  evidenceSpecAccount: evidenceSpecAccountB,
  policyProof: [forwardLeaf],
});
eq(generationModel.revision, 2n,
  'same-policy new Timepin generation registers without economy migration');
const rejectedPolicyRuleset = {
  ...observedRuleset,
  evidenceSpecHash: evidenceSpecHashPolicyChanged,
  evidencePolicyHash: evidencePolicyHashChanged,
};
noMutation(generationModel, () => generationModel.registerRuleset({
  spec: rejectedPolicyRuleset,
  economyHash: economyHashValue,
  account: makeRulesetAccount(programId, rejectedPolicyRuleset, economySpec),
  evidenceSpecAccount: makeTimepinEvidenceSpecAccount(
    timepinProgram, evidenceSpecPolicyChanged,
  ),
  policyProof: [forwardLeaf],
}), 'RULESET_NOT_IN_POLICY');
const alternateEconomy = { ...economySpec, maxStake: 101n };
const alternateRuleset = {
  ...observedRuleset, economyHash: economyHash(alternateEconomy),
};
neq(rulesetHash(alternateRuleset, alternateEconomy), observedRulesetHash,
  'full ruleset hash includes economy hash');
eq(rulesetPolicyMerkleParent(observedLeaf, forwardLeaf),
  rulesetPolicyMerkleParent(forwardLeaf, observedLeaf),
  'policy proof nodes are sorted');
eq(legacyMerkleParent(pk('l'), pk('r')),
  legacyMerkleParent(pk('r'), pk('l')), 'legacy proof nodes are sorted');
neq(legacyLeafHash({
  programId, clusterGenesisHash, migrationId,
  snapshotHash: pk('other-snapshot'),
  cutoverSlot: legacyCutoverSlot, player: legacyPlayer,
  credits: legacyCredits, xp: legacyXp,
}), legacyLeaf, 'legacy leaf commits snapshot');
neq(legacyLeafHash({
  programId: pk('other-program'), clusterGenesisHash, migrationId,
  snapshotHash: legacySnapshotHash,
  cutoverSlot: legacyCutoverSlot, player: legacyPlayer,
  credits: legacyCredits, xp: legacyXp,
}), legacyLeaf, 'legacy leaf domain separates Core program');
neq(legacyLeafHash({
  programId, clusterGenesisHash, migrationId,
  snapshotHash: legacySnapshotHash,
  cutoverSlot: legacyCutoverSlot + 1n, player: legacyPlayer,
  credits: legacyCredits, xp: legacyXp,
}), legacyLeaf, 'legacy leaf commits cutover');
neq(legacyLeafHash({
  programId, clusterGenesisHash, migrationId,
  snapshotHash: legacySnapshotHash,
  cutoverSlot: legacyCutoverSlot, player: pk('other-player'),
  credits: legacyCredits, xp: legacyXp,
}), legacyLeaf, 'legacy leaf commits player');
eq(deriveEconomyPda(programId, economyHashValue),
  pda(programId, [Buffer.from('economy'), u16(2), economyHashValue]),
  'economy PDA includes schema seed');
eq(deriveRulesetPda(programId, observedRulesetHash),
  pda(programId, [Buffer.from('ruleset'), u16(2), observedRulesetHash]),
  'ruleset PDA includes schema seed');
eq(deriveLedgerPda(programId, economyHashValue, legacyPlayer),
  pda(programId, [Buffer.from('ledger'), economyHashValue, legacyPlayer]),
  'ledger namespace is economy/player');
eq(deriveShotPda(programId, economyHashValue, legacyPlayer, 9n),
  pda(programId, [
    Buffer.from('shot'), economyHashValue, legacyPlayer, u64(9n),
  ]), 'shot namespace includes immutable nonce');
eq(deriveHistoryPagePda(programId, economyHashValue, legacyPlayer, 7n),
  pda(programId, [
    Buffer.from('history_page'), economyHashValue, legacyPlayer, u64(7n),
  ]), 'HistoryPage namespace includes economy/player/page');
eq(deriveReloadHistoryPagePda(programId, economyHashValue, legacyPlayer, 7n),
  pda(programId, [
    Buffer.from('reload_history_page'), economyHashValue, legacyPlayer, u64(7n),
  ]), 'ReloadHistoryPage namespace includes economy/player/page');
eq(deriveWorkPagePda(programId, economyHashValue, legacyPlayer, 7n),
  pda(programId, [
    Buffer.from('work_page'), economyHashValue, legacyPlayer, u64(7n),
  ]), 'WorkPage namespace includes economy/player/page');
eq(deriveTimepinEvidenceSpecPda(timepinProgram, evidenceSpecHash),
  pda(timepinProgram, [
    Buffer.from('evidence_spec'), u16(TIMEPIN_SCHEMA_V2), evidenceSpecHash,
  ]), 'EvidenceSpec PDA binds exact generation hash');

const fixedGameProgram =
  new PublicKey('ANVGVtDrECeyQkS56UZ9ZiWCUxk2JWEVNJioFW8JEwbL').toBuffer();
eq(legacyLeafHash({
  programId: fixedGameProgram, clusterGenesisHash: Buffer.alloc(32, 3),
  migrationId: Buffer.alloc(32, 5), snapshotHash: Buffer.alloc(32, 1),
  cutoverSlot: 42n, player: Buffer.alloc(32, 4), credits: 10n, xp: 20n,
}).toString('hex'),
  '66447337f898b26ff78b1125b9050ee305ec718bbb50c7182e903d6cc6555aa2',
  'legacy_leaf matches the Rust fixed vector for the deployed G2 identity');
const fixedGameEconomy = Buffer.alloc(32, 11);
const fixedGamePlayer = Buffer.alloc(32, 42);
const fixedGameSalt = Buffer.alloc(32, 21);
const fixedGameResult = {
  rulesetHash: Buffer.alloc(32, 12),
  proofMaterial: fixedGameSalt,
  state: SHOT_STATE.REVEALED,
  voidReason: null,
  stake: 100n,
  sealedTs: 100n,
  entryTargetTs: 120n,
  exitTargetTs: 180n,
  side: SIDE.UP,
  pBps: 8_000,
  delegate: Buffer.alloc(32, 14),
  gameResultHash: zero32,
};
const fixedGameFacts = {
  entryTimepinResultHash: Buffer.alloc(32, 24),
  exitTimepinResultHash: Buffer.alloc(32, 25),
  outcomeYes: 1,
  hit: 1,
  xpAwarded: 22n,
  scoreDay: 0n,
};
const fixedGameHash = gameResultHash({
  programId: fixedGameProgram,
  economyHash: fixedGameEconomy,
  player: fixedGamePlayer,
  nonce: 1n,
  result: fixedGameResult,
  facts: fixedGameFacts,
});
eq(fixedGameHash.toString('hex'),
  'f4c11f1914da94fe8add4c6fbbd02ca8aeda77c8b1aa94d9d8abd035270fff4d',
  'game_result_hash matches the Rust fixed vector');
eq(compactResultCommit({
  programId: fixedGameProgram,
  economyHash: fixedGameEconomy,
  player: fixedGamePlayer,
  nonce: 1n,
  result: fixedGameResult,
}), commitmentHash({
  programId: fixedGameProgram,
  economyHash: fixedGameEconomy,
  rulesetHash: fixedGameResult.rulesetHash,
  player: fixedGamePlayer,
  nonce: 1n,
  side: SIDE.UP,
  probability: 8_000,
  salt: fixedGameSalt,
}), 'revealed compact proof recomputes the original commitment');

const model = registerKernel();
eq(model.revision, 3n, 'three immutable registrations');
const idempotentRevision = model.revision;
model.registerEconomy({
  spec: economySpec,
  account: makeEconomyAccount(programId, economySpec),
  timepinProgram,
  currentSlot: 100n,
});
eq(model.revision, idempotentRevision, 'immutable economy registration idempotent');

const badEconomyOwner = mutate(
  makeEconomyAccount(programId, economySpec),
  value => { value.owner = pk('attacker'); },
);
noMutation(model, () => model.registerEconomy({
  spec: economySpec, account: badEconomyOwner, timepinProgram, currentSlot: 100n,
}), 'ECONOMY_ACCOUNT_OWNER');
const badEconomyBytes = mutate(
  makeEconomyAccount(programId, economySpec),
  value => { value.data[80] ^= 1; },
);
noMutation(model, () => model.registerEconomy({
  spec: economySpec, account: badEconomyBytes, timepinProgram, currentSlot: 100n,
}), 'ECONOMY_ACCOUNT_BYTES');
const shortRuleset = mutate(
  makeRulesetAccount(programId, observedRuleset, economySpec),
  value => { value.data = value.data.subarray(0, -1); },
);
noMutation(model, () => model.registerRuleset({
  spec: observedRuleset, economyHash: economyHashValue,
  account: shortRuleset, evidenceSpecAccount, policyProof: [forwardLeaf],
}), 'RULESET_ACCOUNT_LENGTH');
noMutation(model, () => model.registerEconomy({
  spec: economySpec,
  account: makeEconomyAccount(programId, economySpec),
  timepinProgram: pk('fake-timepin'), currentSlot: 100n,
}), 'WRONG_TIMEPIN_PROGRAM');
noMutation(model, () => model.registerEconomy({
  spec: economySpec,
  account: makeEconomyAccount(programId, economySpec),
  timepinProgram, timepinExecutable: false, currentSlot: 100n,
}), 'TIMEPIN_PROGRAM_NOT_EXECUTABLE');

const futureEconomy = { ...economySpec, legacyCutoverSlot: 200n };
const futureLeaf = legacyLeafHash({
  programId, clusterGenesisHash, migrationId,
  snapshotHash: legacySnapshotHash, cutoverSlot: 200n,
  player: legacyPlayer, credits: legacyCredits, xp: legacyXp,
});
futureEconomy.legacyRoot = futureLeaf;
const futureModel = new RatchetCoreG2Model({ programId });
noMutation(futureModel, () => futureModel.registerEconomy({
  spec: futureEconomy,
  account: makeEconomyAccount(programId, futureEconomy),
  timepinProgram, currentSlot: 199n,
}), 'FUTURE_LEGACY_CUTOVER');

const tooLongProof = Array.from({ length: 33 }, (_, i) => pk('proof-' + i));
noMutation(model, () => model.registerRuleset({
  spec: observedRuleset, economyHash: economyHashValue,
  account: makeRulesetAccount(programId, observedRuleset, economySpec),
  evidenceSpecAccount,
  policyProof: tooLongProof,
}), 'BAD_RULESET_POLICY_PROOF');

const reloadPlayer = pk('reload-player');
const opened = model.openLedger({
  economyHash: economyHashValue, player: reloadPlayer, signer: reloadPlayer,
});
eq(opened.credits, 0n, 'permissionless player opens zero ledger');
eq(opened.schema, CORE_G2_SCHEMA, 'ledger schema');
eq(opened.key, deriveLedgerPda(programId, economyHashValue, reloadPlayer).key,
  'ledger PDA');
const openRevision = model.revision;
model.openLedger({
  economyHash: economyHashValue, player: reloadPlayer, signer: reloadPlayer,
});
eq(model.revision, openRevision, 'openLedger is idempotent');
noMutation(model, () => model.openLedger({
  economyHash: economyHashValue, player: reloadPlayer, signer: pk('impersonator'),
}), 'PLAYER_SIGNATURE_REQUIRED');
const reloadDay = 0n;
const reloadDayFinalHash = pk('reload-day-final-main');
const allBurnActions = [
  RELOAD_ACTION.BURN, RELOAD_ACTION.BURN, RELOAD_ACTION.BURN,
];
const reloadInput = (nonce, gross, overrides = {}) => ({
  economyHash: economyHashValue,
  player: reloadPlayer,
  signer: reloadPlayer,
  nonce,
  gross,
  day: reloadDay,
  dayFinalHash: reloadDayFinalHash,
  actions: allBurnActions,
  ...overrides,
});
const openPackedReloadPage = (targetModel, player, pageIndex = 0n) =>
  targetModel.openReloadPage({
    economyHash: economyHashValue,
    player,
    actor: pk('reload-page-actor:' + Buffer.from(player).toString('hex')),
    pageIndex,
  });
const packedReload = (targetModel, player, nonce, gross, overrides = {}) =>
  targetModel.reloadBurn({
    economyHash: economyHashValue,
    player,
    signer: player,
    nonce,
    gross,
    day: reloadDay,
    dayFinalHash: reloadDayFinalHash,
    actions: allBurnActions,
    ...overrides,
  });
noMutation(model, () => model.reloadBurn(reloadInput(0n, 1_000_000n)),
  'RELOAD_HISTORY_PAGE_NOT_FOUND');
noMutation(model, () => model.openReloadPage({
  economyHash: economyHashValue, player: reloadPlayer,
  actor: pk('reload-page-opener'), pageIndex: 1n,
}), 'WRONG_RELOAD_HISTORY_PAGE');
model.openReloadPage({
  economyHash: economyHashValue, player: reloadPlayer,
  actor: pk('reload-page-opener'), pageIndex: 0n,
});
eq(model.reloadHistoryPage(economyHashValue, reloadPlayer, 0n).records, [],
  'permissionless open creates only the 87-byte base page');
noMutation(model, () => model.openReloadPage({
  economyHash: economyHashValue, player: reloadPlayer,
  actor: pk('reload-page-opener'), pageIndex: 0n,
}), 'RELOAD_HISTORY_PAGE_EXISTS');
noMutation(model, () => model.reloadBurn(reloadInput(0n, 999_999n)),
  'INVALID_AMOUNT');
noMutation(model, () => model.reloadBurn(reloadInput(0n, 1_000_000n, {
  tokenProgram: pk('legacy-token-program'),
})), 'WRONG_TOKEN_PROGRAM');
noMutation(model, () => model.reloadBurn(reloadInput(0n, 1_000_000n, {
  mint: pk('fake-mint'),
})), 'WRONG_RCX_MINT');
noMutation(model, () => model.reloadBurn(reloadInput(0n, 1_000_000n, {
  decimals: 5,
})), 'WRONG_DECIMALS');
noMutation(model, () => model.reloadBurn(reloadInput(0n, 1_000_000n, {
  burnSucceeded: false,
})), 'TOKEN_BURN_FAILED');

const reloadRevision = model.revision;
let reloaded = model.reloadBurn(reloadInput(0n, 100_500_007n, {
  tokenProgram: TOKEN_2022_PROGRAM, mint: RCX_MINT,
  decimals: RCX_DECIMALS, expectedRevision: reloadRevision,
}));
eq(reloaded.credits, 100n, 'reload floors raw RCX to credits');
eq(reloaded.reloadCredits, 100n, 'reload source credits');
eq(reloaded.rcxReloaded, 100_500_007n, 'all raw RCX counted');
eq(reloaded.rcxBurned, 100_500_007n, 'all-burn podium actions burn all raw RCX');
eq(reloaded.rcxRouted, 0n, 'all-burn podium actions route zero raw RCX');
eq(reloaded.nextReloadNonce, 1n, 'packed position is the replay nonce');
ok(requireLedgerConservation(reloaded), 'reload conservation');
noMutation(model, () => model.reloadBurn(reloadInput(1n, 1_000_000n, {
  expectedRevision: reloadRevision,
})), 'STALE_REVISION');
noMutation(model, () => model.reloadBurn(reloadInput(0n, 1_000_000n)),
  'WRONG_RELOAD_NONCE');
reloaded = model.reloadBurn(reloadInput(1n, 1_000_001n));
eq(reloaded.credits, 101n, 'fresh repeat requires another burn');
eq(reloaded.rcxReloaded, 101_500_008n, 'repeat raw input is conserved');
eq(reloaded.rcxReloaded, reloaded.rcxBurned + reloaded.rcxRouted,
  'raw_in equals burned plus routed');
eq(model.reloadHistoryPage(economyHashValue, reloadPlayer, 0n).records.length,
  2, 'two reloads append contiguously to one packed page');
eq(typeof model.grantCredits, 'undefined', 'no grant/faucet instruction');
eq(typeof model.closeShot, 'undefined', 'no shot close/reuse instruction');

noMutation(model, () => model.claimLegacy({
  economyHash: economyHashValue, player: legacyPlayer, signer: legacyPlayer,
  credits: legacyCredits, xp: legacyXp, proof: [], currentSlot: 89n,
}), 'FUTURE_LEGACY_CUTOVER');
noMutation(model, () => model.claimLegacy({
  economyHash: economyHashValue, player: legacyPlayer, signer: pk('claim-thief'),
  credits: legacyCredits, xp: legacyXp, proof: [], currentSlot: 100n,
}), 'PLAYER_SIGNATURE_REQUIRED');
noMutation(model, () => model.claimLegacy({
  economyHash: economyHashValue, player: legacyPlayer, signer: legacyPlayer,
  credits: legacyCredits + 1n, xp: legacyXp, proof: [], currentSlot: 100n,
}), 'LEGACY_CLAIM_EXCEEDS_MANIFEST');
noMutation(model, () => model.claimLegacy({
  economyHash: economyHashValue, player: legacyPlayer, signer: legacyPlayer,
  credits: legacyCredits, xp: legacyXp, proof: [pk('bad-proof')],
  currentSlot: 100n,
}), 'BAD_LEGACY_PROOF');
noMutation(model, () => model.claimLegacy({
  economyHash: economyHashValue, player: legacyPlayer, signer: legacyPlayer,
  credits: legacyCredits, xp: legacyXp, proof: tooLongProof,
  currentSlot: 100n,
}), 'BAD_MERKLE_PROOF');
noMutation(model, () => model.claimLegacy({
  economyHash: economyHashValue, player: legacyPlayer, signer: legacyPlayer,
  credits: 0n, xp: 0n, proof: [], currentSlot: 100n,
}), 'EMPTY_LEGACY_CLAIM');
const claim = model.claimLegacy({
  economyHash: economyHashValue, player: legacyPlayer, signer: legacyPlayer,
  credits: legacyCredits, xp: legacyXp, proof: [], currentSlot: 100n,
});
eq(claim.leaf, legacyLeaf, 'legacy claim exact acyclic leaf');
eq(claim.snapshotHash, legacySnapshotHash, 'claim records snapshot');
eq(claim.cutoverSlot, legacyCutoverSlot, 'claim records cutover');
eq(model.ledger(economyHashValue, legacyPlayer).legacyCredits,
  legacyCredits, 'legacy credits sourced');
eq(model.ledger(economyHashValue, legacyPlayer).legacyXp,
  legacyXp, 'legacy XP sourced');
noMutation(model, () => model.claimLegacy({
  economyHash: economyHashValue, player: legacyPlayer, signer: legacyPlayer,
  credits: legacyCredits, xp: legacyXp, proof: [], currentSlot: 100n,
}), 'LEGACY_ALREADY_CLAIMED');

const observedNow = 1_000n;
const observedTarget = 950n;
const observedExitTarget = 1_620n;
const observedEntryFact = finalFact(ctx, observedTarget, {
  price: 10_000n, publishTime: 951n, captureTs: 952n, terminalTs: 975n,
});
const observedExitNeed = openNeed(ctx, observedExitTarget);
const revealSalt = pk('observed-reveal-salt');
const observedCommit = commitmentHash({
  programId, economyHash: economyHashValue,
  rulesetHash: observedRulesetHash, player: reloadPlayer, nonce: 0n,
  side: SIDE.UP, probability: 7_000, salt: revealSalt,
});
neq(commitmentHash({
  programId, economyHash: economyHashValue,
  rulesetHash: observedRulesetHash, player: reloadPlayer, nonce: 1n,
  side: SIDE.UP, probability: 7_000, salt: revealSalt,
}), observedCommit, 'commitment binds nonce');
neq(commitmentHash({
  programId, economyHash: economyHashValue,
  rulesetHash: forwardRulesetHash, player: reloadPlayer, nonce: 0n,
  side: SIDE.UP, probability: 7_000, salt: revealSalt,
}), observedCommit, 'commitment binds ruleset');
neq(commitmentHash({
  programId, economyHash: economyHashValue,
  rulesetHash: observedRulesetHash, player: pk('other-player'), nonce: 0n,
  side: SIDE.UP, probability: 7_000, salt: revealSalt,
}), observedCommit, 'commitment binds player');

noMutation(model, () => model.sealObserved({
  economyHash: economyHashValue, rulesetHash: observedRulesetHash,
  player: reloadPlayer, signer: reloadPlayer, nonce: 0n, stake: 5n,
  commitment: observedCommit, nowTs: observedNow,
  entryTargetTs: observedTarget, exitTargetTs: observedExitTarget + 60n,
  observedEntry: observedEntryFact, t1Need: observedExitNeed,
}), 'WRONG_TARGET');
const observedShot = model.sealObserved({
  economyHash: economyHashValue, rulesetHash: observedRulesetHash,
  player: reloadPlayer, signer: reloadPlayer, nonce: 0n, stake: 5n,
  commitment: observedCommit, nowTs: observedNow,
  entryTargetTs: observedTarget, exitTargetTs: observedExitTarget,
  observedEntry: observedEntryFact, t1Need: observedExitNeed,
});
eq(observedShot.state, SHOT_STATE.ACTIVE, 'observed seal is active');
eq(observedShot.entryTargetTs, observedTarget, 'observed entry exact target');
eq(observedShot.exitTargetTs, observedExitTarget,
  'observed exit aligned from now plus horizon');
eq(observedShot.entryPrice, 10_000n, 'entry read from raw Candidate');
eq(observedShot.xpBase, sealXp(20n, 5n), 'seal XP parity');
const sealedPage = model.historyPage(economyHashValue, reloadPlayer, 0n);
eq(sealedPage.pendingCount, 1, 'seal reserves one history slot');
eq(sealedPage.terminalMask, 0, 'a reserved slot is not terminal');
eq(sealedPage.resultsRoot, Buffer.alloc(32),
  'a page with no terminal rows has the zero root');
model.reserveWork({
  shot: observedShot.key, workKind: WORK_KIND.RESOLVE_SHOT, expectedIndex: 0,
});
model.reserveWork({
  shot: observedShot.key, workKind: WORK_KIND.FORFEIT, expectedIndex: 1,
});
noMutation(model, () => model.reserveWork({
  shot: observedShot.key, workKind: WORK_KIND.ACTIVATE_ENTRY, expectedIndex: 2,
}), 'WORK_NOT_RESERVABLE');
let ledger = model.ledger(economyHashValue, reloadPlayer);
eq(ledger.credits, 96n, 'seal atomically debits available');
eq(ledger.lockedCredits, 5n, 'seal atomically locks stake');
eq(ledger.reservedPayoutCredits, hitPayout(5n, economySpec),
  'seal reserves maximum payout');
eq(ledger.reservedXp, terminalXpReserve(observedShot.xpBase, 10n),
  'seal reserves maximum XP');
ok(model.audit(), 'audit active observed seal');

const observedExitFact = finalFact(ctx, observedExitTarget, {
  price: 10_300n, publishTime: 1_621n,
  captureTs: 1_622n, terminalTs: 1_645n,
});
const settledObserved = model.settleFinal({
  shot: observedShot.key, fact: observedExitFact, actor: pk('resolver-a'),
  nowTs: 1_650n, currentSlot: 200n,
});
eq(settledObserved.state, SHOT_STATE.AWAITING_REVEAL,
  'directional final enters AwaitReveal');
eq(settledObserved.outcomeYes, 1, 'scaled outcome is up');
eq(settledObserved.revealDeadlineTs, 1_700n,
  'deadline is fixed from the permanent exit Need');
eq(settledObserved.resolutionHash, resolutionHash(settledObserved),
  'stored resolution hash recomputes');
const resolutionBeforeReveal = Buffer.from(settledObserved.resolutionHash);
const resolveReceipt = model.receipt(
  observedShot.key, WORK_KIND.RESOLVE_SHOT,
);
eq(resolveReceipt.disposition, RECEIPT_DISPOSITION.PAYABLE,
  'resolution is payable work');
eq(resolveReceipt.resultHash, completionResultHash({
  programId, subject: observedShot.key,
  workKind: WORK_KIND.RESOLVE_SHOT,
  factHash: resolutionBeforeReveal,
  disposition: RECEIPT_DISPOSITION.PAYABLE,
  worker: pk('resolver-a'),
}), 'WorkPage wraps the exact transient resolution fact');
noMutation(model, () => model.forfeit({
  shot: observedShot.key, actor: pk('early-forfeiter'),
  nowTs: 1_699n, currentSlot: 201n,
}), 'FORFEIT_TOO_EARLY');

const revealed = model.reveal({
  shot: observedShot.key, side: SIDE.UP, probability: 7_000, salt: revealSalt,
  player: reloadPlayer, signer: reloadPlayer, nowTs: 1_699n,
  currentSlot: 202n,
});
eq(revealed.state, SHOT_STATE.REVEALED, 'reveal terminal state');
eq(revealed.hit, 1, 'correct side hits');
eq(revealed.resolutionHash, resolutionBeforeReveal,
  'resolution hash is stable after reveal');
eq(revealed.resolutionHash, resolutionHash(revealed),
  'resolution recomputes after reveal');
ok(!revealed.terminalHash.equals(zero32), 'terminal hash written on reveal');
ledger = model.ledger(economyHashValue, reloadPlayer);
eq(ledger.reservedPayoutCredits, 0n, 'reveal releases payout reserve');
eq(ledger.reservedXp, 0n, 'reveal releases XP reserve');
eq(ledger.lockedCredits, 0n, 'reveal retires locked stake');
eq(ledger.retiredCredits, 5n, 'revealed stake permanently retired');
eq(ledger.payoutCredits, 10n, 'hit payout is a named credit source');
eq(ledger.xp, 14n, 'hit gets skill XP plus settle XP');
eq(ledger.earnedXp, 14n, 'earned XP conservation');
eq(ledger.brierSum, 9_000_000n, 'Brier score uses yes probability');
eq(model.receipt(
  observedShot.key, WORK_KIND.FORFEIT,
).disposition, RECEIPT_DISPOSITION.NONPAYABLE,
  'unused sponsored forfeit terminalizes nonpayable');
throwsCode(() => model.shot(observedShot.key), 'SHOT_NOT_FOUND');
eq(model.historyResult(
  economyHashValue, reloadPlayer, 0n,
).gameResultHash, revealed.result.gameResultHash,
  'closed Shot survives as the 165-byte history result');
ok(verifyGameResult({
  programId, economyHash: economyHashValue, player: reloadPlayer, nonce: 0n,
  result: revealed.result, facts: revealed.facts,
}), 'compact observed result verifies from Timepin facts');
eq(revealed.facts.entryTimepinResultHash,
  authenticateTerminalFact(
    observedEntryFact, { ...observedRuleset, timepinProgram, evidenceSpec },
  ).terminal.resultHash, 'entry Timepin terminal hash is retained transiently');
eq(revealed.cleanupRewardLamports, economySpec.cleanupBondLamports,
  'terminal actor earns the immutable cleanup bond');
// M3 IN LAMPORTS, on the ordinary reveal path. Before M3 archiving grew the
// page by ShotResult::LEN and that growth was permanent rent: 165 * 5,080 =
// 838_200n per shot, taken out of the transient Shot rent and refunded only as
// the 3_161_800n remainder. The page is a fixed size now, so the growth is
// zero and the WHOLE 4_000_000n transient rent goes back.
eq(revealed.historyRentGrowthLamports, 0n,
  'archiving grows the page by nothing - was 838_200n before M3');
eq(revealed.actorTopupLamports, 0n,
  'there is no growth for the terminal actor to fund');
eq(revealed.rentRefundLamports, 4_000_000n,
  'the whole transient rent is refunded - was 3_161_800n before M3');
eq(revealed.rentRefundLamports - 3_161_800n, 838_200n,
  'and the difference is exactly the per-shot rent M3 stops locking up');
eq(model.lamportAccounting(reloadPlayer).rentRefund, 4_000_000n,
  'refund accounting is keyed by immutable rent_refund');
eq(model.lamportAccounting(reloadPlayer).cleanupReward,
  economySpec.cleanupBondLamports,
  'reveal signer receives the cleanup bond separately from rent');
ok(model.audit(), 'audit revealed observed shot');

const forfeitNow = 2_000n;
const forfeitEntryTarget = 1_950n;
const forfeitExitTarget = 2_640n;
const forfeitEntryFact = finalFact(ctx, forfeitEntryTarget, {
  price: 10_000n, publishTime: 1_951n,
  captureTs: 1_952n, terminalTs: 1_975n,
});
const forfeitExitNeed = openNeed(ctx, forfeitExitTarget);
const forfeitSalt = pk('forfeit-salt');
const forfeitCommit = commitmentHash({
  programId, economyHash: economyHashValue,
  rulesetHash: observedRulesetHash, player: reloadPlayer, nonce: 1n,
  side: SIDE.DOWN, probability: 6_000, salt: forfeitSalt,
});
const forfeitShot = model.sealObserved({
  economyHash: economyHashValue, rulesetHash: observedRulesetHash,
  player: reloadPlayer, signer: reloadPlayer, nonce: 1n, stake: 3n,
  commitment: forfeitCommit, nowTs: forfeitNow,
  observedEntry: forfeitEntryFact, t1Need: forfeitExitNeed,
});
model.reserveWork({
  shot: forfeitShot.key, workKind: WORK_KIND.RESOLVE_SHOT, expectedIndex: 2,
});
model.reserveWork({
  shot: forfeitShot.key, workKind: WORK_KIND.FORFEIT, expectedIndex: 3,
});
const forfeitExitFact = finalFact(ctx, forfeitExitTarget, {
  price: 9_900n, publishTime: 2_641n,
  captureTs: 2_642n, terminalTs: 2_665n,
});
const awaitingForfeit = model.settleFinal({
  shot: forfeitShot.key, fact: forfeitExitFact, actor: pk('resolver-b'),
  nowTs: 2_670n, currentSlot: 300n,
});
const forfeitResolution = Buffer.from(awaitingForfeit.resolutionHash);
noMutation(model, () => model.reveal({
  shot: forfeitShot.key, side: SIDE.DOWN, probability: 6_000,
  salt: forfeitSalt, player: reloadPlayer, signer: reloadPlayer,
  nowTs: awaitingForfeit.revealDeadlineTs,
}), 'REVEAL_DEADLINE_PASSED');
const forfeited = model.forfeit({
  shot: forfeitShot.key, actor: pk('forfeiter'),
  nowTs: awaitingForfeit.revealDeadlineTs, currentSlot: 301n,
});
eq(forfeited.state, SHOT_STATE.FORFEITED,
  'forfeit opens exactly at reveal deadline');
eq(forfeited.resolutionHash, forfeitResolution,
  'resolution hash stable after forfeit');
eq(forfeited.xpAwarded, 0n, 'forfeit awards no settle XP');
eq(model.receipt(forfeitShot.key, WORK_KIND.FORFEIT).disposition,
  RECEIPT_DISPOSITION.PAYABLE, 'forfeit completion payable');
ledger = model.ledger(economyHashValue, reloadPlayer);
eq(ledger.forfeits, 1n, 'forfeit counter');
eq(ledger.brierSum, 109_000_000n, 'forfeit writes worst-case Brier');
eq(ledger.reservedPayoutCredits, 0n, 'forfeit releases payout reserve');
eq(ledger.reservedXp, 0n, 'forfeit releases XP reserve');
ok(model.audit(), 'audit disjoint reveal/forfeit boundary');

const outOfOrderModel = registerKernel();
const outOfOrderPlayer = pk('out-of-order-player');
outOfOrderModel.openLedger({
  economyHash: economyHashValue,
  player: outOfOrderPlayer,
  signer: outOfOrderPlayer,
});
openPackedReloadPage(outOfOrderModel, outOfOrderPlayer);
packedReload(outOfOrderModel, outOfOrderPlayer, 0n, 3_000_000n);
const outOfOrderShots = [];
for (let nonce = 0n; nonce < 3n; nonce += 1n) {
  outOfOrderShots.push(outOfOrderModel.sealObserved({
    economyHash: economyHashValue,
    rulesetHash: observedRulesetHash,
    player: outOfOrderPlayer,
    signer: outOfOrderPlayer,
    nonce,
    stake: 1n,
    commitment: pk('out-of-order-commit-' + nonce),
    nowTs: observedNow,
    observedEntry: observedEntryFact,
    t1Need: observedExitNeed,
    transientRentLamports: nonce === 2n ? 0n : 4_000_000n,
  }));
}
const reservedPage = outOfOrderModel.historyPage(
  economyHashValue, outOfOrderPlayer, 0n,
);
eq(reservedPage.pendingCount, 3, 'sequential seals append three reservations');
eq(reservedPage.terminalMask, 0, 'none of the three is terminal yet');
eq(historyPageSerializedLen(reservedPage), HISTORY_PAGE_LEN,
  'three reservations cost nothing: the page is a fixed size');
const outOfOrderExit = voidFact(
  ctx, observedExitTarget, TIMEPIN_STATE.EXPIRED,
);
const outOfOrderThird = outOfOrderModel.voidActiveShot({
  shot: outOfOrderShots[2].key,
  fact: outOfOrderExit,
  actor: pk('out-of-order-actor-2'),
  nowTs: 1_650n,
  currentSlot: 602n,
});
let outOfOrderPage = outOfOrderModel.historyPage(
  economyHashValue, outOfOrderPlayer, 0n,
);
// SLOT 2 TERMINALISES FIRST. Slots are appended in nonce order and
// terminalised out of order, which is why the fold order is a sequence.
eq(outOfOrderPage.terminalMask, 0b100,
  'only the third slot is terminal, and it terminalised first');
eq(outOfOrderPage.pendingCount, 3, 'terminalising appends nothing');
eq(outOfOrderThird.historySlot, 2, 'the row lands in its implicit nonce slot');
eq(outOfOrderThird.historySequence, 1,
  'it is the FIRST row folded, whatever its slot');
eq(outOfOrderThird.historyRowHash,
  historyRowHash(outOfOrderThird.nonce, outOfOrderThird.result),
  'the archived row hashes to the leaf that was folded');
eq(outOfOrderPage.resultsRoot,
  historyChainFold(Buffer.alloc(32), outOfOrderThird.historyRowHash),
  'the root is the fold of the one row committed so far');
neq(outOfOrderPage.resultsRoot, Buffer.alloc(32),
  'a page with a terminal row does not have the zero root');
eq(encodeShotResult(outOfOrderThird.result).length, SHOT_RESULT_LEN,
  'the hashed row is exactly the 165 borsh bytes the program hashes');
eq(historyPageSerializedLen(outOfOrderPage), HISTORY_PAGE_LEN,
  'a terminal row does not grow the page - THIS IS M3');
// M3 IN LAMPORTS. This used to be 838_200n of top-up (165 bytes at 5,080
// lamports each) charged to whoever terminalised a shot whose transient rent
// was spent. There is no growth to fund now, so there is nothing to top up.
eq(outOfOrderThird.historyRentGrowthLamports, 0n,
  'archiving grows the page by nothing');
eq(outOfOrderThird.actorTopupLamports, 0n,
  'the terminal actor funds no history growth - was 838_200n before M3');
eq(outOfOrderThird.rentRefundLamports, 0n,
  'zero transient rent still leaves no close refund');
eq(outOfOrderModel.lamportAccounting(
  pk('out-of-order-actor-2'),
).cleanupReward, economySpec.cleanupBondLamports,
  'cleanup bond remains protected from history rent growth');
for (const [index, currentSlot] of [[0, 603n], [1, 604n]]) {
  outOfOrderModel.voidActiveShot({
    shot: outOfOrderShots[index].key,
    fact: outOfOrderExit,
    actor: pk('out-of-order-actor-' + index),
    nowTs: 1_650n,
    currentSlot,
  });
}
outOfOrderPage = outOfOrderModel.historyPage(
  economyHashValue, outOfOrderPlayer, 0n,
);
eq(popcount16(outOfOrderPage.terminalMask), 3,
  'out-of-order terminalization eventually marks every slot');
eq(outOfOrderPage.terminalMask, 0b111, 'all three slots are terminal');
eq(historyPageSerializedLen(outOfOrderPage), HISTORY_PAGE_LEN,
  'three terminal rows still cost 110 bytes - was 577 before M3');
// The root is order-dependent: 2, then 0, then 1. Fold them in NONCE order and
// you get a different value, which is exactly why the archive records a
// sequence instead of leaving a reader to guess.
const outOfOrderRows = [2n, 0n, 1n].map(nonce => historyRowHash(
  nonce,
  outOfOrderModel.historyResult(economyHashValue, outOfOrderPlayer, nonce),
));
eq(outOfOrderRows.reduce((root, row) => historyChainFold(root, row),
  Buffer.alloc(32)), outOfOrderPage.resultsRoot,
  'replaying the fold in terminalisation order reproduces the stored root');
neq([0n, 1n, 2n].map(nonce => historyRowHash(
  nonce,
  outOfOrderModel.historyResult(economyHashValue, outOfOrderPlayer, nonce),
)).reduce((root, row) => historyChainFold(root, row), Buffer.alloc(32)),
  outOfOrderPage.resultsRoot,
  'nonce order is NOT fold order, and the root proves it');
ok(outOfOrderModel.audit(),
  'out-of-order compact history remains fully auditable');

const voidModel = registerKernel();
const forwardPlayer = pk('forward-player');
voidModel.openLedger({
  economyHash: economyHashValue, player: forwardPlayer, signer: forwardPlayer,
});
openPackedReloadPage(voidModel, forwardPlayer);
packedReload(voidModel, forwardPlayer, 0n, 100_000_000n);
const forwardNow = 3_000n;
const t0 = 3_060n;
const t1 = 3_660n;
const sharedT0Open = openNeed(ctx, t0);
const sharedT1Open = openNeed(ctx, t1);
const entryFinal = finalFact(ctx, t0, {
  price: 20_000n, publishTime: 3_061n,
  captureTs: 3_062n, terminalTs: 3_085n,
});
const entryExpired = voidFact(ctx, t0, TIMEPIN_STATE.EXPIRED);
const entryAmbiguous = voidFact(ctx, t0, TIMEPIN_STATE.AMBIGUOUS);
const forwardCommit = nonce => commitmentHash({
  programId, economyHash: economyHashValue,
  rulesetHash: forwardRulesetHash, player: forwardPlayer, nonce,
  side: SIDE.UP, probability: 5_500, salt: pk('forward-salt-' + nonce),
});
const sealForward = ordinal => {
  const nonce = ordinal - 1n;
  return voidModel.sealForward({
  economyHash: economyHashValue, rulesetHash: forwardRulesetHash,
  player: forwardPlayer, signer: forwardPlayer, nonce, stake: 4n,
  commitment: forwardCommit(nonce), nowTs: forwardNow,
  entryTargetTs: t0, t0Need: sharedT0Open, t1Need: sharedT1Open,
  });
};

const pendingExpired = sealForward(1n);
voidModel.reserveWork({
  shot: pendingExpired.key, workKind: WORK_KIND.ACTIVATE_ENTRY,
  expectedIndex: 0,
});
voidModel.reserveWork({
  shot: pendingExpired.key, workKind: WORK_KIND.RESOLVE_SHOT,
  expectedIndex: 1,
});
voidModel.reserveWork({
  shot: pendingExpired.key, workKind: WORK_KIND.FORFEIT,
  expectedIndex: 2,
});
eq(pendingExpired.state, SHOT_STATE.PENDING_ENTRY,
  'forward seal starts PendingEntry');
eq(pendingExpired.entryTargetTs, t0, 'forward target aligns now+lead');
eq(pendingExpired.exitTargetTs, t1, 'forward exit is exact T0+horizon');
noMutation(voidModel, () => voidModel.activateEntry({
  shot: pendingExpired.key, fact: entryExpired, actor: pk('actor-x'),
  nowTs: 3_090n, currentSlot: 400n,
}), 'SHOT_MUST_VOID');
noMutation(voidModel, () => voidModel.voidPendingEntry({
  shot: pendingExpired.key, fact: entryFinal, actor: pk('actor-x'),
  nowTs: 3_090n, currentSlot: 400n,
}), 'SHOT_MUST_ACTIVATE');
const pendingVoid = voidModel.voidPendingEntry({
  shot: pendingExpired.key, fact: entryExpired, actor: pk('void-worker'),
  nowTs: 3_090n, currentSlot: 400n,
});
eq(pendingVoid.state, SHOT_STATE.VOID, 'expired pending entry voids');
eq(pendingVoid.voidReason, VOID_REASON.ENTRY_EXPIRED,
  'named entry-expired reason');
eq(pendingVoid.resolutionHash, resolutionHash(pendingVoid),
  'pending void resolution recomputes');
const nonpayableActivation = voidModel.receipt(
  pendingExpired.key, WORK_KIND.ACTIVATE_ENTRY,
);
eq(nonpayableActivation.disposition, RECEIPT_DISPOSITION.NONPAYABLE,
  'pending void writes nonpayable activation tombstone');
eq(nonpayableActivation.worker, zero32,
  'nonpayable activation has zero worker');
eq(nonpayableActivation.resultHash, completionResultHash({
  programId, subject: pendingExpired.key,
  workKind: WORK_KIND.ACTIVATE_ENTRY,
  factHash: pendingVoid.terminalHash,
  disposition: RECEIPT_DISPOSITION.NONPAYABLE,
  worker: zero32,
}), 'pending void activation completion wraps the terminal fact');
eq(voidModel.receipt(
  pendingExpired.key, WORK_KIND.RESOLVE_SHOT,
).disposition, RECEIPT_DISPOSITION.PAYABLE,
  'pending void resolution work payable');
noMutation(voidModel, () => sealForward(1n), 'WRONG_SHOT_NONCE');

const activatedSeal = sealForward(2n);
voidModel.reserveWork({
  shot: activatedSeal.key, workKind: WORK_KIND.ACTIVATE_ENTRY,
  expectedIndex: 3,
});
voidModel.reserveWork({
  shot: activatedSeal.key, workKind: WORK_KIND.RESOLVE_SHOT,
  expectedIndex: 4,
});
voidModel.reserveWork({
  shot: activatedSeal.key, workKind: WORK_KIND.FORFEIT,
  expectedIndex: 5,
});
const activated = voidModel.activateEntry({
  shot: activatedSeal.key, fact: entryFinal, actor: pk('activator'),
  nowTs: 3_090n, currentSlot: 401n,
});
eq(activated.state, SHOT_STATE.ACTIVE, 'Final T0 activates forward shot');
eq(activated.resolutionHash, zero32,
  'activation receipt hash is not stored in shot');
eq(voidModel.receipt(
  activated.key, WORK_KIND.ACTIVATE_ENTRY,
).disposition, RECEIPT_DISPOSITION.PAYABLE,
  'successful activation payable');
eq(voidModel.receipt(
  activated.key, WORK_KIND.ACTIVATE_ENTRY,
).resultHash, completionResultHash({
  programId, subject: activated.key,
  workKind: WORK_KIND.ACTIVATE_ENTRY,
  factHash: activated.entryTimepinResultHash,
  disposition: RECEIPT_DISPOSITION.PAYABLE,
  worker: pk('activator'),
}), 'activation completion authenticates the entry Timepin result');
const exitExpired = voidFact(ctx, t1, TIMEPIN_STATE.EXPIRED);
noMutation(voidModel, () => voidModel.settleFinal({
  shot: activated.key, fact: exitExpired, actor: pk('resolver'),
  nowTs: 3_690n, currentSlot: 402n,
}), 'SHOT_MUST_VOID');
const activeVoid = voidModel.voidActiveShot({
  shot: activated.key, fact: exitExpired, actor: pk('resolver'),
  nowTs: 3_690n, currentSlot: 402n,
});
eq(activeVoid.voidReason, VOID_REASON.EXIT_EXPIRED,
  'active shot consumes exact Expired T1');
eq(activeVoid.state, SHOT_STATE.VOID, 'active expired shot terminal');
eq(voidModel.receipt(
  activeVoid.key, WORK_KIND.RESOLVE_SHOT,
).resultHash, completionResultHash({
  programId, subject: activeVoid.key,
  workKind: WORK_KIND.RESOLVE_SHOT,
  factHash: activeVoid.resolutionHash,
  disposition: RECEIPT_DISPOSITION.PAYABLE,
  worker: pk('resolver'),
}), 'active void completion wraps the transient resolution fact');
eq(voidModel.receipt(
  activeVoid.key, WORK_KIND.FORFEIT,
).disposition, RECEIPT_DISPOSITION.NONPAYABLE,
  'non-forfeit terminalization makes sponsored forfeit nonpayable');

const equalitySeal = sealForward(3n);
voidModel.activateEntry({
  shot: equalitySeal.key, fact: entryFinal, actor: pk('activator-eq'),
  nowTs: 3_090n, currentSlot: 403n,
});
const equalExit = finalFact(ctx, t1, {
  price: 20_000n, publishTime: 3_661n,
  captureTs: 3_662n, terminalTs: 3_685n,
});
const equalAwaitVoid = voidModel.settleFinal({
  shot: equalitySeal.key, fact: equalExit, actor: pk('resolver-eq'),
  nowTs: 3_690n, currentSlot: 404n,
});
eq(equalAwaitVoid.state, SHOT_STATE.AWAITING_VOID,
  'equality resolution first enters AwaitVoid');
const equalVoid = voidModel.finalizeResolvedVoid({
  shot: equalitySeal.key, actor: pk('void-finalizer-eq'),
  nowTs: 3_691n, currentSlot: 405n,
});
eq(equalVoid.state, SHOT_STATE.VOID, 'equality deterministically voids');
eq(equalVoid.voidReason, VOID_REASON.EQUALITY, 'named equality reason');
noMutation(voidModel, () => voidModel.voidActiveShot({
  shot: equalitySeal.key, fact: exitExpired, actor: pk('late-void'),
  nowTs: 7_000n, currentSlot: 406n,
}), 'SHOT_NOT_FOUND');

const bandSeal = sealForward(4n);
voidModel.activateEntry({
  shot: bandSeal.key, fact: entryFinal, actor: pk('activator-band'),
  nowTs: 3_090n, currentSlot: 406n,
});
const bandExit = finalFact(ctx, t1, {
  price: 20_015n, conf: 10n, publishTime: 3_661n,
  captureTs: 3_662n, terminalTs: 3_685n,
});
const bandVoid = voidModel.settleFinal({
  shot: bandSeal.key, fact: bandExit, actor: pk('resolver-band'),
  nowTs: 3_690n, currentSlot: 407n,
});
eq(bandVoid.state, SHOT_STATE.AWAITING_VOID,
  'confidence band first enters AwaitVoid');
const finalizedBandVoid = voidModel.finalizeResolvedVoid({
  shot: bandSeal.key, actor: pk('void-finalizer-band'),
  nowTs: 3_691n, currentSlot: 408n,
});
eq(finalizedBandVoid.voidReason, VOID_REASON.CONFIDENCE_BAND,
  'confidence band deterministically voids');

const ambiguousPendingSeal = sealForward(5n);
const ambiguousPending = voidModel.voidPendingEntry({
  shot: ambiguousPendingSeal.key, fact: entryAmbiguous,
  actor: pk('ambiguous-worker'), nowTs: 3_090n, currentSlot: 408n,
});
eq(ambiguousPending.voidReason, VOID_REASON.ENTRY_AMBIGUOUS,
  'named entry-ambiguous reason');

const ambiguousActiveSeal = sealForward(6n);
voidModel.activateEntry({
  shot: ambiguousActiveSeal.key, fact: entryFinal,
  actor: pk('activator-ambiguous'), nowTs: 3_090n, currentSlot: 409n,
});
const exitAmbiguous = voidFact(ctx, t1, TIMEPIN_STATE.AMBIGUOUS);
const ambiguousActive = voidModel.voidActiveShot({
  shot: ambiguousActiveSeal.key, fact: exitAmbiguous,
  actor: pk('ambiguous-resolver'), nowTs: 3_690n, currentSlot: 410n,
});
eq(ambiguousActive.voidReason, VOID_REASON.EXIT_AMBIGUOUS,
  'named exit-ambiguous reason');

ledger = voidModel.ledger(economyHashValue, forwardPlayer);
eq(ledger.open, 0n, 'all void paths close open counter');
eq(ledger.lockedCredits, 0n, 'all void paths unlock stake');
eq(ledger.reservedPayoutCredits, 0n, 'all void paths release payout reserve');
eq(ledger.reservedXp, 0n, 'all void paths release XP reserve');
eq(ledger.refundedCredits, 24n, 'all six void stakes refunded');
eq(ledger.credits, 100n, 'voids preserve player credit balance');
ok(voidModel.audit(), 'audit every deterministic void path');

const missSalt = pk('forward-miss-salt');
const missCommit = commitmentHash({
  programId, economyHash: economyHashValue,
  rulesetHash: forwardRulesetHash, player: forwardPlayer, nonce: 6n,
  side: SIDE.DOWN, probability: 6_000, salt: missSalt,
});
const missSeal = voidModel.sealForward({
  economyHash: economyHashValue, rulesetHash: forwardRulesetHash,
  player: forwardPlayer, signer: forwardPlayer, nonce: 6n, stake: 4n,
  commitment: missCommit, nowTs: forwardNow,
  t0Need: sharedT0Open, t1Need: sharedT1Open,
});
voidModel.activateEntry({
  shot: missSeal.key, fact: entryFinal, actor: pk('miss-activator'),
  nowTs: 3_090n, currentSlot: 411n,
});
const directionalExit = finalFact(ctx, t1, {
  price: 20_100n, conf: 10n, publishTime: 3_661n,
  captureTs: 3_662n, terminalTs: 3_685n,
});
const missAwaiting = voidModel.settleFinal({
  shot: missSeal.key, fact: directionalExit, actor: pk('miss-resolver'),
  nowTs: 3_690n, currentSlot: 412n,
});
const missResolution = Buffer.from(missAwaiting.resolutionHash);
const missed = voidModel.reveal({
  shot: missSeal.key, side: SIDE.DOWN, probability: 6_000, salt: missSalt,
  player: forwardPlayer, signer: forwardPlayer, nowTs: 3_739n,
  currentSlot: 413n,
});
eq(missed.hit, 0, 'wrong revealed side is a miss');
eq(missed.xpAwarded, economySpec.settleXp, 'miss gets settle XP only');
eq(missed.resolutionHash, missResolution,
  'miss preserves resolution hash');
ledger = voidModel.ledger(economyHashValue, forwardPlayer);
eq(ledger.payoutCredits, 0n, 'miss creates no payout source');
eq(ledger.earnedXp, 10n, 'miss XP remains conserved');
eq(ledger.retiredCredits, 4n, 'miss stake retires');
eq(ledger.credits, 96n, 'miss cannot refund risked stake');
ok(voidModel.audit(), 'audit hit/miss/void lifecycle coverage');

const rawRules = { ...forwardRuleset, timepinProgram, evidenceSpec };
const factAuth = fact => authenticateTerminalFact(
  fact, rawRules, entryFinal.need.key, t0,
);
eq(factAuth({ ...entryFinal, decodedPrice: -999_999n }).candidate.record.price,
  20_000n, 'caller-decoded price is ignored');
throwsCode(() => factAuth({
  ...entryFinal,
  need: mutate(entryFinal.need, value => { value.owner = pk('wrong-owner'); }),
}), 'TIMEPIN_NEED_OWNER');
throwsCode(() => factAuth({
  ...entryFinal,
  need: mutate(entryFinal.need, value => {
    value.data = value.data.subarray(0, value.data.length - 1);
  }),
}), 'TIMEPIN_NEED_LENGTH');
throwsCode(() => factAuth({
  ...entryFinal,
  need: mutate(entryFinal.need, value => { value.key = pk('wrong-need-pda'); }),
}), 'TIMEPIN_NEED_PDA');
throwsCode(() => factAuth({
  ...entryFinal,
  need: mutate(entryFinal.need, value => { value.data[12] ^= 1; }),
}), 'TIMEPIN_NEED_EVIDENCE_SPEC');
throwsCode(() => factAuth({
  ...entryFinal,
  need: mutate(entryFinal.need, value => { value.data[11] = 255; }),
}), 'TIMEPIN_NEED_STATE');
throwsCode(() => factAuth({
  ...entryFinal,
  need: mutate(entryFinal.need, value => { value.data[68] ^= 1; }),
}), 'TIMEPIN_CANDIDATE_MESSAGE_HASH');
throwsCode(() => factAuth({
  ...entryFinal,
  candidate: mutate(entryFinal.candidate, value => {
    value.data[0] ^= 1;
  }),
}), 'TIMEPIN_CANDIDATE_DISCRIMINATOR');
throwsCode(() => factAuth({
  ...entryFinal,
  candidate: mutate(entryFinal.candidate, value => {
    value.data = value.data.subarray(0, value.data.length - 1);
  }),
}), 'TIMEPIN_CANDIDATE_LENGTH');
throwsCode(() => factAuth({
  ...entryFinal,
  candidate: mutate(entryFinal.candidate, value => {
    value.key = pk('wrong-candidate-pda');
  }),
}), 'TIMEPIN_CANDIDATE_PDA');
throwsCode(() => factAuth({
  ...entryFinal,
  candidate: mutate(entryFinal.candidate, value => {
    value.data.writeInt32LE(CORE_MIN_EXPONENT - 1, 59);
  }),
}), 'TIMEPIN_CANDIDATE_EXPONENT');
throwsCode(() => factAuth({
  ...entryFinal,
  candidate: mutate(entryFinal.candidate, value => {
    value.data.writeInt32LE(CORE_MAX_EXPONENT + 1, 59);
  }),
}), 'TIMEPIN_CANDIDATE_EXPONENT');
throwsCode(() => factAuth({
  ...entryFinal,
  candidate: mutate(entryFinal.candidate, value => {
    value.data[43] ^= 1;
  }),
}), 'TIMEPIN_CANDIDATE_MESSAGE_HASH');
throwsCode(() => factAuth({
  ...entryFinal,
  candidate: mutate(entryFinal.candidate, value => {
    value.data[11] ^= 1;
  }),
}), 'TIMEPIN_CANDIDATE_NEED');
throwsCode(() => factAuth({
  ...entryFinal,
  timepin: { obsoleteStandaloneTerminal: true },
}), 'UNEXPECTED_TIMEPIN_TERMINAL');
eq(timepinResultHash(factAuth(entryFinal).need),
  factAuth(entryFinal).terminal.resultHash,
  'terminal result hash is derived only from authenticated Need bytes');
throwsCode(() => authenticateTerminalFact(
  entryFinal, rawRules, pk('other-need'), t0,
), 'WRONG_TIMEPIN_NEED');

const staleEntryTarget = 4_000n;
const staleEntry = finalFact(ctx, staleEntryTarget, {
  price: 5_000n, publishTime: 4_001n,
  captureTs: 4_002n, terminalTs: 4_025n,
});
const staleExitNeed = openNeed(ctx, 5_640n);
noMutation(voidModel, () => voidModel.sealObserved({
  economyHash: economyHashValue, rulesetHash: observedRulesetHash,
  player: forwardPlayer, signer: forwardPlayer, nonce: 99n, stake: 1n,
  commitment: pk('opaque-commit'), nowTs: 5_000n,
  observedEntry: staleEntry, t1Need: staleExitNeed,
}), 'OBSERVED_ENTRY_STALE');

eq(scaleToE12(1n, -12), 1n, 'lower exponent boundary');
eq(scaleToE12(1n, 2), 100_000_000_000_000n, 'upper exponent boundary');
throwsCode(() => scaleToE12(1n, -13), 'BAD_EXPONENT');
throwsCode(() => scaleToE12(1n, 3), 'BAD_EXPONENT');
eq(compareExactPrices(
  { price: 100n, exponent: -2 },
  { price: 1n, exponent: 0 },
), 0, 'mixed exponents compare exactly');
eq(compareExactPrices(
  { price: 100n, exponent: -2 },
  { price: 101n, exponent: -2 },
), 1, 'exact upward comparison');
eq(compareExactPrices(
  { price: 100n, exponent: -2 },
  { price: 99n, exponent: -2 },
), -1, 'exact downward comparison');
eq(sealXp(20n, 5n), 4n, 'seal XP integer vector');
eq(sealXp(20n, 40_000n), 400n, 'seal XP hard cap vector');
eq(skillXp(100n, 0n), 100n, 'skill XP zero streak');
eq(skillXp(100n, 1n), 115n, 'skill XP step');
eq(skillXp(100n, 7n), 200n, 'skill XP multiplier cap');
eq(terminalXpReserve(100n, 10n), 110n,
  'terminal XP reserves exact hit base plus settle');
eq(brierScore(SIDE.UP, 7_000, true), 9_000_000n,
  'up-side Brier vector');
eq(brierScore(SIDE.DOWN, 7_000, false), 9_000_000n,
  'down-side Brier converts to yes probability');
throwsCode(() => brierScore(SIDE.UP, 0, true), 'BAD_PROBABILITY');
throwsCode(() => brierScore(SIDE.DOWN, 10_000, false), 'BAD_PROBABILITY');

for (let i = 1; i <= 200; i += 1) {
  const exponent = CORE_MIN_EXPONENT +
    (i % (CORE_MAX_EXPONENT - CORE_MIN_EXPONENT + 1));
  const value = BigInt(i * 7919);
  eq(scaleToE12(value, exponent),
    value * (10n ** BigInt(12 + exponent)),
    'fuzz exact exponent scaling ' + i);
  const probability = 1 + (i * 47 % 9_999);
  const score = brierScore(i % 2, probability, i % 3 === 0);
  ok(score >= 0n && score <= 100_000_000n,
    'fuzz Brier envelope ' + i);
}

const casModel = registerKernel();
const casPlayer = pk('cas-player');
casModel.openLedger({
  economyHash: economyHashValue, player: casPlayer, signer: casPlayer,
});
openPackedReloadPage(casModel, casPlayer);
packedReload(casModel, casPlayer, 0n, 2_000_000n);
const casNow = 6_000n;
const casT0 = 6_060n;
const casT1 = 6_660n;
const casEntryNeed = openNeed(ctx, casT0);
const casExitNeed = openNeed(ctx, casT1);
const casRevision = casModel.revision;
casModel.sealForward({
  economyHash: economyHashValue, rulesetHash: forwardRulesetHash,
  player: casPlayer, signer: casPlayer, nonce: 0n, stake: 1n,
  commitment: pk('cas-one'), nowTs: casNow,
  t0Need: casEntryNeed, t1Need: casExitNeed,
  expectedRevision: casRevision,
});
noMutation(casModel, () => casModel.sealForward({
  economyHash: economyHashValue, rulesetHash: forwardRulesetHash,
  player: casPlayer, signer: casPlayer, nonce: 1n, stake: 1n,
  commitment: pk('cas-two'), nowTs: casNow,
  t0Need: casEntryNeed, t1Need: casExitNeed,
  expectedRevision: casRevision,
}), 'STALE_REVISION');
eq(casModel.ledger(economyHashValue, casPlayer).open, 1n,
  'CAS loser cannot double-debit');
ok(casModel.audit(), 'CAS model conserves');

const alternateHash = economyHash(alternateEconomy);
model.registerEconomy({
  spec: alternateEconomy,
  account: makeEconomyAccount(programId, alternateEconomy),
  timepinProgram, currentSlot: 100n,
});
noMutation(model, () => model.sealObserved({
  economyHash: alternateHash, rulesetHash: observedRulesetHash,
  player: reloadPlayer, signer: reloadPlayer, nonce: 90n, stake: 1n,
  commitment: pk('cross-economy'), nowTs: observedNow,
  observedEntry: observedEntryFact, t1Need: observedExitNeed,
}), 'CROSS_ECONOMY_RULESET');

const loadModel = registerKernel();
const loadPlayers = Array.from({ length: 16 }, (_, i) => pk('load-player-' + i));
for (const player of loadPlayers) {
  loadModel.openLedger({
    economyHash: economyHashValue, player, signer: player,
  });
  openPackedReloadPage(loadModel, player);
  packedReload(loadModel, player, 0n, 64_000_000n);
}
const sharedNow = 10_000n;
const sharedT0 = 10_080n;
const sharedT1 = 10_680n;
const oneSharedEntryNeed = openNeed(ctx, sharedT0);
const oneSharedExitNeed = openNeed(ctx, sharedT1);

const workModel = registerKernel();
const workPlayer = pk('work-page-player');
workModel.openLedger({
  economyHash: economyHashValue,
  player: workPlayer,
  signer: workPlayer,
});
openPackedReloadPage(workModel, workPlayer);
packedReload(workModel, workPlayer, 0n, 16_000_000n);
const workShots = [];
for (let nonce = 0n; nonce < 16n; nonce += 1n) {
  workShots.push(workModel.sealForward({
    economyHash: economyHashValue,
    rulesetHash: forwardRulesetHash,
    player: workPlayer,
    signer: workPlayer,
    nonce,
    stake: 1n,
    commitment: pk('work-page-commit-' + nonce),
    nowTs: sharedNow,
    t0Need: oneSharedEntryNeed,
    t1Need: oneSharedExitNeed,
  }));
}
let nextWorkIndex = 0;
for (const shot of workShots) {
  for (const workKind of [
    WORK_KIND.ACTIVATE_ENTRY,
    WORK_KIND.RESOLVE_SHOT,
    WORK_KIND.FORFEIT,
  ]) {
    workModel.reserveWork({
      shot: shot.key,
      workKind,
      expectedIndex: nextWorkIndex,
    });
    nextWorkIndex += 1;
  }
}
const fullWorkPage = workModel.workPage(
  economyHashValue, workPlayer, 0n,
);
eq(fullWorkPage.records.length, 48,
  'sixteen shots reserve exactly forty-eight generic work records');
eq(workPageSerializedLen(fullWorkPage.records), WORK_PAGE_MAX_LEN,
  'forty-eight records fill the exact WorkPage allocation');
eq(fullWorkPage.key,
  deriveWorkPagePda(programId, economyHashValue, workPlayer, 0n).key,
  'canonical WorkPage PDA is tied to the shot nonce page');
eq(new Set(fullWorkPage.records.map(record =>
  record.subject.toString('hex') + ':' + record.workKind,
)).size, 48, 'WorkPage enforces unique subject/kind pairs');
throwsCode(() => workModel.receipt(
  workShots[0].key, WORK_KIND.ACTIVATE_ENTRY,
), 'WORK_RECORD_PENDING');
const duplicateWorkRevision = workModel.revision;
workModel.reserveWork({
  shot: workShots[0].key,
  workKind: WORK_KIND.ACTIVATE_ENTRY,
  expectedIndex: 0,
});
eq(workModel.revision, duplicateWorkRevision,
  'identical canonical work reservation replays idempotently');
ok(workModel.audit(), 'full pending WorkPage remains auditable');

const nextNonce = Array(16).fill(-1n);
const shotKeys = new Set();
const sharedSeals = 1_000;
for (let i = 0; i < sharedSeals; i += 1) {
  const playerIndex = i < 64 ? 0 : 1 + ((i - 64) % 15);
  const player = loadPlayers[playerIndex];
  nextNonce[playerIndex] += 1n;
  const nonce = nextNonce[playerIndex];
  const shot = loadModel.sealForward({
    economyHash: economyHashValue,
    rulesetHash: forwardRulesetHash,
    player,
    signer: player,
    nonce,
    stake: 1n,
    commitment: pk('load-commit-' + i),
    nowTs: sharedNow,
    entryTargetTs: sharedT0,
    t0Need: oneSharedEntryNeed,
    t1Need: oneSharedExitNeed,
  });
  shotKeys.add(shot.key.toString('hex'));
  eq(shot.entryNeed, oneSharedEntryNeed.key, 'shared T0 Need ' + i);
}
eq(shotKeys.size, sharedSeals, 'all shared-Need shot PDAs unique');
eq(loadModel.ledger(economyHashValue, loadPlayers[0]).open, 64n,
  'one player reaches immutable max-open bound');
noMutation(loadModel, () => loadModel.sealForward({
  economyHash: economyHashValue,
  rulesetHash: forwardRulesetHash,
  player: loadPlayers[0],
  signer: loadPlayers[0],
  nonce: 64n,
  stake: 1n,
  commitment: pk('max-open-overflow'),
  nowTs: sharedNow,
  t0Need: oneSharedEntryNeed,
  t1Need: oneSharedExitNeed,
}), 'TOO_MANY_OPEN');

let totalAvailable = 0n;
let totalLocked = 0n;
let totalReservedPayout = 0n;
let totalReservedXp = 0n;
for (const player of loadPlayers) {
  const value = loadModel.ledger(economyHashValue, player);
  totalAvailable += value.credits;
  totalLocked += value.lockedCredits;
  totalReservedPayout += value.reservedPayoutCredits;
  totalReservedXp += value.reservedXp;
  ok(requireLedgerConservation(value), 'load ledger conservation');
}
eq(totalAvailable, 24n, '1,024 sourced credits minus 1,000 locked');
eq(totalLocked, 1_000n, 'all shared-Need stakes locked');
eq(totalReservedPayout, 2_000n, 'all maximum payouts reserved');
eq(totalReservedXp, 12_000n, 'all exact terminal XP awards reserved');
ok(loadModel.audit(), '1,000 shared-Need seals audit');

console.log(
  'Core G2 model: ' + checks + ' checks; ' +
  sharedSeals.toLocaleString('en-US') + ' shared-Need seals',
);
