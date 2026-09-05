// Pure deterministic vector data. No filesystem, clock, build or execution inputs.
// Runtime acceptance belongs to tools/g2-build-artifacts.mjs and its exact-SBF receipts.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import * as model from '../../rcx-timepin/model-v2.mjs';

export const PROGRAM_ID = 'C8wwxUGmoKAV22MaY3oW2Q6QeDbmB9dbNdbohsRjJkYp';
export const HISTORICAL_PROGRAM_ID = 'US517G5965aydkZ46HS38QLi7UQiSojurfbQfKCELFx';
export const SBF_FILENAME = 'rcx_timepin_v2.so';
export const VECTOR_FILENAMES = ['register-open-v2.json', 'lifecycle-v2.json'];
export const serializeVector = value => JSON.stringify(value, null, 2) + '\n';
const hash = value => createHash('sha256').update(value).digest();
const hex = value => Buffer.from(value).toString('hex');
const key = value => new PublicKey(value).toBuffer();
const address = value => new PublicKey(value).toBase58();
const discriminator = (namespace, name) => hash(Buffer.from(namespace + ':' + name)).subarray(0, 8);
const integer = (value, label) => {
  if (!Number.isSafeInteger(value)) throw new Error(label + ' must be a safe integer');
  return value;
};
const bytes32 = (value, label) => {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) throw new Error(label + ' must be 32 lowercase hex bytes');
  return Buffer.from(value, 'hex');
};
const i64 = value => { const out = Buffer.alloc(8); out.writeBigInt64LE(BigInt(value)); return out; };
const needFields = 'schema u16 | bump u8 | state u8 | evidence_spec_hash[32] | target_ts i64 | source_deadline_ts i64 | capture_deadline_ts i64 | candidate_a_hash[32] | candidate_b_hash[32] | open_refs u32 | rent_payer Pubkey';
const candidateFields = 'schema u16 | bump u8 | need Pubkey | price i64 | conf u64 | exponent i32 | publish_time i64 | prev_publish_time i64 | ema_price i64 | ema_conf u64 | posted_slot u64 | capture_slot u64 | capture_ts i64';
const manifestFields = 'schema_version u16 | bump u8 | work_kind u8 | completion_schema_version u16 | locator_mode u8 | subject_schema_version u16 | subject_account_size u16 | subject_discriminator[8] | locator_schema_version u16 | locator_discriminator[8] | records_offset u16 | entry_len u16 | locator_capacity u8';
const instruction = (name, suffix, accounts, data) => {
  const disc = discriminator('global', name);
  const bytes = Buffer.concat([disc, suffix]);
  return { discriminatorHex: hex(disc), dataLength: bytes.length, dataBytesHex: hex(bytes), ...(data ? { data } : {}), accounts };
};
const expectOk = (result, label) => {
  if (!result.ok) throw new Error(label + ': ' + result.code + (result.detail ? ': ' + result.detail : ''));
  return result;
};

export function validateArtifactTuple(artifact) {
  if (!artifact || !/^[0-9a-f]{64}$/.test(artifact.sha256 ?? '')
      || !Number.isSafeInteger(artifact.size) || artifact.size < 64
      || artifact.elfFlags !== 3 || artifact.sbpfVersion !== 3
      || artifact.path !== 'ratchetx-onchain-sbf/' + artifact.sha256 + '/' + SBF_FILENAME) {
    throw new Error('artifact must be an exact SBPFv3 content-addressed tuple');
  }
  if (artifact.programId !== undefined && artifact.programId !== PROGRAM_ID) throw new Error('artifact program identity mismatch');
  // Deliberately select only byte identity. Measured fields can never propagate.
  return { path: artifact.path, size: artifact.size, sha256: artifact.sha256, elfFlags: 3, sbpfVersion: 3, releaseArtifact: false, rebuiltBySvmTask: false };
}

export function generateTimepinVectors({ fixture, artifact }) {
  assert.equal(fixture.fixtureSchemaVersion, 1, 'fixture schema');
  assert.equal(fixture.profile, 'synthetic-adapter1-strict-bracket', 'only the explicit synthetic adapter-1 baseline is supported');
  assert.equal(fixture.policy.adapter, model.ADAPTER_PYTH_PUSH_V2, 'fixture must not imply adapter-2 evidence');
  const localSbfEvidence = validateArtifactTuple(artifact);
  const policyNames = ['schema', 'adapter', 'receiverProgram', 'pushOracleProgram', 'shardId', 'feedIdHex',
    'requiredVerification', 'targetGridSeconds', 'minOpenLeadSeconds', 'maxTargetAheadSeconds',
    'maxPreTargetGapSeconds', 'maxPostTargetLagSeconds', 'captureGraceSeconds', 'maxFutureSkewSeconds',
    'minExponent', 'maxExponent', 'maxConfidenceBps'];
  for (const name of Object.keys(fixture.policy)) if (!policyNames.includes(name)) throw new Error('unknown fixture policy field: ' + name);
  const fields = Object.fromEntries(policyNames.map(name => [name, fixture.policy[name]]));
  for (const [name, value] of Object.entries(fields)) if (typeof value === 'number') integer(value, 'policy.' + name);
  const generation = fixture.generation;
  const configInput = generation.receiverConfig;
  assert.equal(configInput.dataLength, 370, 'synthetic Receiver Config allocation');
  const config = Buffer.alloc(configInput.dataLength);
  discriminator('account', 'Config').copy(config);
  bytes32(configInput.governanceAuthorityHex, 'governanceAuthorityHex').copy(config, 8);
  config[40] = 0; // target_governance_authority: None
  key(generation.wormholeProgram).copy(config, 41);
  // valid_data_sources: [], single_update_fee: 0, zero allocation padding
  const minimumSignatures = integer(configInput.minimumSignatures, 'minimumSignatures');
  if (minimumSignatures < 1 || minimumSignatures > 255) throw new Error('minimumSignatures outside u8');
  config[85] = minimumSignatures;
  const spec = {
    ...fields, receiverProgram: key(fields.receiverProgram), pushOracleProgram: key(fields.pushOracleProgram),
    feedId: bytes32(fields.feedIdHex, 'feedIdHex'),
    receiverProgramdataSlot: BigInt(integer(generation.receiverProgramData.generationSlot, 'receiver generation slot')),
    receiverConfigHash: hash(config), wormholeProgram: key(generation.wormholeProgram),
    wormholeProgramdataSlot: BigInt(integer(generation.wormholeProgramData.generationSlot, 'wormhole generation slot')),
    registeredSlot: BigInt(integer(generation.registrationClockSlot, 'registration slot')),
  };
  expectOk(model.validateEvidenceSpec(spec), 'invalid fixture policy');
  const program = key(PROGRAM_ID);
  const policyBytes = model.encodeEvidencePolicy(spec);
  const specBytes = model.encodeEvidenceSpec(spec);
  const specAccount = model.encodeEvidenceSpecAccountData(spec);
  const policyHash = model.evidencePolicyHash(spec);
  const specHash = model.evidenceSpecHash(spec);
  const specPda = model.deriveEvidenceSpecPda(program, spec);
  const target = integer(fixture.need.targetTs, 'targetTs');
  const need = { ...model.createNeed(spec, BigInt(target), BigInt(integer(fixture.need.openedTs, 'openedTs')), program),
    openRefs: integer(fixture.need.openRefs, 'openRefs'), rentPayer: bytes32(fixture.need.rentPayerHex, 'rentPayerHex') };
  if (need.openRefs !== 0 || need.rentPayer.equals(Buffer.alloc(32))) throw new Error('open fixture must have zero references and a nonzero rent payer');
  const openBytes = model.encodeTimepinNeedV2(need);
  const configPda = model.deriveReceiverConfigPda(spec.receiverProgram);
  const programData = (id, input) => {
    if (integer(input.dataLength, 'ProgramData allocation') < 49) throw new Error('ProgramData allocation too small');
    const [pda, bump] = PublicKey.findProgramAddressSync([key(id)], new PublicKey(model.BPF_UPGRADEABLE_LOADER_PROGRAM));
    return { pda: pda.toBase58(), pdaBump: bump, dataLength: input.dataLength, generationSlot: input.generationSlot,
      header: 'variant u32 LE = 3 | slot u64 LE = ' + input.generationSlot + ' | upgrade_authority Option = None | Loader-v3 45-byte metadata followed by synthetic code/padding' };
  };
  const manifests = [model.WORK_KIND_FIRST_CAPTURE, model.WORK_KIND_TERMINALIZE]
    .map(kind => model.workManifestDefinition(program, kind));
  const manifest = manifests[0];
  const manifestVector = value => ({ workKind: value.workKind, pda: address(value.address), bump: value.bump, accountBytesHex: hex(model.encodeWorkManifest(value)) });
  const page = model.createWorkPage(program, need.address);
  const emptyPageBytes = model.encodeWorkPage(page);
  const reservedFirst = expectOk(model.reserveWork(page, need, model.WORK_KIND_FIRST_CAPTURE, 0, program), 'first work reservation').page;
  const reservedBoth = expectOk(model.reserveWork(reservedFirst, need, model.WORK_KIND_TERMINALIZE, 1, program), 'terminal work reservation').page;
  const messages = fixture.messages;
  for (const [name, value] of Object.entries(messages)) if (typeof value === 'number') integer(value, 'messages.' + name);
  const candidateData = {};
  for (const name of ['a', 'b']) {
    const price = integer(messages[name].price, 'message price');
    const conf = integer(messages[name].conf, 'message confidence');
    const message = { price: BigInt(price), conf: BigInt(conf), exponent: messages.exponent,
      publishTime: BigInt(messages.publishTime), prevPublishTime: BigInt(messages.prevPublishTime),
      emaPrice: BigInt(price), emaConf: BigInt(conf) };
    const messageHash = model.hashPriceMessage(message, spec.feedId);
    const pda = model.deriveCandidatePda(program, need.address, messageHash);
    const candidate = { ...message, schema: model.TIMEPIN_SCHEMA_V2, bump: pda.bump, address: pda.address,
      need: need.address, postedSlot: BigInt(messages.postedSlot), captureSlot: BigInt(messages.captureSlot), captureTs: BigInt(messages.captureTs) };
    expectOk(model.validateCandidate(spec, need, candidate, messageHash, program), 'candidate ' + name);
    candidateData[name] = { messageHash, candidate, vector: { price, conf, messageHashHex: hex(messageHash),
      candidatePda: address(pda.address), candidateBump: pda.bump, accountBytesHex: hex(model.encodeCandidateV2(candidate)) } };
  }
  const hashA = candidateData.a.messageHash, hashB = candidateData.b.messageHash;
  if (hashA.equals(hashB)) throw new Error('ambiguity fixture requires two different messages');
  const [low, high] = [hashA, hashB].sort(Buffer.compare);
  const zero = Buffer.alloc(32);
  const states = Object.fromEntries([
    ['open', 'Open', zero, zero], ['candidate', 'Candidate', hashA, zero],
    ['final', 'Final', hashA, zero], ['ambiguous', 'Ambiguous', low, high], ['expired', 'Expired', zero, zero],
  ].map(([name, state, a, b], index) => {
    const stateNeed = { ...need, state, candidateAHash: a, candidateBHash: b };
    return [name, { value: index, candidateAHashHex: hex(a), candidateBHashHex: hex(b),
      accountBytesHex: hex(model.encodeTimepinNeedV2(stateNeed)),
      ...(['Final', 'Ambiguous', 'Expired'].includes(state) ? { resultHashHex: hex(model.terminalResultHash(stateNeed)) } : {}) }];
  }));
  const baseline = { fixtureProfile: fixture.profile, fixtureInputSha256: hex(hash(Buffer.from(serializeVector(fixture)))),
    proofLevel: 'Pure deterministic synthetic adapter-1 ABI fixture; no runtime execution claim.',
    executionEvidence: { status: 'not-included', requiredGate: 'tools/g2-build-artifacts.mjs --verify-artifacts',
      acceptance: 'A passing deterministic vector check cannot replace the separate exact-SBF gate and its artifact/source-bound execution receipts.' } };
  const register = {
    schemaVersion: model.TIMEPIN_SCHEMA_V2, scope: 'Synthetic experimental adapter-1 register/open ABI baseline',
    ...baseline, programId: PROGRAM_ID, programIdBytesHex: hex(program), deployableIdentity: true,
    officialPyth: { receiverProgram: address(model.OFFICIAL_PYTH_RECEIVER_PROGRAM), pushOracleProgram: address(model.OFFICIAL_PYTH_PUSH_ORACLE_PROGRAM) },
    syntheticGenerationFixture: {
      note: 'Synthetic Loader-v3 account shapes and chosen allocation sizes; not mainnet account dumps or measured runtime evidence.',
      loaderProgram: address(model.BPF_UPGRADEABLE_LOADER_PROGRAM),
      receiverProgramData: programData(fields.receiverProgram, generation.receiverProgramData),
      wormholeProgram: generation.wormholeProgram,
      wormholeProgramData: programData(generation.wormholeProgram, generation.wormholeProgramData),
      receiverConfig: { pda: address(configPda.address), pdaBump: configPda.bump, owner: fields.receiverProgram,
        dataLength: config.length, accountDiscriminatorHex: hex(config.subarray(0, 8)), completeAccountDataSha256: hex(hash(config)),
        configuredWormhole: generation.wormholeProgram, completeAccountDataHex: hex(config) },
      registrationClockSlot: generation.registrationClockSlot,
    },
    evidencePolicy: { hashDomainUtf8: 'rcx-timepin:evidence-policy:v2\0', canonicalLength: policyBytes.length,
      canonicalBytesHex: hex(policyBytes), hashHex: hex(policyHash), fields },
    evidenceSpec: { hashDomainUtf8: 'rcx-timepin:evidence-spec:v2-generation\0', canonicalLength: specBytes.length,
      canonicalBytesHex: hex(specBytes), hashHex: hex(specHash), pda: address(specPda.address), pdaBump: specPda.bump,
      payloadLength: specAccount.length - 8, accountLength: specAccount.length,
      accountDiscriminatorHex: hex(specAccount.subarray(0, 8)), accountBytesHex: hex(specAccount),
      generationFields: 'receiver_programdata_slot u64 | receiver_config_hash[32] | wormhole_program Pubkey | wormhole_programdata_slot u64',
      storedSuffix: 'evidence_policy_hash[32] | exact generation fields[80] | registered_slot u64' },
    need: { targetTs: target, openedTs: fixture.need.openedTs,
      sourceDeadlineTs: Number(need.sourceDeadlineTs), captureDeadlineTs: Number(need.captureDeadlineTs),
      payloadLength: openBytes.length - 8, accountLength: openBytes.length,
      accountDiscriminatorHex: hex(openBytes.subarray(0, 8)), pda: address(need.address), pdaBump: need.bump,
      fields: needFields, state: 'Open', openRefs: need.openRefs, rentPayer: address(need.rentPayer), accountBytesHex: hex(openBytes) },
    instructions: {
      registerEvidenceSpec: instruction('register_evidence_spec', Buffer.concat([specHash, specBytes]), [
        'payer signer+writable', 'evidence_spec writable', 'official receiver_program executable',
        'receiver_program_data Loader-v3', 'canonical receiver_config', 'config-selected wormhole_program executable',
        'wormhole_program_data Loader-v3', 'system_program',
      ], 'discriminator[8] | spec_hash[32] | EvidenceSpecArgs[214]'),
      openNeed: instruction('open_need', Buffer.concat([specHash, i64(target)]),
        ['actor signer+writable', 'evidence_spec', 'need writable', 'system_program'],
        'discriminator[8] | spec_hash[32] | target_ts_i64_le[8]'),
    },
    localSbfEvidence: { ...localSbfEvidence },
  };
  const lifecycle = {
    schemaVersion: model.TIMEPIN_SCHEMA_V2, scope: 'Synthetic experimental adapter-1 compact lifecycle and packed-work ABI baseline',
    ...baseline, programId: PROGRAM_ID, deployableIdentity: true,
    fixtureNeed: { address: address(need.address), bump: need.bump, targetTs: target,
      sourceDeadlineTs: Number(need.sourceDeadlineTs), captureDeadlineTs: Number(need.captureDeadlineTs) },
    domains: { messageHashUtf8: 'rcx-timepin:pyth-price-message:v2\0', evidenceSetHashUtf8: 'rcx-timepin:evidence-set:v2\0',
      expiredHashUtf8: 'rcx-timepin:expired:v2\0', completionResultHashUtf8: 'rcx-timepin:completion-result:v2\0' },
    accounts: {
      TimepinNeedV2: { discriminatorHex: hex(openBytes.subarray(0, 8)), payloadLength: openBytes.length - 8,
        accountLength: openBytes.length, fields: needFields, states,
        terminalResult: 'Derived from Need address/state/target/candidate hashes; there is no separate terminal account.' },
      CandidateV2: { seeds: ['candidate', 'need_pubkey', 'message_hash_32'], discriminatorHex: hex(discriminator('account', 'CandidateV2')),
        payloadLength: model.CANDIDATE_V2_PAYLOAD_LEN, accountLength: model.CANDIDATE_V2_ACCOUNT_LEN, fields: candidateFields },
      WorkManifest: { seeds: ['work_manifest', 'manifest_schema_u16_le', 'work_kind_u8'],
        manifestSchema: manifest.schemaVersion, completionSchema: manifest.completionSchemaVersion, locatorMode: manifest.locatorMode,
        discriminatorHex: hex(discriminator('account', 'WorkManifest')),
        payloadLength: model.WORK_MANIFEST_PAYLOAD_LEN, accountLength: model.WORK_MANIFEST_ACCOUNT_LEN, fields: manifestFields,
        firstCapture: manifestVector(manifests[0]), terminalize: manifestVector(manifests[1]),
        frozenLocatorFields: { subjectSchema: manifest.subjectSchemaVersion, subjectAccountSize: manifest.subjectAccountSize,
          subjectDiscriminatorHex: hex(manifest.subjectDiscriminator), locatorSchema: manifest.locatorSchemaVersion,
          locatorDiscriminatorHex: hex(manifest.locatorDiscriminator), recordsOffset: manifest.recordsOffset,
          entryLength: manifest.entryLen, capacity: manifest.locatorCapacity } },
      WorkPage: { seeds: ['work_page', 'need_pubkey'], fixturePda: address(page.address), fixtureBump: page.bump,
        schema: page.schema, discriminatorHex: hex(emptyPageBytes.subarray(0, 8)),
        basePayloadLength: emptyPageBytes.length - 8, baseAccountLength: emptyPageBytes.length,
        maximumPayloadLength: model.WORK_PAGE_MAX_ACCOUNT_LEN - 8, maximumAccountLength: model.WORK_PAGE_MAX_ACCOUNT_LEN,
        recordsOffset: model.WORK_PAGE_RECORDS_OFFSET, capacity: model.WORK_PAGE_CAPACITY,
        fields: 'schema u16 | bump u8 | need Pubkey | records Vec<WorkRecord>',
        emptyAccountBytesHex: hex(emptyPageBytes), reservedFirstAccountBytesHex: hex(model.encodeWorkPage(reservedFirst)),
        reservedBothAccountBytesHex: hex(model.encodeWorkPage(reservedBoth)) },
      WorkRecord: { length: model.WORK_RECORD_LEN,
        fields: 'subject Pubkey | work_kind u8 | disposition u8 | worker Pubkey | result_hash[32] | completed_slot u64',
        dispositions: { pending: model.WORK_DISPOSITION_PENDING, payable: model.WORK_DISPOSITION_PAYABLE, nonpayable: model.WORK_DISPOSITION_NONPAYABLE } },
    },
    instructions: {
      openWorkManifest: instruction('open_work_manifest', Buffer.from([model.WORK_KIND_FIRST_CAPTURE]),
        ['actor signer+writable', 'work_manifest writable', 'system_program'], 'discriminator[8] | work_kind u8'),
      openWorkPage: instruction('open_work_page', Buffer.alloc(0),
        ['actor signer+writable', 'evidence_spec', 'need', 'work_page writable', 'system_program']),
      reserveWork: instruction('reserve_work', Buffer.from([model.WORK_KIND_FIRST_CAPTURE, 0]),
        ['actor signer+writable', 'evidence_spec', 'need', 'work_page writable', 'system_program'],
        'discriminator[8] | work_kind u8 | expected_index u8'),
      captureFirst: instruction('capture_first', hashA, [
        'actor signer+writable', 'evidence_spec', 'need writable', 'candidate writable', 'official receiver_program executable',
        'receiver_program_data', 'canonical receiver_config', 'pinned wormhole_program executable', 'wormhole_program_data',
        'price_update', 'canonical optional work_page writable', 'system_program',
      ], 'discriminator[8] | expected_message_hash[32]'),
      captureConflict: instruction('capture_conflict', hashB, [
        'actor signer+writable', 'evidence_spec', 'need writable', 'candidate_a', 'candidate_b writable', 'official receiver_program executable',
        'receiver_program_data', 'canonical receiver_config', 'pinned wormhole_program executable', 'wormhole_program_data',
        'price_update', 'canonical optional work_page writable', 'system_program',
      ], 'discriminator[8] | expected_message_hash[32]'),
      finalize: instruction('finalize', Buffer.alloc(0),
        ['actor signer+writable', 'evidence_spec', 'need writable', 'candidate', 'canonical optional work_page writable']),
      expire: instruction('expire', Buffer.alloc(0),
        ['actor signer+writable', 'evidence_spec', 'need writable', 'canonical optional work_page writable']),
    },
    goldenMessages: {
      common: { feedIdHex: fields.feedIdHex, exponent: messages.exponent, publishTime: messages.publishTime,
        prevPublishTime: messages.prevPublishTime, emaEqualsSpot: true, postedSlot: messages.postedSlot,
        captureSlot: messages.captureSlot, captureTs: messages.captureTs },
      a: candidateData.a.vector, b: candidateData.b.vector,
    },
    terminalVectors: { finalResultHashHex: states.final.resultHashHex, ambiguousHashOrder: [hex(low), hex(high)],
      ambiguousResultHashHex: states.ambiguous.resultHashHex, expiredResultHashHex: states.expired.resultHashHex,
      proofLevel: baseline.proofLevel },
    localSbfEvidence: { ...localSbfEvidence },
  };
  return { register, lifecycle };
}

export function assertTimepinVectors(actual, input) {
  const expected = generateTimepinVectors(input);
  assert.deepEqual(actual.register, expected.register, 'register vector differs from complete deterministic generation');
  assert.deepEqual(actual.lifecycle, expected.lifecycle, 'lifecycle vector differs from complete deterministic generation');
  return expected;
}