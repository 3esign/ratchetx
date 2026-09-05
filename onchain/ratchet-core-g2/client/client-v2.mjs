const UTF8 = new TextEncoder();

export const CORE_SCHEMA_VERSION = 2;
export const TIMEPIN_SCHEMA_VERSION = 2;
// Adapter 1 = strict bracket (prev < T <= publish; the pre-gap is load-bearing
// and positive). Adapter 2 = MIN-CAPTURE, the mainnet-class rule: the earliest
// print at or after T, where prev_publish_time is not part of the predicate and
// the pre-gap is therefore pinned to ZERO. Same numbers as rcx-timepin-v2
// lib.rs and ratchet-core-g2/foreign_timepin.rs, pinned across all four mirrors
// by test/test_core_and_timepin_agree_on_a_spec.mjs.
export const ADAPTER_PYTH_PUSH_V2 = 1;
export const ADAPTER_PYTH_MIN_CAPTURE_V2 = 2;
export const FORWARD_ENTRY_MODE = 2;
export const HISTORY_PAGE_CAP = 16;
export const RANK_SHARD_COUNT = 16;
export const DAY_SECONDS = 86_400;
export const CORE_MIN_EXPONENT = -12;
export const CORE_MAX_EXPONENT = 2;

export const ACCOUNT_SIZE = Object.freeze({
  Economy: 415,
  Ruleset: 206,
  PlayerLedger: 285,
  Shot: 780, // 8-byte Anchor discriminator + Shot::LEN (772).
  EvidenceSpecV2: 262,
  // 8 + TimepinNeedV2::LEN. This said 132 - the PRE-INLINE Need, from before
  // Timepin moved the observation into the account - so the client could not
  // decode a single real Need. Same stale number, same day, as
  // foreign_timepin.rs NEED_ACCOUNT_LEN.
  TimepinNeedV2: 168,
  // M3: the page is a FIXED size, so there is no Min and no Max. It was
  // 87..2_743, which is the growing Vec-of-rows form the program no longer has.
  HistoryPage: 118,
});

// EVERY INSTRUCTION BOTH PROGRAMS EXPOSE, not the five this client happened to
// need. Measured 2026-09-05: Core declares 26 instructions and Timepin 9, and
// this table had FIVE - register_evidence_spec, open_need, open_ledger,
// open_history_page, seal_forward. All five are on the way IN. Nothing here knew
// how to settle, reveal, forfeit, capture or finalize, so a player could enter a
// shot that nothing in this repository could ever resolve.
//
// Anchor derives an instruction discriminator as sha256("global:" + name)[0..8].
// These are written out rather than computed at load because the client must work
// where SHA-256 is async, but they are NOT trusted: test_client_covers_every_instruction.mjs
// re-derives every entry from its own key AND reads the #[program] block of both
// crates, so a name that drifts or an instruction that is added without the client
// learning about it fails there. The table cannot be wrong in silence.
// The ordered account list of every instruction, GENERATED from the programs by
// tools/derive-account-lists.mjs and pinned by test_account_lists.mjs, which
// regenerates and compares field for field. Inlined rather than imported so the
// client stays a single file that a browser can load; the test is what keeps the
// copy honest, and it fails on a flipped mut flag, a transposed pair or a missing
// instruction. Do not hand-edit: run the generator with --write.
export const INSTRUCTION_ACCOUNTS = Object.freeze(JSON.parse(
  '{"ratchet-core-g2":{"register_economy":{"context":"RegisterEconomy","accounts":[{"name":"actor","mut":true,"signer":true},{"name":"economy","mut":true,"signer":false},{"name":"timepin_program","mut":false,"signer":false},{"name":"system_program","mut":false,"signer":false}]},"register_ruleset":{"context":"RegisterRuleset","accounts":[{"name":"actor","mut":true,"signer":true},{"name":"economy","mut":false,"signer":false},{"name":"ruleset","mut":true,"signer":false},{"name":"evidence_spec","mut":false,"signer":false},{"name":"system_program","mut":false,"signer":false}]},"open_ledger":{"context":"OpenLedger","accounts":[{"name":"player","mut":true,"signer":true},{"name":"economy","mut":false,"signer":false},{"name":"ledger","mut":true,"signer":false},{"name":"system_program","mut":false,"signer":false}]},"open_history_page":{"context":"OpenHistoryPage","accounts":[{"name":"actor","mut":true,"signer":true},{"name":"economy","mut":false,"signer":false},{"name":"player","mut":false,"signer":false},{"name":"ledger","mut":false,"signer":false},{"name":"history_page","mut":true,"signer":false},{"name":"system_program","mut":false,"signer":false}]},"open_reload_page":{"context":"OpenReloadPage","accounts":[{"name":"actor","mut":true,"signer":true},{"name":"economy","mut":false,"signer":false},{"name":"player","mut":false,"signer":false},{"name":"ledger","mut":false,"signer":false},{"name":"reload_history_page","mut":true,"signer":false},{"name":"system_program","mut":false,"signer":false}]},"open_work_page":{"context":"OpenWorkPage","accounts":[{"name":"actor","mut":true,"signer":true},{"name":"economy","mut":false,"signer":false},{"name":"player","mut":false,"signer":false},{"name":"ledger","mut":false,"signer":false},{"name":"work_page","mut":true,"signer":false},{"name":"system_program","mut":false,"signer":false}]},"open_work_manifest":{"context":"OpenWorkManifest","accounts":[{"name":"actor","mut":true,"signer":true},{"name":"work_manifest","mut":true,"signer":false},{"name":"system_program","mut":false,"signer":false}]},"reserve_work":{"context":"ReserveWork","accounts":[{"name":"actor","mut":true,"signer":true},{"name":"economy","mut":false,"signer":false},{"name":"ruleset","mut":false,"signer":false},{"name":"ledger","mut":false,"signer":false},{"name":"shot","mut":false,"signer":false},{"name":"work_page","mut":true,"signer":false},{"name":"system_program","mut":false,"signer":false}]},"reload_rcx":{"context":"ReloadRcx","accounts":[{"name":"player","mut":true,"signer":true},{"name":"economy","mut":false,"signer":false},{"name":"ledger","mut":true,"signer":false},{"name":"day_final","mut":false,"signer":false},{"name":"reload_history_page","mut":true,"signer":false},{"name":"mint","mut":true,"signer":false},{"name":"player_token","mut":true,"signer":false},{"name":"token_program","mut":false,"signer":false},{"name":"memo_program","mut":false,"signer":false},{"name":"system_program","mut":false,"signer":false}]},"finalize_day":{"context":"FinalizeDay","accounts":[{"name":"actor","mut":true,"signer":true},{"name":"economy","mut":false,"signer":false},{"name":"day_final","mut":true,"signer":false},{"name":"system_program","mut":false,"signer":false}]},"claim_legacy":{"context":"ClaimLegacy","accounts":[{"name":"player","mut":true,"signer":true},{"name":"economy","mut":false,"signer":false},{"name":"ledger","mut":true,"signer":false},{"name":"system_program","mut":false,"signer":false}]},"grant_delegate":{"context":"GrantDelegate","accounts":[{"name":"player","mut":true,"signer":true},{"name":"economy","mut":false,"signer":false},{"name":"ruleset","mut":false,"signer":false},{"name":"delegate","mut":false,"signer":false},{"name":"delegate_grant","mut":true,"signer":false},{"name":"system_program","mut":false,"signer":false}]},"revoke_delegate":{"context":"RevokeDelegate","accounts":[{"name":"economy","mut":false,"signer":false},{"name":"ruleset","mut":false,"signer":false},{"name":"delegate_grant","mut":true,"signer":false},{"name":"player","mut":false,"signer":true}]},"seal_forward":{"context":"SealForward","accounts":[{"name":"player","mut":true,"signer":true},{"name":"economy","mut":false,"signer":false},{"name":"ruleset","mut":false,"signer":false},{"name":"ledger","mut":true,"signer":false},{"name":"player_day","mut":true,"signer":false},{"name":"rank_shard","mut":true,"signer":false},{"name":"history_page","mut":true,"signer":false},{"name":"shot","mut":true,"signer":false},{"name":"entry_need","mut":false,"signer":false},{"name":"exit_need","mut":false,"signer":false},{"name":"system_program","mut":false,"signer":false}]},"seal_forward_delegated":{"context":"SealForwardDelegated","accounts":[{"name":"delegate","mut":true,"signer":true},{"name":"economy","mut":false,"signer":false},{"name":"ruleset","mut":false,"signer":false},{"name":"delegate_grant","mut":true,"signer":false},{"name":"ledger","mut":true,"signer":false},{"name":"player_day","mut":true,"signer":false},{"name":"rank_shard","mut":true,"signer":false},{"name":"history_page","mut":true,"signer":false},{"name":"shot","mut":true,"signer":false},{"name":"entry_need","mut":false,"signer":false},{"name":"exit_need","mut":false,"signer":false},{"name":"system_program","mut":false,"signer":false}]},"seal_observed":{"context":"SealObserved","accounts":[{"name":"player","mut":true,"signer":true},{"name":"economy","mut":false,"signer":false},{"name":"ruleset","mut":false,"signer":false},{"name":"ledger","mut":true,"signer":false},{"name":"player_day","mut":true,"signer":false},{"name":"rank_shard","mut":true,"signer":false},{"name":"history_page","mut":true,"signer":false},{"name":"shot","mut":true,"signer":false},{"name":"evidence_spec","mut":false,"signer":false},{"name":"entry_need","mut":false,"signer":false},{"name":"entry_candidate","mut":false,"signer":false},{"name":"exit_need","mut":false,"signer":false},{"name":"system_program","mut":false,"signer":false}]},"seal_observed_delegated":{"context":"SealObservedDelegated","accounts":[{"name":"delegate","mut":true,"signer":true},{"name":"economy","mut":false,"signer":false},{"name":"ruleset","mut":false,"signer":false},{"name":"delegate_grant","mut":true,"signer":false},{"name":"ledger","mut":true,"signer":false},{"name":"player_day","mut":true,"signer":false},{"name":"rank_shard","mut":true,"signer":false},{"name":"history_page","mut":true,"signer":false},{"name":"shot","mut":true,"signer":false},{"name":"evidence_spec","mut":false,"signer":false},{"name":"entry_need","mut":false,"signer":false},{"name":"entry_candidate","mut":false,"signer":false},{"name":"exit_need","mut":false,"signer":false},{"name":"system_program","mut":false,"signer":false}]},"activate_entry":{"context":"ActivateEntry","accounts":[{"name":"actor","mut":true,"signer":true},{"name":"economy","mut":false,"signer":false},{"name":"ruleset","mut":false,"signer":false},{"name":"ledger","mut":false,"signer":false},{"name":"shot","mut":true,"signer":false},{"name":"work_page","mut":true,"signer":false},{"name":"evidence_spec","mut":false,"signer":false},{"name":"entry_need","mut":false,"signer":false},{"name":"entry_candidate","mut":false,"signer":false}]},"void_pending_entry":{"context":"VoidPendingEntry","accounts":[{"name":"actor","mut":true,"signer":true},{"name":"economy","mut":false,"signer":false},{"name":"ruleset","mut":false,"signer":false},{"name":"ledger","mut":true,"signer":false},{"name":"shot","mut":true,"signer":false},{"name":"player_day","mut":true,"signer":false},{"name":"rank_shard","mut":true,"signer":false},{"name":"history_page","mut":true,"signer":false},{"name":"work_page","mut":true,"signer":false},{"name":"rent_refund","mut":true,"signer":false},{"name":"entry_need","mut":false,"signer":false},{"name":"system_program","mut":false,"signer":false}]},"settle_final":{"context":"SettleFinal","accounts":[{"name":"actor","mut":true,"signer":true},{"name":"economy","mut":false,"signer":false},{"name":"ruleset","mut":false,"signer":false},{"name":"ledger","mut":true,"signer":false},{"name":"shot","mut":true,"signer":false},{"name":"work_page","mut":true,"signer":false},{"name":"player_day","mut":true,"signer":false},{"name":"rank_shard","mut":true,"signer":false},{"name":"evidence_spec","mut":false,"signer":false},{"name":"exit_need","mut":false,"signer":false},{"name":"exit_candidate","mut":false,"signer":false}]},"finalize_resolved_void":{"context":"FinalizeResolvedVoid","accounts":[{"name":"actor","mut":true,"signer":true},{"name":"economy","mut":false,"signer":false},{"name":"ruleset","mut":false,"signer":false},{"name":"ledger","mut":true,"signer":false},{"name":"shot","mut":true,"signer":false},{"name":"player_day","mut":true,"signer":false},{"name":"rank_shard","mut":true,"signer":false},{"name":"history_page","mut":true,"signer":false},{"name":"work_page","mut":true,"signer":false},{"name":"rent_refund","mut":true,"signer":false},{"name":"system_program","mut":false,"signer":false}]},"void_active_shot":{"context":"VoidActiveShot","accounts":[{"name":"actor","mut":true,"signer":true},{"name":"economy","mut":false,"signer":false},{"name":"ruleset","mut":false,"signer":false},{"name":"ledger","mut":true,"signer":false},{"name":"shot","mut":true,"signer":false},{"name":"player_day","mut":true,"signer":false},{"name":"rank_shard","mut":true,"signer":false},{"name":"history_page","mut":true,"signer":false},{"name":"work_page","mut":true,"signer":false},{"name":"rent_refund","mut":true,"signer":false},{"name":"exit_need","mut":false,"signer":false},{"name":"system_program","mut":false,"signer":false}]},"reveal":{"context":"RevealShot","accounts":[{"name":"economy","mut":false,"signer":false},{"name":"ruleset","mut":false,"signer":false},{"name":"ledger","mut":true,"signer":false},{"name":"shot","mut":true,"signer":false},{"name":"player_day","mut":true,"signer":false},{"name":"rank_shard","mut":true,"signer":false},{"name":"history_page","mut":true,"signer":false},{"name":"work_page","mut":true,"signer":false},{"name":"player","mut":true,"signer":true},{"name":"rent_refund","mut":true,"signer":false},{"name":"system_program","mut":false,"signer":false}]},"reveal_delegated":{"context":"RevealDelegatedShot","accounts":[{"name":"economy","mut":false,"signer":false},{"name":"ruleset","mut":false,"signer":false},{"name":"ledger","mut":true,"signer":false},{"name":"shot","mut":true,"signer":false},{"name":"player_day","mut":true,"signer":false},{"name":"rank_shard","mut":true,"signer":false},{"name":"history_page","mut":true,"signer":false},{"name":"work_page","mut":true,"signer":false},{"name":"delegate","mut":true,"signer":true},{"name":"rent_refund","mut":true,"signer":false},{"name":"system_program","mut":false,"signer":false}]},"close_player_day":{"context":"ClosePlayerDay","accounts":[{"name":"actor","mut":false,"signer":true},{"name":"rent_payer","mut":true,"signer":false},{"name":"player_day","mut":true,"signer":false}]},"forfeit":{"context":"ForfeitShot","accounts":[{"name":"actor","mut":true,"signer":true},{"name":"economy","mut":false,"signer":false},{"name":"ruleset","mut":false,"signer":false},{"name":"ledger","mut":true,"signer":false},{"name":"shot","mut":true,"signer":false},{"name":"player_day","mut":true,"signer":false},{"name":"rank_shard","mut":true,"signer":false},{"name":"history_page","mut":true,"signer":false},{"name":"work_page","mut":true,"signer":false},{"name":"rent_refund","mut":true,"signer":false},{"name":"system_program","mut":false,"signer":false}]}},"rcx-timepin-v2":{"register_evidence_spec":{"context":"RegisterEvidenceSpec","accounts":[{"name":"payer","mut":true,"signer":true},{"name":"evidence_spec","mut":true,"signer":false},{"name":"receiver_program","mut":false,"signer":false},{"name":"receiver_program_data","mut":false,"signer":false},{"name":"receiver_config","mut":false,"signer":false},{"name":"wormhole_program","mut":false,"signer":false},{"name":"wormhole_program_data","mut":false,"signer":false},{"name":"system_program","mut":false,"signer":false}]},"open_need":{"context":"OpenNeed","accounts":[{"name":"actor","mut":true,"signer":true},{"name":"evidence_spec","mut":false,"signer":false},{"name":"need","mut":true,"signer":false},{"name":"system_program","mut":false,"signer":false}]},"open_work_manifest":{"context":"OpenWorkManifest","accounts":[{"name":"actor","mut":true,"signer":true},{"name":"work_manifest","mut":true,"signer":false},{"name":"system_program","mut":false,"signer":false}]},"open_work_page":{"context":"OpenWorkPage","accounts":[{"name":"actor","mut":true,"signer":true},{"name":"evidence_spec","mut":false,"signer":false},{"name":"need","mut":false,"signer":false},{"name":"work_page","mut":true,"signer":false},{"name":"system_program","mut":false,"signer":false}]},"reserve_work":{"context":"ReserveWork","accounts":[{"name":"actor","mut":true,"signer":true},{"name":"evidence_spec","mut":false,"signer":false},{"name":"need","mut":false,"signer":false},{"name":"work_page","mut":true,"signer":false},{"name":"system_program","mut":false,"signer":false}]},"capture_first":{"context":"CaptureFirst","accounts":[{"name":"actor","mut":true,"signer":true},{"name":"evidence_spec","mut":false,"signer":false},{"name":"need","mut":true,"signer":false},{"name":"candidate","mut":true,"signer":false},{"name":"receiver_program","mut":false,"signer":false},{"name":"receiver_program_data","mut":false,"signer":false},{"name":"receiver_config","mut":false,"signer":false},{"name":"wormhole_program","mut":false,"signer":false},{"name":"wormhole_program_data","mut":false,"signer":false},{"name":"price_update","mut":false,"signer":false},{"name":"work_page","mut":true,"signer":false},{"name":"system_program","mut":false,"signer":false}]},"capture_conflict":{"context":"CaptureConflict","accounts":[{"name":"actor","mut":true,"signer":true},{"name":"evidence_spec","mut":false,"signer":false},{"name":"need","mut":true,"signer":false},{"name":"candidate_a","mut":false,"signer":false},{"name":"candidate_b","mut":true,"signer":false},{"name":"receiver_program","mut":false,"signer":false},{"name":"receiver_program_data","mut":false,"signer":false},{"name":"receiver_config","mut":false,"signer":false},{"name":"wormhole_program","mut":false,"signer":false},{"name":"wormhole_program_data","mut":false,"signer":false},{"name":"price_update","mut":false,"signer":false},{"name":"work_page","mut":true,"signer":false},{"name":"system_program","mut":false,"signer":false}]},"finalize":{"context":"FinalizeNeed","accounts":[{"name":"actor","mut":true,"signer":true},{"name":"evidence_spec","mut":false,"signer":false},{"name":"need","mut":true,"signer":false},{"name":"candidate","mut":false,"signer":false},{"name":"work_page","mut":true,"signer":false}]},"expire":{"context":"ExpireNeed","accounts":[{"name":"actor","mut":true,"signer":true},{"name":"evidence_spec","mut":false,"signer":false},{"name":"need","mut":true,"signer":false},{"name":"work_page","mut":true,"signer":false}]}}}'
));

export const CORE_INSTRUCTION = Object.freeze({
  register_economy: '910213263a5cd182',
  register_ruleset: 'de7c09f372f4ff75',
  open_ledger: '3667bde8ecfb772a',
  open_history_page: '3ddcedb625accff2',
  open_reload_page: '0ce3780b152a1749',
  open_work_page: '9efdadb53034bc10',
  open_work_manifest: 'e2efc3ece315c9a3',
  reserve_work: 'b9476c8bdcd345b7',
  reload_rcx: 'be1b36fd75a5a7a1',
  finalize_day: '584dfa993992a1c6',
  claim_legacy: 'f1f728c0d5acb159',
  grant_delegate: 'faa96ed929a061b8',
  revoke_delegate: '8e42627e663c5ca3',
  seal_forward: '8a4a00f1f67f89fe',
  seal_forward_delegated: '2aee51112039de65',
  seal_observed: 'c9a434da358c1c92',
  seal_observed_delegated: 'd87f7819e549bd63',
  activate_entry: 'dcb50aadf1eff487',
  void_pending_entry: '398b3c572c4e99ed',
  settle_final: 'b2466bdb076752bb',
  finalize_resolved_void: '16239970dfd50b24',
  void_active_shot: '9e161959ebcde3cb',
  reveal: '09233bbea7f94c73',
  reveal_delegated: '04fef8332a2dd20a',
  close_player_day: '73aa94b09acc7a1a',
  forfeit: '509aed9ef4c69a09',
});

export const TIMEPIN_INSTRUCTION = Object.freeze({
  register_evidence_spec: '8668d270eff95e77',
  open_need: 'a4821105a5fcd669',
  open_work_manifest: 'e2efc3ece315c9a3',
  open_work_page: '9efdadb53034bc10',
  reserve_work: 'b9476c8bdcd345b7',
  capture_first: '0e54cde37305fa4b',
  capture_conflict: 'd5552dd458e413b3',
  finalize: 'ab3dda387f730cd9',
  expire: 'f353cd3a39c9f792',
});

// Kept for the callers that already import it. It is the old five, unchanged, so
// nothing that used it breaks; new code should reach for the two tables above.
export const INSTRUCTION_DISCRIMINATOR = Object.freeze({
  register_evidence_spec: TIMEPIN_INSTRUCTION.register_evidence_spec,
  open_need: TIMEPIN_INSTRUCTION.open_need,
  open_ledger: CORE_INSTRUCTION.open_ledger,
  open_history_page: CORE_INSTRUCTION.open_history_page,
  seal_forward: CORE_INSTRUCTION.seal_forward,
});

export const ACCOUNT_DISCRIMINATOR = Object.freeze({
  Economy: '09475dff98bbaa9a',
  Ruleset: '7b5c88a6a0ecf8b4',
  PlayerLedger: 'd8e0da01437669d5',
  Shot: 'e1a2a812cfc1f16b',
  HistoryPage: '2b0d259f9c40db44',
  EvidenceSpecV2: '5e4c19f1274146e4',
  TimepinNeedV2: 'e1f8cc821015586c',
});

export const PYTH_RECEIVER_PROGRAM =
  'rec2HHDDnjLfj4kE7VyEtFA1HPGQLK33259532cRyHp';
export const PYTH_PUSH_ORACLE_PROGRAM =
  'pyt2F414BA6dPttK6RddPZUdHfapoBN24GL5wbrPCou';
export const UPGRADEABLE_LOADER_PROGRAM =
  'BPFLoaderUpgradeab1e11111111111111111111111';

const U64_MAX = (1n << 64n) - 1n;
const I64_MIN = -(1n << 63n);
const I64_MAX = (1n << 63n) - 1n;
const ZERO32 = new Uint8Array(32);

const utf8 = value => UTF8.encode(value);
const asBytes = value => value instanceof Uint8Array
  ? new Uint8Array(value)
  : new Uint8Array(value || []);
const concat = (...parts) => {
  const arrays = parts.map(asBytes);
  const out = new Uint8Array(arrays.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of arrays) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};
const fromHex = (value, label = 'hex') => {
  if (typeof value !== 'string' || !/^[0-9a-fA-F]*$/.test(value) ||
      value.length % 2 !== 0) throw new TypeError(label + ' must be even-length hex');
  const out = new Uint8Array(value.length / 2);
  for (let index = 0; index < out.length; index++)
    out[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  return out;
};
const toHex = value => Array.from(asBytes(value), byte =>
  byte.toString(16).padStart(2, '0')).join('');
const equalBytes = (left, right) => {
  const a = asBytes(left), b = asBytes(right);
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index++) difference |= a[index] ^ b[index];
  return difference === 0;
};
const asBigInt = (value, label) => {
  if (typeof value === 'number' && !Number.isSafeInteger(value))
    throw new RangeError(label + ' must be a safe integer or bigint');
  try { return BigInt(value); }
  catch { throw new TypeError(label + ' must be an integer'); }
};
const unsigned = (value, max, label) => {
  const out = asBigInt(value, label);
  if (out < 0n || out > max) throw new RangeError(label + ' out of range');
  return out;
};
const signed = (value, min, max, label) => {
  const out = asBigInt(value, label);
  if (out < min || out > max) throw new RangeError(label + ' out of range');
  return out;
};
const numberUnsigned = (value, max, label) =>
  Number(unsigned(value, BigInt(max), label));
const le = (size, writer) => {
  const out = new Uint8Array(size);
  writer(new DataView(out.buffer));
  return out;
};
const u8 = (value, label = 'u8') =>
  Uint8Array.of(numberUnsigned(value, 0xff, label));
const i8 = (value, label = 'i8') => {
  const number = Number(signed(value, -128n, 127n, label));
  return le(1, view => view.setInt8(0, number));
};
const u16 = (value, label = 'u16') => {
  const number = numberUnsigned(value, 0xffff, label);
  return le(2, view => view.setUint16(0, number, true));
};
const u32 = (value, label = 'u32') => {
  const number = numberUnsigned(value, 0xffff_ffff, label);
  return le(4, view => view.setUint32(0, number, true));
};
const u64 = (value, label = 'u64') => {
  const number = unsigned(value, U64_MAX, label);
  return le(8, view => view.setBigUint64(0, number, true));
};
const i64 = (value, label = 'i64') => {
  const number = signed(value, I64_MIN, I64_MAX, label);
  return le(8, view => view.setBigInt64(0, number, true));
};
const hash32 = (value, label = 'bytes32') => {
  const out = typeof value === 'string' ? fromHex(value, label) : asBytes(value);
  if (out.length !== 32) throw new RangeError(label + ' must be 32 bytes');
  return out;
};
const nonzero32 = (value, label) => {
  const out = hash32(value, label);
  if (equalBytes(out, ZERO32)) throw new RangeError(label + ' must be nonzero');
  return out;
};
const expectEqual = (left, right, label) => {
  if (!equalBytes(left, right)) throw new TypeError(label + ' mismatch');
};

export function createCoreG2Client({
  web3,
  coreProgramId,
  timepinProgramId,
  cryptoImpl = globalThis.crypto,
}) {
  if (!web3 || !web3.PublicKey || !web3.TransactionInstruction || !web3.SystemProgram)
    throw new TypeError('web3 PublicKey, TransactionInstruction and SystemProgram are required');
  if (!cryptoImpl || !cryptoImpl.subtle || typeof cryptoImpl.subtle.digest !== 'function')
    throw new TypeError('Web Crypto SHA-256 is required');

  const { PublicKey, TransactionInstruction, SystemProgram } = web3;
  const coreProgram = new PublicKey(coreProgramId);
  const timepinProgram = new PublicKey(timepinProgramId);
  const loaderProgram = new PublicKey(UPGRADEABLE_LOADER_PROGRAM);
  const pythReceiver = new PublicKey(PYTH_RECEIVER_PROGRAM);
  const pythPushOracle = new PublicKey(PYTH_PUSH_ORACLE_PROGRAM);

  const pk = value => value instanceof PublicKey ? value : new PublicKey(value);
  const pkBytes = (value, label = 'public key') => {
    try { return new Uint8Array(pk(value).toBytes()); }
    catch { throw new TypeError(label + ' is not a public key'); }
  };
  const discriminator = (table, name) => fromHex(table[name], name);
  const meta = (pubkey, isSigner = false, isWritable = false) => ({
    pubkey: pk(pubkey), isSigner, isWritable,
  });
  const instruction = (programId, name, keys, ...args) =>
    new TransactionInstruction({
      programId,
      keys,
      data: concat(discriminator(INSTRUCTION_DISCRIMINATOR, name), ...args),
    });
  // BUILD ANY INSTRUCTION FROM THE GENERATED TABLE.
  //
  // The caller supplies addresses BY NAME and this resolves the order, the mut
  // flags and the signer flags from what the program declares. A name the
  // instruction does not take, or one it takes and the caller forgot, is an
  // error HERE - at build time, with the name in the message - instead of a
  // transaction that fails on chain with nothing to go on. That is the whole
  // point: thirty-five account lists is far past what anyone should be checking
  // by eye, and every one of them is already pinned by a test.
  const buildIx = (crate, name, addresses, ...args) => {
    const table = INSTRUCTION_ACCOUNTS[crate];
    if (!table) throw new TypeError(`unknown crate ${crate}`);
    const entry = table[name];
    if (!entry) throw new TypeError(`${crate} has no instruction ${name}`);
    const given = new Set(Object.keys(addresses));
    const missing = entry.accounts.map(a => a.name).filter(n => !given.has(n));
    if (missing.length)
      throw new TypeError(`${crate}.${name} needs ${missing.length} account(s) nobody supplied: `
        + `${missing.join(', ')} (context ${entry.context})`);
    const extra = [...given].filter(n => !entry.accounts.some(a => a.name === n));
    if (extra.length)
      throw new TypeError(`${crate}.${name} does not take: ${extra.join(', ')}. `
        + `It takes ${entry.accounts.map(a => a.name).join(', ')}`);
    const programId = crate === 'rcx-timepin-v2' ? timepinProgram : coreProgram;
    const disc = crate === 'rcx-timepin-v2' ? TIMEPIN_INSTRUCTION : CORE_INSTRUCTION;
    return new TransactionInstruction({
      programId,
      keys: entry.accounts.map(a => meta(pk(addresses[a.name]), a.signer, a.mut)),
      data: concat(discriminator(disc, name), ...args),
    });
  };

  const derive = (programId, seeds) =>
    PublicKey.findProgramAddressSync(seeds.map(asBytes), programId);

  const sha256 = async (...parts) =>
    new Uint8Array(await cryptoImpl.subtle.digest('SHA-256', concat(...parts)));

  class Reader {
    constructor(data, name, exactSize = null) {
      this.data = asBytes(data);
      if (exactSize !== null && this.data.length !== exactSize)
        throw new RangeError(name + ' account must be exactly ' + exactSize + ' bytes');
      const expected = discriminator(ACCOUNT_DISCRIMINATOR, name);
      if (this.data.length < 8 || !equalBytes(this.data.subarray(0, 8), expected))
        throw new TypeError(name + ' account discriminator mismatch');
      this.name = name;
      this.offset = 8;
    }
    take(length) {
      if (!Number.isSafeInteger(length) || length < 0 ||
          this.offset + length > this.data.length)
        throw new RangeError(this.name + ' account is truncated');
      const out = this.data.subarray(this.offset, this.offset + length);
      this.offset += length;
      return out;
    }
    u8() { return this.take(1)[0]; }
    i8() { const bytes = this.take(1); return new DataView(bytes.buffer, bytes.byteOffset, 1).getInt8(0); }
    u16() { const b = this.take(2); return new DataView(b.buffer, b.byteOffset, 2).getUint16(0, true); }
    u32() { const b = this.take(4); return new DataView(b.buffer, b.byteOffset, 4).getUint32(0, true); }
    i32() { const b = this.take(4); return new DataView(b.buffer, b.byteOffset, 4).getInt32(0, true); }
    u64() { const b = this.take(8); return new DataView(b.buffer, b.byteOffset, 8).getBigUint64(0, true); }
    i64() { const b = this.take(8); return new DataView(b.buffer, b.byteOffset, 8).getBigInt64(0, true); }
    u128() {
      const low = this.u64(), high = this.u64();
      return low | (high << 64n);
    }
    key() { return new PublicKey(this.take(32)); }
    bytes32() { return new Uint8Array(this.take(32)); }
    done() {
      if (this.offset !== this.data.length)
        throw new RangeError(this.name + ' account has trailing bytes');
    }
  }

  const exactAccount = (info, owner, name, size = null) => {
    if (!info) throw new TypeError(name + ' account is missing');
    if (info.executable) throw new TypeError(name + ' account must not be executable');
    if (!pk(info.owner).equals(owner)) throw new TypeError(name + ' account owner mismatch');
    return new Reader(info.data, name, size);
  };

  const economyPda = economyHash => derive(coreProgram, [
    utf8('economy'), u16(CORE_SCHEMA_VERSION), hash32(economyHash, 'economyHash'),
  ]);
  const rulesetPda = rulesetHash => derive(coreProgram, [
    utf8('ruleset'), u16(CORE_SCHEMA_VERSION), hash32(rulesetHash, 'rulesetHash'),
  ]);
  const ledgerPda = (economyHash, player) => derive(coreProgram, [
    utf8('ledger'), hash32(economyHash, 'economyHash'), pkBytes(player, 'player'),
  ]);
  const historyPagePda = (economyHash, player, pageIndex) => derive(coreProgram, [
    utf8('history_page'), hash32(economyHash, 'economyHash'),
    pkBytes(player, 'player'), u64(pageIndex, 'pageIndex'),
  ]);
  const shotPda = (economyHash, player, nonce) => derive(coreProgram, [
    utf8('shot'), hash32(economyHash, 'economyHash'),
    pkBytes(player, 'player'), u64(nonce, 'nonce'),
  ]);
  const playerDayPda = (economyHash, day, player) => derive(coreProgram, [
    utf8('player_day'), hash32(economyHash, 'economyHash'),
    i64(day, 'scoreDay'), pkBytes(player, 'player'),
  ]);
  const evidenceSpecPda = specHash => derive(timepinProgram, [
    utf8('evidence_spec'), u16(TIMEPIN_SCHEMA_VERSION),
    hash32(specHash, 'evidenceSpecHash'),
  ]);
  const needPda = (specHash, targetTs) => derive(timepinProgram, [
    utf8('need'), u16(TIMEPIN_SCHEMA_VERSION),
    hash32(specHash, 'evidenceSpecHash'), i64(targetTs, 'targetTs'),
  ]);
  const receiverConfigPda = receiverProgram => derive(pk(receiverProgram), [utf8('config')]);
  const programDataPda = program => derive(loaderProgram, [pkBytes(program)]);

  const encodeEvidenceSpecArgs = args => {
    const out = concat(
      u16(args.schema, 'schema'),
      u8(args.adapter, 'adapter'),
      pkBytes(args.receiverProgram, 'receiverProgram'),
      pkBytes(args.pushOracleProgram, 'pushOracleProgram'),
      u16(args.shardId, 'shardId'),
      nonzero32(args.feedId, 'feedId'),
      u8(args.requiredVerification, 'requiredVerification'),
      u32(args.targetGridSeconds, 'targetGridSeconds'),
      u32(args.minOpenLeadSeconds, 'minOpenLeadSeconds'),
      u32(args.maxTargetAheadSeconds, 'maxTargetAheadSeconds'),
      u32(args.maxPreTargetGapSeconds, 'maxPreTargetGapSeconds'),
      u32(args.maxPostTargetLagSeconds, 'maxPostTargetLagSeconds'),
      u32(args.captureGraceSeconds, 'captureGraceSeconds'),
      u16(args.maxFutureSkewSeconds, 'maxFutureSkewSeconds'),
      i8(args.minExponent, 'minExponent'),
      i8(args.maxExponent, 'maxExponent'),
      u32(args.maxConfidenceBps, 'maxConfidenceBps'),
      u64(args.receiverProgramdataSlot, 'receiverProgramdataSlot'),
      nonzero32(args.receiverConfigHash, 'receiverConfigHash'),
      pkBytes(args.wormholeProgram, 'wormholeProgram'),
      u64(args.wormholeProgramdataSlot, 'wormholeProgramdataSlot'),
    );
    if (out.length !== 214) throw new RangeError('EvidenceSpecArgs must encode to 214 bytes');
    return out;
  };

  const encodeEconomyArgs = args => {
    const curve = Array.from(args.podiumCurve || []);
    if (curve.length !== 3) throw new RangeError('podiumCurve must contain three values');
    const out = concat(
      u16(args.schema, 'schema'), pkBytes(args.timepinProgram, 'timepinProgram'),
      u16(args.timepinSchema, 'timepinSchema'),
      nonzero32(args.clusterGenesisHash, 'clusterGenesisHash'),
      nonzero32(args.migrationId, 'migrationId'),
      hash32(args.legacyRoot, 'legacyRoot'),
      hash32(args.legacySnapshotHash, 'legacySnapshotHash'),
      u64(args.legacyCutoverSlot, 'legacyCutoverSlot'),
      u32(args.legacyLeafCount, 'legacyLeafCount'),
      u64(args.legacyTotalCredits, 'legacyTotalCredits'),
      u64(args.legacyTotalXp, 'legacyTotalXp'),
      nonzero32(args.rulesetPolicyRoot, 'rulesetPolicyRoot'),
      u16(args.rulesetPolicyCount, 'rulesetPolicyCount'),
      pkBytes(args.rcxMint, 'rcxMint'), pkBytes(args.rcxTokenProgram, 'rcxTokenProgram'),
      u8(args.rcxDecimals, 'rcxDecimals'),
      u64(args.rawUnitsPerCredit, 'rawUnitsPerCredit'),
      u16(args.burnPerMille, 'burnPerMille'),
      u16(args.podiumPerMille, 'podiumPerMille'),
      ...curve.map((value, index) => u16(value, 'podiumCurve[' + index + ']')),
      u8(args.rankShardCount, 'rankShardCount'),
      u32(args.daySeconds, 'daySeconds'),
      u64(args.hitPayoutNumerator, 'hitPayoutNumerator'),
      u64(args.hitPayoutDenominator, 'hitPayoutDenominator'),
      u64(args.settleXp, 'settleXp'), u64(args.minStake, 'minStake'),
      u64(args.maxStake, 'maxStake'), u16(args.maxOpen, 'maxOpen'),
      u64(args.cleanupBondLamports, 'cleanupBondLamports'),
      u32(args.revealWindowSeconds, 'revealWindowSeconds'),
      u32(args.maxHorizonSeconds, 'maxHorizonSeconds'),
    );
    if (out.length !== 372) throw new RangeError('EconomyArgs must encode to 372 bytes');
    return out;
  };

  const encodeRulesetArgs = args => {
    const out = concat(
      u16(args.schema, 'schema'),
      hash32(args.economyHash, 'economyHash'),
      nonzero32(args.evidenceSpecHash, 'evidenceSpecHash'),
      nonzero32(args.evidencePolicyHash, 'evidencePolicyHash'),
      nonzero32(args.feedId, 'feedId'),
      u8(args.entryMode, 'entryMode'),
      u32(args.horizonSeconds, 'horizonSeconds'),
      u32(args.targetGridSeconds, 'targetGridSeconds'),
      u32(args.minOpenLeadSeconds, 'minOpenLeadSeconds'),
      u32(args.maxEntryAgeSeconds, 'maxEntryAgeSeconds'),
      u32(args.bandNumerator, 'bandNumerator'),
      u32(args.bandDenominator, 'bandDenominator'),
      u64(args.baseXp, 'baseXp'),
    );
    if (out.length !== 163) throw new RangeError('RulesetArgs must encode to 163 bytes');
    return out;
  };

  const evidencePolicyHash = async args =>
    sha256(utf8('rcx-timepin:evidence-policy:v2\0'),
      encodeEvidenceSpecArgs(args).subarray(0, 134));
  const evidenceSpecHash = async args =>
    sha256(utf8('rcx-timepin:evidence-spec:v2-generation\0'),
      encodeEvidenceSpecArgs(args));
  const economyHashOf = async args =>
    sha256(utf8('rcx-core:economy:g2\0'), encodeEconomyArgs(args));
  const rulesetHashOf = async args =>
    sha256(utf8('rcx-core:ruleset:g2\0'), encodeRulesetArgs(args));

  const decodeEconomy = data => {
    const r = new Reader(data, 'Economy', ACCOUNT_SIZE.Economy);
    const value = {
      schema: r.u16(), bump: r.u8(), economyHash: r.bytes32(),
      args: {
        schema: r.u16(), timepinProgram: r.key(), timepinSchema: r.u16(),
        clusterGenesisHash: r.bytes32(), migrationId: r.bytes32(),
        legacyRoot: r.bytes32(), legacySnapshotHash: r.bytes32(),
        legacyCutoverSlot: r.u64(), legacyLeafCount: r.u32(),
        legacyTotalCredits: r.u64(), legacyTotalXp: r.u64(),
        rulesetPolicyRoot: r.bytes32(), rulesetPolicyCount: r.u16(),
        rcxMint: r.key(), rcxTokenProgram: r.key(), rcxDecimals: r.u8(),
        rawUnitsPerCredit: r.u64(), burnPerMille: r.u16(),
        podiumPerMille: r.u16(), podiumCurve: [r.u16(), r.u16(), r.u16()],
        rankShardCount: r.u8(), daySeconds: r.u32(),
        hitPayoutNumerator: r.u64(), hitPayoutDenominator: r.u64(),
        settleXp: r.u64(), minStake: r.u64(), maxStake: r.u64(),
        maxOpen: r.u16(), cleanupBondLamports: r.u64(),
        revealWindowSeconds: r.u32(), maxHorizonSeconds: r.u32(),
      },
    };
    r.done();
    return value;
  };

  const decodeRuleset = data => {
    const r = new Reader(data, 'Ruleset', ACCOUNT_SIZE.Ruleset);
    const value = {
      schema: r.u16(), bump: r.u8(), rulesetHash: r.bytes32(),
      args: {
        schema: r.u16(), economyHash: r.bytes32(),
        evidenceSpecHash: r.bytes32(), evidencePolicyHash: r.bytes32(),
        feedId: r.bytes32(), entryMode: r.u8(),
        horizonSeconds: r.u32(), targetGridSeconds: r.u32(),
        minOpenLeadSeconds: r.u32(), maxEntryAgeSeconds: r.u32(),
        bandNumerator: r.u32(), bandDenominator: r.u32(), baseXp: r.u64(),
      },
    };
    r.done();
    return value;
  };

  const decodeEvidenceSpec = data => {
    const r = new Reader(data, 'EvidenceSpecV2', ACCOUNT_SIZE.EvidenceSpecV2);
    const schema = r.u16();
    const value = {
      schema,
      args: {
        schema, adapter: r.u8(), receiverProgram: r.key(),
        pushOracleProgram: r.key(), shardId: r.u16(), feedId: r.bytes32(),
        requiredVerification: r.u8(), targetGridSeconds: r.u32(),
        minOpenLeadSeconds: r.u32(), maxTargetAheadSeconds: r.u32(),
        maxPreTargetGapSeconds: r.u32(), maxPostTargetLagSeconds: r.u32(),
        captureGraceSeconds: r.u32(), maxFutureSkewSeconds: r.u16(),
        minExponent: r.i8(), maxExponent: r.i8(),
        maxConfidenceBps: r.u32(),
      },
    };
    value.evidencePolicyHash = r.bytes32();
    value.args.receiverProgramdataSlot = r.u64();
    value.args.receiverConfigHash = r.bytes32();
    value.args.wormholeProgram = r.key();
    value.args.wormholeProgramdataSlot = r.u64();
    value.registeredSlot = r.u64();
    r.done();
    return value;
  };

  const decodeNeed = data => {
    const r = new Reader(data, 'TimepinNeedV2', ACCOUNT_SIZE.TimepinNeedV2);
    const value = {
      schema: r.u16(), bump: r.u8(), state: r.u8(),
      evidenceSpecHash: r.bytes32(), targetTs: r.i64(),
      sourceDeadlineTs: r.i64(), captureDeadlineTs: r.i64(),
      candidateAHash: r.bytes32(), candidateBHash: r.bytes32(),
      // The two rent fields, and only those. Eleven obs_ fields were briefly
      // decoded here as well; they are gone from the account because nothing
      // ever wrote them. r.done() below asserts every byte is consumed, which
      // makes this decoder one of THREE places that must agree with
      // TimepinNeedV2::LEN exactly - the Rust reader, this client, and
      // model.mjs. Borsh is positional, so this order mirrors the struct.
      openRefs: r.u32(), rentPayer: r.key(),
    };
    r.done();
    return value;
  };

  const decodeLedger = data => {
    const r = new Reader(data, 'PlayerLedger', ACCOUNT_SIZE.PlayerLedger);
    const value = {
      schema: r.u16(), bump: r.u8(), economyHash: r.bytes32(), player: r.key(),
      credits: r.u64(), lockedCredits: r.u64(), xp: r.u64(),
      legacyCredits: r.u64(), reloadCredits: r.u64(), payoutCredits: r.u64(),
      reservedPayoutCredits: r.u64(), retiredCredits: r.u64(),
      refundedCredits: r.u64(), legacyXp: r.u64(), earnedXp: r.u64(),
      reservedXp: r.u64(), streak: r.u32(), best: r.u32(),
      hits: r.u64(), shots: r.u64(), voids: r.u64(), forfeits: r.u64(),
      sealed: r.u64(), open: r.u16(), brierSum: r.u128(),
      nextShotNonce: r.u64(), nextReloadNonce: r.u64(),
      rcxBurned: r.u64(), rcxRouted: r.u64(),
      rcxReloaded: r.u64(), rcxRetained: r.u64(),
    };
    r.done();
    return value;
  };

  const decodeShot = data => {
    const r = new Reader(data, 'Shot', ACCOUNT_SIZE.Shot);
    // Borsh field order follows state.rs::Shot. Keep state/outcome bytes numeric:
    // an unknown value is evidence to display, never an invented hit or miss.
    const value = {
      schema: r.u16(), bump: r.u8(), economyHash: r.bytes32(),
      rulesetHash: r.bytes32(), player: r.key(), rentRefund: r.key(),
      delegate: r.key(), nonce: r.u64(), commit: r.bytes32(),
      entryMode: r.u8(), state: r.u8(), voidReason: r.u8(),
      stake: r.u64(), cleanupBondLamports: r.u64(), xpBase: r.u64(),
      sealedTs: r.i64(), entryTargetTs: r.i64(), exitTargetTs: r.i64(),
      scoreDay: r.i64(), rankShard: r.u8(), entryNeed: r.key(),
      exitNeed: r.key(), activationWorker: r.key(), activationSlot: r.u64(),
      activationTs: r.i64(), entryMessageHash: r.bytes32(),
      entryTimepinResultHash: r.bytes32(), entryPrice: r.i64(),
      entryConf: r.u64(), entryExponent: r.i32(), entryPublishTime: r.i64(),
      exitMessageHash: r.bytes32(), exitTimepinResultHash: r.bytes32(),
      exitPrice: r.i64(), exitConf: r.u64(), exitExponent: r.i32(),
      exitPublishTime: r.i64(), outcomeYes: r.u8(), settledTs: r.i64(),
      resolutionSlot: r.u64(), revealDeadlineTs: r.i64(), side: r.u8(),
      pBps: r.u16(), hit: r.u8(), xpAwarded: r.u64(), resolver: r.key(),
      forfeitWorker: r.key(), terminalSlot: r.u64(), terminalTs: r.i64(),
      revealedSalt: r.bytes32(), resolutionHash: r.bytes32(), terminalHash: r.bytes32(),
    };
    r.done();
    return value;
  };

  const decodeHistoryPage = data => {
    // M3: a fixed-size commitment, not a container of rows. This used to walk a
    // Vec of Option<ShotResult> and count the Some tags; there are no rows to
    // walk. The rows live in the ShotArchived events, and resultsRoot is what
    // proves the ones a reader has were not altered.
    const r = new Reader(data, 'HistoryPage', ACCOUNT_SIZE.HistoryPage);
    const value = {
      schema: r.u16(), bump: r.u8(), economyHash: r.bytes32(),
      player: r.key(), pageIndex: r.u64(),
      pendingCount: r.u8(), terminalMask: r.u16(), resultsRoot: r.bytes32(),
    };
    r.done();
    if (value.pendingCount > HISTORY_PAGE_CAP)
      throw new RangeError('HistoryPage has too many slots');
    // No bit may be set above the slots actually appended. JS shifts are 32-bit,
    // so this is safe at pendingCount === 16 where the Rust had to widen to u32.
    if ((value.terminalMask >>> value.pendingCount) !== 0)
      throw new RangeError('HistoryPage has a terminal bit above its slots');
    value.terminalCount = 0;
    for (let bit = value.terminalMask; bit; bit &= bit - 1) value.terminalCount++;
    return value;
  };

  const validateAddress = (address, expected, bump, actualBump, label) => {
    if (!pk(address).equals(expected)) throw new TypeError(label + ' PDA mismatch');
    if (actualBump !== undefined && actualBump !== bump)
      throw new TypeError(label + ' bump mismatch');
  };
  const validateEvidenceSpecShape = (args, registeredSlot) => {
    const schema = numberUnsigned(args.schema, 0xffff, 'schema');
    const adapter = numberUnsigned(args.adapter, 0xff, 'adapter');
    const verification = numberUnsigned(
      args.requiredVerification, 0xff, 'requiredVerification');
    const grid = numberUnsigned(args.targetGridSeconds, 0xffff_ffff, 'targetGridSeconds');
    const lead = numberUnsigned(args.minOpenLeadSeconds, 0xffff_ffff, 'minOpenLeadSeconds');
    const ahead = numberUnsigned(args.maxTargetAheadSeconds, 0xffff_ffff, 'maxTargetAheadSeconds');
    const preGap = numberUnsigned(args.maxPreTargetGapSeconds, 0xffff_ffff, 'maxPreTargetGapSeconds');
    const postLag = numberUnsigned(args.maxPostTargetLagSeconds, 0xffff_ffff, 'maxPostTargetLagSeconds');
    const grace = numberUnsigned(args.captureGraceSeconds, 0xffff_ffff, 'captureGraceSeconds');
    const skew = numberUnsigned(args.maxFutureSkewSeconds, 0xffff, 'maxFutureSkewSeconds');
    const minExponent = Number(signed(args.minExponent, -128n, 127n, 'minExponent'));
    const maxExponent = Number(signed(args.maxExponent, -128n, 127n, 'maxExponent'));
    const confidence = numberUnsigned(args.maxConfidenceBps, 0xffff_ffff, 'maxConfidenceBps');
    const receiverSlot = unsigned(
      args.receiverProgramdataSlot, U64_MAX, 'receiverProgramdataSlot');
    const wormholeSlot = unsigned(
      args.wormholeProgramdataSlot, U64_MAX, 'wormholeProgramdataSlot');
    nonzero32(args.feedId, 'feedId');
    nonzero32(args.receiverConfigHash, 'receiverConfigHash');
    // BOTH ADAPTERS. This read `adapter !== 1`, which refused every MIN-CAPTURE
    // spec - the rule the mainnet manifest uses - so the browser client could
    // not read or build the economy the programs are being frozen for. Same
    // defect, found the same day, as foreign_timepin.rs validate_spec_shape.
    if (schema !== TIMEPIN_SCHEMA_VERSION ||
        (adapter !== ADAPTER_PYTH_PUSH_V2 &&
         adapter !== ADAPTER_PYTH_MIN_CAPTURE_V2) ||
        !pk(args.receiverProgram).equals(pythReceiver) ||
        !pk(args.pushOracleProgram).equals(pythPushOracle) ||
        verification !== 1)
      throw new TypeError('EvidenceSpec oracle identity mismatch');
    if (!grid || grid > 86_400 || lead < 5 || lead > 86_400 ||
        ahead < lead || ahead > 30 * 86_400 ||
        // The pre-gap is pinned in OPPOSITE directions by the two adapters, so
        // `!preGap` was a SECOND, independent rejection of MIN-CAPTURE: under
        // that adapter zero is not merely allowed, it is required, because a
        // non-zero bound would be a dead number inside every spec hash.
        // Mirrors rcx-timepin-v2 lib.rs:573-583 and foreign_timepin.rs:632.
        (adapter === ADAPTER_PYTH_MIN_CAPTURE_V2
          ? preGap !== 0
          : (!preGap || preGap > 7 * 86_400)) ||
        !postLag || postLag > 7 * 86_400 ||
        !grace || grace > 86_400 || skew > 300 ||
        minExponent < -18 || maxExponent > 18 ||
        minExponent > maxExponent || confidence > 10_000)
      throw new TypeError('EvidenceSpec policy shape mismatch');
    if (!receiverSlot || !wormholeSlot ||
        equalBytes(pkBytes(args.wormholeProgram, 'wormholeProgram'), ZERO32))
      throw new TypeError('EvidenceSpec generation pins mismatch');
    if (registeredSlot !== undefined) {
      const registered = unsigned(registeredSlot, U64_MAX, 'registeredSlot');
      if (registered <= receiverSlot || registered <= wormholeSlot)
        throw new TypeError('EvidenceSpec registered slot mismatch');
    }
    return true;
  };

  const validateEconomyAccount = async ({ address, info, expectedHash }) => {
    const reader = exactAccount(info, coreProgram, 'Economy', ACCOUNT_SIZE.Economy);
    const value = decodeEconomy(reader.data);
    if (value.schema !== CORE_SCHEMA_VERSION || value.args.schema !== CORE_SCHEMA_VERSION)
      throw new TypeError('Economy schema mismatch');
    if (!value.args.timepinProgram.equals(timepinProgram) ||
        value.args.timepinSchema !== TIMEPIN_SCHEMA_VERSION)
      throw new TypeError('Economy Timepin identity mismatch');
    const calculated = await economyHashOf(value.args);
    expectEqual(value.economyHash, calculated, 'Economy hash');
    if (expectedHash !== undefined)
      expectEqual(calculated, hash32(expectedHash, 'expectedEconomyHash'), 'expected Economy hash');
    const [expected, bump] = economyPda(calculated);
    validateAddress(address, expected, bump, value.bump, 'Economy');
    return value;
  };

  const validateRulesetAccount = async ({ address, info, economy, expectedHash }) => {
    const reader = exactAccount(info, coreProgram, 'Ruleset', ACCOUNT_SIZE.Ruleset);
    const value = decodeRuleset(reader.data);
    if (value.schema !== CORE_SCHEMA_VERSION || value.args.schema !== CORE_SCHEMA_VERSION)
      throw new TypeError('Ruleset schema mismatch');
    expectEqual(value.args.economyHash, economy.economyHash, 'Ruleset Economy');
    const calculated = await rulesetHashOf(value.args);
    expectEqual(value.rulesetHash, calculated, 'Ruleset hash');
    if (expectedHash !== undefined)
      expectEqual(calculated, hash32(expectedHash, 'expectedRulesetHash'), 'expected Ruleset hash');
    const [expected, bump] = rulesetPda(calculated);
    validateAddress(address, expected, bump, value.bump, 'Ruleset');
    return value;
  };

  const validateEvidenceSpecAccount = async ({ address, info, expectedHash }) => {
    const reader = exactAccount(
      info, timepinProgram, 'EvidenceSpecV2', ACCOUNT_SIZE.EvidenceSpecV2);
    const value = decodeEvidenceSpec(reader.data);
    validateEvidenceSpecShape(value.args, value.registeredSlot);
    const policy = await evidencePolicyHash(value.args);
    expectEqual(value.evidencePolicyHash, policy, 'EvidenceSpec policy hash');
    const exact = await evidenceSpecHash(value.args);
    if (expectedHash !== undefined)
      expectEqual(exact, hash32(expectedHash, 'expectedEvidenceSpecHash'),
        'expected EvidenceSpec hash');
    const [expected, bump] = evidenceSpecPda(exact);
    validateAddress(address, expected, bump, undefined, 'EvidenceSpec');
    value.pdaBump = bump;
    value.specHash = exact;
    return value;
  };

  const validateNeedAccount = ({
    address, info, evidenceSpec, targetTs, requireOpen = true,
  }) => {
    const reader = exactAccount(
      info, timepinProgram, 'TimepinNeedV2', ACCOUNT_SIZE.TimepinNeedV2);
    const value = decodeNeed(reader.data);
    if (value.schema !== TIMEPIN_SCHEMA_VERSION) throw new TypeError('Need schema mismatch');
    expectEqual(value.evidenceSpecHash, evidenceSpec.specHash, 'Need EvidenceSpec');
    if (value.targetTs !== signed(targetTs, I64_MIN, I64_MAX, 'targetTs'))
      throw new TypeError('Need target mismatch');
    const [expected, bump] = needPda(evidenceSpec.specHash, value.targetTs);
    validateAddress(address, expected, bump, value.bump, 'Need');
    const expectedSource = value.targetTs +
      BigInt(evidenceSpec.args.maxPostTargetLagSeconds);
    const expectedCapture = expectedSource +
      BigInt(evidenceSpec.args.captureGraceSeconds);
    if (value.sourceDeadlineTs !== expectedSource ||
        value.captureDeadlineTs !== expectedCapture)
      throw new TypeError('Need deadline mismatch');
    const aZero = equalBytes(value.candidateAHash, ZERO32);
    const bZero = equalBytes(value.candidateBHash, ZERO32);
    if ((value.state === 0 || value.state === 4) && (!aZero || !bZero))
      throw new TypeError('Need terminal shape mismatch');
    if ((value.state === 1 || value.state === 2) && (aZero || !bZero))
      throw new TypeError('Need terminal shape mismatch');
    if (value.state === 3 && (aZero || bZero ||
        toHex(value.candidateAHash) >= toHex(value.candidateBHash)))
      throw new TypeError('Need terminal shape mismatch');
    if (value.state > 4) throw new TypeError('Need state mismatch');
    if (requireOpen && value.state !== 0) throw new TypeError('Need is not open');
    return value;
  };

  const validateLedgerAccount = ({ address, info, economy, player }) => {
    const reader = exactAccount(
      info, coreProgram, 'PlayerLedger', ACCOUNT_SIZE.PlayerLedger);
    const value = decodeLedger(reader.data);
    if (value.schema !== CORE_SCHEMA_VERSION) throw new TypeError('Ledger schema mismatch');
    expectEqual(value.economyHash, economy.economyHash, 'Ledger Economy');
    if (!value.player.equals(pk(player))) throw new TypeError('Ledger player mismatch');
    const [expected, bump] = ledgerPda(economy.economyHash, player);
    validateAddress(address, expected, bump, value.bump, 'Ledger');
    const held = value.credits + value.lockedCredits + value.retiredCredits;
    const sourced = value.legacyCredits + value.reloadCredits + value.payoutCredits;
    if (held !== sourced || sourced + value.reservedPayoutCredits > U64_MAX ||
        value.xp !== value.legacyXp + value.earnedXp ||
        value.xp + value.reservedXp > U64_MAX ||
        value.rcxReloaded !== value.rcxBurned + value.rcxRouted ||
        value.sealed !== BigInt(value.open) + value.shots + value.voids ||
        value.sealed !== value.nextShotNonce || value.forfeits > value.shots)
      throw new TypeError('Ledger conservation mismatch');
    return value;
  };

  const validateShotAccount = ({ address, info, economy, ruleset, player, nonce }) => {
    const reader = exactAccount(info, coreProgram, 'Shot', ACCOUNT_SIZE.Shot);
    const value = decodeShot(reader.data);
    if (value.schema !== CORE_SCHEMA_VERSION) throw new TypeError('Shot schema mismatch');
    expectEqual(value.economyHash, economy.economyHash, 'Shot Economy');
    expectEqual(value.rulesetHash, ruleset.rulesetHash, 'Shot Ruleset');
    expectEqual(ruleset.args.economyHash, economy.economyHash, 'Ruleset Economy');
    if (!value.player.equals(pk(player))) throw new TypeError('Shot player mismatch');
    const expectedNonce = unsigned(nonce, U64_MAX, 'nonce');
    if (value.nonce !== expectedNonce) throw new TypeError('Shot nonce mismatch');
    const [expected, bump] = shotPda(economy.economyHash, player, expectedNonce);
    validateAddress(address, expected, bump, value.bump, 'Shot');
    return value;
  };

  const validateHistoryPageAccount = ({
    address, info, economy, player, pageIndex,
  }) => {
    const reader = exactAccount(info, coreProgram, 'HistoryPage');
    const value = decodeHistoryPage(reader.data);
    if (value.schema !== CORE_SCHEMA_VERSION) throw new TypeError('HistoryPage schema mismatch');
    expectEqual(value.economyHash, economy.economyHash, 'HistoryPage Economy');
    if (!value.player.equals(pk(player))) throw new TypeError('HistoryPage player mismatch');
    const index = unsigned(pageIndex, U64_MAX, 'pageIndex');
    if (value.pageIndex !== index) throw new TypeError('HistoryPage index mismatch');
    const [expected, bump] = historyPagePda(economy.economyHash, player, index);
    validateAddress(address, expected, bump, value.bump, 'HistoryPage');
    return value;
  };

  const validateForwardKernel = ({ economy, ruleset, evidenceSpec }) => {
    const rules = ruleset.args, spec = evidenceSpec.args;
    if (rules.entryMode !== FORWARD_ENTRY_MODE)
      throw new TypeError('Ruleset is not forward-entry');
    expectEqual(rules.economyHash, economy.economyHash, 'Ruleset Economy');
    expectEqual(rules.evidenceSpecHash, evidenceSpec.specHash, 'Ruleset EvidenceSpec');
    expectEqual(rules.evidencePolicyHash, evidenceSpec.evidencePolicyHash,
      'Ruleset evidence policy');
    expectEqual(rules.feedId, spec.feedId, 'Ruleset feed');
    if (rules.targetGridSeconds !== spec.targetGridSeconds ||
        rules.minOpenLeadSeconds !== spec.minOpenLeadSeconds ||
        spec.requiredVerification !== 1 ||
        spec.minExponent < CORE_MIN_EXPONENT ||
        spec.maxExponent > CORE_MAX_EXPONENT)
      throw new TypeError('Ruleset/Timepin timing mismatch');
    if (!rules.horizonSeconds ||
        rules.horizonSeconds % rules.targetGridSeconds !== 0 ||
        rules.horizonSeconds > economy.args.maxHorizonSeconds ||
        rules.maxEntryAgeSeconds !== 0)
      throw new TypeError('Ruleset horizon mismatch');
    const requiredAhead = BigInt(rules.horizonSeconds) +
      BigInt(rules.targetGridSeconds - 1) + BigInt(rules.minOpenLeadSeconds);
    if (BigInt(spec.maxTargetAheadSeconds) < requiredAhead)
      throw new TypeError('EvidenceSpec target-ahead window is too small');
    return true;
  };

  const divEuclid = (value, divisor) => {
    let quotient = value / divisor;
    const remainder = value % divisor;
    if (remainder < 0n) quotient -= 1n;
    return quotient;
  };
  const alignUp = (value, grid) => {
    const g = unsigned(grid, 0xffff_ffffn, 'grid');
    if (g === 0n) throw new RangeError('grid must be positive');
    const v = signed(value, I64_MIN, I64_MAX, 'timestamp');
    const remainder = ((v % g) + g) % g;
    return remainder === 0n ? v : v + g - remainder;
  };
  const admissionTiming = ({ chainNowTs, economy, ruleset, evidenceSpec }) => {
    validateForwardKernel({ economy, ruleset, evidenceSpec });
    const rules = ruleset.args, spec = evidenceSpec.args;
    const now = signed(chainNowTs, I64_MIN, I64_MAX, 'chainNowTs');
    const entryTargetTs = alignUp(
      now + BigInt(rules.minOpenLeadSeconds), rules.targetGridSeconds);
    const exitTargetTs = entryTargetTs + BigInt(rules.horizonSeconds);
    const sourceDeadlineTs = exitTargetTs + BigInt(spec.maxPostTargetLagSeconds);
    const captureDeadlineTs = sourceDeadlineTs + BigInt(spec.captureGraceSeconds);
    const revealDeadlineTs = captureDeadlineTs +
      BigInt(economy.args.revealWindowSeconds);
    const scoreDay = divEuclid(revealDeadlineTs, BigInt(DAY_SECONDS));
    for (const [label, value] of Object.entries({
      entryTargetTs, exitTargetTs, sourceDeadlineTs, captureDeadlineTs,
      revealDeadlineTs, scoreDay,
    })) signed(value, I64_MIN, I64_MAX, label);
    return {
      entryTargetTs, exitTargetTs, sourceDeadlineTs, captureDeadlineTs,
      revealDeadlineTs, scoreDay,
    };
  };

  const rankShardFor = async player => {
    const digest = await sha256(
      utf8('rcx-core:rank-shard-for:g2\0'), pkBytes(player, 'player'));
    return digest[0] % RANK_SHARD_COUNT;
  };
  const rankShardPda = async (economyHash, day, player) => derive(coreProgram, [
    utf8('rank_shard'), hash32(economyHash, 'economyHash'),
    i64(day, 'scoreDay'), u8(await rankShardFor(player), 'rankShard'),
  ]);

  const commitmentHash = async ({
    economyHash, rulesetHash, player, nonce, side, probability, salt,
  }) => {
    const direction = numberUnsigned(side, 0xff, 'side');
    if (direction !== 0 && direction !== 1) throw new RangeError('side must be 0 or 1');
    return sha256(
      utf8('rcx-core:commitment:g2\0'), pkBytes(coreProgram),
      hash32(economyHash, 'economyHash'), hash32(rulesetHash, 'rulesetHash'),
      pkBytes(player, 'player'), u64(nonce, 'nonce'), u8(direction),
      u16(probability, 'probability'), hash32(salt, 'salt'),
    );
  };

  const registerEvidenceSpecIx = async ({ payer, args, specHash }) => {
    validateEvidenceSpecShape(args);
    const exact = await evidenceSpecHash(args);
    if (specHash !== undefined)
      expectEqual(exact, hash32(specHash, 'specHash'), 'register EvidenceSpec hash');
    const [spec] = evidenceSpecPda(exact);
    const [receiverData] = programDataPda(args.receiverProgram);
    const [config] = receiverConfigPda(args.receiverProgram);
    const [wormholeData] = programDataPda(args.wormholeProgram);
    return instruction(timepinProgram, 'register_evidence_spec', [
      meta(payer, true, true), meta(spec, false, true),
      meta(args.receiverProgram), meta(receiverData), meta(config),
      meta(args.wormholeProgram), meta(wormholeData),
      meta(SystemProgram.programId),
    ], exact, encodeEvidenceSpecArgs(args));
  };

  const openNeedIx = ({ actor, specHash, targetTs }) => {
    const exact = hash32(specHash, 'specHash');
    const [spec] = evidenceSpecPda(exact);
    const [need] = needPda(exact, targetTs);
    return instruction(timepinProgram, 'open_need', [
      meta(actor, true, true), meta(spec), meta(need, false, true),
      meta(SystemProgram.programId),
    ], exact, i64(targetTs, 'targetTs'));
  };

  const openLedgerIx = ({ player, economyHash }) => {
    const [economy] = economyPda(economyHash);
    const [ledger] = ledgerPda(economyHash, player);
    return instruction(coreProgram, 'open_ledger', [
      meta(player, true, true), meta(economy), meta(ledger, false, true),
      meta(SystemProgram.programId),
    ]);
  };

  const openHistoryPageIx = ({ actor, player, economyHash, pageIndex }) => {
    const [economy] = economyPda(economyHash);
    const [ledger] = ledgerPda(economyHash, player);
    const [historyPage] = historyPagePda(economyHash, player, pageIndex);
    return instruction(coreProgram, 'open_history_page', [
      meta(actor, true, true), meta(economy), meta(player), meta(ledger),
      meta(historyPage, false, true), meta(SystemProgram.programId),
    ], u64(pageIndex, 'pageIndex'));
  };

  const sealForwardIx = async ({
    player, economyHash, rulesetHash, evidenceSpecHash,
    nonce, commit, stake, entryTargetTs, horizonSeconds, scoreDay,
  }) => {
    const [economy] = economyPda(economyHash);
    const [ruleset] = rulesetPda(rulesetHash);
    const [ledger] = ledgerPda(economyHash, player);
    const [playerDay] = playerDayPda(economyHash, scoreDay, player);
    const [rankShard] = await rankShardPda(economyHash, scoreDay, player);
    const pageIndex = unsigned(nonce, U64_MAX, 'nonce') / BigInt(HISTORY_PAGE_CAP);
    const [historyPage] = historyPagePda(economyHash, player, pageIndex);
    const [shot] = shotPda(economyHash, player, nonce);
    const exitTargetTs = signed(entryTargetTs, I64_MIN, I64_MAX, 'entryTargetTs') +
      BigInt(numberUnsigned(horizonSeconds, 0xffff_ffff, 'horizonSeconds'));
    const [entryNeed] = needPda(evidenceSpecHash, entryTargetTs);
    const [exitNeed] = needPda(evidenceSpecHash, exitTargetTs);
    return instruction(coreProgram, 'seal_forward', [
      meta(player, true, true), meta(economy), meta(ruleset),
      meta(ledger, false, true), meta(playerDay, false, true),
      meta(rankShard, false, true), meta(historyPage, false, true),
      meta(shot, false, true), meta(entryNeed), meta(exitNeed),
      meta(SystemProgram.programId),
    ], u64(nonce, 'nonce'), nonzero32(commit, 'commit'), u64(stake, 'stake'),
    i64(entryTargetTs, 'entryTargetTs'), i64(scoreDay, 'scoreDay'));
  };

  const buildForwardAdmission = async ({
    player, economy, ruleset, evidenceSpec, ledger = null,
    chainNowTs, stake, commit, nonce,
  }) => {
    validateForwardKernel({ economy, ruleset, evidenceSpec });
    const playerKey = pk(player);
    const chosenNonce = nonce === undefined
      ? (ledger ? ledger.nextShotNonce : 0n)
      : unsigned(nonce, U64_MAX, 'nonce');
    if (ledger) {
      expectEqual(ledger.economyHash, economy.economyHash, 'Ledger Economy');
      if (!ledger.player.equals(playerKey)) throw new TypeError('Ledger player mismatch');
      if (ledger.nextShotNonce !== chosenNonce) throw new TypeError('Ledger nonce mismatch');
      if (ledger.credits < unsigned(stake, U64_MAX, 'stake'))
        throw new RangeError('insufficient on-chain credits');
      if (ledger.open >= economy.args.maxOpen) throw new RangeError('too many open shots');
    }
    const amount = unsigned(stake, U64_MAX, 'stake');
    if (amount < economy.args.minStake || amount > economy.args.maxStake)
      throw new RangeError('stake outside Economy bounds');
    const timing = admissionTiming({ chainNowTs, economy, ruleset, evidenceSpec });
    const pageIndex = chosenNonce / BigInt(HISTORY_PAGE_CAP);
    const instructions = [
      openLedgerIx({ player: playerKey, economyHash: economy.economyHash }),
      openHistoryPageIx({
        actor: playerKey, player: playerKey, economyHash: economy.economyHash,
        pageIndex,
      }),
      openNeedIx({
        actor: playerKey, specHash: evidenceSpec.specHash,
        targetTs: timing.entryTargetTs,
      }),
      openNeedIx({
        actor: playerKey, specHash: evidenceSpec.specHash,
        targetTs: timing.exitTargetTs,
      }),
      await sealForwardIx({
        player: playerKey, economyHash: economy.economyHash,
        rulesetHash: ruleset.rulesetHash,
        evidenceSpecHash: evidenceSpec.specHash, nonce: chosenNonce,
        commit, stake: amount, entryTargetTs: timing.entryTargetTs,
        horizonSeconds: ruleset.args.horizonSeconds, scoreDay: timing.scoreDay,
      }),
    ];
    return {
      instructions, timing, nonce: chosenNonce, pageIndex,
      addresses: {
        economy: economyPda(economy.economyHash)[0],
        ruleset: rulesetPda(ruleset.rulesetHash)[0],
        ledger: ledgerPda(economy.economyHash, playerKey)[0],
        historyPage: historyPagePda(economy.economyHash, playerKey, pageIndex)[0],
        shot: shotPda(economy.economyHash, playerKey, chosenNonce)[0],
        evidenceSpec: evidenceSpecPda(evidenceSpec.specHash)[0],
        entryNeed: needPda(evidenceSpec.specHash, timing.entryTargetTs)[0],
        exitNeed: needPda(evidenceSpec.specHash, timing.exitTargetTs)[0],
      },
    };
  };

  return Object.freeze({
    coreProgram, timepinProgram, pythReceiver, pythPushOracle, loaderProgram,
    economyPda, rulesetPda, ledgerPda, historyPagePda, shotPda,
    playerDayPda, rankShardPda, evidenceSpecPda, needPda,
    receiverConfigPda, programDataPda,
    encodeEvidenceSpecArgs, encodeEconomyArgs, encodeRulesetArgs,
    evidencePolicyHash, evidenceSpecHash, economyHashOf, rulesetHashOf,
    decodeEconomy, decodeRuleset, decodeEvidenceSpec, decodeNeed,
    decodeLedger, decodeShot, decodeHistoryPage,
    validateEconomyAccount, validateRulesetAccount,
    validateEvidenceSpecAccount, validateNeedAccount,
    validateLedgerAccount, validateShotAccount, validateHistoryPageAccount, validateForwardKernel,
    validateEvidenceSpecShape,
    admissionTiming, rankShardFor, commitmentHash,
    registerEvidenceSpecIx, openNeedIx, openLedgerIx, openHistoryPageIx,
    sealForwardIx, buildForwardAdmission,
    buildIx,
  });
}
