// LIVE_CAPTURE_MIN — the rule that needs no keyed submitter: evidence is admissible
// only when the program itself read it from the live sponsored PDA (provenance by
// construction), and the winner is the smallest publish_time among landed captures.
// Because the PDA only moves forward, the FIRST landed capture after T is already
// the minimum; later captures can only read equal-or-later posts.
//
// This file simulates the PDA timeline so the property can be tested: a capture
// transaction that lands at chain time c reads the post with the latest post_time <= c.
import { compareKey } from './model.mjs';

/** posts: [{ message, post_time }] sorted by post_time — what the pusher wrote and when. */
export function liveStateAt(posts, c) {
  let cur = null;
  for (const p of posts) { if (p.post_time <= c) cur = p; else break; }
  return cur ? cur.message : null;
}

export function openLiveNeed(target_ts, lag_s, grace_s) {
  return { target_ts, source_deadline_ts: target_ts + lag_s, capture_deadline_ts: target_ts + lag_s + grace_s, state: 'OPEN', winner: null, captures: 0 };
}

/**
 * capture(): the program reads the live PDA at landing time `land_ts`. A message is
 * admissible iff publish_time in [T, T + lag]. First landed capture wins; a later
 * capture replaces only if its key is smaller (unreachable on a forward-only PDA,
 * kept as a safety property), equal is a duplicate, larger is refused.
 */
export function capture(need, posts, land_ts, submitter) {
  if (need.state === 'FINAL' || need.state === 'EXPIRED') return { ok: false, reason: 'TERMINAL' };
  if (land_ts < need.target_ts) return { ok: false, reason: 'TARGET_NOT_REACHED' };
  if (land_ts >= need.capture_deadline_ts) return { ok: false, reason: 'CAPTURE_WINDOW_CLOSED' };
  const m = liveStateAt(posts, land_ts);
  if (!m) return { ok: false, reason: 'NO_LIVE_MESSAGE' };
  if (m.publish_time < need.target_ts) return { ok: false, reason: 'BEFORE_TARGET' };
  if (m.publish_time > need.source_deadline_ts) return { ok: false, reason: 'POST_TARGET_LAG_TOO_LARGE' };
  need.captures += 1;
  if (need.winner === null) { need.winner = { message: m, submitter, land_ts }; need.state = 'CANDIDATE'; return { ok: true, first: true }; }
  const c = compareKey(m, need.winner.message);
  if (c === 0) return { ok: true, duplicate: true };
  if (c < 0) { need.winner = { message: m, submitter, land_ts }; return { ok: true, replaced: true }; }
  return { ok: false, reason: 'LATER_THAN_WINNER' };
}

export function finalizeLive(need, now_ts) {
  if (need.state !== 'CANDIDATE') return { ok: false, reason: need.state === 'OPEN' ? 'NO_CANDIDATE' : 'TERMINAL' };
  if (now_ts < need.capture_deadline_ts) return { ok: false, reason: 'WINDOW_OPEN' };
  need.state = 'FINAL'; return { ok: true, winner: need.winner.message };
}

export function expireLive(need, now_ts) {
  if (need.state !== 'OPEN') return { ok: false, reason: 'HAS_CANDIDATE_OR_TERMINAL' };
  if (now_ts < need.capture_deadline_ts) return { ok: false, reason: 'WINDOW_OPEN' };
  need.state = 'EXPIRED'; return { ok: true };
}

/** A crank that polls every `poll_s` seconds from T and whose transactions land after `inclusion_s`. */
export function crankLandings(target_ts, capture_deadline_ts, poll_s, inclusion_s, offset_s = 0) {
  const out = [];
  for (let t = target_ts + offset_s; t < capture_deadline_ts; t += poll_s) out.push(t + inclusion_s);
  return out;
}
