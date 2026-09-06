// What the page says during the twenty minutes between a target and a result.
//
// The two rules being tested are not cosmetic. A countdown must always run to a
// DEADLINE the spec defines rather than to a guess about when a price will
// arrive - a countdown that expires while nothing happens teaches a player that
// our numbers are decorative. And a window that can still close empty must say
// so BEFORE it does, so a void is never a surprise.
import assert from 'node:assert/strict';
import { waitState, captureDeadline, nextInterestingTs, PHASE } from '../lib/g2-text/waiting.mjs';

let checks = 0;
const ok = (c, msg) => { checks += 1; assert.ok(c, msg); };
const eq = (a, b, msg) => { checks += 1; assert.equal(a, b, msg); };

const T = 1788653100;              // entry target
const SPEC = { lagSeconds: 299, graceSeconds: 900 };   // the live devnet spec
const shot = over => ({ state: 2, entryTargetTs: T, exitTargetTs: T + 300, ...over });

// ---- the deadline is the spec's arithmetic, not ours ------------------------
eq(captureDeadline(T, SPEC), T + 1199, 'the capture deadline is not target + lag + grace');
eq(captureDeadline(T, { lagSeconds: 59, graceSeconds: 60 }), T + 119,
  'the Sixty timings do not produce the 119-second deadline the scope claims');

// ---- a defaulted term is refused, because it would be confidently wrong -----
for (const missing of ['lagSeconds', 'graceSeconds']) {
  checks += 1;
  assert.throws(() => waitState(shot(), { ...SPEC, [missing]: undefined }, T), new RegExp(missing),
    `A COUNTDOWN WAS BUILT WITH NO ${missing}. It would look authoritative and be wrong.`);
}
checks += 1;
assert.throws(() => waitState(null, SPEC, T), /needs both/, 'a missing shot produced a countdown');

// ---- before the window ------------------------------------------------------
{
  const s = waitState(shot(), SPEC, T - 60);
  eq(s.phase, PHASE.BEFORE_ENTRY, 'the pre-window phase is wrong');
  eq(s.deadline, T, 'the pre-window countdown does not run to the target');
  eq(s.countdown, '1:00', 'the countdown is not formatted as minutes and seconds');
  ok(/not admissible/.test(s.detail), 'the page does not say an earlier print would not count');
}

// ---- the window is open and nothing has arrived -----------------------------
{
  const s = waitState(shot(), SPEC, T + 10);
  eq(s.phase, PHASE.ENTRY_OPEN, 'an open entry window is not reported as open');
  eq(s.deadline, T + 1199, 'the open window counts down to something other than the capture deadline');
  ok(/the first one wins/.test(s.detail),
    'the page does not say WHICH print will be chosen, which is the whole of MIN-CAPTURE in four words');
  ok(/If none arrives, the shot is returned/.test(s.detail),
    'A WINDOW THAT CAN CLOSE EMPTY DOES NOT SAY SO. A void must never be a surprise.');
  ok(s.secondsLeft === 1189, 'the remaining time is not the distance to the deadline');
}

// ---- a print arrives, and the page can say how late it was ------------------
{
  const s = waitState(shot({ entryPublishTime: T + 2 }), SPEC, T + 30);
  eq(s.phase, PHASE.BEFORE_EXIT, 'after an entry capture the page is not waiting on the exit');
  eq(s.arrived.length, 1, 'the captured entry is not reported as arrived');
  eq(s.arrived[0].afterTarget, 2, 'the page cannot say how many seconds after the target the print landed');
  ok(/close this page/.test(s.detail),
    'the page does not say the player may leave, which is half of why a long wait feels bad');
}

// ---- the exit window, and both captured -------------------------------------
{
  const s = waitState(shot({ entryPublishTime: T + 2 }), SPEC, T + 320);
  eq(s.phase, PHASE.EXIT_OPEN, 'an open exit window is not reported as open');
  eq(s.deadline, T + 300 + 1199, 'the exit window counts down to the wrong deadline');
}
{
  const s = waitState(shot({ entryPublishTime: T + 2, exitPublishTime: T + 301 }), SPEC, T + 400);
  eq(s.phase, PHASE.EXIT_CAPTURED, 'with both prices in, the page is still waiting on the oracle');
  eq(s.arrived.length, 2, 'both arrivals are not reported');
  eq(s.countdown, null, 'a countdown is running with nothing left to wait for');
}

// ---- a window that closed empty ---------------------------------------------
{
  const s = waitState(shot(), SPEC, T + 1300);
  ok(/No price arrived in time/.test(s.headline), 'an expired entry window is not stated plainly');
  ok(/permissionless/.test(s.detail), 'the page does not say settlement does not need it open');
  eq(s.countdown, null, 'a countdown continued past the deadline');
}

// ---- terminal states stop counting ------------------------------------------
for (const [state, phase] of [[4, PHASE.SETTLED], [3, PHASE.SETTLED], [5, PHASE.VOIDED], [7, PHASE.VOIDED]]) {
  const s = waitState(shot({ state }), SPEC, T + 10);
  eq(s.phase, phase, `state ${state} is not terminal for the waiting view`);
  eq(s.countdown, null, `state ${state} still shows a countdown`);
}

// ---- the page knows in advance when to look again ---------------------------
{
  // Not a poll interval: every moment something can happen is derivable, which is
  // why this path cannot repeat the outage of 2026-09-05.
  eq(nextInterestingTs(shot(), SPEC, T - 60), T, 'the next interesting moment before the window is not the target');
  eq(nextInterestingTs(shot(), SPEC, T + 10), T + 1199, 'the next interesting moment in an open window is not its deadline');
  eq(nextInterestingTs(shot({ state: 4 }), SPEC, T + 10), null, 'a settled shot still has something to wait for');
}

console.log(`ok - the countdown runs to a deadline, and a window that can close empty says so first (${checks} checks)`);
