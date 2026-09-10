// Core G2 formal model. This file is intentionally independent of Core v1.
//
// The model treats raw account bytes as the instruction boundary. In
// particular, callers cannot hand Core a decoded price: the immutable
// EvidenceSpec plus terminal-in-Need and compact Candidate accounts are
// authenticated by owner, discriminator, exact length, canonical PDA and
// content hash before a price can affect a shot.
import { PublicKey } from '@solana/web3.js';

export const CORE_G2_SCHEMA = 2;
export const COMPLETION_SCHEMA = 1;
export const ECONOMY_CANONICAL_LEN = 372;
export const ECONOMY_ACCOUNT_LEN = 415;
export const RULESET_CANONICAL_LEN = 163;
export const RULESET_ACCOUNT_LEN = 206;
export const RULESET_POLICY_CANONICAL_LEN = 99;
export const SHOT_RESULT_LEN = 165;
export const GAME_RESULT_FACTS_LEN = 82;
export const HISTORY_PAGE_CAP = 16;
// M3: the page is a FIXED-SIZE COMMITMENT, not a container of rows.
// schema 2 + bump 1 + economyHash 32 + player 32 + pageIndex 8 +
// pendingCount 1 + terminalMask 2 + resultsRoot 32 = 110.
// BASE and MAX are kept as aliases so callers do not all change at once, and
// their being EQUAL is the statement: a page whose base and max differ is a
// page that grows.
export const HISTORY_PAGE_LEN = 2 + 1 + 32 + 32 + 8 + 1 + 2 + 32;
export const HISTORY_PAGE_BASE_LEN = HISTORY_PAGE_LEN;
export const HISTORY_PAGE_MAX_LEN = HISTORY_PAGE_LEN;
// What the page cost BEFORE M3, kept so the saving is arithmetic in one place
// rather than a number repeated in prose: 79 + 16 * (1 + 165) = 2,735.
export const HISTORY_PAGE_PRE_M3_MAX_LEN = 79 + HISTORY_PAGE_CAP * (1 + SHOT_RESULT_LEN);
export const WORK_KINDS_PER_SHOT = 3;
export const WORK_PAGE_CAP = HISTORY_PAGE_CAP * WORK_KINDS_PER_SHOT;
export const WORK_RECORD_LEN = 106;
export const WORK_PAGE_BASE_LEN = 79;
export const WORK_PAGE_MAX_LEN =
  WORK_PAGE_BASE_LEN + WORK_PAGE_CAP * WORK_RECORD_LEN;
export const RELOAD_HISTORY_PAGE_CAP = 32;
export const RELOAD_RECORD_LEN = 51;
// Unlike HistoryPage::BASE_LEN above, this constant names the full account
// prefix including Anchor's discriminator, matching the public wire ABI.
export const RELOAD_HISTORY_PAGE_BASE_LEN = 87;
export const RELOAD_HISTORY_PAGE_MAX_LEN =
  RELOAD_HISTORY_PAGE_BASE_LEN +
  RELOAD_HISTORY_PAGE_CAP * RELOAD_RECORD_LEN;
export const CORE_MIN_EXPONENT = -12;
export const CORE_MAX_EXPONENT = 2;
export const RCX_DECIMALS = 6;
export const RCX_RAW_UNITS_PER_CREDIT = 1_000_000n;
export const RCX_MINT =
  new PublicKey('FQb2EyaLZ9TWBemYmQ9zWtXcEwLiSXtz7j619ThQpump').toBuffer();
export const TOKEN_2022_PROGRAM =
  new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb').toBuffer();

// The deployed instruction and the frozen distribution architecture now share
// this exact 70/30 policy.
export const CURRENT_RELOAD_PARITY = Object.freeze({
  rustBurnBps: 7_000,
  rustPodiumBps: 3_000,
  finalBurnBps: 7_000,
  finalPodiumBps: 3_000,
  finalPodiumSeatBps: Object.freeze([5_000, 3_000, 2_000]),
  finalTeamBps: 0,
  finalSelfSeatRetained: true,
  finalMissingSeatsAndDustBurned: true,
  finalArchitectureCompatible: true,
});

export const TIMEPIN_SCHEMA_V2 = 2;
export const TIMEPIN_EVIDENCE_POLICY_CANONICAL_LEN = 134;
export const TIMEPIN_EVIDENCE_SPEC_CANONICAL_LEN = 214;
export const TIMEPIN_EVIDENCE_SPEC_ACCOUNT_LEN = 262;
// 8 + 160: the 124-byte header through candidate_b_hash, plus open_refs 4 and
// rent_payer 32. It read 276 for part of an afternoon, when the eleven obs_
// fields were still declared on the Need. They are gone: nothing ever wrote
// them, and the observation lives where it has always lived, in the CandidateV2
// account below.
export const TIMEPIN_NEED_ACCOUNT_LEN = 168;
// 8 + 143 since 2026-09-10: CandidateV2 gained rent_payer, a 32-byte field
// after `need`, so that the capture rent has an address to be returned to.
// Every offset below it moved by 32.
export const TIMEPIN_CANDIDATE_ACCOUNT_LEN = 151;
export const TIMEPIN_FULL_VERIFICATION = 1;

export const ENTRY_MODE = Object.freeze({
  OBSERVED_ENTRY: 1,
  FORWARD_ENTRY: 2,
});

export const WORK_KIND = Object.freeze({
  ACTIVATE_ENTRY: 3,
  RESOLVE_SHOT: 4,
  FORFEIT: 5,
});

export const RECEIPT_DISPOSITION = Object.freeze({
  PENDING: 0,
  PAYABLE: 1,
  NONPAYABLE: 2,
});

export const RELOAD_ACTION = Object.freeze({
  NONE: 0,
  BURN: 1,
  ROUTE: 2,
  RETAIN: 3,
});

export const SIDE = Object.freeze({ DOWN: 0, UP: 1 });

export const SHOT_STATE = Object.freeze({
  PENDING_ENTRY: 'PendingEntry',
  ACTIVE: 'Active',
  AWAITING_REVEAL: 'AwaitingReveal',
  AWAITING_VOID: 'AwaitVoid',
  REVEALED: 'Revealed',
  FORFEITED: 'Forfeited',
  VOID: 'Void',
});

export const TIMEPIN_STATE = Object.freeze({
  OPEN: 0,
  CANDIDATE: 1,
  FINAL: 2,
  AMBIGUOUS: 3,
  EXPIRED: 4,
});

export const VOID_REASON = Object.freeze({
  ENTRY_EXPIRED: 'VOID_ENTRY_EXPIRED',
  ENTRY_AMBIGUOUS: 'VOID_ENTRY_AMBIGUOUS',
  EXIT_EXPIRED: 'VOID_EXIT_EXPIRED',
  EXIT_AMBIGUOUS: 'VOID_EXIT_AMBIGUOUS',
  EQUALITY: 'VOID_EQUALITY',
  CONFIDENCE_BAND: 'VOID_CONFIDENCE_BAND',
});

const U64_MAX = (1n << 64n) - 1n;
const U128_MAX = (1n << 128n) - 1n;
const ZERO32 = Buffer.alloc(32);
const BRIER_SCALE = 100_000_000n;
const MAX_OPEN_POSITIONS = 64;
const MAX_BASE_XP = 1_000_000n;
const MAX_SETTLE_XP = 1_000_000n;
const ZERO_PUBKEY = Buffer.alloc(32);
const MIN_CLEANUP_BOND_LAMPORTS = 5_000n;
const MAX_CLEANUP_BOND_LAMPORTS = 1_000_000n;
const MAX_DELEGATE_LIFETIME_SECONDS = 30n * 86_400n;

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
const discriminator = name =>
  sha256(Buffer.from('account:' + name, 'utf8')).subarray(0, 8);

const ECONOMY_DISCRIMINATOR = discriminator('Economy');
const RULESET_DISCRIMINATOR = discriminator('Ruleset');
const EVIDENCE_SPEC_DISCRIMINATOR = discriminator('EvidenceSpecV2');
const NEED_DISCRIMINATOR = discriminator('TimepinNeedV2');
const CANDIDATE_DISCRIMINATOR = discriminator('CandidateV2');

const ECONOMY_HASH_DOMAIN = Buffer.from('rcx-core:economy:g2\0', 'utf8');
const RULESET_HASH_DOMAIN = Buffer.from('rcx-core:ruleset:g2\0', 'utf8');
const RULESET_POLICY_HASH_DOMAIN =
  Buffer.from('rcx-core:ruleset-policy:g2\0', 'utf8');
const RULESET_POLICY_NODE_DOMAIN =
  Buffer.from('rcx-core:ruleset-node:g2\0', 'utf8');
const COMMIT_HASH_DOMAIN = Buffer.from('rcx-core:commitment:g2\0', 'utf8');
const LEGACY_LEAF_HASH_DOMAIN =
  Buffer.from('rcx-core:legacy-leaf:g2\0', 'utf8');
const LEGACY_NODE_HASH_DOMAIN =
  Buffer.from('rcx-core:legacy-node:g2\0', 'utf8');
const RESOLUTION_HASH_DOMAIN = Buffer.from('rcx-core:result:g2\0', 'utf8');
// M3. Two domains, so a row hash can never be replayed as a chain hash.
// These must match state.rs HISTORY_ROW_DOMAIN / HISTORY_CHAIN_DOMAIN exactly:
// the whole point of the root is that an off-chain reader recomputes it.
const HISTORY_ROW_DOMAIN = Buffer.from('rcx-core:history-row:g2\0', 'utf8');
const HISTORY_CHAIN_DOMAIN =
  Buffer.from('rcx-core:history-chain:g2\0', 'utf8');
const TERMINAL_HASH_DOMAIN = Buffer.from('rcx-core:terminal:g2\0', 'utf8');
const GAME_RESULT_HASH_DOMAIN =
  Buffer.from('rcx-core:game-result:g2\0', 'utf8');
const COMPLETION_RESULT_HASH_DOMAIN =
  Buffer.from('rcx-core:completion-result:g2\0', 'utf8');
const RANK_SHARD_FOR_DOMAIN =
  Buffer.from('rcx-core:rank-shard-for:g2\0', 'utf8');
const TIMEPIN_MESSAGE_HASH_DOMAIN =
  Buffer.from('rcx-timepin:pyth-price-message:v2\0', 'utf8');
const TIMEPIN_POLICY_HASH_DOMAIN =
  Buffer.from('rcx-timepin:evidence-policy:v2\0', 'utf8');
const TIMEPIN_SPEC_HASH_DOMAIN =
  Buffer.from('rcx-timepin:evidence-spec:v2-generation\0', 'utf8');
const TIMEPIN_SET_HASH_DOMAIN =
  Buffer.from('rcx-timepin:evidence-set:v2\0', 'utf8');
const TIMEPIN_EXPIRED_HASH_DOMAIN =
  Buffer.from('rcx-timepin:expired:v2\0', 'utf8');

export class CoreG2Error extends Error {
  constructor(code, detail = '') {
    super(detail ? code + ': ' + detail : code);
    this.code = code;
    this.detail = detail;
  }
}

const fail = (code, detail = '') => { throw new CoreG2Error(code, detail); };

const integer = (value, name) => {
  if (typeof value === 'bigint') return value;
  if (!Number.isSafeInteger(value)) fail('BAD_INTEGER', name);
  return BigInt(value);
};

const uint = (value, bits, name) => {
  const n = integer(value, name);
  const max = (1n << BigInt(bits)) - 1n;
  if (n < 0n || n > max) fail('INTEGER_OUT_OF_RANGE', name);
  return n;
};

const sint = (value, bits, name) => {
  const n = integer(value, name);
  const edge = 1n << BigInt(bits - 1);
  if (n < -edge || n >= edge) fail('INTEGER_OUT_OF_RANGE', name);
  return n;
};

const numberUint = (value, bits, name) => {
  const n = uint(value, bits, name);
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) fail('UNSAFE_NUMBER', name);
  return Number(n);
};

const bytes = (value, length, name) => {
  let out;
  try { out = Buffer.from(value || []); } catch { fail('BAD_BYTES', name); }
  if (out.length !== length) fail('BAD_BYTES_LENGTH', name);
  return out;
};

const bytes32 = (value, name) => bytes(value, 32, name);
const nonzero32 = (value, name) => {
  const out = bytes32(value, name);
  if (out.equals(ZERO32)) fail('ZERO_IDENTITY', name);
  return out;
};
const same = (left, right) => Buffer.from(left).equals(Buffer.from(right));
const keyHex = value => bytes32(value, 'key').toString('hex');
const publicKey = (value, name) => new PublicKey(bytes32(value, name));

const u8 = (value, name) => {
  const out = Buffer.alloc(1);
  out.writeUInt8(numberUint(value, 8, name));
  return out;
};
const i8 = (value, name) => {
  const out = Buffer.alloc(1);
  out.writeInt8(Number(sint(value, 8, name)));
  return out;
};
const u16 = (value, name) => {
  const out = Buffer.alloc(2);
  out.writeUInt16LE(numberUint(value, 16, name));
  return out;
};
const u32 = (value, name) => {
  const out = Buffer.alloc(4);
  out.writeUInt32LE(numberUint(value, 32, name));
  return out;
};
const i32 = (value, name) => {
  const out = Buffer.alloc(4);
  out.writeInt32LE(Number(sint(value, 32, name)));
  return out;
};
const u64 = (value, name) => {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(uint(value, 64, name));
  return out;
};
const i64 = (value, name) => {
  const out = Buffer.alloc(8);
  out.writeBigInt64LE(sint(value, 64, name));
  return out;
};

const addU64 = (left, right, name) => {
  const out = uint(left, 64, name) + uint(right, 64, name);
  if (out > U64_MAX) fail('U64_OVERFLOW', name);
  return out;
};
const addU32 = (left, right, name) => {
  const out = uint(left, 32, name) + uint(right, 32, name);
  if (out > 0xffff_ffffn) fail('U32_OVERFLOW', name);
  return out;
};
const subU64 = (left, right, code) => {
  const a = uint(left, 64, code);
  const b = uint(right, 64, code);
  if (b > a) fail(code);
  return a - b;
};
const addU128 = (left, right, name) => {
  const out = uint(left, 128, name) + uint(right, 128, name);
  if (out > U128_MAX) fail('U128_OVERFLOW', name);
  return out;
};

const clone = value => {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array)
    return Buffer.from(value);
  if (value instanceof Map)
    return new Map(Array.from(value, ([k, v]) => [k, clone(v)]));
  if (value instanceof Set) return new Set(Array.from(value, clone));
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)]));
  return value;
};

const checkedTimestampAdd = (left, right, name) => {
  const out = sint(left, 64, name) + sint(right, 64, name);
  sint(out, 64, name);
  return out;
};

const PDA_CACHE = new Map();
const derivePda = (programId, seeds) => {
  const program = bytes32(programId, 'programId');
  const seedBuffers = seeds.map(seed => Buffer.from(seed));
  const cacheKey = program.toString('hex') + ':' +
    seedBuffers.map(seed => seed.length + ':' + seed.toString('hex')).join(':');
  const cached = PDA_CACHE.get(cacheKey);
  if (cached) return { key: Buffer.from(cached.key), bump: cached.bump };
  const [key, bump] = PublicKey.findProgramAddressSync(
    seedBuffers,
    publicKey(program, 'programId'),
  );
  const result = { key: key.toBuffer(), bump };
  PDA_CACHE.set(cacheKey, result);
  return { key: Buffer.from(result.key), bump: result.bump };
};

export const deriveEconomyPda = (programId, hash) => derivePda(programId, [
  Buffer.from('economy'), u16(CORE_G2_SCHEMA, 'schema'),
  bytes32(hash, 'economyHash'),
]);
export const deriveRulesetPda = (programId, hash) => derivePda(programId, [
  Buffer.from('ruleset'), u16(CORE_G2_SCHEMA, 'schema'),
  bytes32(hash, 'rulesetHash'),
]);
export const deriveLedgerPda = (programId, economyHashValue, player) =>
  derivePda(programId, [
    Buffer.from('ledger'), bytes32(economyHashValue, 'economyHash'),
    bytes32(player, 'player'),
  ]);
export const deriveShotPda = (programId, economyHashValue, player, nonce) =>
  derivePda(programId, [
    Buffer.from('shot'), bytes32(economyHashValue, 'economyHash'),
    bytes32(player, 'player'), u64(nonce, 'nonce'),
  ]);
// Bits set in a 16-bit mask. Number of terminal rows folded into the root.
export const popcount16 = mask => {
  let value = numberUint(mask, 16, 'terminalMask');
  let count = 0;
  while (value) { value &= value - 1; count += 1; }
  return count;
};

export const historyPageIndex = nonce =>
  uint(nonce, 64, 'nonce') / BigInt(HISTORY_PAGE_CAP);
export const historyPageSlot = nonce =>
  Number(uint(nonce, 64, 'nonce') % BigInt(HISTORY_PAGE_CAP));
export const deriveHistoryPagePda = (
  programId, economyHashValue, player, pageIndex,
) => derivePda(programId, [
  Buffer.from('history_page'), bytes32(economyHashValue, 'economyHash'),
  bytes32(player, 'player'), u64(pageIndex, 'pageIndex'),
]);
export const deriveWorkPagePda = (
  programId, economyHashValue, player, pageIndex,
) => derivePda(programId, [
  Buffer.from('work_page'), bytes32(economyHashValue, 'economyHash'),
  bytes32(player, 'player'), u64(pageIndex, 'pageIndex'),
]);
export const reloadHistoryPageIndex = nonce =>
  uint(nonce, 64, 'nonce') / BigInt(RELOAD_HISTORY_PAGE_CAP);
export const reloadHistoryPageSlot = nonce =>
  Number(uint(nonce, 64, 'nonce') % BigInt(RELOAD_HISTORY_PAGE_CAP));
export const deriveReloadHistoryPagePda = (
  programId, economyHashValue, player, pageIndex,
) => derivePda(programId, [
  Buffer.from('reload_history_page'),
  bytes32(economyHashValue, 'economyHash'),
  bytes32(player, 'player'), u64(pageIndex, 'pageIndex'),
]);
export const deriveTimepinEvidenceSpecPda = (
  programId, evidenceSpecHash,
) => derivePda(programId, [
  Buffer.from('evidence_spec'), u16(TIMEPIN_SCHEMA_V2, 'timepinSchema'),
  bytes32(evidenceSpecHash, 'evidenceSpecHash'),
]);
const deriveTimepinNeedPda = (programId, evidenceSpecHash, targetTs) =>
  derivePda(programId, [
    Buffer.from('need'), u16(TIMEPIN_SCHEMA_V2, 'timepinSchema'),
    bytes32(evidenceSpecHash, 'evidenceSpecHash'), i64(targetTs, 'targetTs'),
  ]);
const deriveTimepinCandidatePda = (programId, need, messageHash) =>
  derivePda(programId, [
    Buffer.from('candidate'), bytes32(need, 'need'),
    bytes32(messageHash, 'messageHash'),
  ]);

export function validateEconomySpec(spec) {
  if (!spec || spec.schema !== CORE_G2_SCHEMA) fail('BAD_ECONOMY_SCHEMA');
  nonzero32(spec.timepinProgram, 'timepinProgram');
  if (numberUint(spec.timepinSchema, 16, 'timepinSchema') !== TIMEPIN_SCHEMA_V2)
    fail('BAD_TIMEPIN_SCHEMA');
  nonzero32(spec.clusterGenesisHash, 'clusterGenesisHash');
  nonzero32(spec.migrationId, 'migrationId');
  const root = bytes32(spec.legacyRoot, 'legacyRoot');
  const snapshot = bytes32(spec.legacySnapshotHash, 'legacySnapshotHash');
  const cutover = uint(spec.legacyCutoverSlot, 64, 'legacyCutoverSlot');
  const leaves = numberUint(spec.legacyLeafCount, 32, 'legacyLeafCount');
  const legacyCredits = uint(spec.legacyTotalCredits, 64, 'legacyTotalCredits');
  const legacyXp = uint(spec.legacyTotalXp, 64, 'legacyTotalXp');
  if (root.equals(ZERO32)) {
    if (!snapshot.equals(ZERO32) || cutover !== 0n || leaves !== 0 ||
        legacyCredits !== 0n || legacyXp !== 0n) fail('BAD_LEGACY_SNAPSHOT');
  } else if (snapshot.equals(ZERO32) || cutover === 0n || leaves === 0 ||
             (legacyCredits === 0n && legacyXp === 0n)) {
    fail('BAD_LEGACY_SNAPSHOT');
  }
  nonzero32(spec.rulesetPolicyRoot, 'rulesetPolicyRoot');
  if (!numberUint(spec.rulesetPolicyCount, 16, 'rulesetPolicyCount'))
    fail('EMPTY_RULESET_POLICY');
  if (!same(bytes32(spec.rcxMint, 'rcxMint'), RCX_MINT) ||
      !same(bytes32(spec.rcxTokenProgram, 'rcxTokenProgram'),
        TOKEN_2022_PROGRAM) ||
      numberUint(spec.rcxDecimals, 8, 'rcxDecimals') !== RCX_DECIMALS ||
      uint(spec.rawUnitsPerCredit, 64, 'rawUnitsPerCredit') !==
        RCX_RAW_UNITS_PER_CREDIT)
    fail('WRONG_FROZEN_RCX_POLICY');
  const podiumCurve = Array.from(spec.podiumCurve || []);
  if (numberUint(spec.burnPerMille, 16, 'burnPerMille') !== 700 ||
      numberUint(spec.podiumPerMille, 16, 'podiumPerMille') !== 300 ||
      podiumCurve.length !== 3 ||
      podiumCurve.some((value, index) =>
        numberUint(value, 16, 'podiumCurve') !== [500, 300, 200][index]) ||
      numberUint(spec.rankShardCount, 8, 'rankShardCount') !== 16 ||
      numberUint(spec.daySeconds, 32, 'daySeconds') !== 86_400)
    fail('WRONG_FROZEN_RANKING_POLICY');
  const num = uint(spec.hitPayoutNumerator, 64, 'hitPayoutNumerator');
  const den = uint(spec.hitPayoutDenominator, 64, 'hitPayoutDenominator');
  if (num === 0n || den === 0n || num > den * 10n) fail('BAD_PAYOUT_RATIO');
  const minStake = uint(spec.minStake, 64, 'minStake');
  const maxStake = uint(spec.maxStake, 64, 'maxStake');
  if (minStake === 0n || maxStake < minStake ||
      maxStake * num / den > U64_MAX) fail('BAD_STAKE_RANGE');
  if (uint(spec.settleXp, 64, 'settleXp') > MAX_SETTLE_XP)
    fail('BAD_SETTLE_XP');
  const maxOpen = numberUint(spec.maxOpen, 16, 'maxOpen');
  if (!maxOpen || maxOpen > MAX_OPEN_POSITIONS) fail('BAD_MAX_OPEN');
  const cleanupBond = uint(
    spec.cleanupBondLamports, 64, 'cleanupBondLamports',
  );
  if (cleanupBond < MIN_CLEANUP_BOND_LAMPORTS ||
      cleanupBond > MAX_CLEANUP_BOND_LAMPORTS)
    fail('BAD_CLEANUP_BOND');
  const reveal = numberUint(spec.revealWindowSeconds, 32, 'revealWindowSeconds');
  if (!reveal || reveal > 86_400) fail('BAD_REVEAL_WINDOW');
  if (!numberUint(spec.maxHorizonSeconds, 32, 'maxHorizonSeconds'))
    fail('BAD_MAX_HORIZON');
  return true;
}

export function encodeEconomy(spec) {
  validateEconomySpec(spec);
  const out = Buffer.concat([
    u16(spec.schema, 'schema'), bytes32(spec.timepinProgram, 'timepinProgram'),
    u16(spec.timepinSchema, 'timepinSchema'),
    bytes32(spec.clusterGenesisHash, 'clusterGenesisHash'),
    bytes32(spec.migrationId, 'migrationId'),
    bytes32(spec.legacyRoot, 'legacyRoot'),
    bytes32(spec.legacySnapshotHash, 'legacySnapshotHash'),
    u64(spec.legacyCutoverSlot, 'legacyCutoverSlot'),
    u32(spec.legacyLeafCount, 'legacyLeafCount'),
    u64(spec.legacyTotalCredits, 'legacyTotalCredits'),
    u64(spec.legacyTotalXp, 'legacyTotalXp'),
    bytes32(spec.rulesetPolicyRoot, 'rulesetPolicyRoot'),
    u16(spec.rulesetPolicyCount, 'rulesetPolicyCount'),
    bytes32(spec.rcxMint, 'rcxMint'),
    bytes32(spec.rcxTokenProgram, 'rcxTokenProgram'),
    u8(spec.rcxDecimals, 'rcxDecimals'),
    u64(spec.rawUnitsPerCredit, 'rawUnitsPerCredit'),
    u16(spec.burnPerMille, 'burnPerMille'),
    u16(spec.podiumPerMille, 'podiumPerMille'),
    ...spec.podiumCurve.map((value, index) =>
      u16(value, 'podiumCurve[' + index + ']')),
    u8(spec.rankShardCount, 'rankShardCount'),
    u32(spec.daySeconds, 'daySeconds'),
    u64(spec.hitPayoutNumerator, 'hitPayoutNumerator'),
    u64(spec.hitPayoutDenominator, 'hitPayoutDenominator'),
    u64(spec.settleXp, 'settleXp'), u64(spec.minStake, 'minStake'),
    u64(spec.maxStake, 'maxStake'), u16(spec.maxOpen, 'maxOpen'),
    u64(spec.cleanupBondLamports, 'cleanupBondLamports'),
    u32(spec.revealWindowSeconds, 'revealWindowSeconds'),
    u32(spec.maxHorizonSeconds, 'maxHorizonSeconds'),
  ]);
  if (out.length !== ECONOMY_CANONICAL_LEN) fail('BAD_ECONOMY_LENGTH');
  return out;
}

export const economyHash = spec =>
  sha256(Buffer.concat([ECONOMY_HASH_DOMAIN, encodeEconomy(spec)]));

export function validateRulesetPolicy(spec, economy) {
  if (!spec || spec.schema !== CORE_G2_SCHEMA) fail('BAD_RULESET_SCHEMA');
  nonzero32(spec.evidenceSpecHash, 'evidenceSpecHash');
  nonzero32(spec.evidencePolicyHash, 'evidencePolicyHash');
  nonzero32(spec.feedId, 'feedId');
  const mode = numberUint(spec.entryMode, 8, 'entryMode');
  if (mode !== ENTRY_MODE.OBSERVED_ENTRY && mode !== ENTRY_MODE.FORWARD_ENTRY)
    fail('BAD_ENTRY_MODE');
  const horizon = numberUint(spec.horizonSeconds, 32, 'horizonSeconds');
  const grid = numberUint(spec.targetGridSeconds, 32, 'targetGridSeconds');
  const lead = numberUint(spec.minOpenLeadSeconds, 32, 'minOpenLeadSeconds');
  const maxAge = numberUint(spec.maxEntryAgeSeconds, 32, 'maxEntryAgeSeconds');
  if (!horizon || horizon > Number(economy.maxHorizonSeconds) ||
      !grid || grid > 86_400 || lead < 30 || lead > horizon)
    fail('BAD_TARGET_POLICY');
  if (mode === ENTRY_MODE.FORWARD_ENTRY &&
      (horizon % grid !== 0 || maxAge !== 0)) fail('BAD_FORWARD_POLICY');
  if (mode === ENTRY_MODE.OBSERVED_ENTRY && maxAge === 0)
    fail('BAD_OBSERVED_POLICY');
  const bandNum = numberUint(spec.bandNumerator, 32, 'bandNumerator');
  const bandDen = numberUint(spec.bandDenominator, 32, 'bandDenominator');
  if (!bandDen || bandNum > 1_000_000) fail('BAD_BAND');
  const baseXp = uint(spec.baseXp, 64, 'baseXp');
  if (!baseXp || baseXp > MAX_BASE_XP) fail('BAD_BASE_XP');
  return true;
}

export function validateRulesetSpec(spec, economy) {
  validateRulesetPolicy(spec, economy);
  if (!same(bytes32(spec.economyHash, 'economyHash'), economyHash(economy)))
    fail('WRONG_ECONOMY_HASH');
  return true;
}

export function encodeRulesetPolicy(spec, economy) {
  validateRulesetPolicy(spec, economy);
  const out = Buffer.concat([
    u16(spec.schema, 'schema'),
    // Economy identity and the exact Timepin generation are intentionally
    // excluded. This generation-independent policy hash remains bound.
    bytes32(spec.evidencePolicyHash, 'evidencePolicyHash'),
    bytes32(spec.feedId, 'feedId'), u8(spec.entryMode, 'entryMode'),
    u32(spec.horizonSeconds, 'horizonSeconds'),
    u32(spec.targetGridSeconds, 'targetGridSeconds'),
    u32(spec.minOpenLeadSeconds, 'minOpenLeadSeconds'),
    u32(spec.maxEntryAgeSeconds, 'maxEntryAgeSeconds'),
    u32(spec.bandNumerator, 'bandNumerator'),
    u32(spec.bandDenominator, 'bandDenominator'),
    u64(spec.baseXp, 'baseXp'),
  ]);
  if (out.length !== RULESET_POLICY_CANONICAL_LEN)
    fail('BAD_RULESET_POLICY_LENGTH');
  return out;
}

export const rulesetPolicyHash = (spec, economy) =>
  sha256(Buffer.concat([
    RULESET_POLICY_HASH_DOMAIN, encodeRulesetPolicy(spec, economy),
  ]));

export function rulesetPolicyMerkleParent(left, right) {
  const a = bytes32(left, 'left');
  const b = bytes32(right, 'right');
  const ordered = Buffer.compare(a, b) <= 0 ? [a, b] : [b, a];
  return sha256(Buffer.concat([RULESET_POLICY_NODE_DOMAIN, ...ordered]));
}

export function verifyRulesetPolicyProof(leaf, proof, root) {
  let current = bytes32(leaf, 'leaf');
  if (!Array.isArray(proof) || proof.length > 32)
    fail('BAD_RULESET_POLICY_PROOF');
  for (const sibling of proof)
    current = rulesetPolicyMerkleParent(current, sibling);
  return current.equals(bytes32(root, 'rulesetPolicyRoot'));
}

export function encodeRuleset(spec, economy) {
  validateRulesetSpec(spec, economy);
  const out = Buffer.concat([
    u16(spec.schema, 'schema'), bytes32(spec.economyHash, 'economyHash'),
    bytes32(spec.evidenceSpecHash, 'evidenceSpecHash'),
    bytes32(spec.evidencePolicyHash, 'evidencePolicyHash'),
    bytes32(spec.feedId, 'feedId'), u8(spec.entryMode, 'entryMode'),
    u32(spec.horizonSeconds, 'horizonSeconds'),
    u32(spec.targetGridSeconds, 'targetGridSeconds'),
    u32(spec.minOpenLeadSeconds, 'minOpenLeadSeconds'),
    u32(spec.maxEntryAgeSeconds, 'maxEntryAgeSeconds'),
    u32(spec.bandNumerator, 'bandNumerator'),
    u32(spec.bandDenominator, 'bandDenominator'), u64(spec.baseXp, 'baseXp'),
  ]);
  if (out.length !== RULESET_CANONICAL_LEN) fail('BAD_RULESET_LENGTH');
  return out;
}

export const rulesetHash = (spec, economy) =>
  sha256(Buffer.concat([RULESET_HASH_DOMAIN, encodeRuleset(spec, economy)]));

const contentAccount = (programId, type, hash, disc, canonical) => {
  const pda = type === 'economy'
    ? deriveEconomyPda(programId, hash) : deriveRulesetPda(programId, hash);
  return {
    key: pda.key,
    owner: bytes32(programId, 'programId'),
    executable: false,
    bump: pda.bump,
    data: Buffer.concat([
      disc, u16(CORE_G2_SCHEMA, 'schema'), u8(pda.bump, 'bump'),
      bytes32(hash, 'hash'), canonical,
    ]),
  };
};

export const makeEconomyAccount = (programId, spec) => {
  const canonical = encodeEconomy(spec);
  return contentAccount(
    programId, 'economy', economyHash(spec), ECONOMY_DISCRIMINATOR, canonical,
  );
};

export const makeRulesetAccount = (programId, spec, economy) => {
  const canonical = encodeRuleset(spec, economy);
  return contentAccount(
    programId, 'ruleset', rulesetHash(spec, economy),
    RULESET_DISCRIMINATOR, canonical,
  );
};

const authenticateContentAccount = ({
  programId, account, expectedHash, expectedData, expectedDisc,
  expectedLength, type, code,
}) => {
  if (!account || account.executable === true) fail(code + '_EXECUTABLE');
  if (!same(bytes32(account.owner, 'account.owner'), programId))
    fail(code + '_OWNER');
  const data = Buffer.from(account.data || []);
  if (data.length !== expectedLength) fail(code + '_LENGTH');
  if (!data.subarray(0, 8).equals(expectedDisc)) fail(code + '_DISCRIMINATOR');
  if (data.readUInt16LE(8) !== CORE_G2_SCHEMA) fail(code + '_SCHEMA');
  if (!data.subarray(11, 43).equals(expectedHash) ||
      !data.subarray(43).equals(expectedData)) fail(code + '_BYTES');
  const pda = type === 'economy'
    ? deriveEconomyPda(programId, expectedHash)
    : deriveRulesetPda(programId, expectedHash);
  if (!same(bytes32(account.key, 'account.key'), pda.key)) fail(code + '_PDA');
  if (data.readUInt8(10) !== pda.bump ||
      (account.bump !== undefined && account.bump !== pda.bump))
    fail(code + '_BUMP');
  return true;
};

export function legacyLeafHash({
  programId, clusterGenesisHash, migrationId, snapshotHash, cutoverSlot,
  player, credits, xp,
}) {
  return sha256(Buffer.concat([
    LEGACY_LEAF_HASH_DOMAIN, bytes32(programId, 'programId'),
    u16(CORE_G2_SCHEMA, 'schema'),
    bytes32(clusterGenesisHash, 'clusterGenesisHash'),
    bytes32(migrationId, 'migrationId'),
    bytes32(snapshotHash, 'snapshotHash'),
    u64(cutoverSlot, 'cutoverSlot'), bytes32(player, 'player'),
    u64(credits, 'credits'), u64(xp, 'xp'),
  ]));
}

export function legacyMerkleParent(left, right) {
  const a = bytes32(left, 'left');
  const b = bytes32(right, 'right');
  const ordered = Buffer.compare(a, b) <= 0 ? [a, b] : [b, a];
  return sha256(Buffer.concat([LEGACY_NODE_HASH_DOMAIN, ...ordered]));
}

export function verifyLegacyProof(leaf, proof, root) {
  let current = bytes32(leaf, 'leaf');
  if (!Array.isArray(proof) || proof.length > 32) fail('BAD_MERKLE_PROOF');
  for (const sibling of proof) current = legacyMerkleParent(current, sibling);
  return current.equals(bytes32(root, 'root'));
}

export function commitmentHash({
  programId, economyHash: economyHashValue, rulesetHash: rulesetHashValue,
  player, nonce, side, probability, salt,
}) {
  const sideValue = numberUint(side, 8, 'side');
  if (sideValue !== SIDE.DOWN && sideValue !== SIDE.UP) fail('BAD_SIDE');
  return sha256(Buffer.concat([
    COMMIT_HASH_DOMAIN, bytes32(programId, 'programId'),
    bytes32(economyHashValue, 'economyHash'),
    bytes32(rulesetHashValue, 'rulesetHash'), bytes32(player, 'player'),
    u64(nonce, 'nonce'), u8(sideValue, 'side'),
    u16(probability, 'probability'), bytes32(salt, 'salt'),
  ]));
}

export function alignFutureTarget(nowTs, leadSeconds, gridSeconds) {
  const earliest = checkedTimestampAdd(nowTs, leadSeconds, 'target');
  const grid = uint(gridSeconds, 32, 'gridSeconds');
  if (earliest < 0n || grid === 0n) fail('TIMESTAMP_OVERFLOW');
  const target = ((earliest + grid - 1n) / grid) * grid;
  sint(target, 64, 'target');
  return target;
}

export function encodeTimepinEvidencePolicy(spec) {
  if (!spec || numberUint(spec.schema, 16, 'spec.schema') !==
      TIMEPIN_SCHEMA_V2) fail('TIMEPIN_SPEC_SCHEMA');
  // Adapter 1 = strict bracket (experimental from 2026-09-05); adapter 2 =
  // MIN-CAPTURE, the mainnet-class rule. Mirrors foreign_timepin.rs.
  const adapter = numberUint(spec.adapter, 8, 'spec.adapter');
  if (adapter !== 1 && adapter !== 2)
    fail('TIMEPIN_SPEC_ADAPTER');
  nonzero32(spec.receiverProgram, 'spec.receiverProgram');
  nonzero32(spec.pushOracleProgram, 'spec.pushOracleProgram');
  nonzero32(spec.feedId, 'spec.feedId');
  if (numberUint(
    spec.requiredVerification, 8, 'spec.requiredVerification',
  ) !== TIMEPIN_FULL_VERIFICATION) fail('TIMEPIN_SPEC_VERIFICATION');
  const grid = numberUint(
    spec.targetGridSeconds, 32, 'spec.targetGridSeconds',
  );
  const lead = numberUint(
    spec.minOpenLeadSeconds, 32, 'spec.minOpenLeadSeconds',
  );
  const ahead = numberUint(
    spec.maxTargetAheadSeconds, 32, 'spec.maxTargetAheadSeconds',
  );
  const preGap = numberUint(
    spec.maxPreTargetGapSeconds, 32, 'spec.maxPreTargetGapSeconds',
  );
  const postLag = numberUint(
    spec.maxPostTargetLagSeconds, 32, 'spec.maxPostTargetLagSeconds',
  );
  const grace = numberUint(
    spec.captureGraceSeconds, 32, 'spec.captureGraceSeconds',
  );
  if (!grid || !lead || ahead < lead || !preGap || !postLag || !grace)
    fail('TIMEPIN_SPEC_TIMING');
  const minExponent = Number(sint(
    spec.minExponent, 8, 'spec.minExponent',
  ));
  const maxExponent = Number(sint(
    spec.maxExponent, 8, 'spec.maxExponent',
  ));
  if (minExponent > maxExponent) fail('TIMEPIN_SPEC_EXPONENT');
  if (numberUint(
    spec.maxConfidenceBps, 32, 'spec.maxConfidenceBps',
  ) > 10_000) fail('TIMEPIN_SPEC_CONFIDENCE');
  const out = Buffer.concat([
    u16(spec.schema, 'spec.schema'), u8(spec.adapter, 'spec.adapter'),
    bytes32(spec.receiverProgram, 'spec.receiverProgram'),
    bytes32(spec.pushOracleProgram, 'spec.pushOracleProgram'),
    u16(spec.shardId, 'spec.shardId'), bytes32(spec.feedId, 'spec.feedId'),
    u8(spec.requiredVerification, 'spec.requiredVerification'),
    u32(grid, 'spec.targetGridSeconds'),
    u32(lead, 'spec.minOpenLeadSeconds'),
    u32(ahead, 'spec.maxTargetAheadSeconds'),
    u32(preGap, 'spec.maxPreTargetGapSeconds'),
    u32(postLag, 'spec.maxPostTargetLagSeconds'),
    u32(grace, 'spec.captureGraceSeconds'),
    u16(spec.maxFutureSkewSeconds, 'spec.maxFutureSkewSeconds'),
    i8(minExponent, 'spec.minExponent'), i8(maxExponent, 'spec.maxExponent'),
    u32(spec.maxConfidenceBps, 'spec.maxConfidenceBps'),
  ]);
  if (out.length !== TIMEPIN_EVIDENCE_POLICY_CANONICAL_LEN)
    fail('TIMEPIN_SPEC_POLICY_LENGTH');
  return out;
}

export const timepinEvidencePolicyHash = spec => sha256(Buffer.concat([
  TIMEPIN_POLICY_HASH_DOMAIN, encodeTimepinEvidencePolicy(spec),
]));

export function encodeTimepinEvidenceSpec(spec) {
  const receiverSlot = uint(
    spec.receiverProgramdataSlot, 64, 'spec.receiverProgramdataSlot',
  );
  const wormholeSlot = uint(
    spec.wormholeProgramdataSlot, 64, 'spec.wormholeProgramdataSlot',
  );
  if (!receiverSlot || !wormholeSlot) fail('TIMEPIN_SPEC_GENERATION');
  nonzero32(spec.receiverConfigHash, 'spec.receiverConfigHash');
  nonzero32(spec.wormholeProgram, 'spec.wormholeProgram');
  const out = Buffer.concat([
    encodeTimepinEvidencePolicy(spec),
    u64(receiverSlot, 'spec.receiverProgramdataSlot'),
    bytes32(spec.receiverConfigHash, 'spec.receiverConfigHash'),
    bytes32(spec.wormholeProgram, 'spec.wormholeProgram'),
    u64(wormholeSlot, 'spec.wormholeProgramdataSlot'),
  ]);
  if (out.length !== TIMEPIN_EVIDENCE_SPEC_CANONICAL_LEN)
    fail('TIMEPIN_SPEC_CANONICAL_LENGTH');
  return out;
}

export const timepinEvidenceSpecHash = spec => sha256(Buffer.concat([
  TIMEPIN_SPEC_HASH_DOMAIN, encodeTimepinEvidenceSpec(spec),
]));

export function makeTimepinEvidenceSpecAccount(timepinProgram, spec) {
  const policyHash = timepinEvidencePolicyHash(spec);
  const exactHash = timepinEvidenceSpecHash(spec);
  const registeredSlot = uint(spec.registeredSlot, 64, 'spec.registeredSlot');
  if (registeredSlot <= uint(
    spec.receiverProgramdataSlot, 64, 'spec.receiverProgramdataSlot',
  ) || registeredSlot <= uint(
    spec.wormholeProgramdataSlot, 64, 'spec.wormholeProgramdataSlot',
  )) fail('TIMEPIN_SPEC_REGISTERED_SLOT');
  const canonical = encodeTimepinEvidenceSpec(spec);
  const pda = deriveTimepinEvidenceSpecPda(timepinProgram, exactHash);
  const data = Buffer.concat([
    EVIDENCE_SPEC_DISCRIMINATOR,
    canonical.subarray(0, TIMEPIN_EVIDENCE_POLICY_CANONICAL_LEN),
    policyHash,
    canonical.subarray(TIMEPIN_EVIDENCE_POLICY_CANONICAL_LEN),
    u64(registeredSlot, 'spec.registeredSlot'),
  ]);
  if (data.length !== TIMEPIN_EVIDENCE_SPEC_ACCOUNT_LEN)
    fail('TIMEPIN_SPEC_ACCOUNT_LENGTH');
  return {
    key: pda.key,
    owner: bytes32(timepinProgram, 'timepinProgram'),
    executable: false,
    data,
  };
}

export function authenticateTimepinEvidenceSpec({
  account, timepinProgram, evidenceSpecHash,
}) {
  const data = rawAccountData(
    account, timepinProgram, TIMEPIN_EVIDENCE_SPEC_ACCOUNT_LEN,
    EVIDENCE_SPEC_DISCRIMINATOR, 'TIMEPIN_SPEC',
  );
  const spec = {
    schema: data.readUInt16LE(8),
    adapter: data.readUInt8(10),
    receiverProgram: data.subarray(11, 43),
    pushOracleProgram: data.subarray(43, 75),
    shardId: data.readUInt16LE(75),
    feedId: data.subarray(77, 109),
    requiredVerification: data.readUInt8(109),
    targetGridSeconds: data.readUInt32LE(110),
    minOpenLeadSeconds: data.readUInt32LE(114),
    maxTargetAheadSeconds: data.readUInt32LE(118),
    maxPreTargetGapSeconds: data.readUInt32LE(122),
    maxPostTargetLagSeconds: data.readUInt32LE(126),
    captureGraceSeconds: data.readUInt32LE(130),
    maxFutureSkewSeconds: data.readUInt16LE(134),
    minExponent: data.readInt8(136),
    maxExponent: data.readInt8(137),
    maxConfidenceBps: data.readUInt32LE(138),
    evidencePolicyHash: data.subarray(142, 174),
    receiverProgramdataSlot: data.readBigUInt64LE(174),
    receiverConfigHash: data.subarray(182, 214),
    wormholeProgram: data.subarray(214, 246),
    wormholeProgramdataSlot: data.readBigUInt64LE(246),
    registeredSlot: data.readBigUInt64LE(254),
  };
  const expectedExact = bytes32(evidenceSpecHash, 'evidenceSpecHash');
  if (!same(timepinEvidencePolicyHash(spec), spec.evidencePolicyHash))
    fail('TIMEPIN_SPEC_POLICY_HASH');
  if (!same(timepinEvidenceSpecHash(spec), expectedExact))
    fail('TIMEPIN_SPEC_HASH');
  if (spec.registeredSlot <= spec.receiverProgramdataSlot ||
      spec.registeredSlot <= spec.wormholeProgramdataSlot)
    fail('TIMEPIN_SPEC_REGISTERED_SLOT');
  const pda = deriveTimepinEvidenceSpecPda(timepinProgram, expectedExact);
  if (!same(account.key, pda.key)) fail('TIMEPIN_SPEC_PDA');
  return spec;
}

const requireTimepinSpecRulesetMatch = (spec, rules) => {
  if (!same(spec.evidencePolicyHash, rules.evidencePolicyHash) ||
      !same(spec.feedId, rules.feedId) ||
      spec.targetGridSeconds !== rules.targetGridSeconds ||
      spec.minOpenLeadSeconds !== rules.minOpenLeadSeconds ||
      spec.requiredVerification !== TIMEPIN_FULL_VERIFICATION ||
      spec.minExponent < CORE_MIN_EXPONENT ||
      spec.maxExponent > CORE_MAX_EXPONENT)
    fail('RULESET_SPEC_MISMATCH');
  const extraLead = rules.entryMode === ENTRY_MODE.FORWARD_ENTRY
    ? rules.minOpenLeadSeconds : 0;
  const requiredAhead = rules.horizonSeconds +
    (rules.targetGridSeconds - 1) + extraLead;
  if (spec.maxTargetAheadSeconds < requiredAhead)
    fail('RULESET_SPEC_MISMATCH');
  return true;
};

const rawAccountData = (account, owner, expectedLength, expectedDisc, code) => {
  if (!account || account.executable === true) fail(code + '_EXECUTABLE');
  if (!same(bytes32(account.owner, code + '.owner'), owner)) fail(code + '_OWNER');
  const data = Buffer.from(account.data || []);
  if (data.length !== expectedLength) fail(code + '_LENGTH');
  if (!data.subarray(0, 8).equals(expectedDisc)) fail(code + '_DISCRIMINATOR');
  bytes32(account.key, code + '.key');
  return data;
};

const needShapeIsCanonical = need => {
  const aZero = need.candidateAHash.equals(ZERO32);
  const bZero = need.candidateBHash.equals(ZERO32);
  if (need.state === TIMEPIN_STATE.OPEN || need.state === TIMEPIN_STATE.EXPIRED)
    return aZero && bZero;
  if (need.state === TIMEPIN_STATE.CANDIDATE ||
      need.state === TIMEPIN_STATE.FINAL)
    return !aZero && bZero;
  if (need.state === TIMEPIN_STATE.AMBIGUOUS)
    return !aZero && !bZero &&
      Buffer.compare(need.candidateAHash, need.candidateBHash) < 0;
  return false;
};

export function authenticateTimepinNeed({
  account, timepinProgram, evidenceSpecHash, targetTs,
}) {
  const data = rawAccountData(
    account, timepinProgram, TIMEPIN_NEED_ACCOUNT_LEN,
    NEED_DISCRIMINATOR, 'TIMEPIN_NEED',
  );
  const need = {
    key: bytes32(account.key, 'need.key'),
    owner: bytes32(account.owner, 'need.owner'),
    dataHash: sha256(data),
    schema: data.readUInt16LE(8),
    bump: data.readUInt8(10),
    state: data.readUInt8(11),
    evidenceSpecHash: data.subarray(12, 44),
    targetTs: data.readBigInt64LE(44),
    sourceDeadlineTs: data.readBigInt64LE(52),
    captureDeadlineTs: data.readBigInt64LE(60),
    candidateAHash: data.subarray(68, 100),
    candidateBHash: data.subarray(100, 132),
  };
  if (need.schema !== TIMEPIN_SCHEMA_V2) fail('TIMEPIN_NEED_SCHEMA');
  if (!same(need.evidenceSpecHash, evidenceSpecHash))
    fail('TIMEPIN_NEED_EVIDENCE_SPEC');
  if (targetTs !== undefined &&
      need.targetTs !== sint(targetTs, 64, 'targetTs'))
    fail('TIMEPIN_NEED_TARGET');
  if (need.sourceDeadlineTs < need.targetTs ||
      need.captureDeadlineTs <= need.sourceDeadlineTs)
    fail('TIMEPIN_NEED_DEADLINES');
  if (!needShapeIsCanonical(need)) fail('TIMEPIN_NEED_STATE');
  const pda = deriveTimepinNeedPda(
    timepinProgram, need.evidenceSpecHash, need.targetTs,
  );
  if (!same(need.key, pda.key)) fail('TIMEPIN_NEED_PDA');
  if (need.bump !== pda.bump) fail('TIMEPIN_NEED_BUMP');
  return need;
}

const hashTimepinMessage = record => sha256(Buffer.concat([
  TIMEPIN_MESSAGE_HASH_DOMAIN, record.feedId,
  i64(record.price, 'candidate.price'), u64(record.conf, 'candidate.conf'),
  i32(record.exponent, 'candidate.exponent'),
  i64(record.publishTime, 'candidate.publishTime'),
  i64(record.prevPublishTime, 'candidate.prevPublishTime'),
  i64(record.emaPrice, 'candidate.emaPrice'),
  u64(record.emaConf, 'candidate.emaConf'),
]));

export function authenticateTimepinCandidate({
  account, timepinProgram, need, expectedMessageHash, evidenceSpec,
}) {
  const data = rawAccountData(
    account, timepinProgram, TIMEPIN_CANDIDATE_ACCOUNT_LEN,
    CANDIDATE_DISCRIMINATOR, 'TIMEPIN_CANDIDATE',
  );
  const record = {
    messageHash: bytes32(expectedMessageHash, 'expectedMessageHash'),
    feedId: bytes32(evidenceSpec.feedId, 'evidenceSpec.feedId'),
    price: data.readBigInt64LE(75),
    conf: data.readBigUInt64LE(83),
    exponent: data.readInt32LE(91),
    publishTime: data.readBigInt64LE(95),
    prevPublishTime: data.readBigInt64LE(103),
    emaPrice: data.readBigInt64LE(111),
    emaConf: data.readBigUInt64LE(119),
    postedSlot: data.readBigUInt64LE(127),
    captureSlot: data.readBigUInt64LE(135),
    captureTs: data.readBigInt64LE(143),
  };
  const candidate = {
    key: bytes32(account.key, 'candidate.key'),
    owner: bytes32(account.owner, 'candidate.owner'),
    dataHash: sha256(data),
    schema: data.readUInt16LE(8),
    bump: data.readUInt8(10),
    need: data.subarray(11, 43),
    rentPayer: data.subarray(43, 75),
    record,
  };
  if (candidate.schema !== TIMEPIN_SCHEMA_V2)
    fail('TIMEPIN_CANDIDATE_SCHEMA');
  if (record.exponent < evidenceSpec.minExponent ||
      record.exponent > evidenceSpec.maxExponent)
    fail('TIMEPIN_CANDIDATE_EXPONENT');
  if (!same(candidate.need, need.key)) fail('TIMEPIN_CANDIDATE_NEED');
  if (record.price <= 0n) fail('TIMEPIN_CANDIDATE_BRACKET');
  if (evidenceSpec.adapter === 2) {
    // MIN-CAPTURE: earliest print at or after the target. prev_publish_time is not
    // part of the predicate, so there is no bracket and no pre-gap bound here.
    if (record.publishTime < need.targetTs) fail('TIMEPIN_CANDIDATE_BRACKET');
  } else {
    if (record.prevPublishTime >= need.targetTs ||
        record.publishTime < need.targetTs)
      fail('TIMEPIN_CANDIDATE_BRACKET');
    if (need.targetTs - record.prevPublishTime >
        BigInt(evidenceSpec.maxPreTargetGapSeconds))
      fail('TIMEPIN_CANDIDATE_GAP');
  }
  if (record.publishTime - need.targetTs >
      BigInt(evidenceSpec.maxPostTargetLagSeconds))
    fail('TIMEPIN_CANDIDATE_GAP');
  if (record.captureTs < need.targetTs ||
      record.captureTs >= need.captureDeadlineTs ||
      record.postedSlot > record.captureSlot)
    fail('TIMEPIN_CANDIDATE_CAPTURE');
  if (record.postedSlot <= evidenceSpec.registeredSlot)
    fail('TIMEPIN_CANDIDATE_REGISTRATION');
  if (record.publishTime > record.captureTs +
      BigInt(evidenceSpec.maxFutureSkewSeconds))
    fail('TIMEPIN_CANDIDATE_FUTURE');
  if (record.conf * 10_000n >
      record.price * BigInt(evidenceSpec.maxConfidenceBps))
    fail('TIMEPIN_CANDIDATE_CONFIDENCE');
  if (!hashTimepinMessage(record).equals(record.messageHash))
    fail('TIMEPIN_CANDIDATE_MESSAGE_HASH');
  const pda = deriveTimepinCandidatePda(
    timepinProgram, need.key, record.messageHash,
  );
  if (!same(candidate.key, pda.key)) fail('TIMEPIN_CANDIDATE_PDA');
  if (candidate.bump !== pda.bump) fail('TIMEPIN_CANDIDATE_BUMP');
  return candidate;
}

export const timepinResultHash = need => {
  if (need.state === TIMEPIN_STATE.FINAL)
    return sha256(Buffer.concat([
      TIMEPIN_SET_HASH_DOMAIN, need.key, need.candidateAHash,
    ]));
  if (need.state === TIMEPIN_STATE.AMBIGUOUS)
    return sha256(Buffer.concat([
      TIMEPIN_SET_HASH_DOMAIN, need.key,
      need.candidateAHash, need.candidateBHash,
    ]));
  if (need.state === TIMEPIN_STATE.EXPIRED)
    return sha256(Buffer.concat([
      TIMEPIN_EXPIRED_HASH_DOMAIN, need.key,
      i64(need.targetTs, 'need.targetTs'),
    ]));
  fail('TIMEPIN_TERMINAL_KIND');
};

export function authenticateTerminalFact(
  bundle, ruleset, expectedNeedKey, expectedTargetTs,
) {
  if (!bundle || !bundle.need) fail('MISSING_TIMEPIN_FACT');
  if (bundle.timepin) fail('UNEXPECTED_TIMEPIN_TERMINAL');
  const need = authenticateTimepinNeed({
    account: bundle.need,
    timepinProgram: ruleset.timepinProgram,
    evidenceSpecHash: ruleset.evidenceSpecHash,
    targetTs: expectedTargetTs,
  });
  if (expectedNeedKey && !same(need.key, expectedNeedKey))
    fail('WRONG_TIMEPIN_NEED');
  if (![TIMEPIN_STATE.FINAL, TIMEPIN_STATE.AMBIGUOUS,
        TIMEPIN_STATE.EXPIRED].includes(need.state))
    fail('TIMEPIN_TERMINAL_KIND');
  const terminal = {
    terminalKind: need.state,
    need: Buffer.from(need.key),
    evidenceSpecHash: Buffer.from(need.evidenceSpecHash),
    targetTs: need.targetTs,
    candidateAHash: Buffer.from(need.candidateAHash),
    candidateBHash: Buffer.from(need.candidateBHash),
    resultHash: timepinResultHash(need),
  };
  if (terminal.terminalKind !== TIMEPIN_STATE.FINAL) {
    if (bundle.candidate) fail('UNEXPECTED_TIMEPIN_CANDIDATE');
    return { need, terminal, candidate: null };
  }
  if (!bundle.candidate) fail('MISSING_TIMEPIN_CANDIDATE');
  const candidate = authenticateTimepinCandidate({
    account: bundle.candidate,
    timepinProgram: ruleset.timepinProgram,
    need,
    expectedMessageHash: terminal.candidateAHash,
    evidenceSpec: ruleset.evidenceSpec,
  });
  return { need, terminal, candidate };
}

const authenticateOpenNeed = (account, ruleset, targetTs) => {
  const need = authenticateTimepinNeed({
    account,
    timepinProgram: ruleset.timepinProgram,
    evidenceSpecHash: ruleset.evidenceSpecHash,
    targetTs,
  });
  if (need.state !== TIMEPIN_STATE.OPEN) fail('TIMEPIN_NEED_NOT_OPEN');
  return need;
};

const authenticateObservedEntry = (bundle, ruleset, nowTs) => {
  const fact = authenticateTerminalFact(bundle, ruleset);
  if (fact.terminal.terminalKind !== TIMEPIN_STATE.FINAL)
    fail('OBSERVED_ENTRY_NOT_FINAL');
  const now = sint(nowTs, 64, 'nowTs');
  if (fact.candidate.record.publishTime > now)
    fail('OBSERVED_ENTRY_IN_FUTURE');
  if (now - fact.candidate.record.publishTime >
      BigInt(ruleset.maxEntryAgeSeconds))
    fail('OBSERVED_ENTRY_STALE');
  return fact;
};

// Timepin's frozen program creates and terminalizes these accounts using its
// own Clock. Core therefore authenticates immutable account bytes and does not
// duplicate a removed terminal timestamp.
const requireTerminalVisible = () => true;

export function scaleToE12(value, exponent) {
  const price = sint(value, 64, 'price');
  const exp = Number(sint(exponent, 32, 'exponent'));
  if (exp < CORE_MIN_EXPONENT || exp > CORE_MAX_EXPONENT)
    fail('BAD_EXPONENT');
  return price * (10n ** BigInt(12 + exp));
}

export function scaleConfToE12(value, exponent) {
  const conf = uint(value, 64, 'conf');
  const exp = Number(sint(exponent, 32, 'exponent'));
  if (exp < CORE_MIN_EXPONENT || exp > CORE_MAX_EXPONENT)
    fail('BAD_EXPONENT');
  return conf * (10n ** BigInt(12 + exp));
}

export function compareExactPrices(left, right) {
  const a = scaleToE12(left.price, left.exponent);
  const b = scaleToE12(right.price, right.exponent);
  return b === a ? 0 : b > a ? 1 : -1;
}

const isqrt = value => {
  const n = uint(value, 64, 'sqrt');
  if (n < 2n) return n;
  let low = 1n;
  let high = n < 4_294_967_296n ? n : 4_294_967_296n;
  while (low + 1n < high) {
    const middle = low + (high - low) / 2n;
    if (middle <= n / middle) low = middle;
    else high = middle;
  }
  return low;
};

const satMulU64 = (a, b) => {
  const product = uint(a, 64, 'multiply') * uint(b, 64, 'multiply');
  return product > U64_MAX ? U64_MAX : product;
};

export function sealXp(baseXp, stake) {
  const base = uint(baseXp, 64, 'baseXp');
  const amount = uint(stake, 64, 'stake');
  if (amount >= 40_000n) return (satMulU64(base, 20n) || 1n);
  const square = satMulU64(satMulU64(base, base), amount);
  const rounded = (isqrt(square) / 5n + 1n) / 2n;
  return rounded || 1n;
}

export function skillXp(xpBase, streak) {
  const base = uint(xpBase, 64, 'xpBase');
  const count = uint(streak, 32, 'streak');
  const rawMultiplier = satMulU64(15n, count);
  const multiplier = 100n + rawMultiplier > 200n
    ? 200n : 100n + rawMultiplier;
  const product = satMulU64(base, multiplier);
  return ((product + 50n > U64_MAX ? U64_MAX : product + 50n) / 100n) || 1n;
}

export const terminalXpReserve = (xpBase, settleXp) =>
  addU64(xpBase, settleXp, 'terminalXpReserve');

export const hitPayout = (stake, economy) => {
  const amount = uint(stake, 64, 'stake');
  const value = amount * uint(
    economy.hitPayoutNumerator, 64, 'hitPayoutNumerator',
  ) / uint(economy.hitPayoutDenominator, 64, 'hitPayoutDenominator');
  return uint(value, 64, 'hitPayout');
};

export function brierScore(side, probability, outcomeYes) {
  const direction = numberUint(side, 8, 'side');
  const p = numberUint(probability, 16, 'probability');
  if ((direction !== SIDE.DOWN && direction !== SIDE.UP) || p < 1 || p >= 10_000)
    fail(direction > 1 ? 'BAD_SIDE' : 'BAD_PROBABILITY');
  const yesProbability = direction === SIDE.UP ? BigInt(p) : 10_000n - BigInt(p);
  const outcome = outcomeYes ? 10_000n : 0n;
  const error = yesProbability - outcome;
  return error * error;
}

const STATE_CODE = Object.freeze({
  [SHOT_STATE.PENDING_ENTRY]: 1,
  [SHOT_STATE.ACTIVE]: 2,
  [SHOT_STATE.AWAITING_REVEAL]: 3,
  [SHOT_STATE.REVEALED]: 4,
  [SHOT_STATE.VOID]: 5,
  [SHOT_STATE.FORFEITED]: 6,
  [SHOT_STATE.AWAITING_VOID]: 7,
});
const VOID_CODE = Object.freeze({
  null: 0,
  [VOID_REASON.ENTRY_EXPIRED]: 1,
  [VOID_REASON.ENTRY_AMBIGUOUS]: 2,
  [VOID_REASON.EXIT_EXPIRED]: 3,
  [VOID_REASON.EXIT_AMBIGUOUS]: 4,
  [VOID_REASON.EQUALITY]: 5,
  [VOID_REASON.CONFIDENCE_BAND]: 6,
});

const voidCode = reason => {
  const value = VOID_CODE[String(reason)];
  if (value === undefined) fail('BAD_VOID_REASON');
  return value;
};

export function resolutionHash(shot) {
  return sha256(Buffer.concat([
    RESOLUTION_HASH_DOMAIN, bytes32(shot.key, 'shot.key'),
    bytes32(shot.economyHash, 'shot.economyHash'),
    bytes32(shot.rulesetHash, 'shot.rulesetHash'),
    bytes32(shot.player, 'shot.player'),
    bytes32(shot.rentRefund, 'shot.rentRefund'),
    bytes32(shot.delegate, 'shot.delegate'), u64(shot.nonce, 'shot.nonce'),
    bytes32(shot.commit, 'shot.commit'), u8(shot.entryMode, 'shot.entryMode'),
    u8(voidCode(shot.voidReason), 'shot.voidReason'),
    u64(shot.stake, 'shot.stake'),
    u64(shot.cleanupBondLamports, 'shot.cleanupBondLamports'),
    u64(shot.xpBase, 'shot.xpBase'),
    i64(shot.sealedTs, 'shot.sealedTs'),
    i64(shot.entryTargetTs, 'shot.entryTargetTs'),
    i64(shot.exitTargetTs, 'shot.exitTargetTs'),
    i64(shot.scoreDay, 'shot.scoreDay'),
    u8(shot.rankShard, 'shot.rankShard'),
    bytes32(shot.entryNeed, 'shot.entryNeed'),
    bytes32(shot.exitNeed, 'shot.exitNeed'),
    bytes32(shot.activationWorker, 'shot.activationWorker'),
    u64(shot.activationSlot, 'shot.activationSlot'),
    i64(shot.activationTs, 'shot.activationTs'),
    bytes32(shot.entryMessageHash, 'shot.entryMessageHash'),
    bytes32(shot.entryTimepinResultHash, 'shot.entryTimepinResultHash'),
    i64(shot.entryPrice, 'shot.entryPrice'), u64(shot.entryConf, 'shot.entryConf'),
    i32(shot.entryExponent, 'shot.entryExponent'),
    i64(shot.entryPublishTime, 'shot.entryPublishTime'),
    bytes32(shot.exitMessageHash, 'shot.exitMessageHash'),
    bytes32(shot.exitTimepinResultHash, 'shot.exitTimepinResultHash'),
    i64(shot.exitPrice, 'shot.exitPrice'), u64(shot.exitConf, 'shot.exitConf'),
    i32(shot.exitExponent, 'shot.exitExponent'),
    i64(shot.exitPublishTime, 'shot.exitPublishTime'),
    u8(shot.outcomeYes, 'shot.outcomeYes'),
    i64(shot.settledTs, 'shot.settledTs'),
    u64(shot.resolutionSlot, 'shot.resolutionSlot'),
    i64(shot.revealDeadlineTs, 'shot.revealDeadlineTs'),
    bytes32(shot.resolver, 'shot.resolver'),
  ]));
}

export function terminalHash(shot) {
  const state = STATE_CODE[shot.state];
  if (!state) fail('BAD_SHOT_STATE');
  return sha256(Buffer.concat([
    TERMINAL_HASH_DOMAIN, bytes32(shot.key, 'shot.key'),
    bytes32(shot.resolutionHash, 'shot.resolutionHash'), u8(state, 'shot.state'),
    u8(voidCode(shot.voidReason), 'shot.voidReason'),
    u8(shot.side, 'shot.side'), u16(shot.pBps, 'shot.pBps'),
    u8(shot.hit, 'shot.hit'), u64(shot.xpAwarded, 'shot.xpAwarded'),
    bytes32(shot.forfeitWorker, 'shot.forfeitWorker'),
    bytes32(shot.revealedSalt, 'shot.revealedSalt'),
    u64(shot.terminalSlot, 'shot.terminalSlot'),
    i64(shot.terminalTs, 'shot.terminalTs'),
  ]));
}

const terminalState = state => state === SHOT_STATE.REVEALED ||
  state === SHOT_STATE.VOID || state === SHOT_STATE.FORFEITED;

export function validateCompactResultShape(result) {
  nonzero32(result.rulesetHash, 'result.rulesetHash');
  const proof = bytes32(result.proofMaterial, 'result.proofMaterial');
  const stake = uint(result.stake, 64, 'result.stake');
  const sealedTs = sint(result.sealedTs, 64, 'result.sealedTs');
  const entryTargetTs = sint(
    result.entryTargetTs, 64, 'result.entryTargetTs',
  );
  const exitTargetTs = sint(
    result.exitTargetTs, 64, 'result.exitTargetTs',
  );
  if (!stake || sealedTs <= 0n || entryTargetTs <= 0n ||
      exitTargetTs <= entryTargetTs || !terminalState(result.state))
    fail('INVALID_TERMINAL_SHAPE');
  const side = numberUint(result.side, 8, 'result.side');
  const probability = numberUint(result.pBps, 16, 'result.pBps');
  if (result.state === SHOT_STATE.REVEALED) {
    if (result.voidReason !== null || side > 1 ||
        probability < 1 || probability >= 10_000)
      fail('INVALID_TERMINAL_SHAPE');
  } else if (result.state === SHOT_STATE.VOID) {
    if (!Object.values(VOID_REASON).includes(result.voidReason) ||
        side !== 0 || probability !== 0 || proof.equals(ZERO32))
      fail('INVALID_TERMINAL_SHAPE');
  } else if (result.voidReason !== null || side !== 0 ||
             probability !== 0 || proof.equals(ZERO32)) {
    fail('INVALID_TERMINAL_SHAPE');
  }
  bytes32(result.delegate, 'result.delegate');
  return true;
}

export function compactResultCommit({
  programId, economyHash: economyHashValue, player, nonce, result,
}) {
  validateCompactResultShape(result);
  const commit = result.state === SHOT_STATE.REVEALED
    ? commitmentHash({
      programId, economyHash: economyHashValue,
      rulesetHash: result.rulesetHash, player, nonce,
      side: result.side, probability: result.pBps, salt: result.proofMaterial,
    })
    : bytes32(result.proofMaterial, 'result.proofMaterial');
  if (commit.equals(ZERO32)) fail('INVALID_TERMINAL_SHAPE');
  return commit;
}

export function validateGameResultFacts(result, facts) {
  validateCompactResultShape(result);
  const entryHash = bytes32(
    facts.entryTimepinResultHash, 'facts.entryTimepinResultHash',
  );
  const exitHash = bytes32(
    facts.exitTimepinResultHash, 'facts.exitTimepinResultHash',
  );
  const outcome = numberUint(facts.outcomeYes, 8, 'facts.outcomeYes');
  const hit = numberUint(facts.hit, 8, 'facts.hit');
  const xp = uint(facts.xpAwarded, 64, 'facts.xpAwarded');
  if (outcome > 1 || hit > 1 ||
      sint(facts.scoreDay, 64, 'facts.scoreDay') < 0n)
    fail('INVALID_GAME_RESULT_FACTS');
  if (result.state === SHOT_STATE.REVEALED) {
    if (entryHash.equals(ZERO32) || exitHash.equals(ZERO32) ||
        hit !== Number((result.side === SIDE.UP) === (outcome === 1)))
      fail('INVALID_GAME_RESULT_FACTS');
  } else if (result.state === SHOT_STATE.FORFEITED) {
    if (entryHash.equals(ZERO32) || exitHash.equals(ZERO32) ||
        hit !== 0 || xp !== 0n)
      fail('INVALID_GAME_RESULT_FACTS');
  } else {
    const entryTerminal =
      result.voidReason === VOID_REASON.ENTRY_EXPIRED ||
      result.voidReason === VOID_REASON.ENTRY_AMBIGUOUS;
    if (entryHash.equals(ZERO32) ||
        (entryTerminal ? !exitHash.equals(ZERO32) : exitHash.equals(ZERO32)) ||
        outcome !== 0 || hit !== 0 || xp !== 0n)
      fail('INVALID_GAME_RESULT_FACTS');
  }
  return true;
}

export function gameResultHash({
  programId, economyHash: economyHashValue, player, nonce, result, facts,
}) {
  validateGameResultFacts(result, facts);
  const commit = compactResultCommit({
    programId, economyHash: economyHashValue, player, nonce, result,
  });
  return sha256(Buffer.concat([
    GAME_RESULT_HASH_DOMAIN, bytes32(programId, 'programId'),
    bytes32(economyHashValue, 'economyHash'), bytes32(player, 'player'),
    u64(nonce, 'nonce'), bytes32(result.rulesetHash, 'result.rulesetHash'),
    commit, u64(result.stake, 'result.stake'),
    i64(result.sealedTs, 'result.sealedTs'),
    i64(result.entryTargetTs, 'result.entryTargetTs'),
    i64(result.exitTargetTs, 'result.exitTargetTs'),
    u8(STATE_CODE[result.state], 'result.state'),
    u8(voidCode(result.voidReason), 'result.voidReason'),
    u8(result.side, 'result.side'), u16(result.pBps, 'result.pBps'),
    bytes32(result.delegate, 'result.delegate'),
    bytes32(facts.entryTimepinResultHash, 'facts.entryTimepinResultHash'),
    bytes32(facts.exitTimepinResultHash, 'facts.exitTimepinResultHash'),
    u8(facts.outcomeYes, 'facts.outcomeYes'), u8(facts.hit, 'facts.hit'),
    u64(facts.xpAwarded, 'facts.xpAwarded'),
    i64(facts.scoreDay, 'facts.scoreDay'),
  ]));
}

export function verifyGameResult(args) {
  const expected = gameResultHash(args);
  if (!same(expected, args.result.gameResultHash))
    fail('WRONG_GAME_RESULT_HASH');
  return true;
}

export function compactResultFromShot(programId, shot) {
  if (!terminalState(shot.state)) fail('SHOT_NOT_TERMINAL');
  const result = {
    rulesetHash: Buffer.from(shot.rulesetHash),
    proofMaterial: Buffer.from(
      shot.state === SHOT_STATE.REVEALED ? shot.revealedSalt : shot.commit,
    ),
    state: shot.state,
    voidReason: shot.voidReason,
    stake: shot.stake,
    sealedTs: shot.sealedTs,
    entryTargetTs: shot.entryTargetTs,
    exitTargetTs: shot.exitTargetTs,
    side: shot.side,
    pBps: shot.pBps,
    delegate: Buffer.from(shot.delegate),
    gameResultHash: Buffer.from(ZERO32),
  };
  const facts = {
    entryTimepinResultHash: Buffer.from(shot.entryTimepinResultHash),
    exitTimepinResultHash: Buffer.from(shot.exitTimepinResultHash),
    outcomeYes: shot.outcomeYes,
    hit: shot.hit,
    xpAwarded: shot.xpAwarded,
    scoreDay: shot.scoreDay,
  };
  result.gameResultHash = gameResultHash({
    programId, economyHash: shot.economyHash, player: shot.player,
    nonce: shot.nonce, result, facts,
  });
  verifyGameResult({
    programId, economyHash: shot.economyHash, player: shot.player,
    nonce: shot.nonce, result, facts,
  });
  return { result, facts };
}

export function completionResultHash({
  programId, subject, workKind, factHash, disposition, worker,
}) {
  return sha256(Buffer.concat([
    COMPLETION_RESULT_HASH_DOMAIN, bytes32(programId, 'programId'),
    bytes32(subject, 'subject'), u8(workKind, 'workKind'),
    bytes32(factHash, 'factHash'), u8(disposition, 'disposition'),
    bytes32(worker, 'worker'),
  ]));
}

// Borsh encoding of ShotResult, in the field order state.rs declares:
// rulesetHash 32, proofMaterial 32, state 1, voidReason 1, stake 8, sealedTs 8,
// entryTargetTs 8, exitTargetTs 8, side 1, pBps 2, delegate 32,
// gameResultHash 32 = 165. Borsh has no padding and no length prefix for fixed
// arrays, so this is the exact byte string the program hashes.
export function encodeShotResult(result) {
  validateCompactResultShape(result);
  const encoded = Buffer.concat([
    bytes32(result.rulesetHash, 'result.rulesetHash'),
    bytes32(result.proofMaterial, 'result.proofMaterial'),
    u8(STATE_CODE[result.state], 'result.state'),
    u8(voidCode(result.voidReason), 'result.voidReason'),
    u64(result.stake, 'result.stake'),
    i64(result.sealedTs, 'result.sealedTs'),
    i64(result.entryTargetTs, 'result.entryTargetTs'),
    i64(result.exitTargetTs, 'result.exitTargetTs'),
    u8(result.side, 'result.side'),
    u16(result.pBps, 'result.pBps'),
    bytes32(result.delegate, 'result.delegate'),
    bytes32(result.gameResultHash, 'result.gameResultHash'),
  ]);
  if (encoded.length !== SHOT_RESULT_LEN) fail('INVALID_TERMINAL_SHAPE');
  return encoded;
}

// One row's leaf. The nonce is bound in so a row cannot be moved to another
// slot or another page and still verify.
export const historyRowHash = (nonce, result) => sha256(Buffer.concat([
  HISTORY_ROW_DOMAIN, u64(nonce, 'nonce'), encodeShotResult(result),
]));

// The fold. Order is TERMINALISATION order, not nonce order - slots are
// appended in nonce order but terminalised out of order, so a nonce-ordered
// replay does not reproduce the root.
export const historyChainFold = (root, rowHash) => sha256(Buffer.concat([
  HISTORY_CHAIN_DOMAIN, bytes32(root, 'resultsRoot'),
  bytes32(rowHash, 'rowHash'),
]));

// Fixed size, whatever the page contains. The argument is still validated so a
// caller passing an impossible page still fails here.
export const historyPageSerializedLen = page => {
  const pending = numberUint(page.pendingCount, 8, 'page.pendingCount');
  const mask = numberUint(page.terminalMask, 16, 'page.terminalMask');
  if (pending > HISTORY_PAGE_CAP || (mask >>> pending) !== 0)
    fail('INVALID_HISTORY_PAGE');
  return HISTORY_PAGE_LEN;
};

export function podiumAllocation(gross) {
  const value = uint(gross, 64, 'gross');
  const baseBurn = value * 700n / 1_000n;
  const pool = value - baseBurn;
  const shares = [500n, 300n, 200n].map(
    curve => pool * curve / 1_000n,
  );
  return {
    baseBurn,
    pool,
    shares,
    dust: pool - shares.reduce((sum, share) => sum + share, 0n),
  };
}

export function reloadRecordAccounting(record) {
  const gross = uint(record.gross, 64, 'record.gross');
  if (!gross) fail('INVALID_RELOAD_RECORD');
  const dayFinalHash = nonzero32(
    record.dayFinalHash, 'record.dayFinalHash',
  );
  sint(record.day, 64, 'record.day');
  const actions = Array.from(record.actions || []);
  if (actions.length !== 3 || actions.some(action =>
    ![RELOAD_ACTION.BURN, RELOAD_ACTION.ROUTE, RELOAD_ACTION.RETAIN]
      .includes(numberUint(action, 8, 'record.action'))))
    fail('INVALID_RELOAD_RECORD');
  const allocation = podiumAllocation(gross);
  let rawBurned = allocation.baseBurn + allocation.dust;
  let rawRouted = 0n;
  let rawRetained = 0n;
  actions.forEach((action, index) => {
    if (action === RELOAD_ACTION.BURN) rawBurned += allocation.shares[index];
    else if (action === RELOAD_ACTION.ROUTE)
      rawRouted += allocation.shares[index];
    else rawRetained += allocation.shares[index];
  });
  const consumed = rawBurned + rawRouted;
  if (consumed + rawRetained !== gross) fail('RELOAD_CONSERVATION_BROKEN');
  return {
    dayFinalHash,
    actions,
    gross,
    rawBurned,
    rawRouted,
    rawRetained,
    consumed,
    credits: consumed / RCX_RAW_UNITS_PER_CREDIT,
  };
}

export const reloadHistoryPageSerializedLen = records => {
  if (!Array.isArray(records) || records.length > RELOAD_HISTORY_PAGE_CAP)
    fail('RELOAD_HISTORY_PAGE_FULL');
  records.forEach(reloadRecordAccounting);
  return RELOAD_HISTORY_PAGE_BASE_LEN + records.length * RELOAD_RECORD_LEN;
};

export function validateWorkRecord(record) {
  nonzero32(record.subject, 'record.subject');
  if (!Object.values(WORK_KIND).includes(record.workKind))
    fail('INVALID_WORK_RECORD');
  const worker = bytes32(record.worker, 'record.worker');
  const result = bytes32(record.resultHash, 'record.resultHash');
  const slot = uint(record.completedSlot, 64, 'record.completedSlot');
  if (record.disposition === RECEIPT_DISPOSITION.PENDING) {
    if (!worker.equals(ZERO32) || !result.equals(ZERO32) || slot !== 0n)
      fail('INVALID_WORK_RECORD');
  } else if (record.disposition === RECEIPT_DISPOSITION.PAYABLE) {
    if (worker.equals(ZERO32) || result.equals(ZERO32) || slot === 0n)
      fail('INVALID_WORK_RECORD');
  } else if (record.disposition === RECEIPT_DISPOSITION.NONPAYABLE) {
    if (!worker.equals(ZERO32) || result.equals(ZERO32) || slot === 0n)
      fail('INVALID_WORK_RECORD');
  } else fail('INVALID_WORK_DISPOSITION');
  return true;
}

export const workPageSerializedLen = records => {
  if (!Array.isArray(records) || records.length > WORK_PAGE_CAP)
    fail('WORK_PAGE_FULL');
  return WORK_PAGE_BASE_LEN + records.length * WORK_RECORD_LEN;
};

const recordFields = record => ({
  messageHash: Buffer.from(record.messageHash),
  price: record.price,
  conf: record.conf,
  exponent: record.exponent,
  publishTime: record.publishTime,
});

const writeEntry = (shot, record) => {
  const fields = recordFields(record);
  shot.entryMessageHash = fields.messageHash;
  shot.entryPrice = fields.price;
  shot.entryConf = fields.conf;
  shot.entryExponent = fields.exponent;
  shot.entryPublishTime = fields.publishTime;
};
const writeExit = (shot, record) => {
  const fields = recordFields(record);
  shot.exitMessageHash = fields.messageHash;
  shot.exitPrice = fields.price;
  shot.exitConf = fields.conf;
  shot.exitExponent = fields.exponent;
  shot.exitPublishTime = fields.publishTime;
};

const nonceIdentity = (economyHashValue, player, nonce) =>
  keyHex(economyHashValue) + ':' + keyHex(player) + ':' +
  uint(nonce, 64, 'nonce').toString();
const receiptIdentity = (shot, workKind) =>
  keyHex(shot) + ':' + numberUint(workKind, 8, 'workKind');
const utcDay = timestamp => {
  const value = sint(timestamp, 64, 'timestamp');
  const day = 86_400n;
  return value >= 0n ? value / day : -((-value + day - 1n) / day);
};
const rankShardFor = player =>
  sha256(Buffer.concat([
    RANK_SHARD_FOR_DOMAIN, bytes32(player, 'player'),
  ]))[0] % 16;
const fixedRevealDeadline = (need, revealWindowSeconds) =>
  checkedTimestampAdd(
    need.captureDeadlineTs, revealWindowSeconds, 'revealDeadlineTs',
  );

const emptyLedger = (programId, economyHashValue, player) => {
  const pda = deriveLedgerPda(programId, economyHashValue, player);
  return {
    schema: CORE_G2_SCHEMA,
    key: pda.key,
    bump: pda.bump,
    economyHash: bytes32(economyHashValue, 'economyHash'),
    player: bytes32(player, 'player'),
    credits: 0n,
    lockedCredits: 0n,
    xp: 0n,
    legacyCredits: 0n,
    reloadCredits: 0n,
    payoutCredits: 0n,
    reservedPayoutCredits: 0n,
    retiredCredits: 0n,
    refundedCredits: 0n,
    legacyXp: 0n,
    earnedXp: 0n,
    reservedXp: 0n,
    streak: 0n,
    best: 0n,
    hits: 0n,
    shots: 0n,
    voids: 0n,
    forfeits: 0n,
    sealed: 0n,
    open: 0n,
    brierSum: 0n,
    nextShotNonce: 0n,
    nextReloadNonce: 0n,
    rcxBurned: 0n,
    rcxRouted: 0n,
    rcxReloaded: 0n,
    rcxRetained: 0n,
  };
};

export function requireLedgerConservation(ledger) {
  const fields64 = [
    'credits', 'lockedCredits', 'xp', 'legacyCredits', 'reloadCredits',
    'payoutCredits', 'reservedPayoutCredits', 'retiredCredits',
    'refundedCredits', 'legacyXp', 'earnedXp', 'reservedXp', 'hits', 'shots',
    'voids', 'forfeits', 'sealed', 'rcxBurned', 'rcxRouted', 'rcxReloaded',
    'nextShotNonce', 'nextReloadNonce', 'rcxRetained',
  ];
  for (const field of fields64) uint(ledger[field], 64, 'ledger.' + field);
  uint(ledger.streak, 32, 'ledger.streak');
  uint(ledger.best, 32, 'ledger.best');
  uint(ledger.open, 16, 'ledger.open');
  uint(ledger.brierSum, 128, 'ledger.brierSum');
  const held = ledger.credits + ledger.lockedCredits + ledger.retiredCredits;
  const sourced = ledger.legacyCredits + ledger.reloadCredits +
    ledger.payoutCredits;
  if (held !== sourced) fail('LEDGER_CONSERVATION_BROKEN');
  if (sourced + ledger.reservedPayoutCredits > U64_MAX)
    fail('LEDGER_CREDIT_CAPACITY');
  if (ledger.xp !== ledger.legacyXp + ledger.earnedXp)
    fail('LEDGER_XP_CONSERVATION_BROKEN');
  if (ledger.xp + ledger.reservedXp > U64_MAX)
    fail('LEDGER_XP_CAPACITY');
  if (ledger.rcxReloaded !== ledger.rcxBurned + ledger.rcxRouted)
    fail('RCX_CONSERVATION_BROKEN');
  if (ledger.sealed !== ledger.open + ledger.shots + ledger.voids ||
      ledger.forfeits > ledger.shots)
    fail('SHOT_CONSERVATION_BROKEN');
  return true;
}

export class RatchetCoreG2Model {
  #programId;
  #state;

  constructor({ programId, rentLamportsPerByte = 5_080n }) {
    this.#programId = nonzero32(programId, 'programId');
    const rentRate = uint(rentLamportsPerByte, 64, 'rentLamportsPerByte');
    this.#state = {
      revision: 0n,
      economies: new Map(),
      rulesets: new Map(),
      ledgers: new Map(),
      shots: new Map(),
      closedShots: new Map(),
      historyPages: new Map(),
      reloadHistoryPages: new Map(),
      workPages: new Map(),
      lamportRefunds: new Map(),
      cleanupRewards: new Map(),
      actorTopups: new Map(),
      rentLamportsPerByte: rentRate,
      usedNonces: new Set(),
    };
  }

  get programId() { return Buffer.from(this.#programId); }
  get revision() { return this.#state.revision; }
  snapshot() { return clone(this.#state); }

  registerEconomy({
    spec, account, timepinProgram = spec.timepinProgram,
    timepinExecutable = true, currentSlot = U64_MAX,
    expectedRevision,
  }) {
    const canonical = encodeEconomy(spec);
    const hash = economyHash(spec);
    if (timepinExecutable !== true) fail('TIMEPIN_PROGRAM_NOT_EXECUTABLE');
    if (!bytes32(account.owner, 'account.owner').equals(this.#programId))
      fail('ECONOMY_ACCOUNT_OWNER');
    if (!same(
      bytes32(timepinProgram, 'timepinProgram'),
      bytes32(spec.timepinProgram, 'spec.timepinProgram'),
    )) fail('WRONG_TIMEPIN_PROGRAM');
    if (!bytes32(spec.legacyRoot, 'legacyRoot').equals(ZERO32) &&
        uint(spec.legacyCutoverSlot, 64, 'legacyCutoverSlot') >
          uint(currentSlot, 64, 'currentSlot'))
      fail('FUTURE_LEGACY_CUTOVER');
    authenticateContentAccount({
      programId: this.#programId, account, expectedHash: hash,
      expectedData: canonical, expectedDisc: ECONOMY_DISCRIMINATOR,
      expectedLength: ECONOMY_ACCOUNT_LEN, type: 'economy',
      code: 'ECONOMY_ACCOUNT',
    });
    return this._tx(expectedRevision, state => {
      const id = keyHex(hash);
      const existing = state.economies.get(id);
      if (existing) {
        if (!same(existing.account.data, account.data))
          fail('ECONOMY_HASH_COLLISION');
        return { noChange: true, value: hash };
      }
      state.economies.set(id, {
        hash, spec: clone(spec), account: clone(account),
      });
      return { value: hash };
    });
  }

  registerRuleset({
    spec, economyHash: economyHashValue, account, evidenceSpecAccount,
    policyProof,
    expectedRevision,
  }) {
    const economy = this._economy(this.#state, economyHashValue);
    if (!same(spec.economyHash, economy.hash)) fail('WRONG_ECONOMY_HASH');
    const evidenceSpec = authenticateTimepinEvidenceSpec({
      account: evidenceSpecAccount,
      timepinProgram: economy.spec.timepinProgram,
      evidenceSpecHash: spec.evidenceSpecHash,
    });
    requireTimepinSpecRulesetMatch(evidenceSpec, spec);
    const leaf = rulesetPolicyHash(spec, economy.spec);
    if (!verifyRulesetPolicyProof(
      leaf, policyProof, economy.spec.rulesetPolicyRoot,
    )) fail('RULESET_NOT_IN_POLICY');
    const canonical = encodeRuleset(spec, economy.spec);
    const hash = rulesetHash(spec, economy.spec);
    authenticateContentAccount({
      programId: this.#programId, account, expectedHash: hash,
      expectedData: canonical, expectedDisc: RULESET_DISCRIMINATOR,
      expectedLength: RULESET_ACCOUNT_LEN, type: 'ruleset',
      code: 'RULESET_ACCOUNT',
    });
    return this._tx(expectedRevision, state => {
      this._economy(state, economyHashValue);
      const id = keyHex(hash);
      const existing = state.rulesets.get(id);
      if (existing) {
        if (!same(existing.account.data, account.data))
          fail('RULESET_HASH_COLLISION');
        return { noChange: true, value: hash };
      }
      state.rulesets.set(id, {
        hash,
        economyHash: bytes32(economyHashValue, 'economyHash'),
        policyHash: leaf,
        policyProof: clone(policyProof),
        spec: clone(spec),
        evidenceSpec: clone(evidenceSpec),
        evidenceSpecAccount: clone(evidenceSpecAccount),
        account: clone(account),
      });
      return { value: hash };
    });
  }

  openLedger({
    economyHash: economyHashValue, player, signer = player, expectedRevision,
  }) {
    const playerKey = nonzero32(player, 'player');
    if (!same(nonzero32(signer, 'signer'), playerKey))
      fail('PLAYER_SIGNATURE_REQUIRED');
    return this._tx(expectedRevision, state => {
      this._economy(state, economyHashValue);
      const result = this._getOrCreateLedger(state, economyHashValue, playerKey);
      return { noChange: !result.created, value: result.ledger };
    });
  }

  openReloadPage({
    economyHash: economyHashValue, player, actor,
    pageIndex, expectedRevision,
  }) {
    const playerKey = nonzero32(player, 'player');
    nonzero32(actor, 'actor');
    const index = uint(pageIndex, 64, 'pageIndex');
    return this._tx(expectedRevision, state => {
      this._economy(state, economyHashValue);
      const ledger = this._ledger(state, economyHashValue, playerKey);
      if (index !== reloadHistoryPageIndex(ledger.nextReloadNonce))
        fail('WRONG_RELOAD_HISTORY_PAGE');
      const pda = deriveReloadHistoryPagePda(
        this.#programId, economyHashValue, playerKey, index,
      );
      if (state.reloadHistoryPages.has(keyHex(pda.key)))
        fail('RELOAD_HISTORY_PAGE_EXISTS');
      const page = {
        schema: CORE_G2_SCHEMA,
        key: pda.key,
        bump: pda.bump,
        economyHash: bytes32(economyHashValue, 'economyHash'),
        player: playerKey,
        pageIndex: index,
        records: [],
      };
      state.reloadHistoryPages.set(keyHex(page.key), page);
      if (state._cow) state._cow.reloadHistoryPages.add(keyHex(page.key));
      this._validateReloadHistoryPage(page);
      return { value: page };
    });
  }

  // Model the exact atomic Core instruction. DayFinal and destination account
  // authentication determine the three actions before any CPI; actions are
  // supplied here as that already-authenticated environment.
  reloadBurn({
    economyHash: economyHashValue, player, signer = player,
    nonce, gross, day, dayFinalHash, actions,
    tokenProgram = TOKEN_2022_PROGRAM, mint = RCX_MINT,
    decimals = RCX_DECIMALS, burnSucceeded = true, expectedRevision,
  }) {
    const playerKey = nonzero32(player, 'player');
    if (!same(nonzero32(signer, 'signer'), playerKey))
      fail('PLAYER_SIGNATURE_REQUIRED');
    if (!same(bytes32(tokenProgram, 'tokenProgram'), TOKEN_2022_PROGRAM))
      fail('WRONG_TOKEN_PROGRAM');
    if (!same(bytes32(mint, 'mint'), RCX_MINT)) fail('WRONG_RCX_MINT');
    if (numberUint(decimals, 8, 'decimals') !== RCX_DECIMALS)
      fail('WRONG_DECIMALS');
    const nonceValue = uint(nonce, 64, 'nonce');
    const record = {
      day: sint(day, 64, 'day'),
      dayFinalHash: bytes32(dayFinalHash, 'dayFinalHash'),
      gross: uint(gross, 64, 'gross'),
      actions: Array.from(actions || []),
    };
    const accounting = reloadRecordAccounting(record);
    if (accounting.credits === 0n) fail('INVALID_AMOUNT');
    if (burnSucceeded !== true) fail('TOKEN_BURN_FAILED');
    return this._tx(expectedRevision, state => {
      this._economy(state, economyHashValue);
      const { ledger } = this._getOrCreateLedger(
        state, economyHashValue, playerKey,
      );
      requireLedgerConservation(ledger);
      if (nonceValue !== ledger.nextReloadNonce) fail('WRONG_RELOAD_NONCE');
      const page = this._getReloadHistoryPage(
        state, economyHashValue, playerKey,
        reloadHistoryPageIndex(nonceValue), false,
      );
      if (!page) fail('RELOAD_HISTORY_PAGE_NOT_FOUND');
      const slot = reloadHistoryPageSlot(nonceValue);
      if (page.records.length !== slot) fail('RELOAD_APPEND_OUT_OF_ORDER');
      if (page.records.length >= RELOAD_HISTORY_PAGE_CAP)
        fail('RELOAD_HISTORY_PAGE_FULL');
      page.records.push(clone(record));
      this._validateReloadHistoryPage(page);
      ledger.credits = addU64(
        ledger.credits, accounting.credits, 'ledger.credits',
      );
      ledger.reloadCredits = addU64(
        ledger.reloadCredits, accounting.credits, 'ledger.reloadCredits',
      );
      ledger.rcxReloaded = addU64(
        ledger.rcxReloaded, accounting.consumed, 'ledger.rcxReloaded',
      );
      ledger.rcxBurned = addU64(
        ledger.rcxBurned, accounting.rawBurned, 'ledger.rcxBurned',
      );
      ledger.rcxRouted = addU64(
        ledger.rcxRouted, accounting.rawRouted, 'ledger.rcxRouted',
      );
      ledger.rcxRetained = addU64(
        ledger.rcxRetained, accounting.rawRetained, 'ledger.rcxRetained',
      );
      ledger.nextReloadNonce = addU64(
        nonceValue, 1n, 'ledger.nextReloadNonce',
      );
      requireLedgerConservation(ledger);
      return { value: ledger };
    });
  }

  claimLegacy({
    economyHash: economyHashValue, player, signer = player, credits, xp,
    proof, currentSlot, expectedRevision,
  }) {
    const economy = this._economy(this.#state, economyHashValue);
    if (bytes32(economy.spec.legacyRoot, 'legacyRoot').equals(ZERO32))
      fail('NO_LEGACY_SNAPSHOT');
    if (uint(currentSlot, 64, 'currentSlot') <
        uint(economy.spec.legacyCutoverSlot, 64, 'legacyCutoverSlot'))
      fail('FUTURE_LEGACY_CUTOVER');
    const playerKey = nonzero32(player, 'player');
    if (!same(nonzero32(signer, 'signer'), playerKey))
      fail('PLAYER_SIGNATURE_REQUIRED');
    const creditAmount = uint(credits, 64, 'credits');
    const xpAmount = uint(xp, 64, 'xp');
    if (creditAmount === 0n && xpAmount === 0n)
      fail('EMPTY_LEGACY_CLAIM');
    if (creditAmount > BigInt(economy.spec.legacyTotalCredits) ||
        xpAmount > BigInt(economy.spec.legacyTotalXp))
      fail('LEGACY_CLAIM_EXCEEDS_MANIFEST');
    const leaf = legacyLeafHash({
      programId: this.#programId,
      clusterGenesisHash: economy.spec.clusterGenesisHash,
      migrationId: economy.spec.migrationId,
      snapshotHash: economy.spec.legacySnapshotHash,
      cutoverSlot: economy.spec.legacyCutoverSlot,
      player: playerKey,
      credits: creditAmount,
      xp: xpAmount,
    });
    if (!verifyLegacyProof(leaf, proof, economy.spec.legacyRoot))
      fail('BAD_LEGACY_PROOF');
    return this._tx(expectedRevision, state => {
      this._economy(state, economyHashValue);
      const { ledger } = this._getOrCreateLedger(
        state, economyHashValue, playerKey,
      );
      // The permanent ledger is the only replay tombstone. A separate
      // per-player LegacyClaim account duplicated this state and rent.
      if (ledger.legacyCredits !== 0n || ledger.legacyXp !== 0n)
        fail('LEGACY_ALREADY_CLAIMED');
      requireLedgerConservation(ledger);
      ledger.credits = addU64(
        ledger.credits, creditAmount, 'ledger.credits',
      );
      ledger.legacyCredits = addU64(
        ledger.legacyCredits, creditAmount, 'ledger.legacyCredits',
      );
      ledger.xp = addU64(ledger.xp, xpAmount, 'ledger.xp');
      ledger.legacyXp = addU64(
        ledger.legacyXp, xpAmount, 'ledger.legacyXp',
      );
      requireLedgerConservation(ledger);
      const claimEvent = {
        credits: creditAmount, xp: xpAmount, leaf,
        snapshotHash: Buffer.from(economy.spec.legacySnapshotHash),
        cutoverSlot: BigInt(economy.spec.legacyCutoverSlot),
      };
      return { value: claimEvent };
    });
  }

  seal(args) {
    if (args.entryMode === ENTRY_MODE.FORWARD_ENTRY)
      return this.sealForward(args);
    if (args.entryMode === ENTRY_MODE.OBSERVED_ENTRY)
      return this.sealObserved(args);
    fail('BAD_ENTRY_MODE');
  }

  sealForward({
    economyHash: economyHashValue, rulesetHash: rulesetHashValue,
    player, signer = player, nonce, stake, commitment, nowTs,
    entryTargetTs, scoreDay, t0Need, t1Need,
    rentRefund = player, delegate = ZERO_PUBKEY,
    transientRentLamports = 4_000_000n, expectedRevision,
  }) {
    const economy = this._economy(this.#state, economyHashValue);
    const ruleset = this._ruleset(
      this.#state, rulesetHashValue, economyHashValue,
    );
    if (ruleset.spec.entryMode !== ENTRY_MODE.FORWARD_ENTRY)
      fail('WRONG_ENTRY_MODE');
    const rules = this._hydratedRules(ruleset, economy);
    const now = sint(nowTs, 64, 'nowTs');
    const expectedEntry = alignFutureTarget(
      now, rules.minOpenLeadSeconds, rules.targetGridSeconds,
    );
    if (entryTargetTs !== undefined &&
        sint(entryTargetTs, 64, 'entryTargetTs') !== expectedEntry)
      fail('WRONG_TARGET');
    const exitTarget = checkedTimestampAdd(
      expectedEntry, rules.horizonSeconds, 'exitTargetTs',
    );
    const entryNeed = authenticateOpenNeed(t0Need, rules, expectedEntry);
    const exitNeed = authenticateOpenNeed(t1Need, rules, exitTarget);
    if (same(entryNeed.key, exitNeed.key)) fail('SAME_NEED');
    const revealDeadlineTs = fixedRevealDeadline(
      exitNeed, economy.spec.revealWindowSeconds,
    );
    const expectedScoreDay = utcDay(revealDeadlineTs);
    if (scoreDay !== undefined &&
        sint(scoreDay, 64, 'scoreDay') !== expectedScoreDay)
      fail('WRONG_SCORE_DAY');
    return this._sealPrepared({
      economy, ruleset, player, signer, nonce, stake, commitment, now,
      entryTargetTs: expectedEntry, exitTargetTs: exitTarget,
      entryNeed: entryNeed.key, exitNeed: exitNeed.key,
      stateValue: SHOT_STATE.PENDING_ENTRY, entryRecord: null,
      entryTimepinResultHash: ZERO32,
      revealDeadlineTs, scoreDay: expectedScoreDay,
      rentRefund, delegate, transientRentLamports,
      expectedRevision,
    });
  }

  sealObserved({
    economyHash: economyHashValue, rulesetHash: rulesetHashValue,
    player, signer = player, nonce, stake, commitment, nowTs,
    entryTargetTs, exitTargetTs, scoreDay, observedEntry, t1Need,
    rentRefund = player, delegate = ZERO_PUBKEY,
    transientRentLamports = 4_000_000n, expectedRevision,
  }) {
    const economy = this._economy(this.#state, economyHashValue);
    const ruleset = this._ruleset(
      this.#state, rulesetHashValue, economyHashValue,
    );
    if (ruleset.spec.entryMode !== ENTRY_MODE.OBSERVED_ENTRY)
      fail('WRONG_ENTRY_MODE');
    const rules = this._hydratedRules(ruleset, economy);
    const now = sint(nowTs, 64, 'nowTs');
    const observed = authenticateObservedEntry(observedEntry, rules, now);
    const entryTarget = observed.need.targetTs;
    if (entryTargetTs !== undefined &&
        sint(entryTargetTs, 64, 'entryTargetTs') !== entryTarget)
      fail('WRONG_TARGET');
    const expectedExit = alignFutureTarget(
      now, rules.horizonSeconds, rules.targetGridSeconds,
    );
    if (exitTargetTs !== undefined &&
        sint(exitTargetTs, 64, 'exitTargetTs') !== expectedExit)
      fail('WRONG_TARGET');
    const exitNeed = authenticateOpenNeed(t1Need, rules, expectedExit);
    if (same(observed.need.key, exitNeed.key)) fail('SAME_NEED');
    const revealDeadlineTs = fixedRevealDeadline(
      exitNeed, economy.spec.revealWindowSeconds,
    );
    const expectedScoreDay = utcDay(revealDeadlineTs);
    if (scoreDay !== undefined &&
        sint(scoreDay, 64, 'scoreDay') !== expectedScoreDay)
      fail('WRONG_SCORE_DAY');
    return this._sealPrepared({
      economy, ruleset, player, signer, nonce, stake, commitment, now,
      entryTargetTs: entryTarget, exitTargetTs: expectedExit,
      entryNeed: observed.need.key, exitNeed: exitNeed.key,
      stateValue: SHOT_STATE.ACTIVE,
      entryRecord: observed.candidate.record,
      entryTimepinResultHash: observed.terminal.resultHash,
      revealDeadlineTs, scoreDay: expectedScoreDay,
      rentRefund, delegate, transientRentLamports,
      expectedRevision,
    });
  }

  _sealPrepared({
    economy, ruleset, player, signer, nonce, stake, commitment, now,
    entryTargetTs, exitTargetTs, entryNeed, exitNeed, stateValue,
    entryRecord, entryTimepinResultHash, revealDeadlineTs, scoreDay,
    rentRefund, delegate, transientRentLamports, expectedRevision,
  }) {
    const playerKey = nonzero32(player, 'player');
    if (!same(nonzero32(signer, 'signer'), playerKey))
      fail('PLAYER_SIGNATURE_REQUIRED');
    const nonceValue = uint(nonce, 64, 'nonce');
    const stakeValue = uint(stake, 64, 'stake');
    if (stakeValue < BigInt(economy.spec.minStake) ||
        stakeValue > BigInt(economy.spec.maxStake))
      fail('INVALID_STAKE');
    const commit = nonzero32(commitment, 'commitment');
    const rentRefundKey = nonzero32(rentRefund, 'rentRefund');
    const delegateKey = bytes32(delegate, 'delegate');
    const transientRent = uint(
      transientRentLamports, 64, 'transientRentLamports',
    );
    const xpBase = sealXp(ruleset.spec.baseXp, stakeValue);
    const payoutReserve = hitPayout(stakeValue, economy.spec);
    const xpReserve = terminalXpReserve(xpBase, economy.spec.settleXp);
    return this._tx(expectedRevision, state => {
      this._economy(state, economy.hash);
      this._ruleset(state, ruleset.hash, economy.hash);
      const ledger = this._ledger(state, economy.hash, playerKey);
      requireLedgerConservation(ledger);
      if (nonceValue !== ledger.nextShotNonce) fail('WRONG_SHOT_NONCE');
      if (ledger.open >= BigInt(economy.spec.maxOpen))
        fail('TOO_MANY_OPEN');
      if (ledger.credits < stakeValue) fail('INSUFFICIENT_CREDITS');
      const nonceKey = nonceIdentity(economy.hash, playerKey, nonceValue);
      if (state.usedNonces.has(nonceKey)) fail('NONCE_ALREADY_USED');
      const pda = deriveShotPda(
        this.#programId, economy.hash, playerKey, nonceValue,
      );
      const id = keyHex(pda.key);
      if (state.shots.has(id)) fail('SHOT_ALREADY_EXISTS');
      ledger.reservedPayoutCredits = addU64(
        ledger.reservedPayoutCredits, payoutReserve,
        'ledger.reservedPayoutCredits',
      );
      ledger.reservedXp = addU64(
        ledger.reservedXp, xpReserve, 'ledger.reservedXp',
      );
      ledger.credits = subU64(
        ledger.credits, stakeValue, 'INSUFFICIENT_CREDITS',
      );
      ledger.lockedCredits = addU64(
        ledger.lockedCredits, stakeValue, 'ledger.lockedCredits',
      );
      ledger.sealed = addU64(ledger.sealed, 1n, 'ledger.sealed');
      ledger.open = addU64(ledger.open, 1n, 'ledger.open');
      ledger.nextShotNonce = addU64(
        nonceValue, 1n, 'ledger.nextShotNonce',
      );
      this._reserveHistorySlot(
        state, economy.hash, playerKey, nonceValue,
      );
      requireLedgerConservation(ledger);
      const shot = {
        schema: CORE_G2_SCHEMA,
        key: pda.key,
        bump: pda.bump,
        economyHash: Buffer.from(economy.hash),
        rulesetHash: Buffer.from(ruleset.hash),
        player: playerKey,
        rentRefund: rentRefundKey,
        delegate: delegateKey,
        nonce: nonceValue,
        commit,
        entryMode: ruleset.spec.entryMode,
        state: stateValue,
        voidReason: null,
        stake: stakeValue,
        cleanupBondLamports: uint(
          economy.spec.cleanupBondLamports, 64, 'cleanupBondLamports',
        ),
        transientRentLamports: transientRent,
        xpBase,
        sealedTs: now,
        entryTargetTs,
        exitTargetTs,
        scoreDay: sint(scoreDay, 64, 'scoreDay'),
        rankShard: rankShardFor(playerKey),
        entryNeed: Buffer.from(entryNeed),
        exitNeed: Buffer.from(exitNeed),
        activationWorker: Buffer.from(ZERO_PUBKEY),
        activationSlot: 0n,
        activationTs: 0n,
        entryMessageHash: Buffer.from(ZERO32),
        entryTimepinResultHash: bytes32(
          entryTimepinResultHash, 'entryTimepinResultHash',
        ),
        entryPrice: 0n,
        entryConf: 0n,
        entryExponent: 0,
        entryPublishTime: 0n,
        exitMessageHash: Buffer.from(ZERO32),
        exitTimepinResultHash: Buffer.from(ZERO32),
        exitPrice: 0n,
        exitConf: 0n,
        exitExponent: 0,
        exitPublishTime: 0n,
        outcomeYes: 0,
        settledTs: 0n,
        resolutionSlot: 0n,
        revealDeadlineTs: sint(
          revealDeadlineTs, 64, 'revealDeadlineTs',
        ),
        side: SIDE.DOWN,
        pBps: 0,
        hit: 0,
        xpAwarded: 0n,
        resolver: Buffer.from(ZERO_PUBKEY),
        forfeitWorker: Buffer.from(ZERO_PUBKEY),
        terminalSlot: 0n,
        terminalTs: 0n,
        revealedSalt: Buffer.from(ZERO32),
        resolutionHash: Buffer.from(ZERO32),
        terminalHash: Buffer.from(ZERO32),
      };
      if (entryRecord) writeEntry(shot, entryRecord);
      state.shots.set(id, shot);
      state.usedNonces.add(nonceKey);
      return { value: shot };
    });
  }

  activateEntry({
    shot: shotKey, fact, actor, nowTs, currentSlot, expectedRevision,
  }) {
    const current = this._shot(this.#state, shotKey);
    if (current.state !== SHOT_STATE.PENDING_ENTRY)
      fail('SHOT_NOT_PENDING_ENTRY');
    const rules = this._shotRules(this.#state, current);
    const authenticated = authenticateTerminalFact(
      fact, rules, current.entryNeed, current.entryTargetTs,
    );
    requireTerminalVisible(authenticated, nowTs);
    if (authenticated.terminal.terminalKind !== TIMEPIN_STATE.FINAL)
      fail('SHOT_MUST_VOID');
    const worker = nonzero32(actor, 'actor');
    const now = sint(nowTs, 64, 'nowTs');
    const slot = uint(currentSlot, 64, 'currentSlot');
    return this._tx(expectedRevision, state => {
      const shot = this._shot(state, shotKey);
      if (shot.state !== SHOT_STATE.PENDING_ENTRY)
        fail('SHOT_NOT_PENDING_ENTRY');
      writeEntry(shot, authenticated.candidate.record);
      shot.entryTimepinResultHash = Buffer.from(
        authenticated.terminal.resultHash,
      );
      shot.state = SHOT_STATE.ACTIVE;
      shot.activationWorker = worker;
      shot.activationSlot = slot;
      shot.activationTs = now;
      this._completeWorkIfPresent(
        state, shot, WORK_KIND.ACTIVATE_ENTRY,
        RECEIPT_DISPOSITION.PAYABLE, worker,
        shot.entryTimepinResultHash, slot,
      );
      return { value: shot };
    });
  }

  voidPendingEntry({
    shot: shotKey, fact, actor, nowTs, currentSlot, expectedRevision,
  }) {
    const current = this._shot(this.#state, shotKey);
    if (current.state !== SHOT_STATE.PENDING_ENTRY)
      fail('SHOT_NOT_PENDING_ENTRY');
    const rules = this._shotRules(this.#state, current);
    const authenticated = authenticateTerminalFact(
      fact, rules, current.entryNeed, current.entryTargetTs,
    );
    requireTerminalVisible(authenticated, nowTs);
    let reason;
    if (authenticated.terminal.terminalKind === TIMEPIN_STATE.EXPIRED)
      reason = VOID_REASON.ENTRY_EXPIRED;
    else if (authenticated.terminal.terminalKind === TIMEPIN_STATE.AMBIGUOUS)
      reason = VOID_REASON.ENTRY_AMBIGUOUS;
    else fail('SHOT_MUST_ACTIVATE');
    const worker = nonzero32(actor, 'actor');
    const now = sint(nowTs, 64, 'nowTs');
    const slot = uint(currentSlot, 64, 'currentSlot');
    return this._tx(expectedRevision, state => {
      const shot = this._shot(state, shotKey);
      if (shot.state !== SHOT_STATE.PENDING_ENTRY)
        fail('SHOT_NOT_PENDING_ENTRY');
      shot.entryTimepinResultHash = Buffer.from(
        authenticated.terminal.resultHash,
      );
      this._refundVoid(state, shot, reason, worker, now, slot);
      this._completeWorkIfPresent(
        state, shot, WORK_KIND.ACTIVATE_ENTRY,
        RECEIPT_DISPOSITION.NONPAYABLE, ZERO_PUBKEY,
        shot.terminalHash, slot,
      );
      this._completeWorkIfPresent(
        state, shot, WORK_KIND.RESOLVE_SHOT,
        RECEIPT_DISPOSITION.PAYABLE, worker,
        shot.resolutionHash, slot,
      );
      return { value: this._archiveTerminal(state, shot, worker, slot) };
    });
  }

  settleFinal({
    shot: shotKey, fact, actor, nowTs, currentSlot, expectedRevision,
  }) {
    const current = this._shot(this.#state, shotKey);
    if (current.state !== SHOT_STATE.ACTIVE) fail('SHOT_NOT_ACTIVE');
    const rules = this._shotRules(this.#state, current);
    const authenticated = authenticateTerminalFact(
      fact, rules, current.exitNeed, current.exitTargetTs,
    );
    requireTerminalVisible(authenticated, nowTs);
    if (authenticated.terminal.terminalKind !== TIMEPIN_STATE.FINAL)
      fail('SHOT_MUST_VOID');
    const entryScaled = scaleToE12(
      current.entryPrice, current.entryExponent,
    );
    const exitScaled = scaleToE12(
      authenticated.candidate.record.price,
      authenticated.candidate.record.exponent,
    );
    const delta = exitScaled >= entryScaled
      ? exitScaled - entryScaled : entryScaled - exitScaled;
    const entryConf = scaleConfToE12(
      current.entryConf, current.entryExponent,
    );
    const exitConf = scaleConfToE12(
      authenticated.candidate.record.conf,
      authenticated.candidate.record.exponent,
    );
    const referenceConf = entryConf > exitConf ? entryConf : exitConf;
    const inBand = delta * BigInt(rules.bandDenominator) <=
      referenceConf * BigInt(rules.bandNumerator);
    const worker = nonzero32(actor, 'actor');
    const now = sint(nowTs, 64, 'nowTs');
    const slot = uint(currentSlot, 64, 'currentSlot');
    const economy = this._economy(this.#state, current.economyHash);
    return this._tx(expectedRevision, state => {
      const shot = this._shot(state, shotKey);
      if (shot.state !== SHOT_STATE.ACTIVE) fail('SHOT_NOT_ACTIVE');
      writeExit(shot, authenticated.candidate.record);
      shot.exitTimepinResultHash = Buffer.from(
        authenticated.terminal.resultHash,
      );
      shot.resolver = worker;
      shot.settledTs = now;
      shot.resolutionSlot = slot;
      if (delta === 0n ||
          (rules.bandNumerator > 0 && inBand)) {
        const reason = delta === 0n
          ? VOID_REASON.EQUALITY : VOID_REASON.CONFIDENCE_BAND;
        shot.state = SHOT_STATE.AWAITING_VOID;
        shot.voidReason = reason;
        shot.outcomeYes = 0;
      } else {
        shot.state = SHOT_STATE.AWAITING_REVEAL;
        shot.voidReason = null;
        shot.outcomeYes = exitScaled > entryScaled ? 1 : 0;
      }
      shot.resolutionHash = resolutionHash(shot);
      shot.terminalHash = Buffer.from(ZERO32);
      requireLedgerConservation(
        this._ledger(state, shot.economyHash, shot.player),
      );
      this._completeWorkIfPresent(
        state, shot, WORK_KIND.RESOLVE_SHOT,
        RECEIPT_DISPOSITION.PAYABLE, worker,
        shot.resolutionHash, slot,
      );
      return { value: shot };
    });
  }

  voidActiveShot({
    shot: shotKey, fact, actor, nowTs, currentSlot, expectedRevision,
  }) {
    const current = this._shot(this.#state, shotKey);
    if (current.state !== SHOT_STATE.ACTIVE) fail('SHOT_NOT_ACTIVE');
    const rules = this._shotRules(this.#state, current);
    const authenticated = authenticateTerminalFact(
      fact, rules, current.exitNeed, current.exitTargetTs,
    );
    requireTerminalVisible(authenticated, nowTs);
    let reason;
    if (authenticated.terminal.terminalKind === TIMEPIN_STATE.EXPIRED)
      reason = VOID_REASON.EXIT_EXPIRED;
    else if (authenticated.terminal.terminalKind === TIMEPIN_STATE.AMBIGUOUS)
      reason = VOID_REASON.EXIT_AMBIGUOUS;
    else fail('SHOT_MUST_SETTLE');
    const worker = nonzero32(actor, 'actor');
    const now = sint(nowTs, 64, 'nowTs');
    const slot = uint(currentSlot, 64, 'currentSlot');
    return this._tx(expectedRevision, state => {
      const shot = this._shot(state, shotKey);
      if (shot.state !== SHOT_STATE.ACTIVE) fail('SHOT_NOT_ACTIVE');
      shot.exitTimepinResultHash = Buffer.from(
        authenticated.terminal.resultHash,
      );
      this._refundVoid(state, shot, reason, worker, now, slot);
      this._completeWorkIfPresent(
        state, shot, WORK_KIND.RESOLVE_SHOT,
        RECEIPT_DISPOSITION.PAYABLE, worker,
        shot.resolutionHash, slot,
      );
      return { value: this._archiveTerminal(state, shot, worker, slot) };
    });
  }

  finalizeResolvedVoid({
    shot: shotKey, actor, nowTs, currentSlot, expectedRevision,
  }) {
    const current = this._shot(this.#state, shotKey);
    if (current.state !== SHOT_STATE.AWAITING_VOID)
      fail('SHOT_NOT_AWAITING_VOID');
    const worker = nonzero32(actor, 'actor');
    const now = sint(nowTs, 64, 'nowTs');
    const slot = uint(currentSlot, 64, 'currentSlot');
    return this._tx(expectedRevision, state => {
      const shot = this._shot(state, shotKey);
      if (shot.state !== SHOT_STATE.AWAITING_VOID)
        fail('SHOT_NOT_AWAITING_VOID');
      const economy = this._economy(state, shot.economyHash).spec;
      const ledger = this._ledger(state, shot.economyHash, shot.player);
      this._releaseTerminalCapacity(ledger, shot, economy);
      ledger.lockedCredits = subU64(
        ledger.lockedCredits, shot.stake, 'LOCKED_CREDITS_UNDERFLOW',
      );
      ledger.credits = addU64(ledger.credits, shot.stake, 'ledger.credits');
      ledger.refundedCredits = addU64(
        ledger.refundedCredits, shot.stake, 'ledger.refundedCredits',
      );
      ledger.open = subU64(ledger.open, 1n, 'OPEN_COUNTER_UNDERFLOW');
      ledger.voids = addU64(ledger.voids, 1n, 'ledger.voids');
      shot.state = SHOT_STATE.VOID;
      shot.terminalSlot = slot;
      shot.terminalTs = now;
      shot.terminalHash = terminalHash(shot);
      requireLedgerConservation(ledger);
      return { value: this._archiveTerminal(state, shot, worker, slot) };
    });
  }

  reveal({
    shot: shotKey, side, probability, salt, player, signer = player,
    nowTs, currentSlot, expectedRevision,
  }) {
    const current = this._shot(this.#state, shotKey);
    if (current.state !== SHOT_STATE.AWAITING_REVEAL)
      fail('SHOT_NOT_AWAITING_REVEAL');
    const playerKey = nonzero32(player, 'player');
    if (!same(playerKey, current.player) ||
        !same(nonzero32(signer, 'signer'), current.player))
      fail('PLAYER_SIGNATURE_REQUIRED');
    const now = sint(nowTs, 64, 'nowTs');
    if (now < current.settledTs) fail('REVEAL_BEFORE_SETTLEMENT');
    if (now >= current.revealDeadlineTs) fail('REVEAL_DEADLINE_PASSED');
    const sideValue = numberUint(side, 8, 'side');
    const pBps = numberUint(probability, 16, 'probability');
    const expected = commitmentHash({
      programId: this.#programId,
      economyHash: current.economyHash,
      rulesetHash: current.rulesetHash,
      player: current.player,
      nonce: current.nonce,
      side: sideValue,
      probability: pBps,
      salt,
    });
    if (!same(expected, current.commit)) fail('BAD_REVEAL');
    const score = brierScore(sideValue, pBps, current.outcomeYes === 1);
    const hit = (sideValue === SIDE.UP) === (current.outcomeYes === 1);
    const economy = this._economy(this.#state, current.economyHash);
    const slot = uint(currentSlot, 64, 'currentSlot');
    return this._tx(expectedRevision, state => {
      const shot = this._shot(state, shotKey);
      if (shot.state !== SHOT_STATE.AWAITING_REVEAL)
        fail('SHOT_NOT_AWAITING_REVEAL');
      const ledger = this._ledger(state, shot.economyHash, shot.player);
      this._releaseTerminalCapacity(ledger, shot, economy.spec);
      this._retireLockedStake(ledger, shot.stake);
      ledger.shots = addU64(ledger.shots, 1n, 'ledger.shots');
      ledger.brierSum = addU128(ledger.brierSum, score, 'ledger.brierSum');
      let gained;
      if (hit) {
        const payout = hitPayout(shot.stake, economy.spec);
        ledger.credits = addU64(ledger.credits, payout, 'ledger.credits');
        ledger.payoutCredits = addU64(
          ledger.payoutCredits, payout, 'ledger.payoutCredits',
        );
        ledger.hits = addU64(ledger.hits, 1n, 'ledger.hits');
        gained = addU64(
          shot.xpBase, economy.spec.settleXp, 'gainedXp',
        );
      } else {
        gained = uint(economy.spec.settleXp, 64, 'settleXp');
      }
      ledger.xp = addU64(ledger.xp, gained, 'ledger.xp');
      ledger.earnedXp = addU64(
        ledger.earnedXp, gained, 'ledger.earnedXp',
      );
      shot.state = SHOT_STATE.REVEALED;
      shot.side = sideValue;
      shot.pBps = pBps;
      shot.hit = hit ? 1 : 0;
      shot.xpAwarded = gained;
      shot.revealedSalt = bytes32(salt, 'salt');
      shot.terminalSlot = slot;
      shot.terminalTs = now;
      shot.terminalHash = terminalHash(shot);
      requireLedgerConservation(ledger);
      return {
        value: this._archiveTerminal(
          state, shot, shot.player, slot,
        ),
      };
    });
  }

  forfeit({
    shot: shotKey, actor, nowTs, currentSlot, expectedRevision,
  }) {
    const current = this._shot(this.#state, shotKey);
    if (current.state !== SHOT_STATE.AWAITING_REVEAL)
      fail('SHOT_NOT_AWAITING_REVEAL');
    const now = sint(nowTs, 64, 'nowTs');
    if (now < current.revealDeadlineTs) fail('FORFEIT_TOO_EARLY');
    const worker = nonzero32(actor, 'actor');
    const slot = uint(currentSlot, 64, 'currentSlot');
    const economy = this._economy(this.#state, current.economyHash);
    return this._tx(expectedRevision, state => {
      const shot = this._shot(state, shotKey);
      if (shot.state !== SHOT_STATE.AWAITING_REVEAL)
        fail('SHOT_NOT_AWAITING_REVEAL');
      const ledger = this._ledger(state, shot.economyHash, shot.player);
      this._releaseTerminalCapacity(ledger, shot, economy.spec);
      this._retireLockedStake(ledger, shot.stake);
      ledger.shots = addU64(ledger.shots, 1n, 'ledger.shots');
      ledger.forfeits = addU64(
        ledger.forfeits, 1n, 'ledger.forfeits',
      );
      ledger.streak = 0n;
      ledger.brierSum = addU128(
        ledger.brierSum, BRIER_SCALE, 'ledger.brierSum',
      );
      shot.state = SHOT_STATE.FORFEITED;
      shot.forfeitWorker = worker;
      shot.terminalSlot = slot;
      shot.terminalTs = now;
      shot.terminalHash = terminalHash(shot);
      requireLedgerConservation(ledger);
      this._completeWorkIfPresent(
        state, shot, WORK_KIND.FORFEIT,
        RECEIPT_DISPOSITION.PAYABLE, worker,
        shot.terminalHash, slot,
      );
      return { value: this._archiveTerminal(state, shot, worker, slot) };
    });
  }

  reserveWork({
    shot: shotKey, workKind, expectedIndex, expectedRevision,
  }) {
    const kind = numberUint(workKind, 8, 'workKind');
    if (!Object.values(WORK_KIND).includes(kind)) fail('BAD_WORK_KIND');
    const index = numberUint(expectedIndex, 8, 'expectedIndex');
    return this._tx(expectedRevision, state => {
      const shot = this._shot(state, shotKey);
      if (!this._workReservable(shot, kind)) fail('WORK_NOT_RESERVABLE');
      const page = this._getWorkPage(
        state, shot.economyHash, shot.player,
        historyPageIndex(shot.nonce), true,
      );
      const existing = page.records.findIndex(record =>
        same(record.subject, shot.key) && record.workKind === kind);
      if (existing >= 0) {
        if (existing !== index) fail('WRONG_WORK_RECORD_INDEX');
        return {
          noChange: true,
          value: { page: page.key, index: existing, record: page.records[existing] },
        };
      }
      if (page.records.length >= WORK_PAGE_CAP) fail('WORK_PAGE_FULL');
      if (page.records.length !== index) fail('WRONG_WORK_RECORD_INDEX');
      const record = {
        subject: Buffer.from(shot.key),
        workKind: kind,
        disposition: RECEIPT_DISPOSITION.PENDING,
        worker: Buffer.from(ZERO_PUBKEY),
        resultHash: Buffer.from(ZERO32),
        completedSlot: 0n,
      };
      validateWorkRecord(record);
      page.records.push(record);
      this._validateWorkPage(page);
      return {
        value: { page: page.key, index, record },
      };
    });
  }

  ledger(economyHashValue, player) {
    return clone(this._ledger(this.#state, economyHashValue, player));
  }

  shot(shotKey) {
    return clone(this._shot(this.#state, shotKey));
  }

  receipt(shotKey, workKind) {
    const key = bytes32(shotKey, 'shot');
    const kind = numberUint(workKind, 8, 'workKind');
    for (const page of this.#state.workPages.values()) {
      const value = page.records.find(record =>
        same(record.subject, key) && record.workKind === kind);
      if (value) {
        if (value.disposition === RECEIPT_DISPOSITION.PENDING)
          fail('WORK_RECORD_PENDING');
        return clone(value);
      }
    }
    fail('RECEIPT_NOT_FOUND');
  }

  historyPage(economyHashValue, player, pageIndex) {
    const pda = deriveHistoryPagePda(
      this.#programId, economyHashValue, player, pageIndex,
    );
    const page = this.#state.historyPages.get(keyHex(pda.key));
    if (!page) fail('HISTORY_PAGE_NOT_FOUND');
    this._validateHistoryPage(page);
    return clone(page);
  }

  // M3: the page no longer stores rows, so this reads the row from the archive
  // - which is where the program puts it too, in the ShotArchived event - and
  // then CHECKS IT AGAINST THE PAGE. That is strictly stronger than the old
  // version: it used to return whatever the page held, trusting the same
  // structure it was reading from. Now the page has to agree.
  historyResult(economyHashValue, player, nonce) {
    const page = this.historyPage(
      economyHashValue, player, historyPageIndex(nonce),
    );
    const slot = historyPageSlot(nonce);
    if (!(page.terminalMask & (1 << slot))) fail('HISTORY_RESULT_NOT_TERMINAL');
    const shotKey = deriveShotPda(
      this.#programId, economyHashValue, player, nonce,
    ).key;
    const archive = this.#state.closedShots.get(keyHex(shotKey));
    if (!archive) fail('HISTORY_RESULT_NOT_TERMINAL');
    if (!same(archive.historyRowHash, historyRowHash(nonce, archive.result)))
      fail('WRONG_HISTORY_ROW_HASH');
    return clone(archive.result);
  }

  reloadHistoryPage(economyHashValue, player, pageIndex) {
    const page = this._getReloadHistoryPage(
      this.#state, economyHashValue, player, pageIndex, false,
    );
    if (!page) fail('RELOAD_HISTORY_PAGE_NOT_FOUND');
    return clone(page);
  }

  workPage(economyHashValue, player, pageIndex) {
    const pda = deriveWorkPagePda(
      this.#programId, economyHashValue, player, pageIndex,
    );
    const page = this.#state.workPages.get(keyHex(pda.key));
    if (!page) fail('WORK_PAGE_NOT_FOUND');
    this._validateWorkPage(page);
    return clone(page);
  }

  closedShot(shotKey) {
    const value = this.#state.closedShots.get(keyHex(shotKey));
    if (!value) fail('CLOSED_SHOT_NOT_FOUND');
    return clone(value);
  }

  lamportAccounting(address) {
    const id = keyHex(address);
    return {
      rentRefund: this.#state.lamportRefunds.get(id) || 0n,
      cleanupReward: this.#state.cleanupRewards.get(id) || 0n,
      actorTopup: this.#state.actorTopups.get(id) || 0n,
    };
  }

  audit() {
    for (const economy of this.#state.economies.values())
      this._auditEconomy(this.#state, economy);
    return true;
  }

  _economy(state, economyHashValue) {
    const hash = bytes32(economyHashValue, 'economyHash');
    const record = state.economies.get(keyHex(hash));
    if (!record) fail('ECONOMY_NOT_FOUND');
    const canonical = encodeEconomy(record.spec);
    const recomputed = economyHash(record.spec);
    if (!same(recomputed, record.hash) || !same(recomputed, hash))
      fail('CORRUPT_ECONOMY');
    authenticateContentAccount({
      programId: this.#programId, account: record.account,
      expectedHash: recomputed, expectedData: canonical,
      expectedDisc: ECONOMY_DISCRIMINATOR,
      expectedLength: ECONOMY_ACCOUNT_LEN, type: 'economy',
      code: 'ECONOMY_ACCOUNT',
    });
    return record;
  }

  _ruleset(state, rulesetHashValue, expectedEconomyHash) {
    const hash = bytes32(rulesetHashValue, 'rulesetHash');
    const record = state.rulesets.get(keyHex(hash));
    if (!record) fail('RULESET_NOT_FOUND');
    if (!same(record.economyHash, expectedEconomyHash))
      fail('CROSS_ECONOMY_RULESET');
    const economy = this._economy(state, record.economyHash);
    const canonical = encodeRuleset(record.spec, economy.spec);
    const recomputed = rulesetHash(record.spec, economy.spec);
    const leaf = rulesetPolicyHash(record.spec, economy.spec);
    const evidenceSpec = authenticateTimepinEvidenceSpec({
      account: record.evidenceSpecAccount,
      timepinProgram: economy.spec.timepinProgram,
      evidenceSpecHash: record.spec.evidenceSpecHash,
    });
    requireTimepinSpecRulesetMatch(evidenceSpec, record.spec);
    if (!same(recomputed, record.hash) || !same(recomputed, hash) ||
        !same(leaf, record.policyHash) ||
        !verifyRulesetPolicyProof(
          leaf, record.policyProof, economy.spec.rulesetPolicyRoot,
        ))
      fail('CORRUPT_RULESET');
    authenticateContentAccount({
      programId: this.#programId, account: record.account,
      expectedHash: recomputed, expectedData: canonical,
      expectedDisc: RULESET_DISCRIMINATOR,
      expectedLength: RULESET_ACCOUNT_LEN, type: 'ruleset',
      code: 'RULESET_ACCOUNT',
    });
    return record;
  }

  _hydratedRules(ruleset, economy) {
    return {
      ...ruleset.spec,
      timepinProgram: Buffer.from(economy.spec.timepinProgram),
      evidenceSpec: clone(ruleset.evidenceSpec),
    };
  }

  _shotRules(state, shot) {
    const economy = this._economy(state, shot.economyHash);
    const ruleset = this._ruleset(
      state, shot.rulesetHash, shot.economyHash,
    );
    return this._hydratedRules(ruleset, economy);
  }

  _getOrCreateLedger(state, economyHashValue, player) {
    const pda = deriveLedgerPda(
      this.#programId, economyHashValue, player,
    );
    const id = keyHex(pda.key);
    if (state.ledgers.has(id))
      return { ledger: this._ledger(state, economyHashValue, player), created: false };
    const ledger = emptyLedger(
      this.#programId, economyHashValue, player,
    );
    state.ledgers.set(id, ledger);
    if (state._cow) state._cow.ledgers.add(id);
    return { ledger, created: true };
  }

  _ledger(state, economyHashValue, player) {
    this._economy(state, economyHashValue);
    const pda = deriveLedgerPda(
      this.#programId, economyHashValue, player,
    );
    const id = keyHex(pda.key);
    let ledger = state.ledgers.get(id);
    if (!ledger) fail('LEDGER_NOT_FOUND');
    if (ledger.schema !== CORE_G2_SCHEMA ||
        !same(ledger.key, pda.key) || ledger.bump !== pda.bump ||
        !same(ledger.economyHash, economyHashValue) ||
        !same(ledger.player, player))
      fail('CORRUPT_LEDGER');
    if (state._cow && !state._cow.ledgers.has(id)) {
      ledger = clone(ledger);
      state.ledgers.set(id, ledger);
      state._cow.ledgers.add(id);
    }
    return ledger;
  }

  _shot(state, shotKey) {
    const key = bytes32(shotKey, 'shot');
    const id = keyHex(key);
    let shot = state.shots.get(id);
    if (!shot) fail('SHOT_NOT_FOUND');
    const pda = deriveShotPda(
      this.#programId, shot.economyHash, shot.player, shot.nonce,
    );
    if (shot.schema !== CORE_G2_SCHEMA ||
        !same(key, shot.key) || !same(pda.key, shot.key) ||
        shot.bump !== pda.bump ||
        !state.usedNonces.has(nonceIdentity(
          shot.economyHash, shot.player, shot.nonce,
        )))
      fail('CORRUPT_SHOT');
    this._ruleset(state, shot.rulesetHash, shot.economyHash);
    if (state._cow && !state._cow.shots.has(id)) {
      shot = clone(shot);
      state.shots.set(id, shot);
      state._cow.shots.add(id);
    }
    return shot;
  }

  _validateHistoryPage(page) {
    if (page.schema !== CORE_G2_SCHEMA ||
        bytes32(page.economyHash, 'page.economyHash').equals(ZERO32) ||
        bytes32(page.player, 'page.player').equals(ZERO_PUBKEY))
      fail('INVALID_HISTORY_PAGE');
    const pending = numberUint(page.pendingCount, 8, 'page.pendingCount');
    const mask = numberUint(page.terminalMask, 16, 'page.terminalMask');
    // No bit above the slots actually appended. Mirrors state.rs
    // validate_contents; the Rust widens the shift to u32 because u16 >> 16 is
    // an overflow shift there, and JS shifts are 32-bit so this is already safe.
    if (pending > HISTORY_PAGE_CAP || (mask >>> pending) !== 0)
      fail('INVALID_HISTORY_PAGE');
    bytes32(page.resultsRoot, 'page.resultsRoot');
    // NOTE, deliberately NOT a check here: "an empty page has the zero root and
    // a page with terminal rows does not" is true, but state.rs
    // validate_contents does not test it, and a mirror that REJECTS states the
    // program ACCEPTS is not a mirror - it is a second opinion that can fail on
    // a page the chain is perfectly happy with. The property is covered where it
    // belongs, in audit(), which replays the fold and proves the exact root
    // rather than merely that it is non-zero.
    const pda = deriveHistoryPagePda(
      this.#programId, page.economyHash, page.player, page.pageIndex,
    );
    if (!same(page.key, pda.key) || page.bump !== pda.bump)
      fail('WRONG_HISTORY_PAGE_PDA');
    // The row-shape checks that used to run here, over rows committed long ago,
    // now run in _archiveTerminal on the row about to be folded - strictly
    // earlier, and on the only row that can still be wrong.
    historyPageSerializedLen(page);
    return true;
  }

  _getHistoryPage(state, economyHashValue, player, pageIndex, create) {
    const pda = deriveHistoryPagePda(
      this.#programId, economyHashValue, player, pageIndex,
    );
    const id = keyHex(pda.key);
    let page = state.historyPages.get(id);
    if (!page) {
      if (!create) return null;
      page = {
        schema: CORE_G2_SCHEMA,
        key: pda.key,
        bump: pda.bump,
        economyHash: bytes32(economyHashValue, 'economyHash'),
        player: bytes32(player, 'player'),
        pageIndex: uint(pageIndex, 64, 'pageIndex'),
        // M3: no rows. pendingCount replaces slots.length, terminalMask
        // replaces slots[i] !== null, resultsRoot is the commitment over the
        // rows themselves - which now live in closedShots, not here.
        pendingCount: 0,
        terminalMask: 0,
        resultsRoot: Buffer.from(ZERO32),
      };
      state.historyPages.set(id, page);
      if (state._cow) state._cow.historyPages.add(id);
    } else if (state._cow && !state._cow.historyPages.has(id)) {
      page = clone(page);
      state.historyPages.set(id, page);
      state._cow.historyPages.add(id);
    }
    this._validateHistoryPage(page);
    return page;
  }

  _validateReloadHistoryPage(page) {
    if (page.schema !== CORE_G2_SCHEMA ||
        bytes32(page.economyHash, 'reloadPage.economyHash').equals(ZERO32) ||
        bytes32(page.player, 'reloadPage.player').equals(ZERO_PUBKEY) ||
        !Array.isArray(page.records) ||
        page.records.length > RELOAD_HISTORY_PAGE_CAP)
      fail('INVALID_RELOAD_HISTORY_PAGE');
    const pda = deriveReloadHistoryPagePda(
      this.#programId, page.economyHash, page.player, page.pageIndex,
    );
    if (!same(page.key, pda.key) || page.bump !== pda.bump)
      fail('WRONG_RELOAD_HISTORY_PAGE_PDA');
    reloadHistoryPageSerializedLen(page.records);
    return true;
  }

  _getReloadHistoryPage(
    state, economyHashValue, player, pageIndex, create,
  ) {
    const pda = deriveReloadHistoryPagePda(
      this.#programId, economyHashValue, player, pageIndex,
    );
    const id = keyHex(pda.key);
    let page = state.reloadHistoryPages.get(id);
    if (!page) {
      if (!create) return null;
      page = {
        schema: CORE_G2_SCHEMA,
        key: pda.key,
        bump: pda.bump,
        economyHash: bytes32(economyHashValue, 'economyHash'),
        player: bytes32(player, 'player'),
        pageIndex: uint(pageIndex, 64, 'pageIndex'),
        records: [],
      };
      state.reloadHistoryPages.set(id, page);
      if (state._cow) state._cow.reloadHistoryPages.add(id);
    } else if (state._cow && !state._cow.reloadHistoryPages.has(id)) {
      page = clone(page);
      state.reloadHistoryPages.set(id, page);
      state._cow.reloadHistoryPages.add(id);
    }
    this._validateReloadHistoryPage(page);
    return page;
  }

  _reserveHistorySlot(state, economyHashValue, player, nonce) {
    const pageIndex = historyPageIndex(nonce);
    const slot = historyPageSlot(nonce);
    const page = this._getHistoryPage(
      state, economyHashValue, player, pageIndex, true,
    );
    if (page.pendingCount >= HISTORY_PAGE_CAP) fail('HISTORY_PAGE_FULL');
    if (slot !== page.pendingCount) fail('HISTORY_APPEND_OUT_OF_ORDER');
    page.pendingCount += 1;
    this._validateHistoryPage(page);
    return { page, slot };
  }

  _validateWorkPage(page) {
    if (page.schema !== CORE_G2_SCHEMA ||
        bytes32(page.economyHash, 'page.economyHash').equals(ZERO32) ||
        bytes32(page.player, 'page.player').equals(ZERO_PUBKEY) ||
        !Array.isArray(page.records) || page.records.length > WORK_PAGE_CAP)
      fail('INVALID_WORK_PAGE');
    const pda = deriveWorkPagePda(
      this.#programId, page.economyHash, page.player, page.pageIndex,
    );
    if (!same(page.key, pda.key) || page.bump !== pda.bump)
      fail('WRONG_WORK_PAGE_PDA');
    const seen = new Set();
    for (const record of page.records) {
      validateWorkRecord(record);
      const id = receiptIdentity(record.subject, record.workKind);
      if (seen.has(id)) fail('DUPLICATE_WORK_RECORD');
      seen.add(id);
    }
    workPageSerializedLen(page.records);
    return true;
  }

  _getWorkPage(state, economyHashValue, player, pageIndex, create) {
    const pda = deriveWorkPagePda(
      this.#programId, economyHashValue, player, pageIndex,
    );
    const id = keyHex(pda.key);
    let page = state.workPages.get(id);
    if (!page) {
      if (!create) return null;
      page = {
        schema: CORE_G2_SCHEMA,
        key: pda.key,
        bump: pda.bump,
        economyHash: bytes32(economyHashValue, 'economyHash'),
        player: bytes32(player, 'player'),
        pageIndex: uint(pageIndex, 64, 'pageIndex'),
        records: [],
      };
      state.workPages.set(id, page);
      if (state._cow) state._cow.workPages.add(id);
    } else if (state._cow && !state._cow.workPages.has(id)) {
      page = clone(page);
      state.workPages.set(id, page);
      state._cow.workPages.add(id);
    }
    this._validateWorkPage(page);
    return page;
  }

  _workReservable(shot, workKind) {
    if (workKind === WORK_KIND.ACTIVATE_ENTRY)
      return shot.entryMode === ENTRY_MODE.FORWARD_ENTRY &&
        shot.state === SHOT_STATE.PENDING_ENTRY &&
        shot.activationWorker.equals(ZERO_PUBKEY);
    if (workKind === WORK_KIND.RESOLVE_SHOT)
      return (shot.state === SHOT_STATE.PENDING_ENTRY ||
        shot.state === SHOT_STATE.ACTIVE) &&
        shot.resolver.equals(ZERO_PUBKEY);
    if (workKind === WORK_KIND.FORFEIT)
      return (shot.state === SHOT_STATE.PENDING_ENTRY ||
        shot.state === SHOT_STATE.ACTIVE ||
        shot.state === SHOT_STATE.AWAITING_REVEAL) &&
        shot.forfeitWorker.equals(ZERO_PUBKEY);
    fail('BAD_WORK_KIND');
  }

  _workRecord(state, shot, workKind) {
    const page = this._getWorkPage(
      state, shot.economyHash, shot.player,
      historyPageIndex(shot.nonce), false,
    );
    if (!page) return null;
    const index = page.records.findIndex(record =>
      same(record.subject, shot.key) && record.workKind === workKind);
    return index < 0 ? null : { page, index, record: page.records[index] };
  }

  _completeWorkIfPresent(
    state, shot, workKind, disposition, worker, factHash, completedSlot,
  ) {
    const located = this._workRecord(state, shot, workKind);
    if (!located) return false;
    if (located.record.disposition !== RECEIPT_DISPOSITION.PENDING)
      fail('WORK_RECORD_NOT_PENDING');
    const workerKey = bytes32(worker, 'worker');
    const record = {
      subject: Buffer.from(shot.key),
      workKind,
      disposition,
      worker: workerKey,
      resultHash: completionResultHash({
        programId: this.#programId,
        subject: shot.key,
        workKind,
        factHash,
        disposition,
        worker: workerKey,
      }),
      completedSlot: uint(completedSlot, 64, 'completedSlot'),
    };
    validateWorkRecord(record);
    located.page.records[located.index] = record;
    this._validateWorkPage(located.page);
    return true;
  }

  _creditLamports(map, address, amount) {
    const id = keyHex(address);
    map.set(id, addU64(map.get(id) || 0n, amount, 'lamportCredit'));
  }

  _archiveTerminal(state, shot, terminalActor, completedSlot) {
    if (!terminalState(shot.state) ||
        !same(shot.resolutionHash, resolutionHash(shot)) ||
        !same(shot.terminalHash, terminalHash(shot)))
      fail('INVALID_TERMINAL_SHOT');
    if (shot.terminalSlot < shot.resolutionSlot ||
        shot.terminalTs < shot.settledTs)
      fail('INVALID_TERMINAL_SHOT');
    const { result, facts } = compactResultFromShot(this.#programId, shot);
    const page = this._getHistoryPage(
      state, shot.economyHash, shot.player,
      historyPageIndex(shot.nonce), false,
    );
    if (!page) fail('HISTORY_PAGE_NOT_FOUND');
    const slot = historyPageSlot(shot.nonce);
    if (slot >= page.pendingCount) fail('HISTORY_SLOT_MISSING');
    const bit = 1 << slot;
    if (page.terminalMask & bit) fail('HISTORY_SLOT_ALREADY_TERMINAL');
    // Shape is checked BEFORE the fold, not after on a row read back. A bad row
    // is never committed in the first place.
    validateCompactResultShape(result);
    if (bytes32(result.gameResultHash, 'result.gameResultHash')
      .equals(ZERO32)) fail('INVALID_HISTORY_PAGE');
    const rowHash = historyRowHash(shot.nonce, result);
    page.resultsRoot = historyChainFold(page.resultsRoot, rowHash);
    page.terminalMask |= bit;
    // 1-based, and it is the FOLD order an off-chain reader must replay.
    const sequence = popcount16(page.terminalMask);
    this._validateHistoryPage(page);

    const terminalSlot = uint(completedSlot, 64, 'completedSlot');
    const forfeit = this._workRecord(state, shot, WORK_KIND.FORFEIT);
    if (forfeit &&
        forfeit.record.disposition === RECEIPT_DISPOSITION.PENDING) {
      const payable = shot.state === SHOT_STATE.FORFEITED;
      this._completeWorkIfPresent(
        state, shot, WORK_KIND.FORFEIT,
        payable
          ? RECEIPT_DISPOSITION.PAYABLE
          : RECEIPT_DISPOSITION.NONPAYABLE,
        payable ? shot.forfeitWorker : ZERO_PUBKEY,
        shot.terminalHash, terminalSlot,
      );
    }
    for (const kind of [
      WORK_KIND.ACTIVATE_ENTRY, WORK_KIND.RESOLVE_SHOT,
    ]) {
      const pending = this._workRecord(state, shot, kind);
      if (!pending ||
          pending.record.disposition !== RECEIPT_DISPOSITION.PENDING)
        continue;
      if (kind === WORK_KIND.ACTIVATE_ENTRY &&
          shot.activationWorker.equals(ZERO_PUBKEY)) {
        this._completeWorkIfPresent(
          state, shot, kind, RECEIPT_DISPOSITION.NONPAYABLE,
          ZERO_PUBKEY, shot.terminalHash, terminalSlot,
        );
      } else {
        const worker = kind === WORK_KIND.ACTIVATE_ENTRY
          ? shot.activationWorker : shot.resolver;
        const fact = kind === WORK_KIND.ACTIVATE_ENTRY
          ? shot.entryTimepinResultHash : shot.resolutionHash;
        this._completeWorkIfPresent(
          state, shot, kind, RECEIPT_DISPOSITION.PAYABLE,
          worker, fact, kind === WORK_KIND.ACTIVATE_ENTRY
            ? shot.activationSlot : shot.resolutionSlot,
        );
      }
    }

    const actor = nonzero32(terminalActor, 'terminalActor');
    // M3: the page is a fixed size, so archiving grows nothing. This was
    // SHOT_RESULT_LEN * rentLamportsPerByte - 165 bytes of permanent rent per
    // shot - and it is the entire saving M3 is argued on. It stays as a named
    // zero rather than disappearing, so the archive record keeps its shape and
    // anything reading historyRentGrowthLamports sees the change instead of a
    // missing field.
    const historyRentGrowth = 0n;
    const available = uint(
      shot.transientRentLamports, 64, 'transientRentLamports',
    );
    const actorTopup = historyRentGrowth > available
      ? historyRentGrowth - available : 0n;
    const rentRefund = available > historyRentGrowth
      ? available - historyRentGrowth : 0n;
    this._creditLamports(
      state.lamportRefunds, shot.rentRefund, rentRefund,
    );
    this._creditLamports(
      state.cleanupRewards, actor, shot.cleanupBondLamports,
    );
    this._creditLamports(state.actorTopups, actor, actorTopup);
    const archive = {
      shot: Buffer.from(shot.key),
      economyHash: Buffer.from(shot.economyHash),
      player: Buffer.from(shot.player),
      nonce: shot.nonce,
      result,
      facts,
      transientResolutionHash: Buffer.from(shot.resolutionHash),
      transientTerminalHash: Buffer.from(shot.terminalHash),
      historyPage: Buffer.from(page.key),
      historySlot: slot,
      // What the on-chain ShotArchived event carries. The row itself is in
      // `result` above: this is what proves it was not altered.
      historySequence: sequence,
      historyRowHash: rowHash,
      historyResultsRoot: Buffer.from(page.resultsRoot),
      historyRentGrowthLamports: historyRentGrowth,
      actorTopupLamports: actorTopup,
      rentRefund: Buffer.from(shot.rentRefund),
      rentRefundLamports: rentRefund,
      cleanupActor: actor,
      cleanupRewardLamports: shot.cleanupBondLamports,
    };
    state.shots.delete(keyHex(shot.key));
    state.closedShots.set(keyHex(shot.key), archive);
    return { ...clone(shot), ...archive, closed: true };
  }

  _releaseTerminalCapacity(ledger, shot, economy) {
    const payout = hitPayout(shot.stake, economy);
    const xp = terminalXpReserve(shot.xpBase, economy.settleXp);
    ledger.reservedPayoutCredits = subU64(
      ledger.reservedPayoutCredits, payout, 'TERMINAL_RESERVE_UNDERFLOW',
    );
    ledger.reservedXp = subU64(
      ledger.reservedXp, xp, 'TERMINAL_RESERVE_UNDERFLOW',
    );
    requireLedgerConservation(ledger);
  }

  _retireLockedStake(ledger, stake) {
    ledger.lockedCredits = subU64(
      ledger.lockedCredits, stake, 'LOCKED_CREDITS_UNDERFLOW',
    );
    ledger.retiredCredits = addU64(
      ledger.retiredCredits, stake, 'ledger.retiredCredits',
    );
    ledger.open = subU64(ledger.open, 1n, 'OPEN_COUNTER_UNDERFLOW');
    // The caller records the terminal shot immediately after retiring the
    // stake. Conservation is checked once that atomic transition is whole.
  }

  _refundVoid(state, shot, reason, resolver, settledTs, resolutionSlot) {
    const economy = this._economy(state, shot.economyHash).spec;
    const ledger = this._ledger(state, shot.economyHash, shot.player);
    this._releaseTerminalCapacity(ledger, shot, economy);
    ledger.lockedCredits = subU64(
      ledger.lockedCredits, shot.stake, 'LOCKED_CREDITS_UNDERFLOW',
    );
    ledger.credits = addU64(ledger.credits, shot.stake, 'ledger.credits');
    ledger.refundedCredits = addU64(
      ledger.refundedCredits, shot.stake, 'ledger.refundedCredits',
    );
    ledger.open = subU64(ledger.open, 1n, 'OPEN_COUNTER_UNDERFLOW');
    ledger.voids = addU64(ledger.voids, 1n, 'ledger.voids');
    shot.state = SHOT_STATE.VOID;
    shot.voidReason = reason;
    shot.outcomeYes = 0;
    shot.settledTs = sint(settledTs, 64, 'settledTs');
    shot.resolutionSlot = uint(
      resolutionSlot, 64, 'resolutionSlot',
    );
    shot.side = SIDE.DOWN;
    shot.pBps = 0;
    shot.hit = 0;
    shot.xpAwarded = 0n;
    shot.resolver = bytes32(resolver, 'resolver');
    shot.resolutionHash = resolutionHash(shot);
    shot.forfeitWorker = Buffer.from(ZERO_PUBKEY);
    shot.revealedSalt = Buffer.from(ZERO32);
    shot.terminalSlot = shot.resolutionSlot;
    shot.terminalTs = shot.settledTs;
    shot.terminalHash = terminalHash(shot);
    requireLedgerConservation(ledger);
  }

  _tx(expectedRevision, transition) {
    if (expectedRevision !== undefined &&
        uint(expectedRevision, 64, 'expectedRevision') !== this.#state.revision)
      fail('STALE_REVISION');
    const draft = {
      revision: this.#state.revision,
      economies: new Map(this.#state.economies),
      rulesets: new Map(this.#state.rulesets),
      ledgers: new Map(this.#state.ledgers),
      shots: new Map(this.#state.shots),
      closedShots: new Map(this.#state.closedShots),
      historyPages: new Map(this.#state.historyPages),
      reloadHistoryPages: new Map(this.#state.reloadHistoryPages),
      workPages: new Map(this.#state.workPages),
      lamportRefunds: new Map(this.#state.lamportRefunds),
      cleanupRewards: new Map(this.#state.cleanupRewards),
      actorTopups: new Map(this.#state.actorTopups),
      rentLamportsPerByte: this.#state.rentLamportsPerByte,
      usedNonces: new Set(this.#state.usedNonces),
      _cow: {
        ledgers: new Set(), shots: new Set(),
        historyPages: new Set(), reloadHistoryPages: new Set(),
        workPages: new Set(),
      },
    };
    const result = transition(draft) || {};
    if (result.noChange) return clone(result.value);
    draft.revision = addU64(draft.revision, 1n, 'revision');
    delete draft._cow;
    this.#state = draft;
    return clone(result.value);
  }

  _auditEconomy(state, economy) {
    this._economy(state, economy.hash);
    for (const ruleset of state.rulesets.values()) {
      if (same(ruleset.economyHash, economy.hash))
        this._ruleset(state, ruleset.hash, economy.hash);
    }
    const aggregates = new Map();
    for (const ledger of state.ledgers.values()) {
      if (!same(ledger.economyHash, economy.hash)) continue;
      this._ledger(state, economy.hash, ledger.player);
      requireLedgerConservation(ledger);
      if (ledger.best < ledger.streak ||
          ledger.hits + ledger.forfeits > ledger.shots ||
          ledger.brierSum > BRIER_SCALE * ledger.shots ||
          ledger.open > BigInt(economy.spec.maxOpen) ||
          ledger.nextShotNonce !== ledger.sealed)
        fail('LEDGER_COUNTER_INVARIANT');
      aggregates.set(keyHex(ledger.key), {
        locked: 0n, reservedPayout: 0n, reservedXp: 0n,
        sealed: 0n, open: 0n, shots: 0n, hits: 0n, voids: 0n,
        forfeits: 0n, retired: 0n, refunded: 0n, payouts: 0n,
        earnedXp: 0n, brier: 0n,
        reloadCount: 0n, reloadCredits: 0n, rcxReloaded: 0n,
        rcxBurned: 0n, rcxRouted: 0n, rcxRetained: 0n,
      });
    }
    const addOpen = shot => {
      const ledgerKey = deriveLedgerPda(
        this.#programId, shot.economyHash, shot.player,
      ).key;
      const agg = aggregates.get(keyHex(ledgerKey));
      if (!agg) fail('SHOT_WITHOUT_LEDGER');
      agg.sealed += 1n;
      agg.open += 1n;
      agg.locked += shot.stake;
      agg.reservedPayout += hitPayout(shot.stake, economy.spec);
      agg.reservedXp += terminalXpReserve(
        shot.xpBase, economy.spec.settleXp,
      );
    };
    for (const shotValue of state.shots.values()) {
      if (!same(shotValue.economyHash, economy.hash)) continue;
      const shot = this._shot(state, shotValue.key);
      if (![SHOT_STATE.PENDING_ENTRY, SHOT_STATE.ACTIVE,
            SHOT_STATE.AWAITING_REVEAL, SHOT_STATE.AWAITING_VOID]
        .includes(shot.state))
        fail('TERMINAL_SHOT_NOT_CLOSED');
      if (!state.usedNonces.has(nonceIdentity(
        shot.economyHash, shot.player, shot.nonce,
      ))) fail('MISSING_NONCE_TOMBSTONE');
      if ((shot.state === SHOT_STATE.AWAITING_REVEAL ||
           shot.state === SHOT_STATE.AWAITING_VOID) &&
          !same(shot.resolutionHash, resolutionHash(shot)))
        fail('CORRUPT_RESOLUTION_HASH');
      const page = this._getHistoryPage(
        state, shot.economyHash, shot.player,
        historyPageIndex(shot.nonce), false,
      );
      // An OPEN shot must have an appended slot that is NOT terminal.
      const openSlot = historyPageSlot(shot.nonce);
      if (!page || openSlot >= page.pendingCount ||
          (page.terminalMask & (1 << openSlot)))
        fail('OPEN_SHOT_HISTORY_INVARIANT');
      addOpen(shot);
    }
    for (const archive of state.closedShots.values()) {
      if (!same(archive.economyHash, economy.hash)) continue;
      if (state.shots.has(keyHex(archive.shot)))
        fail('CLOSED_SHOT_STILL_LIVE');
      const expectedShot = deriveShotPda(
        this.#programId, archive.economyHash,
        archive.player, archive.nonce,
      ).key;
      if (!same(expectedShot, archive.shot) ||
          !state.usedNonces.has(nonceIdentity(
            archive.economyHash, archive.player, archive.nonce,
          )))
        fail('CORRUPT_CLOSED_SHOT');
      verifyGameResult({
        programId: this.#programId,
        economyHash: archive.economyHash,
        player: archive.player,
        nonce: archive.nonce,
        result: archive.result,
        facts: archive.facts,
      });
      const page = this._getHistoryPage(
        state, archive.economyHash, archive.player,
        historyPageIndex(archive.nonce), false,
      );
      // The page no longer holds the row, so this checks the two things it CAN
      // still prove: the slot is marked terminal, and the row the archive holds
      // hashes to the leaf that was folded. The old check compared a stored row
      // to itself; this one binds the archive to the commitment.
      const closedSlot = historyPageSlot(archive.nonce);
      if (!page || !(page.terminalMask & (1 << closedSlot)) ||
          !same(archive.historyRowHash,
            historyRowHash(archive.nonce, archive.result)))
        fail('CLOSED_SHOT_HISTORY_INVARIANT');
      const ledgerKey = deriveLedgerPda(
        this.#programId, archive.economyHash, archive.player,
      ).key;
      const agg = aggregates.get(keyHex(ledgerKey));
      if (!agg) fail('SHOT_WITHOUT_LEDGER');
      const result = archive.result;
      const facts = archive.facts;
      agg.sealed += 1n;
      if (result.state === SHOT_STATE.VOID) {
        agg.voids += 1n;
        agg.refunded += result.stake;
      } else if (result.state === SHOT_STATE.REVEALED) {
        agg.shots += 1n;
        agg.retired += result.stake;
        agg.earnedXp += facts.xpAwarded;
        agg.brier += brierScore(
          result.side, result.pBps, facts.outcomeYes === 1,
        );
        if (facts.hit === 1) {
          agg.hits += 1n;
          agg.payouts += hitPayout(result.stake, economy.spec);
        }
      } else if (result.state === SHOT_STATE.FORFEITED) {
        agg.shots += 1n;
        agg.forfeits += 1n;
        agg.retired += result.stake;
        agg.brier += BRIER_SCALE;
      } else fail('UNKNOWN_SHOT_STATE');
    }
    for (const ledger of state.ledgers.values()) {
      if (!same(ledger.economyHash, economy.hash)) continue;
      const agg = aggregates.get(keyHex(ledger.key));
      for (const [ledgerField, aggregateField] of [
        ['lockedCredits', 'locked'],
        ['reservedPayoutCredits', 'reservedPayout'],
        ['reservedXp', 'reservedXp'], ['sealed', 'sealed'],
        ['open', 'open'], ['shots', 'shots'], ['hits', 'hits'],
        ['voids', 'voids'], ['forfeits', 'forfeits'],
        ['retiredCredits', 'retired'], ['refundedCredits', 'refunded'],
        ['payoutCredits', 'payouts'], ['earnedXp', 'earnedXp'],
        ['brierSum', 'brier'],
      ]) {
        if (ledger[ledgerField] !== agg[aggregateField])
          fail('LEDGER_DERIVATION_INVARIANT', ledgerField);
      }
    }
    for (const page of state.historyPages.values()) {
      if (!same(page.economyHash, economy.hash)) continue;
      this._validateHistoryPage(page);
      // Every appended slot is either an open shot or a closed one - same
      // invariant as before, read off the mask instead of off a row.
      const folded = [];
      for (let slot = 0; slot < page.pendingCount; slot += 1) {
        const nonce = page.pageIndex * BigInt(HISTORY_PAGE_CAP) + BigInt(slot);
        const shotKey = deriveShotPda(
          this.#programId, page.economyHash, page.player, nonce,
        ).key;
        if (!(page.terminalMask & (1 << slot))) {
          if (!state.shots.has(keyHex(shotKey)))
            fail('ORPHAN_PENDING_HISTORY_SLOT');
          continue;
        }
        const archive = state.closedShots.get(keyHex(shotKey));
        if (!archive) fail('ORPHAN_TERMINAL_HISTORY_SLOT');
        folded.push(archive);
      }
      // AND THE CHECK M3 MADE POSSIBLE, which has no pre-M3 equivalent: replay
      // the fold from the archived rows and land on the stored root. The old
      // page held the rows, so "the page agrees with the page" was all it could
      // say. This says the rows a reader has are exactly the rows that were
      // committed, in the order they were committed - and it is the same
      // computation an off-chain reader performs against the on-chain account.
      if (folded.length !== popcount16(page.terminalMask))
        fail('HISTORY_ROOT_INVARIANT');
      folded.sort((a, b) => a.historySequence - b.historySequence);
      let replay = Buffer.from(ZERO32);
      folded.forEach((archive, index) => {
        // The sequence is DENSE and 1-based. A gap is how an omitted row would
        // hide: the root alone cannot reveal one, the sequence can.
        if (archive.historySequence !== index + 1)
          fail('HISTORY_SEQUENCE_INVARIANT');
        const rowHash = historyRowHash(archive.nonce, archive.result);
        if (!same(rowHash, archive.historyRowHash))
          fail('HISTORY_ROW_INVARIANT');
        replay = historyChainFold(replay, rowHash);
      });
      if (!same(replay, page.resultsRoot)) fail('HISTORY_ROOT_INVARIANT');
    }
    for (const page of state.reloadHistoryPages.values()) {
      if (!same(page.economyHash, economy.hash)) continue;
      this._validateReloadHistoryPage(page);
      const ledgerKey = deriveLedgerPda(
        this.#programId, page.economyHash, page.player,
      ).key;
      const agg = aggregates.get(keyHex(ledgerKey));
      if (!agg) fail('RELOAD_PAGE_WITHOUT_LEDGER');
      const ledger = this._ledger(state, economy.hash, page.player);
      page.records.forEach((record, slot) => {
        const nonce = page.pageIndex * BigInt(RELOAD_HISTORY_PAGE_CAP) +
          BigInt(slot);
        if (nonce >= ledger.nextReloadNonce)
          fail('RELOAD_HISTORY_NONCE_INVARIANT');
        const accounting = reloadRecordAccounting(record);
        agg.reloadCount += 1n;
        agg.reloadCredits += accounting.credits;
        agg.rcxReloaded += accounting.consumed;
        agg.rcxBurned += accounting.rawBurned;
        agg.rcxRouted += accounting.rawRouted;
        agg.rcxRetained += accounting.rawRetained;
      });
    }
    for (const ledger of state.ledgers.values()) {
      if (!same(ledger.economyHash, economy.hash)) continue;
      const agg = aggregates.get(keyHex(ledger.key));
      if (agg.reloadCount !== ledger.nextReloadNonce ||
          agg.reloadCredits !== ledger.reloadCredits ||
          agg.rcxReloaded !== ledger.rcxReloaded ||
          agg.rcxBurned !== ledger.rcxBurned ||
          agg.rcxRouted !== ledger.rcxRouted ||
          agg.rcxRetained !== ledger.rcxRetained)
        fail('RELOAD_HISTORY_LEDGER_INVARIANT');
    }
    for (const page of state.workPages.values()) {
      if (!same(page.economyHash, economy.hash)) continue;
      this._validateWorkPage(page);
      for (const record of page.records) {
        const live = state.shots.has(keyHex(record.subject));
        const closed = state.closedShots.has(keyHex(record.subject));
        if (!live && !closed) fail('ORPHAN_WORK_RECORD');
        if (closed &&
            record.disposition === RECEIPT_DISPOSITION.PENDING)
          fail('STRANDED_WORK_RECORD');
      }
    }
    let claimCount = 0n;
    let claimedCredits = 0n;
    let claimedXp = 0n;
    // The permanent ledger fields are the replay tombstone. The Merkle proof
    // was authenticated atomically at claim time; retaining a second account
    // would duplicate these bounded totals without strengthening replay safety.
    for (const ledger of state.ledgers.values()) {
      if (!same(ledger.economyHash, economy.hash) ||
          (ledger.legacyCredits === 0n && ledger.legacyXp === 0n))
        continue;
      claimCount += 1n;
      claimedCredits += ledger.legacyCredits;
      claimedXp += ledger.legacyXp;
    }
    if (claimCount > BigInt(economy.spec.legacyLeafCount) ||
        claimedCredits > BigInt(economy.spec.legacyTotalCredits) ||
        claimedXp > BigInt(economy.spec.legacyTotalXp))
      fail('LEGACY_MANIFEST_TOTAL_INVARIANT');
  }
}
