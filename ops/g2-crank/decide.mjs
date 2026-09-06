#!/usr/bin/env node
// WHAT SHOULD BE CRANKED, as a pure function of state and clock.
//
// capture_first, capture_conflict, finalize, expire, activate_entry,
// settle_final, void_active_shot, finalize_resolved_void and forfeit are all
// PERMISSIONLESS BY DESIGN. That is the right design and it is not the same as
// automatic: if nobody calls them, a shot sits until its capture deadline and
// then voids. A game that always refunds is not a game.
//
// The deciding is separated from the sending on purpose. Sending needs a
// deployed program, an RPC and a funded signer, and none of those can be had
// tonight. Deciding needs none of them, so it is testable NOW - and it is the
// half where a wrong rule silently refunds somebody's stake. This is the same
// move that made MIN-CAPTURE testable: pull the rule out of the instruction.
//
// Every rule below is transcribed from a require! and carries its source.

export const NEED = Object.freeze({ OPEN: 0, CANDIDATE: 1, FINAL: 2, AMBIGUOUS: 3, EXPIRED: 4 });
export const SHOT = Object.freeze({
  PendingEntry: 1, Active: 2, AwaitReveal: 3, Revealed: 4, Voided: 5, Forfeited: 6, AwaitVoid: 7,
});

// A print is admissible for target T under MIN-CAPTURE iff T <= publish_time,
// and the capture must land before capture_deadline_ts. lifecycle.rs, the
// ADAPTER_PYTH_MIN_CAPTURE_V2 branch.
export const admissible = (print, need) =>
  print.publishTime >= need.targetTs && print.publishTime <= need.targetTs + need.maxPostTargetLagSeconds;

// The MIN-CAPTURE order, identical to capture_order_key in lifecycle.rs:
// publish_time, then posted_slot, then message hash. Smaller wins.
export const orderKey = p => [p.publishTime, p.postedSlot, p.messageHash];
const less = (a, b) => {
  for (let i = 0; i < 3; i++) {
    if (a[i] < b[i]) return true;
    if (a[i] > b[i]) return false;
  }
  return false;
};

// The earliest admissible print available for this need, or null.
export function bestPrint(need, prints) {
  let best = null;
  for (const p of prints) {
    if (!admissible(p, need)) continue;
    if (!best || less(orderKey(p), orderKey(best))) best = p;
  }
  return best;
}

// --- Timepin -----------------------------------------------------------------
export function decideNeed(need, { now, prints = [] }) {
  // expire_handler: state == NEED_OPEN && now >= capture_deadline_ts
  if (need.state === NEED.OPEN && now >= need.captureDeadlineTs)
    return { action: 'expire', crate: 'rcx-timepin-v2', why: 'open past its capture deadline' };

  // finalize_handler: state == NEED_CANDIDATE && now >= capture_deadline_ts
  if (need.state === NEED.CANDIDATE && now >= need.captureDeadlineTs)
    return { action: 'finalize', crate: 'rcx-timepin-v2', why: 'candidate past its capture deadline' };

  const best = bestPrint(need, prints);

  if (need.state === NEED.OPEN) {
    if (!best) return null; // nothing admissible yet - waiting is correct, not a failure
    return { action: 'capture_first', crate: 'rcx-timepin-v2', print: best,
             why: 'earliest admissible print available' };
  }

  if (need.state === NEED.CANDIDATE) {
    // AFTER S1 A LATER PRINT IS REFUSED, so offering one wastes a transaction and
    // fails with CaptureIsNotEarlier. Only a strictly earlier print is worth
    // sending, and "earlier" is the full three-part order, not just the second.
    if (best && need.candidate && less(orderKey(best), orderKey(need.candidate)))
      return { action: 'capture_conflict', crate: 'rcx-timepin-v2', print: best,
               why: 'a strictly earlier admissible print exists' };
    return null; // holding a candidate and waiting out the window is correct
  }

  return null; // FINAL, AMBIGUOUS and EXPIRED are terminal
}

// --- Core --------------------------------------------------------------------
export function decideShot(shot, { now, entryNeed, exitNeed }) {
  if (shot.state === SHOT.PendingEntry) {
    if (entryNeed?.state === NEED.FINAL)
      return { action: 'activate_entry', crate: 'ratchet-core-g2', why: 'entry evidence is final' };
    if (entryNeed && (entryNeed.state === NEED.EXPIRED || entryNeed.state === NEED.AMBIGUOUS))
      return { action: 'void_pending_entry', crate: 'ratchet-core-g2',
               why: `entry need is ${entryNeed.state === NEED.EXPIRED ? 'expired' : 'ambiguous'}` };
    return null;
  }

  if (shot.state === SHOT.Active) {
    if (exitNeed?.state === NEED.FINAL)
      return { action: 'settle_final', crate: 'ratchet-core-g2', why: 'exit evidence is final' };
    if (exitNeed && (exitNeed.state === NEED.EXPIRED || exitNeed.state === NEED.AMBIGUOUS))
      return { action: 'void_active_shot', crate: 'ratchet-core-g2',
               why: `exit need is ${exitNeed.state === NEED.EXPIRED ? 'expired' : 'ambiguous'}` };
    return null;
  }

  if (shot.state === SHOT.AwaitVoid)
    return { action: 'finalize_resolved_void', crate: 'ratchet-core-g2', why: 'void is resolved' };

  // forfeit_handler: state == AwaitReveal && now >= shot.reveal_deadline_ts.
  // The deadline is the one SETTLEMENT wrote, not the projection from seal - R3.
  if (shot.state === SHOT.AwaitReveal && now >= shot.revealDeadlineTs)
    return { action: 'forfeit', crate: 'ratchet-core-g2', why: 'reveal deadline passed' };

  return null;
}

// The whole sweep, ordered: evidence before shots, because a shot's action
// usually depends on a need reaching a terminal state in the same pass.
export function decideAll({ now, needs = [], shots = [], printsByNeed = new Map() }) {
  const actions = [];
  for (const need of needs) {
    const d = decideNeed(need, { now, prints: printsByNeed.get(need.key) ?? [] });
    if (d) actions.push({ ...d, subject: need.key });
  }
  for (const shot of shots) {
    const d = decideShot(shot, { now, entryNeed: shot.entryNeed, exitNeed: shot.exitNeed });
    if (d) actions.push({ ...d, subject: shot.key });
  }
  return actions;
}
