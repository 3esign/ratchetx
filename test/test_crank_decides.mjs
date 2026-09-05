#!/usr/bin/env node
// The crank's rules, proven without a chain.
//
// Every assertion here is against a require! in the programs, and the ones that
// matter are the ones where doing nothing is correct: a need holding a candidate
// inside its window must NOT be poked, and a later print must NOT be offered.
// After S1 a later print is refused with CaptureIsNotEarlier, so a crank that
// offers one burns a transaction on every pass, forever, and looks like it is
// working.
import assert from 'node:assert/strict';
import { decideNeed, decideShot, decideAll, bestPrint, NEED, SHOT }
  from '../ops/g2-crank/decide.mjs';

let checks = 0;
const eq = (a, b, m) => { checks += 1; assert.deepEqual(a, b, m); };
const act = d => d?.action ?? null;

const need = (o = {}) => ({
  key: 'need1', state: NEED.OPEN, targetTs: 1000, maxPostTargetLagSeconds: 299,
  captureDeadlineTs: 1000 + 299 + 900, candidate: null, ...o,
});
const print = (publishTime, postedSlot = 10, messageHash = '20') =>
  ({ publishTime, postedSlot, messageHash });

// --- capture_first takes the EARLIEST admissible print, never the first offered
{
  const n = need();
  const d = decideNeed(n, { now: 1400, prints: [print(1200), print(1005), print(1300)] });
  eq(act(d), 'capture_first', 'an open need with an admissible print must be captured');
  eq(d.print.publishTime, 1005, 'capture_first must take the EARLIEST admissible print');
}

// --- a print before the target is not admissible at all
{
  const d = decideNeed(need(), { now: 1400, prints: [print(999)] });
  eq(act(d), null, 'a print before the target is inadmissible - waiting is correct');
}

// --- a print past target + lag is inadmissible, and that is what voids a target
{
  const d = decideNeed(need(), { now: 1400, prints: [print(1000 + 300)] });
  eq(act(d), null, 'a print past target + lag is inadmissible');
  eq(bestPrint(need(), [print(1299)]).publishTime, 1299, 'target + lag exactly is still admissible');
}

// --- THE ONE THAT COSTS MONEY: never offer a later print against a candidate
{
  const n = need({ state: NEED.CANDIDATE, candidate: print(1100, 5, '10') });
  eq(act(decideNeed(n, { now: 1400, prints: [print(1200)] })), null,
     'a LATER print must never be offered - S1 refuses it with CaptureIsNotEarlier and the crank ' +
     'would burn a transaction on every pass');
  eq(act(decideNeed(n, { now: 1400, prints: [print(1100, 5, '10')] })), null,
     'the SAME print must not be re-offered');
  const better = decideNeed(n, { now: 1400, prints: [print(1050)] });
  eq(act(better), 'capture_conflict', 'a strictly earlier print must be offered');
  eq(better.print.publishTime, 1050, 'and it must be that print');
}

// --- the tie-breaks are the full three-part order, not just publish_time
{
  const n = need({ state: NEED.CANDIDATE, candidate: print(1100, 9, '50') });
  eq(act(decideNeed(n, { now: 1400, prints: [print(1100, 7, '50')] })), 'capture_conflict',
     'equal publish_time falls to posted_slot');
  eq(act(decideNeed(n, { now: 1400, prints: [print(1100, 9, '40')] })), 'capture_conflict',
     'equal slot falls to the message hash');
  eq(act(decideNeed(n, { now: 1400, prints: [print(1100, 9, '60')] })), null,
     'a larger hash at the same time and slot must not be offered');
}

// --- deadlines: expire an open need, finalize a candidate, and not before
{
  const open = need();
  eq(act(decideNeed(open, { now: open.captureDeadlineTs - 1, prints: [] })), null,
     'an open need with nothing admissible must not be expired early');
  eq(act(decideNeed(open, { now: open.captureDeadlineTs, prints: [] })), 'expire',
     'expire is due exactly at the capture deadline');
  const cand = need({ state: NEED.CANDIDATE, candidate: print(1100) });
  eq(act(decideNeed(cand, { now: cand.captureDeadlineTs - 1, prints: [] })), null,
     'a candidate must be left alone inside its window');
  eq(act(decideNeed(cand, { now: cand.captureDeadlineTs, prints: [] })), 'finalize',
     'finalize is due exactly at the capture deadline');
}

// --- terminal needs are never touched again
for (const state of [NEED.FINAL, NEED.AMBIGUOUS, NEED.EXPIRED]) {
  eq(act(decideNeed(need({ state }), { now: 9e9, prints: [print(1005)] })), null,
     `a need in terminal state ${state} must never be cranked again`);
}

// --- shots
const shot = (o = {}) => ({ key: 'shot1', state: SHOT.Active, revealDeadlineTs: 5000, ...o });
{
  eq(act(decideShot(shot({ state: SHOT.PendingEntry }), { now: 0, entryNeed: { state: NEED.FINAL } })),
     'activate_entry', 'a pending entry with final evidence must be activated');
  eq(act(decideShot(shot({ state: SHOT.PendingEntry }), { now: 0, entryNeed: { state: NEED.EXPIRED } })),
     'void_pending_entry', 'a pending entry whose evidence expired must be voided');
  eq(act(decideShot(shot({ state: SHOT.PendingEntry }), { now: 0, entryNeed: { state: NEED.OPEN } })),
     null, 'a pending entry still waiting for evidence must be left alone');
  eq(act(decideShot(shot(), { now: 0, exitNeed: { state: NEED.FINAL } })), 'settle_final',
     'an active shot with final exit evidence must be settled');
  eq(act(decideShot(shot(), { now: 0, exitNeed: { state: NEED.AMBIGUOUS } })), 'void_active_shot',
     'an active shot whose exit evidence is ambiguous must be voided');
  eq(act(decideShot(shot({ state: SHOT.AwaitVoid }), { now: 0 })), 'finalize_resolved_void',
     'a resolved void must be finalized');
  eq(act(decideShot(shot({ state: SHOT.AwaitReveal }), { now: 4999 })), null,
     'a shot must NOT be forfeited one second early');
  eq(act(decideShot(shot({ state: SHOT.AwaitReveal }), { now: 5000 })), 'forfeit',
     'forfeit is due exactly at the reveal deadline settlement wrote');
  for (const state of [SHOT.Revealed, SHOT.Voided, SHOT.Forfeited]) {
    eq(act(decideShot(shot({ state }), { now: 9e9 })), null,
       `a shot in terminal state ${state} must never be cranked`);
  }
}

// --- the sweep does evidence before shots, because a shot's action depends on it
{
  const actions = decideAll({
    now: 3000,
    needs: [need({ key: 'n', state: NEED.CANDIDATE, candidate: print(1100), captureDeadlineTs: 2000 })],
    shots: [{ key: 's', state: SHOT.Active, exitNeed: { state: NEED.FINAL } }],
  });
  eq(actions.map(a => `${a.subject}:${a.action}`), ['n:finalize', 's:settle_final'],
     'evidence must be decided before the shots that depend on it');
}

console.log(`ok - crank decisions: ${checks} checks, every rule taken from a require! in the programs`);
