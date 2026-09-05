// Timepin rule V3 — pure decision model ("SUBMITTED_PYTH_MIN").
//
// This is the executable specification for the settlement-evidence rule proposed
// on 2026-09-05 (adapter 3). It is deliberately tiny: no accounts, no RPC, no
// signatures. Every function is a pure transition over plain data so that the
// same vectors can be replayed against the Rust program once it is written.
//
// A "message" is a Pyth-authenticated PriceFeedMessage as the receiver exposes it
// (rec2-owned PriceUpdateV2 with VerificationLevel::Full). Authentication itself
// (owner, discriminator, Full, feed, generation pins) is OUTSIDE this model and
// unchanged from the current program; here `authentic: true` stands for "passed
// load_evidence minus the sponsored-PDA / write_authority pins".
//
// Total order on admissible messages:  key(m) = (publish_time, prev_publish_time, hash)
// Winner of a Need = the minimum key among ADMISSIBLE messages SUBMITTED before the
// absolute deadline D = target_ts + challenge_window_seconds.
//
// Why this key: the unique message with prev < T <= pub (the "strict bracket",
// i.e. the first Pythnet aggregate of second T) is the global minimum under this
// order, so the old rule is the LIMIT of the new one, reached whenever anyone
// submits that message. Every other party can only move the result toward that
// limit by submitting; nobody can move it away. AMBIGUOUS is unreachable because
// the key contains the message hash (a total order), so equal keys are the same
// message.

export const STATE = Object.freeze({ OPEN: 0, CANDIDATE: 1, FINAL: 2, EXPIRED: 3 });

export function compareKey(a, b) {
  if (a.publish_time !== b.publish_time) return a.publish_time < b.publish_time ? -1 : 1;
  if (a.prev_publish_time !== b.prev_publish_time) return a.prev_publish_time < b.prev_publish_time ? -1 : 1;
  if (a.hash === b.hash) return 0;
  return a.hash < b.hash ? -1 : 1;
}

/** Admissibility of one message for one Need under one spec. Pure. */
export function admissible(m, spec, need) {
  if (!m || m.authentic !== true) return { ok: false, reason: 'NOT_AUTHENTIC' };
  if (m.feed_id !== spec.feed_id) return { ok: false, reason: 'WRONG_FEED' };
  if (!(Number.isInteger(m.publish_time) && Number.isInteger(m.prev_publish_time))) return { ok: false, reason: 'BAD_TIMESTAMPS' };
  if (m.prev_publish_time > m.publish_time) return { ok: false, reason: 'BAD_PREDECESSOR' };
  if (m.publish_time < need.target_ts) return { ok: false, reason: 'BEFORE_TARGET' };
  if (m.publish_time - need.target_ts > spec.max_post_target_lag_seconds) return { ok: false, reason: 'POST_TARGET_LAG_TOO_LARGE' };
  if (!(m.price > 0)) return { ok: false, reason: 'NON_POSITIVE_PRICE' };
  if (m.exponent < spec.min_exponent || m.exponent > spec.max_exponent) return { ok: false, reason: 'EXPONENT_OUT_OF_BOUNDS' };
  if (BigInt(m.conf) * 10_000n > BigInt(m.price) * BigInt(spec.max_confidence_bps)) return { ok: false, reason: 'CONFIDENCE_TOO_WIDE' };
  return { ok: true };
}

/** Open a Need. Deadline is ABSOLUTE: target_ts + challenge_window_seconds. */
export function openNeed(spec, target_ts, now_ts) {
  if (target_ts % spec.target_grid_seconds !== 0) throw new Error('TARGET_MISALIGNED');
  if (now_ts + spec.min_open_lead_seconds > target_ts) throw new Error('TARGET_TOO_CLOSE');
  return {
    target_ts,
    deadline_ts: target_ts + spec.challenge_window_seconds,
    state: STATE.OPEN,
    winner: null,          // { message, submitter, submitted_at }
    submissions: 0,
    rejected: [],
    payout: null,
  };
}

/**
 * submit(): permissionless. Anyone may submit any admissible message before the
 * absolute deadline. The message becomes the winner iff its key is strictly
 * smaller than the current winner's key. Duplicates are no-ops (no reward).
 */
export function submit(need, message, submitter, now_ts, spec) {
  if (need.state === STATE.FINAL || need.state === STATE.EXPIRED) return { accepted: false, reason: 'TERMINAL' };
  if (now_ts < need.target_ts) return { accepted: false, reason: 'TARGET_NOT_REACHED' };
  if (now_ts >= need.deadline_ts) return { accepted: false, reason: 'WINDOW_CLOSED' };
  const a = admissible(message, spec, need);
  if (!a.ok) { need.rejected.push(a.reason); return { accepted: false, reason: a.reason }; }
  need.submissions += 1;
  if (need.winner === null) {
    need.winner = { message, submitter, submitted_at: now_ts };
    need.state = STATE.CANDIDATE;
    return { accepted: true, replaced: false };
  }
  const c = compareKey(message, need.winner.message);
  if (c === 0) return { accepted: true, replaced: false, duplicate: true };
  if (c < 0) { need.winner = { message, submitter, submitted_at: now_ts }; return { accepted: true, replaced: true }; }
  return { accepted: true, replaced: false, later: true };
}

/** finalize(): permissionless, only after the absolute deadline, only with a winner. */
export function finalize(need, now_ts, bounty_lamports) {
  if (need.state === STATE.FINAL || need.state === STATE.EXPIRED) return { ok: false, reason: 'TERMINAL' };
  if (now_ts < need.deadline_ts) return { ok: false, reason: 'WINDOW_OPEN' };
  if (need.winner === null) return { ok: false, reason: 'NO_CANDIDATE' };
  need.state = STATE.FINAL;
  need.payout = { to: need.winner.submitter, lamports: bounty_lamports, kind: 'WINNING_CAPTURE' };
  return { ok: true, winner: need.winner.message };
}

/** expire(): permissionless, only after the deadline, only with no winner. */
export function expire(need, now_ts) {
  if (need.state === STATE.FINAL || need.state === STATE.EXPIRED) return { ok: false, reason: 'TERMINAL' };
  if (now_ts < need.deadline_ts) return { ok: false, reason: 'WINDOW_OPEN' };
  if (need.winner !== null) return { ok: false, reason: 'HAS_CANDIDATE' };
  need.state = STATE.EXPIRED;
  return { ok: true };
}

/** Pure helper: the winner a set of messages WOULD produce (no deadline logic). */
export function minKey(messages, spec, need) {
  let best = null;
  for (const m of messages) {
    if (!admissible(m, spec, need).ok) continue;
    if (best === null || compareKey(m, best) < 0) best = m;
  }
  return best;
}

/** The old strict-bracket rule, kept as a reference oracle (adapter 2 semantics). */
export function strictBracket(messages, spec, need) {
  const hits = messages.filter(m => admissible(m, spec, need).ok &&
    m.prev_publish_time < need.target_ts && need.target_ts <= m.publish_time);
  return hits.length === 1 ? hits[0] : (hits.length === 0 ? null : 'AMBIGUOUS');
}

// ---------------------------------------------------------------------------
// Synthetic feed generators used by the tests (deterministic, seedable).
// ---------------------------------------------------------------------------

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function fakeHash(parts) {
  // FNV-1a over a string — only needs to be deterministic and collision-free for tests.
  let h = 0x811c9dc5; const s = parts.join('|');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0') + '-' + s.length.toString(16);
}

/**
 * A Pythnet-like aggregate stream: one aggregate every `aggregate_ms` ms with
 * 1-second timestamps; prev_publish_time = timestamp of the previous aggregate.
 * Returns ALL global messages (what Hermes would know).
 *
 * Default 1000 ms because that is what mainnet shows: every one of the 300
 * sponsored SOL/BTC messages sampled on 2026-09-05 had publish − prev = 1, i.e.
 * one authenticated message per second per feed. Sub-second aggregates (if Pythnet
 * ever emits them) are covered by the (prev, hash) tie-break, see test C2.
 */
export function pythnetStream({ feed_id, from_ts, to_ts, aggregate_ms = 1000, price0 = 100_000_000, rng = mulberry32(1) }) {
  const out = []; let t_ms = from_ts * 1000; let prev = from_ts - 1; let price = price0;
  while (t_ms <= to_ts * 1000) {
    const publish_time = Math.floor(t_ms / 1000);
    price = Math.max(1, Math.round(price * (1 + (rng() - 0.5) * 0.0004)));
    const m = { authentic: true, feed_id, publish_time, prev_publish_time: prev, price, conf: Math.round(price * 0.0002), exponent: -8 };
    m.hash = fakeHash([feed_id, publish_time, prev, price, m.conf]);
    out.push(m); prev = publish_time; t_ms += aggregate_ms;
  }
  return out;
}

/**
 * What a sponsored pusher exposes: one message every `period_s` seconds at phase
 * `phase_s` (publish_time % period_s == phase_s), always the LATEST aggregate at
 * push time. This reproduces the measured mainnet behaviour (SOL/BTC: 5 s, phase 2,
 * publish - prev = 1).
 */
export function sponsoredStream(global, { period_s = 5, phase_s = 2 }) {
  const byTs = new Map();
  for (const m of global) byTs.set(m.publish_time, m); // latest aggregate of each second wins the map
  const out = [];
  for (const [ts, m] of byTs) if (ts % period_s === phase_s) out.push(m);
  return out;
}
