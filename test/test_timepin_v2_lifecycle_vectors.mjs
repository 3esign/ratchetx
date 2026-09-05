import { assertTimepinVectors } from '../onchain/rcx-timepin-v2/scripts/vector-data.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PublicKey } from '@solana/web3.js';
import {
  TIMEPIN_SCHEMA_V2, EVIDENCE_POLICY_V2_CANONICAL_LEN,
  EVIDENCE_SPEC_V2_CANONICAL_LEN, EVIDENCE_SPEC_V2_PAYLOAD_LEN,
  EVIDENCE_SPEC_V2_ACCOUNT_LEN, TIMEPIN_NEED_V2_PAYLOAD_LEN,
  TIMEPIN_NEED_V2_ACCOUNT_LEN, CANDIDATE_V2_PAYLOAD_LEN, CANDIDATE_V2_ACCOUNT_LEN,
  WORK_MANIFEST_PAYLOAD_LEN, WORK_MANIFEST_ACCOUNT_LEN, WORK_PAGE_BASE_PAYLOAD_LEN,
  WORK_PAGE_BASE_ACCOUNT_LEN, WORK_PAGE_MAX_ACCOUNT_LEN, WORK_PAGE_RECORDS_OFFSET,
  WORK_RECORD_LEN, WORK_PAGE_CAPACITY,
  OFFICIAL_PYTH_RECEIVER_PROGRAM, OFFICIAL_PYTH_PUSH_ORACLE_PROGRAM,
  encodeEvidencePolicy, encodeEvidenceSpec, evidencePolicyHash, evidenceSpecHash,
  deriveEvidenceSpecPda, deriveNeedPda, deriveCandidatePda,
  deriveWorkManifestPda, deriveWorkPagePda, hashPriceMessage, terminalResultHash,
} from '../onchain/rcx-timepin/model-v2.mjs';

const CANONICAL_TIMEPIN_PROGRAM_ID = 'C8wwxUGmoKAV22MaY3oW2Q6QeDbmB9dbNdbohsRjJkYp';
const HISTORICAL_TIMEPIN_PROGRAM_ID = 'US517G5965aydkZ46HS38QLi7UQiSojurfbQfKCELFx';
const SBF_FILENAME = 'rcx_timepin_v2.so';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const register = JSON.parse(readFileSync(join(
  root, 'onchain', 'rcx-timepin-v2', 'vectors', 'register-open-v2.json',
), 'utf8'));
const lifecycle = JSON.parse(readFileSync(join(
  root, 'onchain', 'rcx-timepin-v2', 'vectors', 'lifecycle-v2.json',
), 'utf8'));

let checks = 0;
const equal = (actual, expected, message) => {
  checks += 1; assert.equal(actual, expected, message);
};
const ok = (value, message) => { checks += 1; assert.ok(value, message); };
const bytes = (actual, expected, message) => {
  checks += 1; assert.deepEqual(Buffer.from(actual), Buffer.from(expected), message);
};
const deep = (actual, expected, message) => {
  checks += 1; assert.deepEqual(actual, expected, message);
};
const sha256 = (...parts) => createHash('sha256').update(Buffer.concat(parts)).digest();
const discriminator = (namespace, name) =>
  sha256(Buffer.from(`${namespace}:${name}`, 'utf8')).subarray(0, 8);
const key = value => new PublicKey(value).toBuffer();
const hex = value => Buffer.from(value, 'hex');
const countOccurrences = (buffer, needle) => {
  let count = 0;
  let offset = 0;
  while ((offset = buffer.indexOf(needle, offset)) !== -1) {
    count += 1;
    offset += 1;
  }
  return count;
};
const isContainedPath = value =>
  value !== '' && value !== '..' && !value.startsWith(`..${sep}`) && !isAbsolute(value);
const stablePath = value => value.split(sep).join('/');

equal(register.schemaVersion, TIMEPIN_SCHEMA_V2, 'register vector schema');
equal(lifecycle.schemaVersion, TIMEPIN_SCHEMA_V2, 'lifecycle vector schema');
equal(register.programId, lifecycle.programId, 'one fixture program identity');
equal(register.programId, CANONICAL_TIMEPIN_PROGRAM_ID,
  'canonical deployable Timepin identity');
equal(register.deployableIdentity, true, 'register identity is deployable');
equal(lifecycle.deployableIdentity, true, 'lifecycle identity is deployable');

const fields = register.evidencePolicy.fields;
const spec = {
  schema: fields.schema,
  adapter: fields.adapter,
  receiverProgram: key(fields.receiverProgram),
  pushOracleProgram: key(fields.pushOracleProgram),
  shardId: fields.shardId,
  feedId: hex(fields.feedIdHex),
  requiredVerification: fields.requiredVerification,
  targetGridSeconds: fields.targetGridSeconds,
  minOpenLeadSeconds: fields.minOpenLeadSeconds,
  maxTargetAheadSeconds: fields.maxTargetAheadSeconds,
  maxPreTargetGapSeconds: fields.maxPreTargetGapSeconds,
  maxPostTargetLagSeconds: fields.maxPostTargetLagSeconds,
  captureGraceSeconds: fields.captureGraceSeconds,
  maxFutureSkewSeconds: fields.maxFutureSkewSeconds,
  minExponent: fields.minExponent,
  maxExponent: fields.maxExponent,
  maxConfidenceBps: fields.maxConfidenceBps,
  receiverProgramdataSlot: BigInt(
    register.syntheticGenerationFixture.receiverProgramData.generationSlot,
  ),
  receiverConfigHash: hex(
    register.syntheticGenerationFixture.receiverConfig.completeAccountDataSha256,
  ),
  wormholeProgram: key(register.syntheticGenerationFixture.wormholeProgram),
  wormholeProgramdataSlot: BigInt(
    register.syntheticGenerationFixture.wormholeProgramData.generationSlot,
  ),
  registeredSlot: BigInt(register.syntheticGenerationFixture.registrationClockSlot),
};
const program = key(register.programId);

// Policy stays generation-independent; the full spec appends all four generation pins.
equal(register.evidencePolicy.canonicalLength, EVIDENCE_POLICY_V2_CANONICAL_LEN,
  'policy vector length');
equal(register.evidenceSpec.canonicalLength, EVIDENCE_SPEC_V2_CANONICAL_LEN,
  'full spec vector length');
equal(register.evidenceSpec.payloadLength, EVIDENCE_SPEC_V2_PAYLOAD_LEN,
  'stored spec payload');
equal(register.evidenceSpec.accountLength, EVIDENCE_SPEC_V2_ACCOUNT_LEN,
  'stored spec full size');
bytes(encodeEvidencePolicy(spec), hex(register.evidencePolicy.canonicalBytesHex),
  '134-byte policy bytes');
bytes(encodeEvidenceSpec(spec), hex(register.evidenceSpec.canonicalBytesHex),
  '214-byte full spec bytes');
equal(evidencePolicyHash(spec).toString('hex'), register.evidencePolicy.hashHex,
  'policy hash');
equal(evidenceSpecHash(spec).toString('hex'), register.evidenceSpec.hashHex,
  'full spec hash');
bytes(key(register.officialPyth.receiverProgram), OFFICIAL_PYTH_RECEIVER_PROGRAM,
  'official Receiver ID');
bytes(key(register.officialPyth.pushOracleProgram), OFFICIAL_PYTH_PUSH_ORACLE_PROGRAM,
  'official Push ID');

const specPda = deriveEvidenceSpecPda(program, spec);
equal(new PublicKey(specPda.address).toBase58(), register.evidenceSpec.pda, 'EvidenceSpec PDA');
equal(specPda.bump, register.evidenceSpec.pdaBump, 'EvidenceSpec bump');
bytes(hex(register.evidenceSpec.accountDiscriminatorHex),
  discriminator('account', 'EvidenceSpecV2'), 'EvidenceSpec discriminator');

const target = BigInt(register.need.targetTs);
const needPda = deriveNeedPda(program, spec, target);
equal(register.need.payloadLength, TIMEPIN_NEED_V2_PAYLOAD_LEN, 'Need payload');
equal(register.need.accountLength, TIMEPIN_NEED_V2_ACCOUNT_LEN, 'Need full size');
equal(new PublicKey(needPda.address).toBase58(), register.need.pda, 'Need PDA');
equal(needPda.bump, register.need.pdaBump, 'Need bump');
bytes(hex(register.need.accountDiscriminatorHex),
  discriminator('account', 'TimepinNeedV2'), 'Need discriminator');

const expectedAccountNames = ['CandidateV2', 'TimepinNeedV2', 'WorkManifest', 'WorkPage', 'WorkRecord'];
for (const removed of ['TerminalTimepinV2', 'CompletionReceipt', 'EvidenceRecordV2']) {
  equal(Object.hasOwn(lifecycle.accounts, removed), false, `${removed} is absent from final ABI`);
}
for (const present of expectedAccountNames) {
  equal(Object.hasOwn(lifecycle.accounts, present), true, `${present} is present`);
}
equal(lifecycle.accounts.CandidateV2.payloadLength, CANDIDATE_V2_PAYLOAD_LEN,
  'Candidate payload');
equal(lifecycle.accounts.CandidateV2.accountLength, CANDIDATE_V2_ACCOUNT_LEN,
  'Candidate full size');
bytes(hex(lifecycle.accounts.CandidateV2.discriminatorHex),
  discriminator('account', 'CandidateV2'), 'Candidate discriminator');
equal(lifecycle.accounts.TimepinNeedV2.terminalResult,
  'Derived from Need address/state/target/candidate hashes; there is no separate terminal account.',
  'terminal result is in Need state');

equal(lifecycle.accounts.WorkManifest.payloadLength, WORK_MANIFEST_PAYLOAD_LEN,
  'manifest payload');
equal(lifecycle.accounts.WorkManifest.accountLength, WORK_MANIFEST_ACCOUNT_LEN,
  'manifest full size');
equal(lifecycle.accounts.WorkPage.basePayloadLength, WORK_PAGE_BASE_PAYLOAD_LEN,
  'page base payload');
equal(lifecycle.accounts.WorkPage.baseAccountLength, WORK_PAGE_BASE_ACCOUNT_LEN,
  'page base full size');
equal(lifecycle.accounts.WorkPage.maximumAccountLength, WORK_PAGE_MAX_ACCOUNT_LEN,
  'page maximum full size');
equal(lifecycle.accounts.WorkPage.recordsOffset, WORK_PAGE_RECORDS_OFFSET,
  'record absolute offset');
equal(lifecycle.accounts.WorkPage.capacity, WORK_PAGE_CAPACITY, 'page capacity');
equal(lifecycle.accounts.WorkRecord.length, WORK_RECORD_LEN, 'record length');
bytes(hex(lifecycle.accounts.WorkManifest.discriminatorHex),
  discriminator('account', 'WorkManifest'), 'manifest discriminator');
bytes(hex(lifecycle.accounts.WorkPage.discriminatorHex),
  discriminator('account', 'WorkPage'), 'page discriminator');

for (const [kind, vectorKey] of [[1, 'firstCapture'], [2, 'terminalize']]) {
  const pda = deriveWorkManifestPda(program, kind);
  equal(new PublicKey(pda.address).toBase58(),
    lifecycle.accounts.WorkManifest[vectorKey].pda, `${vectorKey} manifest PDA`);
  equal(pda.bump, lifecycle.accounts.WorkManifest[vectorKey].bump,
    `${vectorKey} manifest bump`);
}
const workPage = deriveWorkPagePda(program, needPda.address);
equal(new PublicKey(workPage.address).toBase58(), lifecycle.accounts.WorkPage.fixturePda,
  'WorkPage PDA');
equal(workPage.bump, lifecycle.accounts.WorkPage.fixtureBump, 'WorkPage bump');

const instructionNames = {
  registerEvidenceSpec: 'register_evidence_spec',
  openNeed: 'open_need',
  openWorkManifest: 'open_work_manifest',
  openWorkPage: 'open_work_page',
  reserveWork: 'reserve_work',
  captureFirst: 'capture_first',
  captureConflict: 'capture_conflict',
  finalize: 'finalize',
  expire: 'expire',
};
for (const [keyName, rustName] of Object.entries(instructionNames)) {
  const table = keyName in register.instructions ? register.instructions : lifecycle.instructions;
  bytes(hex(table[keyName].discriminatorHex), discriminator('global', rustName),
    `${rustName} discriminator`);
}
equal(register.instructions.registerEvidenceSpec.dataLength, 8 + 32 + 214,
  'register instruction length');
equal(register.instructions.openNeed.dataLength, 8 + 32 + 8, 'open instruction length');
equal(lifecycle.instructions.openWorkManifest.dataLength, 8 + 1,
  'open-manifest instruction length');
equal(lifecycle.instructions.openWorkPage.dataLength, 8, 'open-page instruction length');
equal(lifecycle.instructions.reserveWork.dataLength, 8 + 1 + 1,
  'reserve-work instruction length');
equal(lifecycle.instructions.captureFirst.dataLength, 40, 'capture-first instruction length');
equal(lifecycle.instructions.captureConflict.dataLength, 40, 'capture-conflict instruction length');
equal(lifecycle.instructions.finalize.dataLength, 8, 'finalize instruction length');
equal(lifecycle.instructions.expire.dataLength, 8, 'expire instruction length');

// Lock exact Anchor account-meta order/mutability descriptions rather than
// merely checking that the vectors contain human-readable strings.
deep(register.instructions.registerEvidenceSpec.accounts, [
  'payer signer+writable',
  'evidence_spec writable',
  'official receiver_program executable',
  'receiver_program_data Loader-v3',
  'canonical receiver_config',
  'config-selected wormhole_program executable',
  'wormhole_program_data Loader-v3',
  'system_program',
], 'register account order');
deep(register.instructions.openNeed.accounts, [
  'actor signer+writable', 'evidence_spec', 'need writable', 'system_program',
], 'open-Need account order');
deep(lifecycle.instructions.openWorkManifest.accounts, [
  'actor signer+writable', 'work_manifest writable', 'system_program',
], 'open-manifest account order');
deep(lifecycle.instructions.openWorkPage.accounts, [
  'actor signer+writable', 'evidence_spec', 'need', 'work_page writable', 'system_program',
], 'open-page account order');
deep(lifecycle.instructions.reserveWork.accounts, [
  'actor signer+writable', 'evidence_spec', 'need', 'work_page writable', 'system_program',
], 'reserve-work account order');
deep(lifecycle.instructions.captureFirst.accounts, [
  'actor signer+writable',
  'evidence_spec',
  'need writable',
  'candidate writable',
  'official receiver_program executable',
  'receiver_program_data',
  'canonical receiver_config',
  'pinned wormhole_program executable',
  'wormhole_program_data',
  'price_update',
  'canonical optional work_page writable',
  'system_program',
], 'capture-first account order');
deep(lifecycle.instructions.captureConflict.accounts, [
  'actor signer+writable',
  'evidence_spec',
  'need writable',
  'candidate_a',
  'candidate_b writable',
  'official receiver_program executable',
  'receiver_program_data',
  'canonical receiver_config',
  'pinned wormhole_program executable',
  'wormhole_program_data',
  'price_update',
  'canonical optional work_page writable',
  'system_program',
], 'capture-conflict account order');
deep(lifecycle.instructions.finalize.accounts, [
  'actor signer+writable', 'evidence_spec', 'need writable', 'candidate',
  'canonical optional work_page writable',
], 'finalize account order');
deep(lifecycle.instructions.expire.accounts, [
  'actor signer+writable', 'evidence_spec', 'need writable',
  'canonical optional work_page writable',
], 'expire account order');

const common = lifecycle.goldenMessages.common;
const message = name => ({
  price: BigInt(lifecycle.goldenMessages[name].price),
  conf: BigInt(lifecycle.goldenMessages[name].conf),
  exponent: common.exponent,
  publishTime: BigInt(common.publishTime),
  prevPublishTime: BigInt(common.prevPublishTime),
  emaPrice: BigInt(lifecycle.goldenMessages[name].price),
  emaConf: BigInt(lifecycle.goldenMessages[name].conf),
});
const hashA = hashPriceMessage(message('a'), hex(common.feedIdHex));
const hashB = hashPriceMessage(message('b'), hex(common.feedIdHex));
equal(hashA.toString('hex'), lifecycle.goldenMessages.a.messageHashHex, 'message A hash');
equal(hashB.toString('hex'), lifecycle.goldenMessages.b.messageHashHex, 'message B hash');
for (const [name, hash] of [['a', hashA], ['b', hashB]]) {
  const candidate = deriveCandidatePda(program, needPda.address, hash);
  equal(new PublicKey(candidate.address).toBase58(), lifecycle.goldenMessages[name].candidatePda,
    `candidate ${name} PDA`);
  equal(candidate.bump, lifecycle.goldenMessages[name].candidateBump, `candidate ${name} bump`);
}

const [low, high] = Buffer.compare(hashA, hashB) < 0 ? [hashA, hashB] : [hashB, hashA];
const terminalNeed = {
  address: needPda.address,
  targetTs: target,
  state: 'Final',
  candidateAHash: hashA,
  candidateBHash: Buffer.alloc(32),
};
equal(terminalResultHash(terminalNeed).toString('hex'),
  lifecycle.terminalVectors.finalResultHashHex, 'final result hash');
equal(terminalResultHash({ ...terminalNeed, state: 'Ambiguous',
  candidateAHash: low, candidateBHash: high }).toString('hex'),
lifecycle.terminalVectors.ambiguousResultHashHex, 'ambiguous result hash');
equal(terminalResultHash({ ...terminalNeed, state: 'Expired',
  candidateAHash: Buffer.alloc(32), candidateBHash: Buffer.alloc(32) }).toString('hex'),
lifecycle.terminalVectors.expiredResultHashHex, 'expired result hash');

// This reader proves deterministic schema/ABI/artifact binding only. Exact-SBF
// execution is a required, separate g2-build-artifacts gate; absence is not a skip.
const fixture = JSON.parse(readFileSync(join(root,
  'onchain/rcx-timepin-v2/vectors/fixture-input.json'), 'utf8'));
assertTimepinVectors({ register, lifecycle }, { fixture, artifact: register.localSbfEvidence });
equal(register.executionEvidence.status, 'not-included', 'vectors carry no execution claim');
equal(register.executionEvidence.requiredGate, 'tools/g2-build-artifacts.mjs --verify-artifacts',
  'runtime acceptance remains a separate required gate');
equal(Object.hasOwn(register, 'runtimeEvidence'), false, 'historical execution counts are absent');
equal(Object.hasOwn(lifecycle, 'runtimeEvidence'), false, 'historical execution claims are absent');
equal(Object.hasOwn(lifecycle.goldenMessages.a, 'runtimeProven'), false, 'no invented runtime proof');
equal(register.need.sourceDeadlineTs, register.need.targetTs + fields.maxPostTargetLagSeconds,
  'source deadline follows current policy');
equal(register.need.captureDeadlineTs, register.need.sourceDeadlineTs + fields.captureGraceSeconds,
  'capture deadline follows current policy');
equal(lifecycle.accounts.WorkManifest.frozenLocatorFields.subjectAccountSize,
  TIMEPIN_NEED_V2_ACCOUNT_LEN, 'work locator follows current Need allocation');
deep(register.localSbfEvidence, lifecycle.localSbfEvidence,
  'register and lifecycle vectors use one SBF evidence tuple');
const sbfEvidence = lifecycle.localSbfEvidence;
equal(sbfEvidence.elfFlags, 3, 'SBF evidence ELF flags identify SBPFv3');
equal(sbfEvidence.sbpfVersion, 3, 'SBF evidence version is SBPFv3');
const sbfPathMatch = /^ratchetx-onchain-sbf\/([0-9a-f]{64})\/rcx_timepin_v2\.so$/
  .exec(sbfEvidence.path);
ok(sbfPathMatch !== null, 'SBF evidence uses the stable content-addressed path');
const pathHash = sbfPathMatch[1];
equal(pathHash, sbfEvidence.sha256, 'SBF path hash matches evidence SHA-256');
equal(sbfEvidence.rebuiltBySvmTask, false, 'vector task did not rebuild SBF');

const cacheRoot = resolve(tmpdir(), 'ratchetx-onchain-sbf');
const pinnedSbfPath = resolve(tmpdir(), ...sbfEvidence.path.split('/'));
const lexicalArtifactRelative = relative(cacheRoot, pinnedSbfPath);
ok(isContainedPath(lexicalArtifactRelative),
  'lexical SBF path remains beneath the temporary artifact cache');
equal(stablePath(lexicalArtifactRelative), `${pathHash}/${SBF_FILENAME}`,
  'lexical SBF path has the exact hash-addressed layout');

const realTmpRoot = realpathSync(tmpdir());
const realCacheRoot = realpathSync(cacheRoot);
const realPinnedSbfPath = realpathSync(pinnedSbfPath);
const realCacheRelative = relative(realTmpRoot, realCacheRoot);
ok(isContainedPath(realCacheRelative), 'resolved artifact cache remains beneath tmpdir');
equal(stablePath(realCacheRelative), 'ratchetx-onchain-sbf',
  'resolved artifact cache has the canonical name');
const realArtifactRelative = relative(realCacheRoot, realPinnedSbfPath);
ok(isContainedPath(realArtifactRelative), 'resolved SBF remains beneath the artifact cache');
equal(stablePath(realArtifactRelative), `${pathHash}/${SBF_FILENAME}`,
  'resolved SBF has the exact hash-addressed layout');

const pinnedSbf = readFileSync(realPinnedSbfPath);
equal(pinnedSbf.length, sbfEvidence.size, 'pinned SBF size on disk');
equal(sha256(pinnedSbf).toString('hex'), sbfEvidence.sha256,
  'pinned SBF bytes match the vector hash');
bytes(pinnedSbf.subarray(0, 4), Buffer.from([0x7f, 0x45, 0x4c, 0x46]), 'pinned SBF is ELF');
ok(pinnedSbf.length >= 52, 'pinned SBF has a complete ELF64 header');
equal(pinnedSbf[4], 2, 'pinned SBF is ELF64');
equal(pinnedSbf[5], 1, 'pinned SBF is little-endian');
equal(pinnedSbf.readUInt32LE(48), 3, 'pinned SBF ELF e_flags identify SBPFv3');
ok(countOccurrences(pinnedSbf, program) >= 1,
  'pinned SBF embeds the canonical Timepin program id');
equal(countOccurrences(pinnedSbf, key(HISTORICAL_TIMEPIN_PROGRAM_ID)), 0,
  'pinned SBF does not embed the historical Timepin program id');

console.log(`timepin v2 lifecycle vectors: ${checks} deterministic checks passed; exact-SBF acceptance requires the separate helper gate`);
