// The Pyth observer's decisions over time.
//
// L2 waits on this loop. A Pyth push account holds only the latest price and no
// history, so the print belonging to a target must be caught as it arrives — and
// everything about WHEN to look, when to stop, and what to do about a window
// that closed empty is decided here, without a chain, so it can be wrong here
// instead of at a deadline.
import assert from 'node:assert/strict';
import { observerTick, needPhase, nextPollMs, WATCHING, OPEN, CLOSED } from '../ops/g2-devnet/observer.mjs';

let checks = 0;
const ok = (c, msg) => { checks += 1; assert.ok(c, msg); };
const eq = (a, b, msg) => { checks += 1; assert.equal(a, b, msg); };

const T = 1_800_000_000;
const need = over => ({
  key: 'need1', targetTs: T, captureDeadlineTs: T + 359, // lag 299 + grace 60
  maxPostTargetLagSeconds: 299, candidate: null, ...over,
});
const print = over => ({ publishTime: T, postedSlot: 100, messageHash: 'aa', ...over });

// ---- the three phases -------------------------------------------------------
eq(needPhase(need(), T - 1), WATCHING, 'a target one second away is not "watching"');
eq(needPhase(need(), T), OPEN, 'the window does not open exactly at the target');
eq(needPhase(need(), T + 358), OPEN, 'the window closed one second early');
eq(needPhase(need(), T + 359), CLOSED, 'the window did not close at the capture deadline');

// ---- an absent Need list is not an empty one --------------------------------
checks += 1;
assert.throws(() => observerTick({ needs: undefined, print: print(), now: T }), /absent list is not an empty one/,
  'A WATCHER WITH NO LIST REPORTED NOTHING TO DO. That is indistinguishable from a healthy quiet chain, '
  + 'and it is the third place in this project that has had to refuse it.');

// ---- before the target: watch, do not send ----------------------------------
{
  const r = observerTick({ needs: [need()], print: print(), now: T - 30 });
  eq(r.actions.length, 0, 'a capture was sent before the target arrived');
  ok(/away/.test(r.notes[0].why), 'the pre-target note does not say how far away the target is');
}

// ---- the first admissible print ---------------------------------------------
{
  const r = observerTick({ needs: [need()], print: print(), now: T + 5 });
  eq(r.actions.length, 1, 'the first admissible print was not captured');
  eq(r.actions[0].instruction, 'capture_first', 'the first capture used the wrong instruction');
}

// ---- and never twice ---------------------------------------------------------
{
  const sent = new Set(['need1:aa']);
  const r = observerTick({ needs: [need()], print: print(), now: T + 5, sent });
  eq(r.actions.length, 0,
    'THE SAME PRINT WAS SUBMITTED TWICE. A poll loop at four ticks a second sends the same capture dozens '
    + 'of times while the first confirms, and every one after it is refused on chain at the cost of a fee.');
  ok(/waiting for confirmation/.test(r.notes[0].why), 'the duplicate was suppressed without saying why');
}

// ---- a strictly earlier print replaces the standing candidate ---------------
{
  const standing = { publishTime: T + 10, postedSlot: 200, messageHash: 'ff' };
  const r = observerTick({ needs: [need({ candidate: standing })], print: print({ publishTime: T + 2 }), now: T + 12 });
  eq(r.actions[0].instruction, 'capture_conflict', 'an earlier print did not challenge the standing candidate');
}
{
  const standing = { publishTime: T + 2, postedSlot: 200, messageHash: 'ff' };
  const r = observerTick({ needs: [need({ candidate: standing })], print: print({ publishTime: T + 10 }), now: T + 12 });
  eq(r.actions.length, 0, 'a LATER print was submitted; S1 refuses it with CaptureIsNotEarlier and it costs a fee');
}

// ---- a print outside the admissible band ------------------------------------
{
  const r = observerTick({ needs: [need()], print: print({ publishTime: T - 1 }), now: T + 5 });
  eq(r.actions.length, 0, 'a print from BEFORE the target was captured - inadmissible under MIN-CAPTURE');
}
{
  const r = observerTick({ needs: [need()], print: print({ publishTime: T + 300 }), now: T + 305 });
  eq(r.actions.length, 0, 'a print past target + lag (299) was captured');
}

// ---- the window that closes empty, which must be loud -----------------------
{
  const r = observerTick({ needs: [need()], print: print(), now: T + 400 });
  eq(r.actions.length, 0, 'a capture was attempted after the window closed');
  eq(r.notes[0].willVoid, true, 'a window that closed with NO candidate did not report that the target voids');
  ok(/voids/.test(r.notes[0].why), 'the empty-window note does not say the shot behind it voids too');
  eq(r.done, true, 'the observer did not report itself finished when every Need was closed');
}
{
  const r = observerTick({ needs: [need({ candidate: print() })], print: print(), now: T + 400 });
  eq(r.notes[0].willVoid, false, 'a window that closed WITH a candidate was reported as voiding');
  ok(/finalize/.test(r.notes[0].why), 'the closed-with-candidate note does not say finalize is next');
}

// ---- two Needs, one open and one not -----------------------------------------
{
  const entry = need({ key: 'entry' });
  const exit = need({ key: 'exit', targetTs: T + 300, captureDeadlineTs: T + 659 });
  const r = observerTick({ needs: [entry, exit], print: print(), now: T + 5 });
  eq(r.actions.length, 1, 'the exit Need, whose target has not arrived, was captured too');
  eq(r.actions[0].need, 'entry', 'the wrong Need was captured');
  eq(r.done, false, 'the observer called itself finished while a Need was still waiting');
}

// ---- polling: short inside a window, never past a deadline ------------------
ok(nextPollMs([need()], T + 5) <= 1000, 'the poll interval inside an OPEN window is long enough to miss a print');
ok(nextPollMs([], T) >= 1000, 'an empty watch list polls as if something were happening');
{
  const far = need({ targetTs: T + 3600, captureDeadlineTs: T + 3959 });
  const wait = nextPollMs([far], T);
  ok(wait <= 30_000, 'the backoff sleeps longer than its own cap');
  ok(wait > 1000, 'a target an hour away is polled as if it were seconds away');
}
{
  // The nearest target governs, not the first in the list.
  const far = need({ key: 'far', targetTs: T + 3600, captureDeadlineTs: T + 3959 });
  const near = need({ key: 'near', targetTs: T + 5, captureDeadlineTs: T + 364 });
  ok(nextPollMs([far, near], T) < nextPollMs([far], T),
    'the poll interval ignored a nearer target because it came second in the list');
}

console.log(`ok - the observer never sends twice, never sends late, and says so when a window closes empty (${checks} checks)`);
