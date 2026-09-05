import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PublicKey } from '@solana/web3.js';
import {
  TIMEPIN_SCHEMA_V2, ADAPTER_PYTH_PUSH_V2, VERIFICATION_FULL,
  PRICE_UPDATE_V2_LEN, EVIDENCE_POLICY_V2_CANONICAL_LEN,
  EVIDENCE_SPEC_V2_CANONICAL_LEN, EVIDENCE_SPEC_V2_PAYLOAD_LEN,
  EVIDENCE_SPEC_V2_ACCOUNT_LEN, TIMEPIN_NEED_V2_PAYLOAD_LEN,
  TIMEPIN_NEED_V2_ACCOUNT_LEN, CANDIDATE_V2_PAYLOAD_LEN, CANDIDATE_V2_ACCOUNT_LEN,
  WORK_MANIFEST_ACCOUNT_LEN, WORK_PAGE_BASE_ACCOUNT_LEN, WORK_PAGE_MAX_ACCOUNT_LEN,
  WORK_PAGE_RECORDS_OFFSET, WORK_RECORD_LEN,
  WORK_KIND_FIRST_CAPTURE, WORK_KIND_TERMINALIZE,
  WORK_DISPOSITION_PENDING, WORK_DISPOSITION_PAYABLE, WORK_DISPOSITION_NONPAYABLE,
  OFFICIAL_PYTH_RECEIVER_PROGRAM, OFFICIAL_PYTH_PUSH_ORACLE_PROGRAM,
  BPF_UPGRADEABLE_LOADER_PROGRAM, SYSTEM_PROGRAM,
  validateEvidenceSpec, encodeEvidencePolicy, encodeEvidenceSpec,
  evidencePolicyHash, evidenceSpecHash, encodeEvidenceSpecAccountData,
  validateEvidenceSpecAccount, validateGeneration, registerEvidenceSpec,
  deriveReceiverConfigPda, deriveEvidenceSpecPda, deriveNeedPda, deriveCandidatePda,
  derivePushSourcePda, deriveWorkManifestPda, deriveWorkPagePda,
  alignFutureTarget, deriveForwardTargets, createNeed, openNeed, validateNeed,
  encodeTimepinNeedV2, decodePriceUpdateV2, hashPriceMessage, evaluateCapture,
  encodeCandidateV2, validateCandidate, terminalResultHash, captureNeed, terminalizeNeed,
  workManifestDefinition, encodeWorkManifest, createWorkPage, encodeWorkPage,
  createAbsentWorkPageAccount, validateWorkPage, reserveWork, completionResultHash,
} from '../onchain/rcx-timepin/model-v2.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const registerVector = JSON.parse(readFileSync(join(
  root, 'onchain', 'rcx-timepin-v2', 'vectors', 'register-open-v2.json',
), 'utf8'));
const lifecycleVector = JSON.parse(readFileSync(join(
  root, 'onchain', 'rcx-timepin-v2', 'vectors', 'lifecycle-v2.json',
), 'utf8'));

let checks = 0;
const ok = (value, message) => { checks += 1; assert.ok(value, message); };
const equal = (actual, expected, message) => { checks += 1; assert.equal(actual, expected, message); };
const bytes = (actual, expected, message) => {
  checks += 1; assert.deepEqual(Buffer.from(actual), Buffer.from(expected), message);
};
const throws = (fn, pattern, message) => { checks += 1; assert.throws(fn, pattern, message); };
const sha256 = value => createHash('sha256').update(value).digest();
const key = value => new PublicKey(value).toBuffer();
const hex = value => Buffer.from(value, 'hex');

const PROGRAM_ID = key(registerVector.programId);
const WORMHOLE = Buffer.alloc(32, 8);
const RECEIVER_PROGRAMDATA = Buffer.alloc(32, 20);
const WORMHOLE_PROGRAMDATA = Buffer.alloc(32, 21);
const ACTOR_A = Buffer.alloc(32, 31);
const ACTOR_B = Buffer.alloc(32, 32);

equal(registerVector.programId, 'C8wwxUGmoKAV22MaY3oW2Q6QeDbmB9dbNdbohsRjJkYp',
  'canonical deployable Timepin identity');
equal(registerVector.deployableIdentity, true, 'Timepin vector identity is deployable');

function loaderProgramAccountData(programdata) {
  const out = Buffer.alloc(36);
  out.writeUInt32LE(2, 0);
  Buffer.from(programdata).copy(out, 4);
  return out;
}

function loaderProgramdataAccountData(slot) {
  const out = Buffer.alloc(45);
  out.writeUInt32LE(3, 0);
  out.writeBigUInt64LE(BigInt(slot), 4);
  out[12] = 0; // upgrade_authority_address: None
  return out;
}

function receiverConfigData(wormhole) {
  const out = Buffer.alloc(370);
  sha256(Buffer.from('account:Config')).subarray(0, 8).copy(out, 0);
  Buffer.alloc(32, 11).copy(out, 8); // governance_authority
  let offset = 40;
  out[offset] = 0; offset += 1; // target_governance_authority: None
  Buffer.from(wormhole).copy(out, offset); offset += 32;
  out.writeUInt32LE(0, offset); offset += 4; // valid_data_sources: []
  out.writeBigUInt64LE(0n, offset); offset += 8;
  out[offset] = 1; // minimum_signatures
  return out;
}

const CONFIG_DATA = receiverConfigData(WORMHOLE);

// Synthetic experimental adapter-1 fixture; this is not a mainnet policy recommendation.
const POLICY = {
  schema: TIMEPIN_SCHEMA_V2,
  adapter: ADAPTER_PYTH_PUSH_V2,
  receiverProgram: OFFICIAL_PYTH_RECEIVER_PROGRAM,
  pushOracleProgram: OFFICIAL_PYTH_PUSH_ORACLE_PROGRAM,
  shardId: 0,
  feedId: Buffer.alloc(32, 3),
  requiredVerification: VERIFICATION_FULL,
  targetGridSeconds: 60,
  minOpenLeadSeconds: 30,
  maxTargetAheadSeconds: 3600,
  maxPreTargetGapSeconds: 120,
  maxPostTargetLagSeconds: 59, // grid - 1: one print cannot serve consecutive targets
  captureGraceSeconds: 60,
  maxFutureSkewSeconds: 5,
  minExponent: -12,
  maxExponent: 2,
  maxConfidenceBps: 1000,
};
const SPEC_ARGS = {
  ...POLICY,
  receiverProgramdataSlot: 900n,
  receiverConfigHash: sha256(CONFIG_DATA),
  wormholeProgram: WORMHOLE,
  wormholeProgramdataSlot: 901n,
};

const GENERATION = {
  receiverProgram: OFFICIAL_PYTH_RECEIVER_PROGRAM,
  receiverProgramExecutable: true,
  receiverProgramOwner: BPF_UPGRADEABLE_LOADER_PROGRAM,
  receiverProgramAccountData: loaderProgramAccountData(RECEIVER_PROGRAMDATA),
  receiverProgramdata: RECEIVER_PROGRAMDATA,
  receiverProgramdataOwner: BPF_UPGRADEABLE_LOADER_PROGRAM,
  receiverProgramdataExecutable: false,
  receiverProgramdataAccountData: loaderProgramdataAccountData(900n),
  receiverConfigKey: deriveReceiverConfigPda().address,
  receiverConfigOwner: OFFICIAL_PYTH_RECEIVER_PROGRAM,
  receiverConfigExecutable: false,
  receiverConfigData: CONFIG_DATA,
  wormholeProgram: WORMHOLE,
  wormholeProgramExecutable: true,
  wormholeProgramOwner: BPF_UPGRADEABLE_LOADER_PROGRAM,
  wormholeProgramAccountData: loaderProgramAccountData(WORMHOLE_PROGRAMDATA),
  wormholeProgramdata: WORMHOLE_PROGRAMDATA,
  wormholeProgramdataOwner: BPF_UPGRADEABLE_LOADER_PROGRAM,
  wormholeProgramdataExecutable: false,
  wormholeProgramdataAccountData: loaderProgramdataAccountData(901n),
};

const generation = changes => ({ ...GENERATION, ...changes });
const spec = changes => ({ ...SPEC_ARGS, ...changes });

const vectorFields = registerVector.evidencePolicy.fields;
const VECTOR_SPEC = {
  schema: vectorFields.schema,
  adapter: vectorFields.adapter,
  receiverProgram: key(vectorFields.receiverProgram),
  pushOracleProgram: key(vectorFields.pushOracleProgram),
  shardId: vectorFields.shardId,
  feedId: hex(vectorFields.feedIdHex),
  requiredVerification: vectorFields.requiredVerification,
  targetGridSeconds: vectorFields.targetGridSeconds,
  minOpenLeadSeconds: vectorFields.minOpenLeadSeconds,
  maxTargetAheadSeconds: vectorFields.maxTargetAheadSeconds,
  maxPreTargetGapSeconds: vectorFields.maxPreTargetGapSeconds,
  maxPostTargetLagSeconds: vectorFields.maxPostTargetLagSeconds,
  captureGraceSeconds: vectorFields.captureGraceSeconds,
  maxFutureSkewSeconds: vectorFields.maxFutureSkewSeconds,
  minExponent: vectorFields.minExponent,
  maxExponent: vectorFields.maxExponent,
  maxConfidenceBps: vectorFields.maxConfidenceBps,
  receiverProgramdataSlot: BigInt(
    registerVector.syntheticGenerationFixture.receiverProgramData.generationSlot,
  ),
  receiverConfigHash: hex(
    registerVector.syntheticGenerationFixture.receiverConfig.completeAccountDataSha256,
  ),
  wormholeProgram: key(registerVector.syntheticGenerationFixture.wormholeProgram),
  wormholeProgramdataSlot: BigInt(
    registerVector.syntheticGenerationFixture.wormholeProgramData.generationSlot,
  ),
  registeredSlot: BigInt(registerVector.syntheticGenerationFixture.registrationClockSlot),
};
VECTOR_SPEC.evidencePolicyHash = evidencePolicyHash(VECTOR_SPEC);

// The generation-independent policy and generation-bound spec are separate, fixed preimages.
{
  equal(PRICE_UPDATE_V2_LEN, 134, 'PriceUpdateV2 exact account length');
  equal(EVIDENCE_POLICY_V2_CANONICAL_LEN, 134, 'policy canonical length');
  equal(EVIDENCE_SPEC_V2_CANONICAL_LEN, 214, 'full spec canonical length');
  equal(EVIDENCE_SPEC_V2_PAYLOAD_LEN, 254, 'stored spec payload length');
  equal(EVIDENCE_SPEC_V2_ACCOUNT_LEN, 262, 'stored spec account length');
  equal(TIMEPIN_NEED_V2_PAYLOAD_LEN, 160, 'Need payload length');
  equal(TIMEPIN_NEED_V2_ACCOUNT_LEN, 168, 'Need account length');
  equal(CANDIDATE_V2_PAYLOAD_LEN, 111, 'Candidate payload length');
  equal(CANDIDATE_V2_ACCOUNT_LEN, 119, 'Candidate account length');
  equal(encodeEvidencePolicy(VECTOR_SPEC).length, 134, 'encoded policy length');
  equal(encodeEvidenceSpec(VECTOR_SPEC).length, 214, 'encoded spec length');
  bytes(encodeEvidencePolicy(VECTOR_SPEC), hex(registerVector.evidencePolicy.canonicalBytesHex),
    'policy canonical bytes');
  bytes(encodeEvidenceSpec(VECTOR_SPEC), hex(registerVector.evidenceSpec.canonicalBytesHex),
    'full canonical bytes');
  equal(evidencePolicyHash(VECTOR_SPEC).toString('hex'), registerVector.evidencePolicy.hashHex,
    'policy hash vector');
  equal(evidenceSpecHash(VECTOR_SPEC).toString('hex'), registerVector.evidenceSpec.hashHex,
    'generation-bound spec hash vector');
  equal(deriveEvidenceSpecPda(PROGRAM_ID, VECTOR_SPEC).address.toString('base64'),
    key(registerVector.evidenceSpec.pda).toString('base64'), 'spec PDA vector');
  equal(deriveReceiverConfigPda().address.toString('base64'),
    key(registerVector.syntheticGenerationFixture.receiverConfig.pda).toString('base64'),
    'official Receiver config PDA');

  const policyMutation = { ...VECTOR_SPEC, maxConfidenceBps: 999 };
  ok(!evidencePolicyHash(policyMutation).equals(evidencePolicyHash(VECTOR_SPEC)),
    'policy mutation changes policy hash');
  const generationMutation = { ...VECTOR_SPEC, receiverProgramdataSlot: 899n };
  bytes(evidencePolicyHash(generationMutation), evidencePolicyHash(VECTOR_SPEC),
    'generation mutation leaves policy hash stable');
  ok(!evidenceSpecHash(generationMutation).equals(evidenceSpecHash(VECTOR_SPEC)),
    'generation mutation changes full spec hash');
}

// Registration checks both Loader-v3 links, both pinned slots, the whole config hash and Wormhole.
{
  equal(validateEvidenceSpec(SPEC_ARGS).code, 'OK', 'valid full spec');
  equal(validateEvidenceSpec(spec({ maxPostTargetLagSeconds: 60 })).code,
    'POST_LAG_NOT_BELOW_GRID', 'lag equal to grid is independently rejected');
  equal(validateEvidenceSpec(spec({ maxPostTargetLagSeconds: 120 })).code,
    'POST_LAG_NOT_BELOW_GRID', 'historical two-grid lag remains an invalid fixture');
  equal(validateGeneration(SPEC_ARGS, GENERATION, 1000n).code, 'OK', 'valid generation');
  equal(validateGeneration(SPEC_ARGS, generation({
    receiverProgramAccountData: loaderProgramAccountData(Buffer.alloc(32, 99)),
  }), 1000n).code, 'WRONG_RECEIVER_PROGRAMDATA_LINK', 'receiver link mutation');
  equal(validateGeneration(SPEC_ARGS, generation({
    receiverProgramdataAccountData: loaderProgramdataAccountData(899n),
  }), 1000n).code, 'RECEIVER_GENERATION_MISMATCH', 'receiver slot mutation');
  equal(validateGeneration(SPEC_ARGS, generation({
    receiverProgramdataAccountData: Buffer.alloc(45),
  }), 1000n).code, 'WRONG_RECEIVER_PROGRAMDATA', 'receiver ProgramData variant mutation');
  const changedConfig = Buffer.from(CONFIG_DATA);
  changedConfig[changedConfig.length - 1] ^= 1;
  equal(validateGeneration(SPEC_ARGS, generation({
    receiverConfigData: changedConfig,
  }), 1000n).code, 'RECEIVER_CONFIG_MISMATCH', 'complete config mutation');
  equal(validateGeneration(SPEC_ARGS, generation({
    receiverConfigData: Buffer.alloc(370),
  }), 1000n).code, 'BAD_RECEIVER_CONFIG', 'invalid Config discriminator');
  const otherConfig = receiverConfigData(Buffer.alloc(32, 98));
  equal(validateGeneration(spec({
    receiverConfigHash: sha256(otherConfig),
  }), generation({
    receiverConfigData: otherConfig,
  }), 1000n).code, 'WRONG_CONFIGURED_WORMHOLE', 'configured Wormhole is parsed from config');
  equal(validateGeneration(SPEC_ARGS, generation({
    wormholeProgramAccountData: loaderProgramAccountData(Buffer.alloc(32, 97)),
  }), 1000n).code, 'WRONG_WORMHOLE_PROGRAMDATA_LINK', 'Wormhole link mutation');
  equal(validateGeneration(SPEC_ARGS, generation({
    wormholeProgramdataAccountData: loaderProgramdataAccountData(902n),
  }), 1000n).code, 'WORMHOLE_GENERATION_MISMATCH', 'Wormhole slot mutation');
  equal(validateGeneration(SPEC_ARGS, GENERATION, 901n).code,
    'GENERATION_NOT_OBSERVABLE_YET', 'clock must be later than both code slots');

  const registered = registerEvidenceSpec(SPEC_ARGS, GENERATION, 1000n, PROGRAM_ID);
  equal(registered.code, 'REGISTERED', 'registration succeeds');
  equal(registered.account.data.length, 262, 'registration produces exact stored account');
  equal(validateEvidenceSpecAccount(PROGRAM_ID, registered.account).code, 'OK',
    'stored spec authenticates');
  const tampered = {
    ...registered.account,
    data: Buffer.from(registered.account.data),
  };
  tampered.data[150] ^= 1;
  equal(validateEvidenceSpecAccount(PROGRAM_ID, tampered).code, 'EVIDENCE_SPEC_BYTES_MISMATCH',
    'stored spec bytes fail closed');
}

const registered = registerEvidenceSpec(SPEC_ARGS, GENERATION, 1000n, PROGRAM_ID);
const LIVE_SPEC = registered.spec;
const TARGET = 1_800_001_200n;
const OPENED = TARGET - 60n;
const MESSAGE_A = {
  feedId: LIVE_SPEC.feedId,
  price: 12_345_678n,
  conf: 12_345n,
  exponent: -6,
  publishTime: TARGET,
  prevPublishTime: TARGET - 60n,
  emaPrice: 12_345_678n,
  emaConf: 12_345n,
  postedSlot: 1001n,
};
const MESSAGE_B = { ...MESSAGE_A, price: 12_345_679n, conf: 12_346n };
const PRICE_DISCRIMINATOR = sha256(Buffer.from('account:PriceUpdateV2')).subarray(0, 8);

function priceUpdateData(message, changes = {}) {
  const sourceKey = derivePushSourcePda(LIVE_SPEC).address;
  const value = {
    writeAuthority: sourceKey,
    verificationLevel: VERIFICATION_FULL,
    ...message,
    ...changes,
  };
  const out = Buffer.alloc(PRICE_UPDATE_V2_LEN);
  PRICE_DISCRIMINATOR.copy(out, 0);
  Buffer.from(value.writeAuthority).copy(out, 8);
  out[40] = value.verificationLevel;
  let offset = 41;
  Buffer.from(value.feedId).copy(out, offset); offset += 32;
  out.writeBigInt64LE(BigInt(value.price), offset); offset += 8;
  out.writeBigUInt64LE(BigInt(value.conf), offset); offset += 8;
  out.writeInt32LE(value.exponent, offset); offset += 4;
  out.writeBigInt64LE(BigInt(value.publishTime), offset); offset += 8;
  out.writeBigInt64LE(BigInt(value.prevPublishTime), offset); offset += 8;
  out.writeBigInt64LE(BigInt(value.emaPrice), offset); offset += 8;
  out.writeBigUInt64LE(BigInt(value.emaConf), offset); offset += 8;
  out.writeBigUInt64LE(BigInt(value.postedSlot), offset);
  return out;
}

function source(message = MESSAGE_A, changes = {}) {
  const sourceKey = derivePushSourcePda(LIVE_SPEC).address;
  return {
    key: changes.key ?? sourceKey,
    owner: changes.owner ?? LIVE_SPEC.receiverProgram,
    executable: changes.executable ?? false,
    data: changes.data ?? priceUpdateData(message, changes.message),
  };
}

const context = (slot = 1001n, unixTimestamp = TARGET + 1n, changes = {}) => ({
  slot, unixTimestamp, generation: GENERATION, ...changes,
});

// Need is the only request and terminal account; Candidate stores only irreducible message fields.
{
  equal(alignFutureTarget(1001n, 30, 60), 1080n, 'align next future target');
  const targets = deriveForwardTargets(1001n, LIVE_SPEC, 120);
  equal(targets.t0, 1080n, 'forward T0');
  equal(targets.t1, 1200n, 'forward T1');
  throws(() => deriveForwardTargets(1001n, LIVE_SPEC, 61), /HORIZON_NOT_GRID_ALIGNED/,
    'forward horizon must align');

  const need = createNeed(LIVE_SPEC, TARGET, OPENED, PROGRAM_ID);
  equal(encodeTimepinNeedV2(need).length, TIMEPIN_NEED_V2_ACCOUNT_LEN, 'Need exact full size');
  equal(need.sourceDeadlineTs, TARGET + 59n, 'source deadline uses the valid lag');
  equal(need.captureDeadlineTs, TARGET + 119n, 'capture deadline adds the grace period');
  const rentBytes = encodeTimepinNeedV2({ ...need, openRefs: 0, rentPayer: ACTOR_A });
  equal(rentBytes.readUInt32LE(132), 0, 'rent suffix starts after the 124-byte historical payload');
  bytes(rentBytes.subarray(136, 168), ACTOR_A, 'rent payer occupies the final 32 bytes');
  equal(validateNeed(LIVE_SPEC, need, PROGRAM_ID).code, 'OK', 'Need authenticates');
  for (const removed of [
    'openedTs', 'openedSlot', 'opener', 'candidateCount', 'nextCaptureOrdinal',
    'records', 'completions', 'terminalActor', 'seedDigest',
  ]) equal(Object.hasOwn(need, removed), false, `Need omits ${removed}`);

  const opened = openNeed(null, registered.account, TARGET, OPENED, PROGRAM_ID);
  equal(opened.code, 'CREATED', 'permissionless open creates Need');
  equal(openNeed(opened.need, registered.account, TARGET, TARGET, PROGRAM_ID).code,
    'EXISTING', 'idempotent open does not depend on original opener/time');
  const corrupt = { ...need, candidateAHash: Buffer.alloc(32, 1) };
  equal(validateNeed(LIVE_SPEC, corrupt, PROGRAM_ID).code, 'CORRUPT_CANDIDATE_STATE',
    'state/hash shape is authoritative');
}

// PriceUpdateV2 is exact-length, and posted_slot is strictly after registration and not future.
{
  const need = createNeed(LIVE_SPEC, TARGET, OPENED, PROGRAM_ID);
  const decoded = decodePriceUpdateV2(source());
  equal(decoded.code, 'OK', 'exact Pyth layout decodes');
  equal(decoded.layoutLength, 134, 'Pyth trailing byte is included in exact layout');
  bytes(hashPriceMessage(decoded), hashPriceMessage(MESSAGE_A), 'message hash ignores metadata');
  equal(evaluateCapture(LIVE_SPEC, need, source(), context(), PROGRAM_ID).code,
    'OK', 'post-registration source accepted');
  equal(evaluateCapture(LIVE_SPEC, need,
    source({ ...MESSAGE_A, postedSlot: 1000n }), context(), PROGRAM_ID).code,
  'POSTED_BEFORE_OR_AT_REGISTRATION', 'equal registration slot fails');
  equal(evaluateCapture(LIVE_SPEC, need,
    source({ ...MESSAGE_A, postedSlot: 1002n }), context(), PROGRAM_ID).code,
  'FUTURE_SLOT', 'posted slot after observed slot fails');
  equal(evaluateCapture(LIVE_SPEC, need, source(), context(1001n, TARGET + 1n, {
    generation: generation({
      receiverProgramdataAccountData: loaderProgramdataAccountData(899n),
    }),
  }), PROGRAM_ID).code, 'RECEIVER_GENERATION_MISMATCH',
  'persistent Receiver generation mutation fails capture');
  const changedCaptureConfig = Buffer.from(CONFIG_DATA);
  changedCaptureConfig[changedCaptureConfig.length - 1] ^= 1;
  equal(evaluateCapture(LIVE_SPEC, need, source(), context(1001n, TARGET + 1n, {
    generation: generation({ receiverConfigData: changedCaptureConfig }),
  }), PROGRAM_ID).code, 'RECEIVER_CONFIG_MISMATCH',
  'persistent valid full-config mutation fails capture');
  equal(decodePriceUpdateV2({ data: source().data.subarray(0, 133) }).code,
    'BAD_PRICE_ACCOUNT_DATA', 'short Pyth data rejected');
}

// Immutable manifests describe the packed page; reservations grow it by exactly 106 bytes.
{
  const need = createNeed(LIVE_SPEC, TARGET, OPENED, PROGRAM_ID);
  for (const [kindValue, vectorKey] of [
    [WORK_KIND_FIRST_CAPTURE, 'firstCapture'],
    [WORK_KIND_TERMINALIZE, 'terminalize'],
  ]) {
    const manifest = workManifestDefinition(PROGRAM_ID, kindValue);
    equal(encodeWorkManifest(manifest).length, WORK_MANIFEST_ACCOUNT_LEN, 'manifest full size');
    equal(new PublicKey(manifest.address).toBase58(),
      lifecycleVector.accounts.WorkManifest[vectorKey].pda, `manifest ${vectorKey} PDA`);
    bytes(manifest.address, deriveWorkManifestPda(PROGRAM_ID, kindValue).address,
      `manifest ${vectorKey} derivation`);
  }
  let page = createWorkPage(PROGRAM_ID, need.address);
  equal(encodeWorkPage(page).length, WORK_PAGE_BASE_ACCOUNT_LEN, 'empty page full size');
  equal(WORK_PAGE_RECORDS_OFFSET, WORK_PAGE_BASE_ACCOUNT_LEN, 'first record absolute offset');
  equal(new PublicKey(deriveWorkPagePda(
    PROGRAM_ID, key(lifecycleVector.fixtureNeed.address),
  ).address).toBase58(), lifecycleVector.accounts.WorkPage.fixturePda, 'WorkPage PDA vector');
  bytes(page.address, deriveWorkPagePda(PROGRAM_ID, need.address).address, 'WorkPage derivation');
  let reserved = reserveWork(page, need, WORK_KIND_FIRST_CAPTURE, 0, PROGRAM_ID);
  equal(reserved.code, 'RESERVED', 'reserve first row'); page = reserved.page;
  equal(page.records[0].disposition, WORK_DISPOSITION_PENDING, 'first row pending');
  equal(encodeWorkPage(page).length, WORK_PAGE_BASE_ACCOUNT_LEN + WORK_RECORD_LEN,
    'one-row page length');
  reserved = reserveWork(page, need, WORK_KIND_TERMINALIZE, 1, PROGRAM_ID);
  equal(reserved.code, 'RESERVED', 'reserve terminal row'); page = reserved.page;
  equal(encodeWorkPage(page).length, WORK_PAGE_MAX_ACCOUNT_LEN, 'two-row maximum page');
  equal(validateWorkPage(page, need.address, PROGRAM_ID).code, 'OK', 'packed page authenticates');
}

// Full lifecycle: terminal result is derived from Need; optional work rows never create receipts.
{
  const fresh = () => createNeed(LIVE_SPEC, TARGET, OPENED, PROGRAM_ID);
  let need = fresh();
  let page = createWorkPage(PROGRAM_ID, need.address);
  page = reserveWork(page, need, WORK_KIND_FIRST_CAPTURE, 0, PROGRAM_ID).page;
  page = reserveWork(page, need, WORK_KIND_TERMINALIZE, 1, PROGRAM_ID).page;
  const first = captureNeed(LIVE_SPEC, need, source(MESSAGE_A), context(), ACTOR_A, PROGRAM_ID, page);
  equal(first.code, 'CANDIDATE', 'first capture');
  need = first.need; page = first.workPage;
  equal(encodeCandidateV2(first.candidate).length, CANDIDATE_V2_ACCOUNT_LEN,
    'compact Candidate full size');
  equal(validateCandidate(LIVE_SPEC, need, first.candidate, first.messageHash, PROGRAM_ID).code,
    'OK', 'Candidate recomputes message hash');
  for (const removed of [
    'messageHash', 'feedId', 'sourceAccount', 'sourceOwner', 'writeAuthority',
    'verificationLevel', 'layoutLength', 'capturer', 'captureOrdinal',
  ]) equal(Object.hasOwn(first.candidate, removed), false, `Candidate omits ${removed}`);
  equal(page.records[0].disposition, WORK_DISPOSITION_PAYABLE, 'first row payable');
  bytes(page.records[0].worker, ACTOR_A, 'first capture worker');
  equal(page.records[1].disposition, WORK_DISPOSITION_PENDING, 'terminal row remains pending');

  const duplicate = captureNeed(LIVE_SPEC, need, source(MESSAGE_A),
    { ...context(), candidateA: first.candidate }, ACTOR_B, PROGRAM_ID, page);
  equal(duplicate.code, 'DUPLICATE', 'duplicate capture is no-op');
  equal(duplicate.changed, false, 'duplicate does not mutate state');

  const conflict = captureNeed(LIVE_SPEC, need, source(MESSAGE_B),
    { ...context(), candidateA: first.candidate }, ACTOR_B, PROGRAM_ID, page);
  equal(conflict.code, 'AMBIGUOUS', 'distinct second message terminalizes ambiguous');
  equal(conflict.need.state, 'Ambiguous', 'ambiguous state lives in Need');
  bytes(conflict.resultHash, terminalResultHash(conflict.need), 'ambiguous result derived from Need');
  equal(conflict.workPage.records[1].disposition, WORK_DISPOSITION_PAYABLE,
    'terminal row payable');
  bytes(conflict.workPage.records[1].resultHash, completionResultHash(
    need.address, WORK_KIND_TERMINALIZE, conflict.resultHash,
    WORK_DISPOSITION_PAYABLE, ACTOR_B,
  ), 'packed completion commits terminal fact');

  need = fresh();
  const absentPage = createAbsentWorkPageAccount(PROGRAM_ID, need.address);
  bytes(absentPage.owner, SYSTEM_PROGRAM, 'absent WorkPage is system-owned');
  bytes(absentPage.address, deriveWorkPagePda(PROGRAM_ID, need.address).address,
    'absent WorkPage still supplies the canonical PDA');
  equal(absentPage.writable, true, 'absent WorkPage meta is writable');
  equal(captureNeed(LIVE_SPEC, fresh(), source(MESSAGE_A), context(),
    ACTOR_A, PROGRAM_ID).code, 'MISSING_WORK_PAGE_ACCOUNT',
  'logical absence cannot omit the mandatory account meta');
  equal(captureNeed(LIVE_SPEC, fresh(), source(MESSAGE_A), context(),
    ACTOR_A, PROGRAM_ID, { ...absentPage, address: Buffer.alloc(32, 99) }).code,
  'WRONG_WORK_PAGE_PDA', 'wrong absent WorkPage PDA fails');
  equal(captureNeed(LIVE_SPEC, fresh(), source(MESSAGE_A), context(),
    ACTOR_A, PROGRAM_ID, { ...absentPage, writable: false }).code,
  'READONLY_WORK_PAGE', 'readonly absent WorkPage fails');
  const candidateOnly = captureNeed(LIVE_SPEC, need, source(MESSAGE_A),
    context(), ACTOR_A, PROGRAM_ID, absentPage);
  const finalized = terminalizeNeed(LIVE_SPEC, candidateOnly.need,
    context(1002n, candidateOnly.need.captureDeadlineTs), ACTOR_B, PROGRAM_ID,
    candidateOnly.workPage, candidateOnly.candidate);
  equal(finalized.code, 'FINAL', 'candidate finalizes at deadline without WorkPage');
  equal(finalized.workPage.absent, true,
    'no-work path retains the supplied canonical absent account meta');
  bytes(finalized.resultHash, terminalResultHash(finalized.need), 'final result derived from Need');

  need = fresh();
  page = createWorkPage(PROGRAM_ID, need.address);
  page = reserveWork(page, need, WORK_KIND_FIRST_CAPTURE, 0, PROGRAM_ID).page;
  page = reserveWork(page, need, WORK_KIND_TERMINALIZE, 1, PROGRAM_ID).page;
  const expired = terminalizeNeed(LIVE_SPEC, need,
    context(1002n, need.captureDeadlineTs), ACTOR_B, PROGRAM_ID, page);
  equal(expired.code, 'EXPIRED', 'unanswered Need expires');
  equal(expired.workPage.records[0].disposition, WORK_DISPOSITION_NONPAYABLE,
    'unperformed capture is nonpayable');
  bytes(expired.workPage.records[0].worker, Buffer.alloc(32), 'nonpayable worker is default');
  equal(expired.workPage.records[1].disposition, WORK_DISPOSITION_PAYABLE,
    'expiry terminalizer is payable');
  bytes(expired.resultHash, terminalResultHash(expired.need), 'expired result derived from Need');
}

// Locked lifecycle hashes and Candidate PDAs remain byte-for-byte reproducible.
{
  const needAddress = key(lifecycleVector.fixtureNeed.address);
  const common = lifecycleVector.goldenMessages.common;
  const message = name => ({
    price: BigInt(lifecycleVector.goldenMessages[name].price),
    conf: BigInt(lifecycleVector.goldenMessages[name].conf),
    exponent: common.exponent,
    publishTime: BigInt(common.publishTime),
    prevPublishTime: BigInt(common.prevPublishTime),
    emaPrice: BigInt(lifecycleVector.goldenMessages[name].price),
    emaConf: BigInt(lifecycleVector.goldenMessages[name].conf),
  });
  const hashA = hashPriceMessage(message('a'), hex(common.feedIdHex));
  const hashB = hashPriceMessage(message('b'), hex(common.feedIdHex));
  equal(hashA.toString('hex'), lifecycleVector.goldenMessages.a.messageHashHex, 'message A vector');
  equal(hashB.toString('hex'), lifecycleVector.goldenMessages.b.messageHashHex, 'message B vector');
  equal(new PublicKey(deriveCandidatePda(PROGRAM_ID, needAddress, hashA).address).toBase58(),
    lifecycleVector.goldenMessages.a.candidatePda, 'candidate A PDA vector');
  const [low, high] = Buffer.compare(hashA, hashB) < 0 ? [hashA, hashB] : [hashB, hashA];
  const base = {
    address: needAddress, targetTs: BigInt(lifecycleVector.fixtureNeed.targetTs),
    candidateAHash: hashA, candidateBHash: Buffer.alloc(32), state: 'Final',
  };
  equal(terminalResultHash(base).toString('hex'),
    lifecycleVector.terminalVectors.finalResultHashHex, 'final result vector');
  equal(terminalResultHash({ ...base, state: 'Ambiguous', candidateAHash: low,
    candidateBHash: high }).toString('hex'),
  lifecycleVector.terminalVectors.ambiguousResultHashHex, 'ambiguous result vector');
  equal(terminalResultHash({ ...base, state: 'Expired', candidateAHash: Buffer.alloc(32),
    candidateBHash: Buffer.alloc(32) }).toString('hex'),
  lifecycleVector.terminalVectors.expiredResultHashHex, 'expired result vector');
  throws(() => terminalResultHash({ ...base, state: 'Candidate' }), /TERMINAL_STATE_REQUIRED/,
    'nonterminal Need has no result');
}

console.log(`timepin v2 model: ${checks} checks passed`);
