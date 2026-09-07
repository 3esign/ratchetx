// P6 canary — pure, dependency-free checks. Every function here is deterministic and testable
// without a network: callers pass bytes/JSON in, verdicts come out. No Date.now anywhere.
import { createHash } from 'node:crypto';

export const LOADER_V3 = 'BPFLoaderUpgradeab1e11111111111111111111111';
export const sha256 = b => createHash('sha256').update(b).digest('hex');

// ---------- ELF ----------
export function elfInfo(bytes) {
  const b = Buffer.from(bytes);
  const isElf = b.length >= 0x40 && b[0] === 0x7f && b[1] === 0x45 && b[2] === 0x4c && b[3] === 0x46;
  if (!isElf) return { isElf: false };
  return { isElf: true, is64: b[4] === 2, eFlags: b.readUInt32LE(0x30), sbpfVersion: b.readUInt32LE(0x30) };
}

// ---------- Loader-v3 (upgradeable) account layouts ----------
// Program account: u32 enum(2=Program) | programdata: Pubkey(32)            => 36 bytes
// ProgramData:     u32 enum(3=ProgramData) | slot: u64 | option u8 | authority Pubkey(32 if option==1) | elf...
export function parseProgramAccount(data) {
  const b = Buffer.from(data);
  if (b.length !== 36) return { ok: false, reason: `program account length ${b.length} != 36` };
  if (b.readUInt32LE(0) !== 2) return { ok: false, reason: `program enum ${b.readUInt32LE(0)} != 2` };
  return { ok: true, programData: b.subarray(4, 36) };
}
export function parseProgramData(data) {
  const b = Buffer.from(data);
  if (b.length < 45) return { ok: false, reason: `programdata too short (${b.length})` };
  if (b.readUInt32LE(0) !== 3) return { ok: false, reason: `programdata enum ${b.readUInt32LE(0)} != 3` };
  const slot = b.readBigUInt64LE(4);
  const opt = b[12];
  if (opt !== 0 && opt !== 1) return { ok: false, reason: `authority option byte ${opt} is neither 0 nor 1` };
  const authority = opt === 1 ? b.subarray(13, 45) : null;
  return { ok: true, slot, authority, elf: b.subarray(45) };
}

// The on-chain ProgramData keeps reserved capacity after the ELF; the tuple pins size + sha of the ELF only,
// and every byte after the pinned size must be zero (exactly what the devnet dump verification did on 2026-09-04).
export function verifyElfBytes(elf, expectedSize, expectedSha) {
  const b = Buffer.from(elf);
  if (b.length < expectedSize) return { ok: false, reason: `on-chain elf ${b.length} B shorter than pinned ${expectedSize} B` };
  const prefix = b.subarray(0, expectedSize);
  const sha = sha256(prefix);
  let nonzero = 0; for (let i = expectedSize; i < b.length; i++) if (b[i] !== 0) nonzero++;
  const info = elfInfo(prefix);
  return { ok: sha === expectedSha.toLowerCase() && nonzero === 0, sha, padding: b.length - expectedSize, nonzeroPadding: nonzero, sbpfVersion: info.sbpfVersion ?? null, isElf: info.isElf };
}

// Full program verdict from the two raw accounts + the pinned tuple.
export function verifyProgram({ programAccount, programDataAccount, programDataKey, expected }) {
  const problems = [];
  if (programAccount.owner !== LOADER_V3) problems.push(`program owner ${programAccount.owner} != Loader-v3`);
  if (!programAccount.executable) problems.push('program account is not executable');
  const p = parseProgramAccount(programAccount.data);
  if (!p.ok) problems.push(p.reason);
  else if (Buffer.from(p.programData).toString('hex') !== Buffer.from(programDataKey).toString('hex')) problems.push('program does not link to the supplied ProgramData address');
  if (programDataAccount.owner !== LOADER_V3) problems.push(`programdata owner ${programDataAccount.owner} != Loader-v3`);
  const pd = parseProgramData(programDataAccount.data);
  if (!pd.ok) { problems.push(pd.reason); return { ok: false, problems }; }
  const elf = verifyElfBytes(pd.elf, expected.size, expected.sha256);
  if (!elf.ok) problems.push(`elf mismatch: sha ${elf.sha} vs pinned ${expected.sha256}, nonzeroPadding ${elf.nonzeroPadding}`);
  if (expected.sbpfVersion !== undefined && elf.sbpfVersion !== expected.sbpfVersion) problems.push(`sbpf version ${elf.sbpfVersion} != pinned ${expected.sbpfVersion}`);
  const authorityHex = pd.authority ? Buffer.from(pd.authority).toString('hex') : null;
  if (expected.authorityHex !== undefined) {
    if ((expected.authorityHex ?? null) !== authorityHex) problems.push(`upgrade authority ${authorityHex ?? 'NONE'} != pinned ${expected.authorityHex ?? 'NONE'}`);
  }
  return { ok: problems.length === 0, problems, observed: { slot: pd.slot.toString(), authorityHex, elfSha: elf.sha, sbpfVersion: elf.sbpfVersion, padding: elf.padding } };
}

// ---------- RPC agreement / reorg awareness ----------
// reads: { endpoint -> { slot, accounts: { pubkey -> base64|null } } } all at the same commitment.
export function compareReadsets(reads) {
  const endpoints = Object.keys(reads);
  if (endpoints.length < 2) return { ok: false, reason: 'need >= 2 endpoints', disagreements: [] };
  const ref = reads[endpoints[0]];
  const disagreements = [];
  for (const ep of endpoints.slice(1)) {
    for (const [pk, v] of Object.entries(ref.accounts)) {
      if (reads[ep].accounts[pk] !== v) disagreements.push({ account: pk, [endpoints[0]]: v === null ? null : sha256(Buffer.from(v, 'base64')), [ep]: reads[ep].accounts[pk] === null ? null : sha256(Buffer.from(reads[ep].accounts[pk], 'base64')) });
    }
  }
  const slots = endpoints.map(e => reads[e].slot);
  return { ok: disagreements.length === 0, disagreements, slotSpread: Math.max(...slots) - Math.min(...slots) };
}

// Timepin Need states and Core Shot states only move forward. A regression means reorg/rollback or a bug.
export const NEED_ORDER = { 0: 0, 1: 1, 2: 2, 3: 2, 4: 2 };           // Open < Candidate < {Final, Ambiguous, Expired}
export function stateRegressions(previous, current, order) {
  const out = [];
  for (const [k, cur] of Object.entries(current)) {
    const prev = previous[k];
    if (prev === undefined) continue;
    const a = order[prev], b = order[cur];
    if (a === undefined || b === undefined) { out.push({ key: k, prev, cur, reason: 'unknown state' }); continue; }
    if (b < a) out.push({ key: k, prev, cur, reason: 'state moved backwards' });
    if (a === 2 && b === 2 && prev !== cur) out.push({ key: k, prev, cur, reason: 'terminal kind changed' });
  }
  return out;
}

// ---------- oracle liveness ----------
export function publishGaps(publishTimes) {
  const t = [...publishTimes].map(Number).sort((a, b) => a - b);
  const gaps = []; for (let i = 1; i < t.length; i++) gaps.push(t[i] - t[i - 1]);
  const max = gaps.length ? Math.max(...gaps) : 0;
  const sorted = [...gaps].sort((a, b) => a - b);
  const p = q => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : 0;
  return { samples: t.length, maxGap: max, p50: p(0.5), p95: p(0.95), gaps };
}

// ---------- thresholds ----------
// Every threshold is a pure predicate over the accumulated counters. SKIPPED never counts as PASS.
export function evaluateThresholds(counters, thresholds) {
  const rows = [];
  const add = (name, ok, detail, skipped = false) => rows.push({ name, status: skipped ? 'SKIPPED' : ok ? 'PASS' : 'FAIL', detail });
  add('genesis agreement', counters.genesisMismatch === 0, `${counters.genesisMismatch} mismatching reads`);
  add('rpc finalized disagreement', counters.rpcDisagreement === 0, `${counters.rpcDisagreement} disagreements`);
  add('authority / elf drift', counters.authorityDrift === 0, `${counters.authorityDrift} drift events`);
  add('sbpf version pinned', counters.sbpfMismatch === 0, `${counters.sbpfMismatch} mismatches`);
  add('state monotonic', counters.stateRegression === 0, `${counters.stateRegression} regressions`);
  add('founder services unreachable', counters.founderReachable === 0, `${counters.founderReachable} reachable probes`);
  add('tick continuity', counters.tickGaps === 0, `${counters.tickGaps} gaps > 2x interval`);
  add('oracle max gap', counters.oracleMaxGap <= thresholds.oracleMaxGapSeconds, `${counters.oracleMaxGap}s (limit ${thresholds.oracleMaxGapSeconds}s)`);
  add('minimum lifecycles', counters.lifecycles >= thresholds.minLifecycles, `${counters.lifecycles} (min ${thresholds.minLifecycles})`, counters.lifecycles === 0 && !counters.writeSideWired);
  add('replay rejected', counters.replayAccepted === 0, `${counters.replayAccepted} accepted replays`, !counters.writeSideWired);
  add('race single landing', counters.raceDoubleLand === 0, `${counters.raceDoubleLand} double landings`, !counters.writeSideWired);
  add('rollback leaves state intact', counters.rollbackLeak === 0, `${counters.rollbackLeak} leaks`, !counters.writeSideWired);
  add('timeout paths chain-gated', counters.earlyTimeoutAccepted === 0, `${counters.earlyTimeoutAccepted} early acceptances`, !counters.writeSideWired);
  const fails = rows.filter(r => r.status === 'FAIL').length, skips = rows.filter(r => r.status === 'SKIPPED').length;
  return { rows, verdict: fails ? 'FAIL' : skips ? 'INCOMPLETE (write-side not wired)' : 'PASS', fails, skips };
}
