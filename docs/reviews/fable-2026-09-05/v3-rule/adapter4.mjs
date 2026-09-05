// Adapter 4 — "certified first-after-T" on top of adapter 3, as an executable model.
//
// Evidence kinds a Need can receive before its absolute deadline D = T + window:
//   { kind:'message', m }                 an authentic Pyth message (sponsored capture or replay)
//   { kind:'cert',    m }                 the same message carrying a FIRST-AFTER-T certificate:
//                                         either (a) its own signed predecessor: m.prev_publish_time < T <= m.publish_time
//                                         (Pyth's benchmark uniqueness rule), or
//                                         (b) a ROOT_SUCCESSOR pair: consecutive attested roots n-1, n
//                                         with t(n-1) < T <= t(n) and m's leaf member of root n.
// Both certificate forms prove the same proposition ("m is the first attested state of this feed
// at or after T"); (a) needs nothing beyond the message, (b) needs the every-root-carries-every-leaf
// guarantee. The model treats them identically after validation.
//
// Rule: a valid certificate is terminal-strength evidence and unique — once one is accepted the
// winner is fixed. Without a certificate, the winner is the adapter-3 minimum over submitted
// authentic messages (key = publish_time, prev_publish_time, hash), which is a LIVENESS floor,
// not a payout-deterministic rule: it carries the selection residual modelled in test A5.
import { compareKey, admissible } from './model.mjs';

export const KIND = Object.freeze({ MESSAGE: 'message', CERT: 'cert' });

/** Validate a certificate against the Need. Pure. */
export function validCert(ev, need, roots) {
  const m = ev.m;
  if (!m || m.authentic !== true) return { ok: false, reason: 'NOT_AUTHENTIC' };
  if (ev.form === 'predecessor') {
    return (m.prev_publish_time < need.target_ts && need.target_ts <= m.publish_time)
      ? { ok: true } : { ok: false, reason: 'DOES_NOT_BRACKET' };
  }
  if (ev.form === 'roots') {
    const a = roots.get(ev.seq - 1), b = roots.get(ev.seq);
    if (!a || !b) return { ok: false, reason: 'ROOT_MISSING' };
    if (!(a.timestamp < need.target_ts && need.target_ts <= b.timestamp)) return { ok: false, reason: 'ROOTS_DO_NOT_BRACKET' };
    if (!b.leaves.has(m.hash)) return { ok: false, reason: 'LEAF_NOT_IN_ROOT' };
    return { ok: true };
  }
  return { ok: false, reason: 'UNKNOWN_CERT_FORM' };
}

export function openNeed4(spec, target_ts) {
  return { target_ts, deadline_ts: target_ts + spec.window_seconds, state: 'OPEN', winner: null, certified: false, rejected: [] };
}

export function submit4(need, ev, submitter, now_ts, spec, roots = new Map()) {
  if (need.state === 'FINAL' || need.state === 'EXPIRED') return { accepted: false, reason: 'TERMINAL' };
  if (now_ts < need.target_ts) return { accepted: false, reason: 'TARGET_NOT_REACHED' };
  if (now_ts >= need.deadline_ts) return { accepted: false, reason: 'WINDOW_CLOSED' };
  const a = admissible(ev.m, spec, need);
  if (!a.ok) { need.rejected.push(a.reason); return { accepted: false, reason: a.reason }; }
  if (ev.kind === KIND.CERT) {
    const c = validCert(ev, need, roots);
    if (!c.ok) { need.rejected.push(c.reason); return { accepted: false, reason: c.reason }; }
    if (need.certified) {
      // a second valid certificate must name the same message: uniqueness
      return ev.m.hash === need.winner.message.hash ? { accepted: true, duplicate: true } : { accepted: false, reason: 'SECOND_CERT_CONTRADICTS' };
    }
    need.winner = { message: ev.m, submitter, submitted_at: now_ts, certified: true };
    need.certified = true; need.state = 'CANDIDATE';
    return { accepted: true, certified: true };
  }
  if (need.certified) return { accepted: true, ignored: true };   // nothing beats a certificate
  if (need.winner === null) { need.winner = { message: ev.m, submitter, submitted_at: now_ts, certified: false }; need.state = 'CANDIDATE'; return { accepted: true }; }
  const c = compareKey(ev.m, need.winner.message);
  if (c === 0) return { accepted: true, duplicate: true };
  if (c < 0) { need.winner = { message: ev.m, submitter, submitted_at: now_ts, certified: false }; return { accepted: true, replaced: true }; }
  return { accepted: true, later: true };
}

export function finalize4(need, now_ts) {
  if (need.state !== 'CANDIDATE') return { ok: false, reason: need.state === 'OPEN' ? 'NO_CANDIDATE' : 'TERMINAL' };
  if (now_ts < need.deadline_ts) return { ok: false, reason: 'WINDOW_OPEN' };
  need.state = 'FINAL';
  return { ok: true, winner: need.winner.message, certified: need.certified };
}

/** Build attested roots from a global 1 Hz stream: one root per message second, leaves = all feeds' latest messages. */
export function rootsFrom(globalByFeed) {
  // globalByFeed: Map<feed, messages sorted by publish_time>; one root per distinct publish_time across feeds
  const times = new Set();
  for (const msgs of globalByFeed.values()) for (const m of msgs) times.add(m.publish_time);
  const sorted = [...times].sort((a, b) => a - b);
  const roots = new Map();
  const last = new Map();
  sorted.forEach((t, i) => {
    const leaves = new Set();
    for (const [feed, msgs] of globalByFeed) {
      const m = msgs.find(x => x.publish_time === t);
      if (m) last.set(feed, m);
      if (last.get(feed)) leaves.add(last.get(feed).hash);   // every root carries every feed's last-known leaf
    }
    roots.set(i + 1, { seq: i + 1, timestamp: t, leaves });
  });
  return roots;
}
