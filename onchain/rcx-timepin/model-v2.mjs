import { PublicKey } from '@solana/web3.js';

export const TIMEPIN_SCHEMA_V2 = 2;
// Adapter 1 is the strict bracket `prev_publish_time < T <= publish_time`. It is
// EXPERIMENTAL from 2026-09-05 and must not be registered for mainnet play: it is
// honest only against a source that delivers every aggregate, and the sponsored
// PriceUpdateV2 account is not one -- it holds a single message that the pusher
// overwrites every ~5 s (SOL/BTC) to ~52 s (ETH, BONK, PUMP, JUP, WIF), so the one
// message that brackets a given second is almost never the one on the account.
export const ADAPTER_PYTH_PUSH_V2 = 1;
// Adapter 2 is MIN-CAPTURE: the admissible print for target T is the one with the
// smallest publish_time such that publish_time >= T. See docs/MIN_CAPTURE_SPEC.md.
//
// Why the two predicates must NEVER be unified, even though adapter 2 looks like a
// relaxation of adapter 1: on a full-aggregate source (Pythnet's accumulator ring,
// ~2.5 aggregates per second) the strict `<` on the left is the only thing that
// excludes intra-second repeats, which carry pub == prev == T and genuinely differ
// in price, conf and ema -- measured 20 of 98 keys with up to 3 distinct signed
// messages. Under `publish_time >= T` all of those tie at the minimum and the tie
// break falls to the submitter. Adapter 2 is safe here ONLY because the sponsored
// PDA it is pinned to holds one message at a time, so the tie cannot arise
// (measured: 235 consecutive sponsored writes, 235 distinct publish times, zero
// duplicates). Change the pin and you change which predicate is safe.
export const ADAPTER_PYTH_MIN_CAPTURE_V2 = 2;
export const VERIFICATION_FULL = 1;
export const PRICE_UPDATE_V2_LEN = 134;
export const EVIDENCE_POLICY_V2_CANONICAL_LEN = 134;
export const EVIDENCE_SPEC_V2_CANONICAL_LEN = 214;
export const EVIDENCE_SPEC_V2_PAYLOAD_LEN = 254;
export const EVIDENCE_SPEC_V2_ACCOUNT_LEN = 262;
// 124 (through candidateBHash) + 36 (rent). The observation is NOT in the Need.
// Branch B, 2026-09-05: inlining the observation was reverted before launch
// because nothing wrote it. It stays in the CandidateV2 PDA. This constant and
// rcx-timepin-v2 lib.rs TimepinNeedV2::LEN must move together or Core cannot
// decode a Need - test/test_foreign_timepin_abi.mjs is what says so.
export const TIMEPIN_NEED_V2_PAYLOAD_LEN = 160;
export const TIMEPIN_NEED_V2_ACCOUNT_LEN = 168;
// 111/119 until 2026-09-10, when CandidateV2 gained rent_payer so the capture
// rent has an address to be returned to. The field sits after `need` and is
// deliberately outside price_message_hash: who paid for the account is not a
// fact about the price.
export const CANDIDATE_V2_PAYLOAD_LEN = 143;
export const CANDIDATE_V2_ACCOUNT_LEN = 151;

export const WORK_MANIFEST_SCHEMA_VERSION = 1;
export const COMPLETION_SCHEMA_VERSION = 1;
export const WORK_PAGE_SCHEMA_VERSION = 1;
export const LOCATOR_MODE_PACKED_WORK_PAGE = 2;
export const WORK_KIND_FIRST_CAPTURE = 1;
export const WORK_KIND_TERMINALIZE = 2;
export const WORK_DISPOSITION_PENDING = 0;
export const WORK_DISPOSITION_PAYABLE = 1;
export const WORK_DISPOSITION_NONPAYABLE = 2;
export const WORK_MANIFEST_PAYLOAD_LEN = 34;
export const WORK_MANIFEST_ACCOUNT_LEN = 42;
export const WORK_RECORD_LEN = 106;
export const WORK_PAGE_CAPACITY = 2;
export const WORK_PAGE_BASE_PAYLOAD_LEN = 39;
export const WORK_PAGE_BASE_ACCOUNT_LEN = 47;
export const WORK_PAGE_RECORDS_OFFSET = 47;
export const WORK_PAGE_MAX_ACCOUNT_LEN = 259;

export const OFFICIAL_PYTH_RECEIVER_PROGRAM =
  new PublicKey('rec2HHDDnjLfj4kE7VyEtFA1HPGQLK33259532cRyHp').toBuffer();
export const OFFICIAL_PYTH_PUSH_ORACLE_PROGRAM =
  new PublicKey('pyt2F414BA6dPttK6RddPZUdHfapoBN24GL5wbrPCou').toBuffer();
export const BPF_UPGRADEABLE_LOADER_PROGRAM =
  new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111').toBuffer();
export const SYSTEM_PROGRAM =
  new PublicKey('11111111111111111111111111111111').toBuffer();

const ZERO32 = Buffer.alloc(32);
const NEED_STATES = Object.freeze({ Open: 0, Candidate: 1, Final: 2, Ambiguous: 3, Expired: 4 });
const TERMINAL_STATES = new Set(['Final', 'Ambiguous', 'Expired']);
const POLICY_HASH_DOMAIN = Buffer.from('rcx-timepin:evidence-policy:v2\0', 'utf8');
const SPEC_HASH_DOMAIN = Buffer.from('rcx-timepin:evidence-spec:v2-generation\0', 'utf8');
const PRICE_MESSAGE_HASH_DOMAIN = Buffer.from('rcx-timepin:pyth-price-message:v2\0', 'utf8');
const EVIDENCE_SET_HASH_DOMAIN = Buffer.from('rcx-timepin:evidence-set:v2\0', 'utf8');
const EXPIRED_HASH_DOMAIN = Buffer.from('rcx-timepin:expired:v2\0', 'utf8');
const COMPLETION_RESULT_HASH_DOMAIN = Buffer.from('rcx-timepin:completion-result:v2\0', 'utf8');

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];
const sha256 = (value) => {
  let msg = Buffer.isBuffer(value) ? value : Buffer.from(value);
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a,
      h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

  let blocks = Math.ceil((msg.length + 9) / 64);
  let padded = Buffer.alloc(blocks * 64);
  msg.copy(padded);
  padded[msg.length] = 0x80;

  let lenBits = msg.length * 8;
  padded.writeUInt32BE(Math.floor(lenBits / 0x100000000), padded.length - 8);
  padded.writeUInt32BE(lenBits >>> 0, padded.length - 4);

  for (let i = 0; i < blocks * 64; i += 64) {
    let w = new Int32Array(64);
    for (let j = 0; j < 16; j++) w[j] = padded.readInt32BE(i + j * 4);
    for (let j = 16; j < 64; j++) {
      let s0 = (w[j - 15] >>> 7 | w[j - 15] << 25) ^ (w[j - 15] >>> 18 | w[j - 15] << 14) ^ (w[j - 15] >>> 3);
      let s1 = (w[j - 2] >>> 17 | w[j - 2] << 15) ^ (w[j - 2] >>> 19 | w[j - 2] << 13) ^ (w[j - 2] >>> 10);
      w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let j = 0; j < 64; j++) {
      let S1 = (e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7);
      let ch = (e & f) ^ ((~e) & g);
      let temp1 = (h + S1 + ch + K[j] + w[j]) | 0;
      let S0 = (a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10);
      let maj = (a & b) ^ (a & c) ^ (b & c);
      let temp2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + temp1) | 0;
      d = c; c = b; b = a; a = (temp1 + temp2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }
  let res = Buffer.alloc(32);
  res.writeInt32BE(h0, 0); res.writeInt32BE(h1, 4); res.writeInt32BE(h2, 8); res.writeInt32BE(h3, 12);
  res.writeInt32BE(h4, 16); res.writeInt32BE(h5, 20); res.writeInt32BE(h6, 24); res.writeInt32BE(h7, 28);
  return res;
};
const discriminator = (namespace, name) =>
  sha256(Buffer.from(`${namespace}:${name}`, 'utf8')).subarray(0, 8);
const PRICE_UPDATE_V2_DISCRIMINATOR = discriminator('account', 'PriceUpdateV2');
const EVIDENCE_SPEC_V2_DISCRIMINATOR = discriminator('account', 'EvidenceSpecV2');
const TIMEPIN_NEED_V2_DISCRIMINATOR = discriminator('account', 'TimepinNeedV2');
const CANDIDATE_V2_DISCRIMINATOR = discriminator('account', 'CandidateV2');
const WORK_MANIFEST_DISCRIMINATOR = discriminator('account', 'WorkManifest');
const WORK_PAGE_DISCRIMINATOR = discriminator('account', 'WorkPage');
const RECEIVER_CONFIG_DISCRIMINATOR = discriminator('account', 'Config');

const fail = (code, detail = '') => ({ ok: false, code, detail });
const sameBytes = (left, right) => Buffer.from(left).equals(Buffer.from(right));
const asBig = (value, name) => {
  try { return typeof value === 'bigint' ? value : BigInt(value); }
  catch { throw new TypeError(`${name} must be an integer`); }
};
const bounded = (value, max, name) => {
  if (!Number.isInteger(value) || value < 0 || value > max)
    throw new RangeError(`${name} is outside 0..${max}`);
  return value;
};
const bytes32 = (value, name) => {
  const out = Buffer.from(value ?? []);
  if (out.length !== 32) throw new RangeError(`${name} must be 32 bytes`);
  return out;
};
const publicKey = (value, name) => new PublicKey(bytes32(value, name));
const u8 = (value, name) => Buffer.from([bounded(value, 0xff, name)]);
const i8 = (value, name) => {
  if (!Number.isInteger(value) || value < -128 || value > 127)
    throw new RangeError(`${name} is outside i8`);
  const out = Buffer.alloc(1); out.writeInt8(value); return out;
};
const u16 = (value, name) => {
  const out = Buffer.alloc(2); out.writeUInt16LE(bounded(value, 0xffff, name)); return out;
};
const u32 = (value, name) => {
  const out = Buffer.alloc(4); out.writeUInt32LE(bounded(value, 0xffffffff, name)); return out;
};
const i32 = (value, name) => {
  if (!Number.isInteger(value) || value < -0x80000000 || value > 0x7fffffff)
    throw new RangeError(`${name} is outside i32`);
  const out = Buffer.alloc(4); out.writeInt32LE(value); return out;
};
const i64 = (value, name) => {
  const n = asBig(value, name);
  if (n < -(1n << 63n) || n >= (1n << 63n)) throw new RangeError(`${name} is outside i64`);
  const out = Buffer.alloc(8); out.writeBigInt64LE(n); return out;
};
const u64 = (value, name) => {
  const n = asBig(value, name);
  if (n < 0n || n >= (1n << 64n)) throw new RangeError(`${name} is outside u64`);
  const out = Buffer.alloc(8); out.writeBigUInt64LE(n); return out;
};

// Loader-v3 `Program` is exactly `variant=2 | ProgramData pubkey`. Its linked
// address, not a caller-provided mirror field, authenticates the ProgramData
// account selected by Anchor's `Program::programdata_address()`.
function decodeUpgradeableProgramLink(value, name) {
  const data = Buffer.from(value ?? []);
  if (data.length !== 36 || data.readUInt32LE(0) !== 2)
    throw new RangeError(`${name} is not a Loader-v3 Program account`);
  return data.subarray(4, 36);
}

// Loader-v3 `ProgramData` starts with `variant=3 | slot u64 | Option<Pubkey>`.
// Executable bytes follow the fixed 45-byte metadata allocation, so trailing
// data is expected and intentionally included in the account-loading shape.
function decodeUpgradeableProgramdataSlot(value, name) {
  const data = Buffer.from(value ?? []);
  if (data.length < 13 || data.readUInt32LE(0) !== 3)
    throw new RangeError(`${name} is not a Loader-v3 ProgramData account`);
  const authorityTag = data[12];
  if (authorityTag !== 0 && authorityTag !== 1)
    throw new RangeError(`${name} has an invalid upgrade-authority Option`);
  if (authorityTag === 1 && data.length < 45)
    throw new RangeError(`${name} truncates its upgrade authority`);
  return data.readBigUInt64LE(4);
}

// Pyth Receiver Config is an Anchor account with fixed allocation (370 B) and
// a variable Borsh payload. Parse Wormhole from the same bytes whose complete
// SHA-256 is pinned; a detached caller field would not prove that binding.
function decodeReceiverConfigWormhole(value) {
  const data = Buffer.from(value ?? []);
  if (data.length !== 370 || !data.subarray(0, 8).equals(RECEIVER_CONFIG_DISCRIMINATOR))
    throw new RangeError('receiverConfigData is not an exact Receiver Config account');
  let offset = 8 + 32; // discriminator + governance_authority
  const targetAuthorityTag = data[offset]; offset += 1;
  if (targetAuthorityTag !== 0 && targetAuthorityTag !== 1)
    throw new RangeError('Receiver Config has an invalid target-authority Option');
  if (targetAuthorityTag === 1) offset += 32;
  if (offset + 32 + 4 > data.length) throw new RangeError('Receiver Config is truncated');
  const wormhole = data.subarray(offset, offset + 32); offset += 32;
  const sourceCount = data.readUInt32LE(offset); offset += 4;
  const sourcesLength = sourceCount * 34; // DataSource { chain: u16, emitter: Pubkey }
  if (offset + sourcesLength + 8 + 1 > data.length)
    throw new RangeError('Receiver Config data-source vector is truncated');
  // The remaining decoded fields are single_update_fee_in_lamports and
  // minimum_signatures. Anchor accepts the fixed-allocation trailing padding.
  return wormhole;
}

export function derivePushSourcePda(spec) {
  const [address, bump] = PublicKey.findProgramAddressSync(
    [u16(spec.shardId, 'shardId'), bytes32(spec.feedId, 'feedId')],
    publicKey(spec.pushOracleProgram, 'pushOracleProgram'),
  );
  return { address: address.toBuffer(), bump };
}

export function deriveReceiverConfigPda(receiverProgram = OFFICIAL_PYTH_RECEIVER_PROGRAM) {
  const [address, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from('config')], publicKey(receiverProgram, 'receiverProgram'),
  );
  return { address: address.toBuffer(), bump };
}

export function deriveEvidenceSpecPda(programId, spec) {
  const [address, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from('evidence_spec'), u16(TIMEPIN_SCHEMA_V2, 'schema'), evidenceSpecHash(spec)],
    publicKey(programId, 'programId'),
  );
  return { address: address.toBuffer(), bump };
}

export function deriveNeedPda(programId, spec, targetTs) {
  const [address, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from('need'), u16(TIMEPIN_SCHEMA_V2, 'schema'),
      evidenceSpecHash(spec), i64(targetTs, 'targetTs')],
    publicKey(programId, 'programId'),
  );
  return { address: address.toBuffer(), bump };
}

export function deriveCandidatePda(programId, needAddress, messageHash) {
  const [address, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from('candidate'), bytes32(needAddress, 'needAddress'), bytes32(messageHash, 'messageHash')],
    publicKey(programId, 'programId'),
  );
  return { address: address.toBuffer(), bump };
}

export function deriveWorkManifestPda(programId, workKind) {
  if (![WORK_KIND_FIRST_CAPTURE, WORK_KIND_TERMINALIZE].includes(workKind))
    throw new RangeError('BAD_WORK_KIND');
  const [address, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from('work_manifest'), u16(WORK_MANIFEST_SCHEMA_VERSION, 'manifestSchema'),
      u8(workKind, 'workKind')],
    publicKey(programId, 'programId'),
  );
  return { address: address.toBuffer(), bump };
}

export function deriveWorkPagePda(programId, needAddress) {
  const [address, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from('work_page'), bytes32(needAddress, 'needAddress')],
    publicKey(programId, 'programId'),
  );
  return { address: address.toBuffer(), bump };
}

export function validateEvidenceSpec(spec) {
  try {
    if (spec?.schema !== TIMEPIN_SCHEMA_V2) return fail('BAD_SCHEMA');
    if (spec.adapter !== ADAPTER_PYTH_PUSH_V2
      && spec.adapter !== ADAPTER_PYTH_MIN_CAPTURE_V2) return fail('BAD_ADAPTER');
    if (!bytes32(spec.receiverProgram, 'receiverProgram').equals(OFFICIAL_PYTH_RECEIVER_PROGRAM))
      return fail('UNOFFICIAL_RECEIVER_PROGRAM');
    if (!bytes32(spec.pushOracleProgram, 'pushOracleProgram').equals(OFFICIAL_PYTH_PUSH_ORACLE_PROGRAM))
      return fail('UNOFFICIAL_PUSH_ORACLE_PROGRAM');
    bytes32(spec.feedId, 'feedId');
    bounded(spec.shardId, 0xffff, 'shardId');
    if (spec.requiredVerification !== VERIFICATION_FULL) return fail('NOT_FULL_POLICY');
    bounded(spec.targetGridSeconds, 86_400, 'targetGridSeconds');
    bounded(spec.minOpenLeadSeconds, 86_400, 'minOpenLeadSeconds');
    bounded(spec.maxTargetAheadSeconds, 30 * 86_400, 'maxTargetAheadSeconds');
    bounded(spec.maxPreTargetGapSeconds, 7 * 86_400, 'maxPreTargetGapSeconds');
    bounded(spec.maxPostTargetLagSeconds, 7 * 86_400, 'maxPostTargetLagSeconds');
    bounded(spec.captureGraceSeconds, 86_400, 'captureGraceSeconds');
    bounded(spec.maxFutureSkewSeconds, 300, 'maxFutureSkewSeconds');
    bounded(spec.maxConfidenceBps, 10_000, 'maxConfidenceBps');
    if (spec.targetGridSeconds === 0) return fail('ZERO_GRID');
    if (spec.minOpenLeadSeconds < 5) return fail('LEAD_TOO_SHORT');
    // Can the price be known before the bet is placed? A Need for target T opens
    // as early as clock C = T - lead; the program accepts publish_time up to
    // clock + maxFutureSkew; so at open the newest acceptable print is already
    // admissible for T (publish_time >= T) iff skew >= lead. lead > skew is
    // necessary and sufficient for the settling price to be unknowable at the
    // moment the shot is committed. Mirrors the require! in lib.rs::validate_spec.
    if (spec.maxFutureSkewSeconds >= spec.minOpenLeadSeconds)
      return fail('LEAD_DOES_NOT_CLEAR_SKEW');
    if (spec.maxTargetAheadSeconds < spec.minOpenLeadSeconds) return fail('AHEAD_BEFORE_LEAD');
    // Targets are the multiples of the grid, so the open window [C+lead, C+ahead]
    // contains one at EVERY clock iff it spans a whole grid of seconds. Otherwise
    // there are clocks at which no target is openable and the game is simply shut.
    // Mirrors the require! in lib.rs::validate_spec.
    if (spec.maxTargetAheadSeconds - spec.minOpenLeadSeconds < spec.targetGridSeconds - 1)
      return fail('OPEN_WINDOW_NARROWER_THAN_GRID');
    // Under MIN-CAPTURE `prev_publish_time` is not part of the predicate, so a
    // non-zero pre-gap would be a dead number sitting inside canonical_policy_bytes
    // and every spec hash, misleading every later reader. The field cannot be
    // removed (it is in the hash), so it is pinned to zero instead.
    if (spec.adapter === ADAPTER_PYTH_MIN_CAPTURE_V2) {
      if (spec.maxPreTargetGapSeconds !== 0) return fail('PRE_GAP_MUST_BE_ZERO');
    } else if (spec.maxPreTargetGapSeconds === 0) return fail('ZERO_PRE_GAP');
    if (spec.maxPostTargetLagSeconds === 0) return fail('ZERO_POST_LAG');
    // lag < grid is necessary and sufficient for a print to belong to at most one
    // target: admissibility is [T, T+lag], so a print serves both T and T+grid iff
    // lag >= grid. Mirrors the require! in lib.rs::validate_spec. Without it a
    // grid-60 lag-120 spec registers and two consecutive rounds can settle at the
    // same price, permanently, for that economy.
    if (spec.maxPostTargetLagSeconds >= spec.targetGridSeconds)
      return fail('POST_LAG_NOT_BELOW_GRID');
    if (spec.captureGraceSeconds === 0) return fail('ZERO_CAPTURE_GRACE');
    if (!Number.isInteger(spec.minExponent) || !Number.isInteger(spec.maxExponent)
      || spec.minExponent < -18 || spec.maxExponent > 18 || spec.minExponent > spec.maxExponent)
      return fail('BAD_EXPONENT_RANGE');
    if (asBig(spec.receiverProgramdataSlot, 'receiverProgramdataSlot') <= 0n
      || asBig(spec.wormholeProgramdataSlot, 'wormholeProgramdataSlot') <= 0n
      || bytes32(spec.receiverConfigHash, 'receiverConfigHash').equals(ZERO32)
      || bytes32(spec.wormholeProgram, 'wormholeProgram').equals(ZERO32))
      return fail('BAD_GENERATION_PINS');
    return { ok: true, code: 'OK' };
  } catch (error) {
    return fail('BAD_SPEC_FIELD', error.message);
  }
}

export function encodeEvidencePolicy(spec) {
  const valid = validateEvidenceSpec(spec);
  if (!valid.ok) throw new RangeError(`${valid.code}${valid.detail ? `: ${valid.detail}` : ''}`);
  const out = Buffer.concat([
    u16(spec.schema, 'schema'), u8(spec.adapter, 'adapter'),
    bytes32(spec.receiverProgram, 'receiverProgram'),
    bytes32(spec.pushOracleProgram, 'pushOracleProgram'),
    u16(spec.shardId, 'shardId'), bytes32(spec.feedId, 'feedId'),
    u8(spec.requiredVerification, 'requiredVerification'),
    u32(spec.targetGridSeconds, 'targetGridSeconds'),
    u32(spec.minOpenLeadSeconds, 'minOpenLeadSeconds'),
    u32(spec.maxTargetAheadSeconds, 'maxTargetAheadSeconds'),
    u32(spec.maxPreTargetGapSeconds, 'maxPreTargetGapSeconds'),
    u32(spec.maxPostTargetLagSeconds, 'maxPostTargetLagSeconds'),
    u32(spec.captureGraceSeconds, 'captureGraceSeconds'),
    u16(spec.maxFutureSkewSeconds, 'maxFutureSkewSeconds'),
    i8(spec.minExponent, 'minExponent'), i8(spec.maxExponent, 'maxExponent'),
    u32(spec.maxConfidenceBps, 'maxConfidenceBps'),
  ]);
  if (out.length !== EVIDENCE_POLICY_V2_CANONICAL_LEN)
    throw new RangeError('BAD_EVIDENCE_POLICY_LENGTH');
  return out;
}

export function encodeEvidenceSpec(spec) {
  const out = Buffer.concat([
    encodeEvidencePolicy(spec),
    u64(spec.receiverProgramdataSlot, 'receiverProgramdataSlot'),
    bytes32(spec.receiverConfigHash, 'receiverConfigHash'),
    bytes32(spec.wormholeProgram, 'wormholeProgram'),
    u64(spec.wormholeProgramdataSlot, 'wormholeProgramdataSlot'),
  ]);
  if (out.length !== EVIDENCE_SPEC_V2_CANONICAL_LEN)
    throw new RangeError('BAD_EVIDENCE_SPEC_LENGTH');
  return out;
}

export const evidencePolicyHash = spec => sha256(Buffer.concat([
  POLICY_HASH_DOMAIN, encodeEvidencePolicy(spec),
]));
export const evidenceSpecHash = spec => sha256(Buffer.concat([
  SPEC_HASH_DOMAIN, encodeEvidenceSpec(spec),
]));

export function encodeEvidenceSpecAccountData(spec) {
  const registeredSlot = asBig(spec.registeredSlot, 'registeredSlot');
  if (registeredSlot <= asBig(spec.receiverProgramdataSlot, 'receiverProgramdataSlot')
    || registeredSlot <= asBig(spec.wormholeProgramdataSlot, 'wormholeProgramdataSlot'))
    throw new RangeError('BAD_REGISTERED_SLOT');
  const storedPolicyHash = spec.evidencePolicyHash === undefined
    ? evidencePolicyHash(spec) : bytes32(spec.evidencePolicyHash, 'evidencePolicyHash');
  const out = Buffer.concat([
    EVIDENCE_SPEC_V2_DISCRIMINATOR,
    encodeEvidencePolicy(spec), storedPolicyHash,
    u64(spec.receiverProgramdataSlot, 'receiverProgramdataSlot'),
    bytes32(spec.receiverConfigHash, 'receiverConfigHash'),
    bytes32(spec.wormholeProgram, 'wormholeProgram'),
    u64(spec.wormholeProgramdataSlot, 'wormholeProgramdataSlot'),
    u64(registeredSlot, 'registeredSlot'),
  ]);
  if (out.length !== EVIDENCE_SPEC_V2_ACCOUNT_LEN)
    throw new RangeError('BAD_EVIDENCE_SPEC_ACCOUNT_LENGTH');
  return out;
}

export function validateEvidenceSpecAccount(programId, account) {
  try {
    const spec = account?.spec;
    const valid = validateEvidenceSpec(spec);
    if (!valid.ok) return valid;
    if (spec.evidencePolicyHash !== undefined
      && !sameBytes(spec.evidencePolicyHash, evidencePolicyHash(spec))) return fail('WRONG_POLICY_HASH');
    const registeredSlot = asBig(spec.registeredSlot, 'registeredSlot');
    if (registeredSlot <= asBig(spec.receiverProgramdataSlot, 'receiverProgramdataSlot')
      || registeredSlot <= asBig(spec.wormholeProgramdataSlot, 'wormholeProgramdataSlot'))
      return fail('BAD_REGISTERED_SLOT');
    const program = bytes32(programId, 'programId');
    if (!bytes32(account.key, 'account.key').equals(deriveEvidenceSpecPda(program, spec).address))
      return fail('WRONG_EVIDENCE_SPEC_PDA');
    if (!bytes32(account.owner, 'account.owner').equals(program)) return fail('WRONG_EVIDENCE_SPEC_OWNER');
    if (account.executable === true) return fail('EXECUTABLE_EVIDENCE_SPEC');
    const data = Buffer.from(account.data ?? []);
    if (data.length !== EVIDENCE_SPEC_V2_ACCOUNT_LEN) return fail('BAD_EVIDENCE_SPEC_DATA');
    if (!data.subarray(0, 8).equals(EVIDENCE_SPEC_V2_DISCRIMINATOR))
      return fail('WRONG_EVIDENCE_SPEC_DISCRIMINATOR');
    if (!data.equals(encodeEvidenceSpecAccountData(spec))) return fail('EVIDENCE_SPEC_BYTES_MISMATCH');
    return { ok: true, code: 'OK', spec, hash: evidenceSpecHash(spec) };
  } catch (error) {
    return fail('BAD_EVIDENCE_SPEC_ACCOUNT', error.message);
  }
}

export function validateGeneration(spec, generation, observedSlot) {
  try {
    const valid = validateEvidenceSpec(spec);
    if (!valid.ok) return valid;
    const loader = BPF_UPGRADEABLE_LOADER_PROGRAM;
    if (!bytes32(generation?.receiverProgram, 'receiverProgram').equals(bytes32(spec.receiverProgram)))
      return fail('WRONG_RECEIVER_PROGRAM');
    if (generation.receiverProgramExecutable !== true) return fail('RECEIVER_NOT_EXECUTABLE');
    if (!bytes32(generation.receiverProgramOwner, 'receiverProgramOwner').equals(loader))
      return fail('WRONG_RECEIVER_LOADER');
    const receiverData = bytes32(generation.receiverProgramdata, 'receiverProgramdata');
    let receiverLink;
    try {
      receiverLink = decodeUpgradeableProgramLink(
        generation.receiverProgramAccountData, 'receiverProgramAccountData',
      );
    } catch (error) {
      return fail('WRONG_RECEIVER_PROGRAMDATA_LINK', error.message);
    }
    if (!receiverData.equals(receiverLink)) return fail('WRONG_RECEIVER_PROGRAMDATA_LINK');
    if (!bytes32(generation.receiverProgramdataOwner, 'receiverProgramdataOwner').equals(loader)
      || generation.receiverProgramdataExecutable === true)
      return fail('WRONG_RECEIVER_PROGRAMDATA');
    let receiverSlot;
    try {
      receiverSlot = decodeUpgradeableProgramdataSlot(
        generation.receiverProgramdataAccountData, 'receiverProgramdataAccountData',
      );
    } catch (error) {
      return fail('WRONG_RECEIVER_PROGRAMDATA', error.message);
    }
    if (receiverSlot !== asBig(spec.receiverProgramdataSlot, 'spec.receiverProgramdataSlot'))
      return fail('RECEIVER_GENERATION_MISMATCH');
    if (!bytes32(generation.receiverConfigKey, 'receiverConfigKey')
      .equals(deriveReceiverConfigPda(spec.receiverProgram).address))
      return fail('WRONG_RECEIVER_CONFIG_PDA');
    if (!bytes32(generation.receiverConfigOwner, 'receiverConfigOwner')
      .equals(bytes32(spec.receiverProgram)) || generation.receiverConfigExecutable === true)
      return fail('BAD_RECEIVER_CONFIG');
    const receiverConfigData = Buffer.from(generation.receiverConfigData ?? []);
    let configuredWormhole;
    try {
      configuredWormhole = decodeReceiverConfigWormhole(receiverConfigData);
    } catch (error) {
      return fail('BAD_RECEIVER_CONFIG', error.message);
    }
    if (!sha256(receiverConfigData)
      .equals(bytes32(spec.receiverConfigHash))) return fail('RECEIVER_CONFIG_MISMATCH');
    if (!bytes32(generation.wormholeProgram, 'wormholeProgram')
      .equals(bytes32(spec.wormholeProgram))) return fail('WRONG_WORMHOLE_PROGRAM');
    if (!configuredWormhole.equals(bytes32(spec.wormholeProgram)))
      return fail('WRONG_CONFIGURED_WORMHOLE');
    if (generation.wormholeProgramExecutable !== true) return fail('WORMHOLE_NOT_EXECUTABLE');
    if (!bytes32(generation.wormholeProgramOwner, 'wormholeProgramOwner').equals(loader))
      return fail('WRONG_WORMHOLE_LOADER');
    const wormholeData = bytes32(generation.wormholeProgramdata, 'wormholeProgramdata');
    let wormholeLink;
    try {
      wormholeLink = decodeUpgradeableProgramLink(
        generation.wormholeProgramAccountData, 'wormholeProgramAccountData',
      );
    } catch (error) {
      return fail('WRONG_WORMHOLE_PROGRAMDATA_LINK', error.message);
    }
    if (!wormholeData.equals(wormholeLink)) return fail('WRONG_WORMHOLE_PROGRAMDATA_LINK');
    if (!bytes32(generation.wormholeProgramdataOwner, 'wormholeProgramdataOwner').equals(loader)
      || generation.wormholeProgramdataExecutable === true)
      return fail('WRONG_WORMHOLE_PROGRAMDATA');
    let wormholeSlot;
    try {
      wormholeSlot = decodeUpgradeableProgramdataSlot(
        generation.wormholeProgramdataAccountData, 'wormholeProgramdataAccountData',
      );
    } catch (error) {
      return fail('WRONG_WORMHOLE_PROGRAMDATA', error.message);
    }
    if (wormholeSlot !== asBig(spec.wormholeProgramdataSlot, 'spec.wormholeProgramdataSlot'))
      return fail('WORMHOLE_GENERATION_MISMATCH');
    const clockSlot = asBig(observedSlot, 'observedSlot');
    if (clockSlot <= asBig(spec.receiverProgramdataSlot)
      || clockSlot <= asBig(spec.wormholeProgramdataSlot))
      return fail('GENERATION_NOT_OBSERVABLE_YET');
    return { ok: true, code: 'OK' };
  } catch (error) {
    return fail('BAD_GENERATION_INPUT', error.message);
  }
}

export function registerEvidenceSpec(specArgs, generation, clockSlot, programId) {
  const checked = validateGeneration(specArgs, generation, clockSlot);
  if (!checked.ok) return checked;
  const spec = {
    ...specArgs,
    evidencePolicyHash: evidencePolicyHash(specArgs),
    registeredSlot: asBig(clockSlot, 'clockSlot'),
  };
  const derived = deriveEvidenceSpecPda(programId, spec);
  return {
    ok: true, code: 'REGISTERED', spec,
    account: {
      key: derived.address, owner: bytes32(programId, 'programId'), executable: false,
      spec, data: encodeEvidenceSpecAccountData(spec),
    },
  };
}

export function alignFutureTarget(nowTs, minOpenLeadSeconds, targetGridSeconds) {
  const now = asBig(nowTs, 'nowTs');
  const lead = asBig(minOpenLeadSeconds, 'minOpenLeadSeconds');
  const grid = asBig(targetGridSeconds, 'targetGridSeconds');
  if (lead < 0n || grid <= 0n) throw new RangeError('lead/grid');
  const earliest = now + lead;
  const target = ((earliest + grid - 1n) / grid) * grid;
  i64(target, 'target');
  return target;
}

export function deriveForwardTargets(nowTs, spec, horizonSeconds) {
  const valid = validateEvidenceSpec(spec);
  if (!valid.ok) throw new RangeError(valid.code);
  const now = asBig(nowTs, 'nowTs');
  const horizon = asBig(horizonSeconds, 'horizonSeconds');
  const grid = BigInt(spec.targetGridSeconds);
  if (horizon <= 0n) throw new RangeError('HORIZON_NOT_POSITIVE');
  if (horizon % grid !== 0n) throw new RangeError('HORIZON_NOT_GRID_ALIGNED');
  const t0 = alignFutureTarget(now, spec.minOpenLeadSeconds, spec.targetGridSeconds);
  const t1 = t0 + horizon;
  i64(t1, 't1');
  if (t1 - now > BigInt(spec.maxTargetAheadSeconds)) throw new RangeError('T1_TOO_FAR');
  return { t0, t1 };
}

export function deriveDeadlines(spec, targetTs) {
  const target = asBig(targetTs, 'targetTs');
  const sourceDeadlineTs = target + BigInt(spec.maxPostTargetLagSeconds);
  const captureDeadlineTs = sourceDeadlineTs + BigInt(spec.captureGraceSeconds);
  i64(sourceDeadlineTs, 'sourceDeadlineTs'); i64(captureDeadlineTs, 'captureDeadlineTs');
  return { sourceDeadlineTs, captureDeadlineTs };
}

export function createNeed(spec, targetTs, openedTs, programId) {
  const valid = validateEvidenceSpec(spec);
  if (!valid.ok) throw new RangeError(valid.code);
  const target = asBig(targetTs, 'targetTs');
  const opened = asBig(openedTs, 'openedTs');
  if (target % BigInt(spec.targetGridSeconds) !== 0n) throw new RangeError('TARGET_NOT_ALIGNED');
  const lead = target - opened;
  if (lead < BigInt(spec.minOpenLeadSeconds)) throw new RangeError('OPEN_TOO_LATE');
  if (lead > BigInt(spec.maxTargetAheadSeconds)) throw new RangeError('TARGET_TOO_FAR');
  const { sourceDeadlineTs, captureDeadlineTs } = deriveDeadlines(spec, target);
  const pda = deriveNeedPda(programId, spec, target);
  return {
    schema: TIMEPIN_SCHEMA_V2, bump: pda.bump, address: pda.address,
    state: 'Open', evidenceSpecHash: evidenceSpecHash(spec), targetTs: target,
    sourceDeadlineTs, captureDeadlineTs,
    candidateAHash: Buffer.from(ZERO32), candidateBHash: Buffer.from(ZERO32),
  };
}

export function encodeTimepinNeedV2(need) {
  const state = NEED_STATES[need?.state];
  if (!Number.isInteger(state)) throw new RangeError('BAD_NEED_STATE');
  const payload = Buffer.concat([
    u16(need.schema, 'need.schema'), u8(need.bump, 'need.bump'), u8(state, 'need.state'),
    bytes32(need.evidenceSpecHash, 'need.evidenceSpecHash'), i64(need.targetTs, 'need.targetTs'),
    i64(need.sourceDeadlineTs, 'need.sourceDeadlineTs'),
    i64(need.captureDeadlineTs, 'need.captureDeadlineTs'),
    bytes32(need.candidateAHash, 'need.candidateAHash'),
    bytes32(need.candidateBHash, 'need.candidateBHash'),
    // open_refs and rent_payer only. The observation is not in the Need; see the
    // constant above.
    u32(need.openRefs ?? 0, 'need.openRefs'),
    bytes32(need.rentPayer ?? ZERO32, 'need.rentPayer'),
  ]);
  if (payload.length !== TIMEPIN_NEED_V2_PAYLOAD_LEN) throw new RangeError('BAD_NEED_PAYLOAD_LENGTH');
  return Buffer.concat([TIMEPIN_NEED_V2_DISCRIMINATOR, payload]);
}

export function validateNeed(spec, need, programId) {
  try {
    const valid = validateEvidenceSpec(spec);
    if (!valid.ok) return valid;
    if (need?.schema !== TIMEPIN_SCHEMA_V2) return fail('BAD_NEED_SCHEMA');
    const target = asBig(need.targetTs, 'need.targetTs');
    if (target % BigInt(spec.targetGridSeconds) !== 0n) return fail('CORRUPT_TARGET_ALIGNMENT');
    if (!sameBytes(need.evidenceSpecHash, evidenceSpecHash(spec))) return fail('WRONG_SPEC');
    const expected = deriveNeedPda(programId, spec, target);
    if (!bytes32(need.address, 'need.address').equals(expected.address)) return fail('WRONG_NEED_PDA');
    if (need.bump !== expected.bump) return fail('WRONG_NEED_BUMP');
    const deadlines = deriveDeadlines(spec, target);
    if (asBig(need.sourceDeadlineTs) !== deadlines.sourceDeadlineTs) return fail('CORRUPT_SOURCE_DEADLINE');
    if (asBig(need.captureDeadlineTs) !== deadlines.captureDeadlineTs) return fail('CORRUPT_CAPTURE_DEADLINE');
    const a = bytes32(need.candidateAHash, 'candidateAHash');
    const b = bytes32(need.candidateBHash, 'candidateBHash');
    const shapeOk = (need.state === 'Open' || need.state === 'Expired')
      ? a.equals(ZERO32) && b.equals(ZERO32)
      : (need.state === 'Candidate' || need.state === 'Final')
        ? !a.equals(ZERO32) && b.equals(ZERO32)
        : need.state === 'Ambiguous'
          ? !a.equals(ZERO32) && !b.equals(ZERO32) && Buffer.compare(a, b) < 0
          : false;
    if (!shapeOk) return fail(Object.hasOwn(NEED_STATES, need.state)
      ? 'CORRUPT_CANDIDATE_STATE' : 'CORRUPT_STATE');
    if (encodeTimepinNeedV2(need).length !== TIMEPIN_NEED_V2_ACCOUNT_LEN)
      return fail('BAD_NEED_ACCOUNT_LENGTH');
    return { ok: true, code: 'OK', target, deadlines, expected };
  } catch (error) {
    return fail('BAD_NEED_ACCOUNT', error.message);
  }
}

export function openNeed(existingNeed, evidenceSpecAccount, targetTs, openedTs, programId) {
  const checkedSpec = validateEvidenceSpecAccount(programId, evidenceSpecAccount);
  if (!checkedSpec.ok) return { ...checkedSpec, need: existingNeed ?? null, changed: false };
  if (!existingNeed) {
    const need = createNeed(checkedSpec.spec, targetTs, openedTs, programId);
    return { ok: true, code: 'CREATED', need, changed: true };
  }
  const checkedNeed = validateNeed(checkedSpec.spec, existingNeed, programId);
  if (!checkedNeed.ok) return { ...checkedNeed, need: existingNeed, changed: false };
  const requested = deriveNeedPda(programId, checkedSpec.spec, targetTs).address;
  return sameBytes(existingNeed.address, requested)
    ? { ok: true, code: 'EXISTING', need: existingNeed, changed: false }
    : { ok: false, code: 'NEED_IDENTITY_MISMATCH', need: existingNeed, changed: false };
}

export function hashPriceMessage(message, feedId = message?.feedId) {
  return sha256(Buffer.concat([
    PRICE_MESSAGE_HASH_DOMAIN, bytes32(feedId, 'feedId'),
    i64(message.price, 'price'), u64(message.conf, 'conf'), i32(message.exponent, 'exponent'),
    i64(message.publishTime, 'publishTime'), i64(message.prevPublishTime, 'prevPublishTime'),
    i64(message.emaPrice, 'emaPrice'), u64(message.emaConf, 'emaConf'),
  ]));
}

export function decodePriceUpdateV2(sourceAccount) {
  const data = Buffer.from(sourceAccount?.data ?? []);
  if (data.length !== PRICE_UPDATE_V2_LEN) return fail('BAD_PRICE_ACCOUNT_DATA');
  if (!data.subarray(0, 8).equals(PRICE_UPDATE_V2_DISCRIMINATOR))
    return fail('WRONG_DISCRIMINATOR');
  const verificationLevel = data[40];
  if (verificationLevel !== VERIFICATION_FULL) return fail('NOT_FULL');
  let offset = 41;
  const feedId = data.subarray(offset, offset + 32); offset += 32;
  const price = data.readBigInt64LE(offset); offset += 8;
  const conf = data.readBigUInt64LE(offset); offset += 8;
  const exponent = data.readInt32LE(offset); offset += 4;
  const publishTime = data.readBigInt64LE(offset); offset += 8;
  const prevPublishTime = data.readBigInt64LE(offset); offset += 8;
  const emaPrice = data.readBigInt64LE(offset); offset += 8;
  const emaConf = data.readBigUInt64LE(offset); offset += 8;
  const postedSlot = data.readBigUInt64LE(offset);
  return {
    ok: true, code: 'OK', writeAuthority: data.subarray(8, 40), verificationLevel,
    feedId, price, conf, exponent, publishTime, prevPublishTime,
    emaPrice, emaConf, postedSlot, layoutLength: data.length,
  };
}

// Exported so the settlement rule can be tested on its own. It used to be
// reachable only through evaluateCapture, which needs a 134-byte price account,
// three PDAs and a generation context -- so the one predicate the whole economy
// rests on had no direct test at any level, which is exactly how the strict
// bracket reached the build queue unchallenged (MIN_CAPTURE_SPEC.md section 7).
export function validateDecisionFields(spec, need, candidate) {
  const target = asBig(need.targetTs, 'need.targetTs');
  const previous = asBig(candidate.prevPublishTime, 'prevPublishTime');
  const published = asBig(candidate.publishTime, 'publishTime');
  if (spec.adapter === ADAPTER_PYTH_MIN_CAPTURE_V2) {
    // MIN-CAPTURE. The bracket and the pre-gap have no meaning here: the rule is
    // the earliest print at or after the target, and `finalize` picks the minimum
    // over everything submitted. Mirrors lifecycle.rs's PublishBeforeTarget.
    if (published < target) return fail('PUBLISH_BEFORE_TARGET');
  } else {
    if (!(previous < target && target <= published)) return fail('NOT_CROSSING');
    if (target - previous > BigInt(spec.maxPreTargetGapSeconds)) return fail('PRE_GAP');
  }
  if (published - target > BigInt(spec.maxPostTargetLagSeconds)) return fail('POST_LAG');
  if (published > asBig(need.sourceDeadlineTs)) return fail('SOURCE_AFTER_DEADLINE');
  const price = asBig(candidate.price, 'price');
  const conf = asBig(candidate.conf, 'conf');
  if (price <= 0n) return fail('NONPOSITIVE_PRICE');
  if (!Number.isInteger(candidate.exponent)
    || candidate.exponent < spec.minExponent || candidate.exponent > spec.maxExponent)
    return fail('BAD_EXPONENT');
  if (conf * 10_000n > price * BigInt(spec.maxConfidenceBps)) return fail('WIDE_CONFIDENCE');
  return { ok: true, code: 'OK' };
}

export function evaluateCapture(spec, need, sourceAccount, context, programId) {
  let captured, currentSlot, sourceKey, sourceOwner;
  try {
    captured = asBig(context?.unixTimestamp, 'context.unixTimestamp');
    currentSlot = asBig(context?.slot, 'context.slot');
    sourceKey = bytes32(sourceAccount?.key, 'sourceAccount.key');
    sourceOwner = bytes32(sourceAccount?.owner, 'sourceAccount.owner');
  } catch (error) {
    return fail('BAD_RUNTIME_INPUT', error.message);
  }
  const authenticated = validateNeed(spec, need, programId);
  if (!authenticated.ok) return authenticated;
  if (TERMINAL_STATES.has(need.state)) return fail('TERMINAL');
  const generation = validateGeneration(spec, context?.generation, currentSlot);
  if (!generation.ok) return generation;
  if (currentSlot < asBig(spec.registeredSlot, 'registeredSlot')) return fail('BAD_REGISTERED_SLOT');
  if (captured < authenticated.target) return fail('TARGET_NOT_REACHED');
  if (captured >= authenticated.deadlines.captureDeadlineTs) return fail('CAPTURE_CLOSED');
  if (!sourceOwner.equals(bytes32(spec.receiverProgram, 'receiverProgram'))) return fail('WRONG_OWNER');
  const expectedSource = derivePushSourcePda(spec).address;
  if (!sourceKey.equals(expectedSource)) return fail('WRONG_SOURCE_PDA');
  if (sourceAccount.executable === true) return fail('EXECUTABLE_SOURCE');
  const decoded = decodePriceUpdateV2(sourceAccount);
  if (!decoded.ok) return decoded;
  if (!decoded.writeAuthority.equals(sourceKey)) return fail('WRONG_WRITE_AUTHORITY');
  if (!decoded.feedId.equals(bytes32(spec.feedId, 'spec.feedId'))) return fail('WRONG_FEED');
  if (decoded.postedSlot <= asBig(spec.registeredSlot, 'registeredSlot'))
    return fail('POSTED_BEFORE_OR_AT_REGISTRATION');
  if (decoded.postedSlot > currentSlot) return fail('FUTURE_SLOT');
  const decision = validateDecisionFields(spec, need, decoded);
  if (!decision.ok) return decision;
  if (decoded.publishTime > captured + BigInt(spec.maxFutureSkewSeconds))
    return fail('FUTURE_SOURCE_TIME');
  return {
    ok: true, code: 'OK', messageHash: hashPriceMessage(decoded), message: decoded,
    sourceKey, sourceOwner, captured, currentSlot,
  };
}

export function encodeCandidateV2(candidate) {
  const payload = Buffer.concat([
    u16(candidate.schema, 'candidate.schema'), u8(candidate.bump, 'candidate.bump'),
    bytes32(candidate.need, 'candidate.need'),
    bytes32(candidate.rentPayer ?? Buffer.alloc(32), 'candidate.rentPayer'),
    i64(candidate.price, 'candidate.price'),
    u64(candidate.conf, 'candidate.conf'), i32(candidate.exponent, 'candidate.exponent'),
    i64(candidate.publishTime, 'candidate.publishTime'),
    i64(candidate.prevPublishTime, 'candidate.prevPublishTime'),
    i64(candidate.emaPrice, 'candidate.emaPrice'), u64(candidate.emaConf, 'candidate.emaConf'),
    u64(candidate.postedSlot, 'candidate.postedSlot'),
    u64(candidate.captureSlot, 'candidate.captureSlot'), i64(candidate.captureTs, 'candidate.captureTs'),
  ]);
  if (payload.length !== CANDIDATE_V2_PAYLOAD_LEN) throw new RangeError('BAD_CANDIDATE_PAYLOAD_LENGTH');
  return Buffer.concat([CANDIDATE_V2_DISCRIMINATOR, payload]);
}

export function validateCandidate(spec, need, candidate, expectedMessageHash, programId) {
  try {
    const hash = bytes32(expectedMessageHash, 'expectedMessageHash');
    const expected = deriveCandidatePda(programId, need.address, hash);
    if (!bytes32(candidate.address, 'candidate.address').equals(expected.address))
      return fail('WRONG_CANDIDATE_PDA');
    if (candidate.schema !== TIMEPIN_SCHEMA_V2 || candidate.bump !== expected.bump
      || !bytes32(candidate.need, 'candidate.need').equals(bytes32(need.address)))
      return fail('CORRUPT_CANDIDATE');
    const captureTs = asBig(candidate.captureTs, 'candidate.captureTs');
    if (captureTs < asBig(need.targetTs) || captureTs >= asBig(need.captureDeadlineTs))
      return fail('CORRUPT_CANDIDATE');
    const posted = asBig(candidate.postedSlot, 'candidate.postedSlot');
    const capturedSlot = asBig(candidate.captureSlot, 'candidate.captureSlot');
    if (posted <= asBig(spec.registeredSlot) || posted > capturedSlot)
      return fail('CORRUPT_CANDIDATE');
    const decision = validateDecisionFields(spec, need, candidate);
    if (!decision.ok) return decision;
    if (!hashPriceMessage(candidate, spec.feedId).equals(hash)) return fail('CORRUPT_CANDIDATE_HASH');
    if (encodeCandidateV2(candidate).length !== CANDIDATE_V2_ACCOUNT_LEN)
      return fail('BAD_CANDIDATE_ACCOUNT_LENGTH');
    return { ok: true, code: 'OK', hash, expected };
  } catch (error) {
    return fail('BAD_CANDIDATE', error.message);
  }
}

export function workManifestDefinition(programId, workKind) {
  const pda = deriveWorkManifestPda(programId, workKind);
  return {
    address: pda.address, schemaVersion: WORK_MANIFEST_SCHEMA_VERSION, bump: pda.bump, workKind,
    completionSchemaVersion: COMPLETION_SCHEMA_VERSION,
    locatorMode: LOCATOR_MODE_PACKED_WORK_PAGE,
    subjectSchemaVersion: TIMEPIN_SCHEMA_V2,
    subjectAccountSize: TIMEPIN_NEED_V2_ACCOUNT_LEN,
    subjectDiscriminator: TIMEPIN_NEED_V2_DISCRIMINATOR,
    locatorSchemaVersion: WORK_PAGE_SCHEMA_VERSION,
    locatorDiscriminator: WORK_PAGE_DISCRIMINATOR,
    recordsOffset: WORK_PAGE_RECORDS_OFFSET,
    entryLen: WORK_RECORD_LEN,
    locatorCapacity: WORK_PAGE_CAPACITY,
  };
}

export function encodeWorkManifest(manifest) {
  const payload = Buffer.concat([
    u16(manifest.schemaVersion, 'schemaVersion'), u8(manifest.bump, 'bump'),
    u8(manifest.workKind, 'workKind'),
    u16(manifest.completionSchemaVersion, 'completionSchemaVersion'),
    u8(manifest.locatorMode, 'locatorMode'),
    u16(manifest.subjectSchemaVersion, 'subjectSchemaVersion'),
    u16(manifest.subjectAccountSize, 'subjectAccountSize'),
    Buffer.from(manifest.subjectDiscriminator),
    u16(manifest.locatorSchemaVersion, 'locatorSchemaVersion'),
    Buffer.from(manifest.locatorDiscriminator),
    u16(manifest.recordsOffset, 'recordsOffset'), u16(manifest.entryLen, 'entryLen'),
    u8(manifest.locatorCapacity, 'locatorCapacity'),
  ]);
  if (Buffer.from(manifest.subjectDiscriminator).length !== 8
    || Buffer.from(manifest.locatorDiscriminator).length !== 8
    || payload.length !== WORK_MANIFEST_PAYLOAD_LEN)
    throw new RangeError('BAD_WORK_MANIFEST_LENGTH');
  return Buffer.concat([WORK_MANIFEST_DISCRIMINATOR, payload]);
}

function validateWorkRecord(record) {
  try {
    const subject = bytes32(record?.subject, 'record.subject');
    if (subject.equals(ZERO32)) return fail('INVALID_WORK_RECORD');
    if (![WORK_KIND_FIRST_CAPTURE, WORK_KIND_TERMINALIZE].includes(record.workKind))
      return fail('INVALID_WORK_KIND');
    const worker = bytes32(record.worker, 'record.worker');
    const resultHash = bytes32(record.resultHash, 'record.resultHash');
    const completedSlot = asBig(record.completedSlot, 'record.completedSlot');
    const pending = record.disposition === WORK_DISPOSITION_PENDING
      && worker.equals(ZERO32) && resultHash.equals(ZERO32) && completedSlot === 0n;
    const payable = record.disposition === WORK_DISPOSITION_PAYABLE
      && !worker.equals(ZERO32) && !resultHash.equals(ZERO32) && completedSlot > 0n;
    const nonpayable = record.disposition === WORK_DISPOSITION_NONPAYABLE
      && worker.equals(ZERO32) && !resultHash.equals(ZERO32) && completedSlot > 0n;
    return pending || payable || nonpayable
      ? { ok: true, code: 'OK' } : fail('INVALID_WORK_RECORD');
  } catch (error) {
    return fail('INVALID_WORK_RECORD', error.message);
  }
}

function encodeWorkRecord(record) {
  const checked = validateWorkRecord(record);
  if (!checked.ok) throw new RangeError(checked.code);
  const out = Buffer.concat([
    bytes32(record.subject, 'record.subject'), u8(record.workKind, 'record.workKind'),
    u8(record.disposition, 'record.disposition'), bytes32(record.worker, 'record.worker'),
    bytes32(record.resultHash, 'record.resultHash'), u64(record.completedSlot, 'record.completedSlot'),
  ]);
  if (out.length !== WORK_RECORD_LEN) throw new RangeError('BAD_WORK_RECORD_LENGTH');
  return out;
}

export function createWorkPage(programId, needAddress) {
  const pda = deriveWorkPagePda(programId, needAddress);
  return {
    address: pda.address, schema: WORK_PAGE_SCHEMA_VERSION, bump: pda.bump,
    need: bytes32(needAddress, 'needAddress'), records: [],
  };
}

// Solana instructions cannot omit an optional WorkPage account. Logical
// absence is the canonical PDA supplied writable as a system-owned, zero-data,
// non-executable account.
export function createAbsentWorkPageAccount(programId, needAddress) {
  return {
    absent: true,
    address: deriveWorkPagePda(programId, needAddress).address,
    owner: Buffer.from(SYSTEM_PROGRAM),
    executable: false,
    writable: true,
    data: Buffer.alloc(0),
  };
}

export function encodeWorkPage(page) {
  if (!Array.isArray(page?.records) || page.records.length > WORK_PAGE_CAPACITY)
    throw new RangeError('BAD_WORK_PAGE_RECORD_COUNT');
  const payload = Buffer.concat([
    u16(page.schema, 'page.schema'), u8(page.bump, 'page.bump'), bytes32(page.need, 'page.need'),
    u32(page.records.length, 'page.records.length'), ...page.records.map(encodeWorkRecord),
  ]);
  const expected = WORK_PAGE_BASE_PAYLOAD_LEN + page.records.length * WORK_RECORD_LEN;
  if (payload.length !== expected) throw new RangeError('BAD_WORK_PAGE_LENGTH');
  return Buffer.concat([WORK_PAGE_DISCRIMINATOR, payload]);
}

export function validateWorkPage(page, needAddress, programId) {
  try {
    if (page?.schema !== WORK_PAGE_SCHEMA_VERSION || !Array.isArray(page.records)
      || page.records.length > WORK_PAGE_CAPACITY) return fail('INVALID_WORK_PAGE');
    const need = bytes32(needAddress, 'needAddress');
    if (!bytes32(page.need, 'page.need').equals(need)) return fail('INVALID_WORK_PAGE');
    const expected = deriveWorkPagePda(programId, need);
    if (!bytes32(page.address, 'page.address').equals(expected.address)) return fail('WRONG_WORK_PAGE_PDA');
    if (page.bump !== expected.bump) return fail('WRONG_WORK_PAGE_BUMP');
    for (let index = 0; index < page.records.length; index++) {
      const checked = validateWorkRecord(page.records[index]);
      if (!checked.ok) return checked;
      if (page.records.slice(0, index).some(prior =>
        sameBytes(prior.subject, page.records[index].subject)
        && prior.workKind === page.records[index].workKind)) return fail('DUPLICATE_WORK_RECORD');
    }
    const encoded = encodeWorkPage(page);
    const expectedLength = WORK_PAGE_BASE_ACCOUNT_LEN + page.records.length * WORK_RECORD_LEN;
    if (encoded.length !== expectedLength) return fail('WRONG_WORK_PAGE_LENGTH');
    return { ok: true, code: 'OK' };
  } catch (error) {
    return fail('INVALID_WORK_PAGE', error.message);
  }
}

function validateOptionalWorkPage(account, needAddress, programId) {
  if (account === null || account === undefined) return fail('MISSING_WORK_PAGE_ACCOUNT');
  if (account.absent === true) {
    try {
      const expected = deriveWorkPagePda(programId, needAddress).address;
      if (!bytes32(account.address, 'workPage.address').equals(expected))
        return fail('WRONG_WORK_PAGE_PDA');
      if (account.writable !== true) return fail('READONLY_WORK_PAGE');
      if (!bytes32(account.owner, 'workPage.owner').equals(SYSTEM_PROGRAM)
        || account.executable === true || Buffer.from(account.data ?? []).length !== 0)
        return fail('INVALID_ABSENT_WORK_PAGE');
      return { ok: true, code: 'ABSENT', absent: true };
    } catch (error) {
      return fail('INVALID_ABSENT_WORK_PAGE', error.message);
    }
  }
  const checked = validateWorkPage(account, needAddress, programId);
  return checked.ok ? { ...checked, absent: false } : checked;
}

const cloneRecord = record => ({
  ...record, subject: Buffer.from(record.subject), worker: Buffer.from(record.worker),
  resultHash: Buffer.from(record.resultHash), completedSlot: BigInt(record.completedSlot),
});
const cloneWorkPage = page => page && ({
  ...page, address: Buffer.from(page.address), need: Buffer.from(page.need),
  records: page.records.map(cloneRecord),
});

export function reserveWork(page, need, workKind, expectedIndex, programId) {
  const authenticated = validateWorkPage(page, need.address, programId);
  if (!authenticated.ok) return { ...authenticated, page, changed: false };
  if (![WORK_KIND_FIRST_CAPTURE, WORK_KIND_TERMINALIZE].includes(workKind))
    return { ok: false, code: 'INVALID_WORK_KIND', page, changed: false };
  const eligible = workKind === WORK_KIND_FIRST_CAPTURE
    ? need.state === 'Open' : need.state === 'Open' || need.state === 'Candidate';
  if (!eligible) return { ok: false, code: 'WORK_NOT_RESERVABLE', page, changed: false };
  const index = page.records.findIndex(record =>
    sameBytes(record.subject, need.address) && record.workKind === workKind);
  if (index >= 0) {
    const pending = page.records[index].disposition === WORK_DISPOSITION_PENDING;
    return index === expectedIndex && pending
      ? { ok: true, code: 'EXISTING', page, changed: false, index }
      : { ok: false, code: 'WRONG_WORK_RECORD_INDEX', page, changed: false };
  }
  if (page.records.length >= WORK_PAGE_CAPACITY) return fail('WORK_PAGE_FULL');
  if (page.records.length !== expectedIndex)
    return { ok: false, code: 'WRONG_WORK_RECORD_INDEX', page, changed: false };
  const next = cloneWorkPage(page);
  next.records.push({
    subject: Buffer.from(need.address), workKind, disposition: WORK_DISPOSITION_PENDING,
    worker: Buffer.from(ZERO32), resultHash: Buffer.from(ZERO32), completedSlot: 0n,
  });
  return { ok: true, code: 'RESERVED', page: next, changed: true, index: expectedIndex };
}

export function completionResultHash(subject, workKind, actionFactHash, disposition, worker) {
  return sha256(Buffer.concat([
    COMPLETION_RESULT_HASH_DOMAIN, bytes32(subject, 'subject'), u8(workKind, 'workKind'),
    bytes32(actionFactHash, 'actionFactHash'), u8(disposition, 'disposition'),
    bytes32(worker, 'worker'),
  ]));
}

function completeOptionalWork(page, need, completions, completedSlot, programId) {
  const checked = validateOptionalWorkPage(page, need.address, programId);
  if (!checked.ok) return { ...checked, page };
  if (checked.absent) return { ok: true, page };
  const next = cloneWorkPage(page);
  for (const completion of completions) {
    const index = next.records.findIndex(record =>
      sameBytes(record.subject, need.address) && record.workKind === completion.workKind);
    if (index < 0) continue;
    if (next.records[index].disposition !== WORK_DISPOSITION_PENDING)
      return { ok: false, code: 'WORK_RECORD_NOT_PENDING', page };
    const worker = bytes32(completion.worker, 'completion.worker');
    next.records[index] = {
      subject: Buffer.from(need.address), workKind: completion.workKind,
      disposition: completion.disposition, worker,
      resultHash: completionResultHash(
        need.address, completion.workKind, completion.actionFactHash,
        completion.disposition, worker,
      ),
      completedSlot: asBig(completedSlot, 'completedSlot'),
    };
    const validRecord = validateWorkRecord(next.records[index]);
    if (!validRecord.ok) return { ...validRecord, page };
  }
  return { ok: true, page: next };
}

const cloneNeed = need => ({
  ...need, address: Buffer.from(need.address), evidenceSpecHash: Buffer.from(need.evidenceSpecHash),
  candidateAHash: Buffer.from(need.candidateAHash), candidateBHash: Buffer.from(need.candidateBHash),
});

function candidateFromCapture(checked, need, programId) {
  const pda = deriveCandidatePda(programId, need.address, checked.messageHash);
  return {
    address: pda.address, schema: TIMEPIN_SCHEMA_V2, bump: pda.bump,
    need: Buffer.from(need.address), price: checked.message.price, conf: checked.message.conf,
    exponent: checked.message.exponent, publishTime: checked.message.publishTime,
    prevPublishTime: checked.message.prevPublishTime, emaPrice: checked.message.emaPrice,
    emaConf: checked.message.emaConf, postedSlot: checked.message.postedSlot,
    captureSlot: checked.currentSlot, captureTs: checked.captured,
  };
}

export function terminalResultHash(need) {
  const address = bytes32(need.address, 'need.address');
  const a = bytes32(need.candidateAHash, 'candidateAHash');
  const b = bytes32(need.candidateBHash, 'candidateBHash');
  if (need.state === 'Final' && !a.equals(ZERO32) && b.equals(ZERO32))
    return sha256(Buffer.concat([EVIDENCE_SET_HASH_DOMAIN, address, a]));
  if (need.state === 'Ambiguous' && !a.equals(ZERO32) && !b.equals(ZERO32)
    && Buffer.compare(a, b) < 0)
    return sha256(Buffer.concat([EVIDENCE_SET_HASH_DOMAIN, address, a, b]));
  if (need.state === 'Expired' && a.equals(ZERO32) && b.equals(ZERO32))
    return sha256(Buffer.concat([EXPIRED_HASH_DOMAIN, address, i64(need.targetTs, 'targetTs')]));
  throw new RangeError('TERMINAL_STATE_REQUIRED');
}

export function captureNeed(
  spec, need, sourceAccount, context, actorValue, programId, workPage = null,
) {
  const checked = evaluateCapture(spec, need, sourceAccount, context, programId);
  if (!checked.ok) return { ...checked, need, candidate: null, workPage, changed: false };
  const actor = bytes32(actorValue, 'actor');
  if (actor.equals(ZERO32)) return { ok: false, code: 'BAD_ACTOR', need, candidate: null, workPage, changed: false };

  if (need.state === 'Candidate' && sameBytes(need.candidateAHash, checked.messageHash)) {
    const candidate = context?.candidateA;
    if (!candidate) return { ok: false, code: 'MISSING_CANDIDATE', need, candidate: null, workPage, changed: false };
    const existing = validateCandidate(spec, need, candidate, checked.messageHash, programId);
    if (!existing.ok) return { ...existing, need, candidate: null, workPage, changed: false };
    const pageCheck = validateOptionalWorkPage(workPage, need.address, programId);
    if (!pageCheck.ok) return { ...pageCheck, need, candidate: null, workPage, changed: false };
    return { ok: true, code: 'DUPLICATE', need, candidate, workPage, changed: false };
  }

  const candidate = candidateFromCapture(checked, need, programId);
  if (need.state === 'Open') {
    const work = completeOptionalWork(workPage, need, [{
      workKind: WORK_KIND_FIRST_CAPTURE, disposition: WORK_DISPOSITION_PAYABLE,
      worker: actor, actionFactHash: checked.messageHash,
    }], checked.currentSlot, programId);
    if (!work.ok) return { ...work, need, candidate: null, workPage, changed: false };
    const next = cloneNeed(need);
    next.state = 'Candidate';
    next.candidateAHash = Buffer.from(checked.messageHash);
    next.candidateBHash = Buffer.from(ZERO32);
    return {
      ok: true, code: 'CANDIDATE', need: next, candidate,
      messageHash: checked.messageHash, workPage: work.page, changed: true,
    };
  }

  if (need.state !== 'Candidate')
    return { ok: false, code: 'TERMINAL_OR_WRONG_STATE', need, candidate: null, workPage, changed: false };
  const firstCandidate = context?.candidateA;
  if (!firstCandidate)
    return { ok: false, code: 'MISSING_CANDIDATE', need, candidate: null, workPage, changed: false };
  const first = validateCandidate(spec, need, firstCandidate, need.candidateAHash, programId);
  if (!first.ok) return { ...first, need, candidate: null, workPage, changed: false };
  if (sameBytes(need.candidateAHash, checked.messageHash))
    return { ok: false, code: 'DUPLICATE_MUST_USE_FIRST_CAPTURE', need, candidate: null, workPage, changed: false };
  if (spec.adapter === ADAPTER_PYTH_MIN_CAPTURE_V2) {
    const oldPub = asBig(firstCandidate.publishTime);
    const newPub = asBig(checked.message.publishTime);
    if (newPub < oldPub) {
      const next = cloneNeed(need);
      next.candidateAHash = Buffer.from(checked.messageHash);
      return {
        ok: true, code: 'REPLACED', need: next, candidate,
        messageHash: checked.messageHash, workPage, changed: true,
      };
    }
    if (newPub > oldPub) {
      return { ok: false, code: 'NOT_BETTER_THAN_CURRENT', need, candidate: null, workPage, changed: false };
    }
  }

  const next = cloneNeed(need);
  next.state = 'Ambiguous';
  [next.candidateAHash, next.candidateBHash] = Buffer.compare(need.candidateAHash, checked.messageHash) < 0
    ? [Buffer.from(need.candidateAHash), Buffer.from(checked.messageHash)]
    : [Buffer.from(checked.messageHash), Buffer.from(need.candidateAHash)];
  const resultHash = terminalResultHash(next);
  const work = completeOptionalWork(workPage, need, [{
    workKind: WORK_KIND_TERMINALIZE, disposition: WORK_DISPOSITION_PAYABLE,
    worker: actor, actionFactHash: resultHash,
  }], checked.currentSlot, programId);
  if (!work.ok) return { ...work, need, candidate: null, workPage, changed: false };
  return {
    ok: true, code: 'AMBIGUOUS', need: next, candidate,
    messageHash: checked.messageHash, resultHash, workPage: work.page, changed: true,
  };
}

export function terminalizeNeed(
  spec, need, context, actorValue, programId, workPage = null, candidate = null,
) {
  const authenticated = validateNeed(spec, need, programId);
  if (!authenticated.ok) return { ...authenticated, need, workPage, changed: false };
  const now = asBig(context?.unixTimestamp, 'context.unixTimestamp');
  const slot = asBig(context?.slot, 'context.slot');
  if (now < authenticated.deadlines.captureDeadlineTs)
    return { ok: false, code: 'TOO_EARLY', need, workPage, changed: false };
  if (TERMINAL_STATES.has(need.state))
    return { ok: false, code: 'TERMINAL', need, workPage, changed: false };
  const actor = bytes32(actorValue, 'actor');
  if (actor.equals(ZERO32)) return { ok: false, code: 'BAD_ACTOR', need, workPage, changed: false };
  if (need.state === 'Candidate') {
    if (!candidate) return { ok: false, code: 'MISSING_CANDIDATE', need, workPage, changed: false };
    const checked = validateCandidate(spec, need, candidate, need.candidateAHash, programId);
    if (!checked.ok) return { ...checked, need, workPage, changed: false };
  } else if (need.state !== 'Open') {
    return { ok: false, code: 'WRONG_STATE', need, workPage, changed: false };
  }
  const next = cloneNeed(need);
  next.state = need.state === 'Candidate' ? 'Final' : 'Expired';
  const resultHash = terminalResultHash(next);
  const completions = next.state === 'Expired' ? [
    {
      workKind: WORK_KIND_FIRST_CAPTURE, disposition: WORK_DISPOSITION_NONPAYABLE,
      worker: ZERO32, actionFactHash: resultHash,
    },
    {
      workKind: WORK_KIND_TERMINALIZE, disposition: WORK_DISPOSITION_PAYABLE,
      worker: actor, actionFactHash: resultHash,
    },
  ] : [{
    workKind: WORK_KIND_TERMINALIZE, disposition: WORK_DISPOSITION_PAYABLE,
    worker: actor, actionFactHash: resultHash,
  }];
  const work = completeOptionalWork(workPage, need, completions, slot, programId);
  if (!work.ok) return { ...work, need, workPage, changed: false };
  return {
    ok: true, code: next.state.toUpperCase(), need: next,
    resultHash, workPage: work.page, changed: true,
  };
}
