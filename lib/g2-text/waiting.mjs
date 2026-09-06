// What the page says while a shot is settling.
//
// docs/design/THE_WAIT.md is the argument: a spinner over this span throws away
// the one time a player would watch the machine work, and the wait is the demo.
// This is the pure part - given a shot, its spec timings and the clock, what is
// true right now.
//
// TWO RULES ARE STRUCTURAL RATHER THAN COSMETIC AND BOTH LIVE HERE.
//
// The countdown is always to a DEADLINE the spec defines, never to an estimate
// of when a price will arrive. We do not know that, the oracle does not promise
// it, and a countdown that expires while nothing happens teaches a player that
// our numbers are decorative.
//
// And a window that can still close empty says so BEFORE it does. A void must
// never be a surprise; the rule that produces it is stated while it can still be
// avoided.
export const PHASE = Object.freeze({
  BEFORE_ENTRY: 'before-entry',
  ENTRY_OPEN: 'entry-open',
  ENTRY_CAPTURED: 'entry-captured',
  BEFORE_EXIT: 'before-exit',
  EXIT_OPEN: 'exit-open',
  EXIT_CAPTURED: 'exit-captured',
  SETTLED: 'settled',
  VOIDED: 'voided',
});

const n = v => (v === null || v === undefined ? null : Number(v));
const mmss = s => {
  if (s === null || s < 0) return null;
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
};

// capture_deadline = target + lag + grace, exactly as Timepin derives it.
export const captureDeadline = (targetTs, { lagSeconds, graceSeconds }) =>
  Number(targetTs) + Number(lagSeconds) + Number(graceSeconds);

export function waitState(shot, spec, now) {
  if (!shot || !spec) throw new Error('waitState needs both a shot and its spec timings; guessing either '
    + 'would produce a deadline that looks authoritative and is not');
  for (const k of ['lagSeconds', 'graceSeconds']) {
    if (spec[k] === undefined || spec[k] === null) {
      throw new Error(`spec.${k} is required: the capture deadline is target + lag + grace, and a defaulted `
        + 'term makes a countdown that is confidently wrong');
    }
  }
  const t = Number(now);
  const entry = n(shot.entryTargetTs);
  const exit = n(shot.exitTargetTs);
  const entryDeadline = entry === null ? null : captureDeadline(entry, spec);
  const exitDeadline = exit === null ? null : captureDeadline(exit, spec);
  const hasEntry = Boolean(shot.entryPublishTime);
  const hasExit = Boolean(shot.exitPublishTime);
  const state = Number(shot.state);

  const arrived = [];
  if (hasEntry) {
    arrived.push({ which: 'entry', publishTime: n(shot.entryPublishTime),
      afterTarget: n(shot.entryPublishTime) - entry });
  }
  if (hasExit) {
    arrived.push({ which: 'exit', publishTime: n(shot.exitPublishTime),
      afterTarget: n(shot.exitPublishTime) - exit });
  }

  const done = (phase, headline) => ({ phase, headline, deadline: null, secondsLeft: null, countdown: null, arrived });
  if (state === 5 || state === 7) return done(PHASE.VOIDED, 'This shot was returned.');
  if (state === 4 || state === 3) return done(PHASE.SETTLED, 'Settled.');

  const openWindow = (target, deadline, which) => {
    const left = deadline - t;
    return {
      phase: which === 'entry' ? PHASE.ENTRY_OPEN : PHASE.EXIT_OPEN,
      // Everything a player needs to understand MIN-CAPTURE, without the words.
      headline: `Waiting for a price at or after ${new Date(target * 1000).toISOString().slice(11, 19)} UTC.`,
      detail: `Any print published in the next ${mmss(Math.max(0, left))} counts, and the first one wins. `
            + 'If none arrives, the shot is returned.',
      deadline, secondsLeft: Math.max(0, left), countdown: mmss(Math.max(0, left)), arrived,
    };
  };

  if (entry !== null && t < entry) {
    return { phase: PHASE.BEFORE_ENTRY,
      headline: `Your window opens at ${new Date(entry * 1000).toISOString().slice(11, 19)} UTC.`,
      detail: 'Nothing can be captured before then; a print published earlier is not admissible.',
      deadline: entry, secondsLeft: entry - t, countdown: mmss(entry - t), arrived };
  }
  if (!hasEntry && entryDeadline !== null && t < entryDeadline) return openWindow(entry, entryDeadline, 'entry');
  if (!hasEntry && entryDeadline !== null) {
    return { ...done(PHASE.ENTRY_OPEN, 'No price arrived in time for the start of your window.'),
      detail: 'The shot will be returned once someone finalises it. Settlement is permissionless; it does '
            + 'not need this page open.' };
  }

  if (exit !== null && t < exit) {
    return { phase: PHASE.BEFORE_EXIT,
      headline: `Entry captured. The exit window opens at ${new Date(exit * 1000).toISOString().slice(11, 19)} UTC.`,
      detail: 'You can close this page. Settlement is permissionless and does not need it open.',
      deadline: exit, secondsLeft: exit - t, countdown: mmss(exit - t), arrived };
  }
  if (!hasExit && exitDeadline !== null && t < exitDeadline) return openWindow(exit, exitDeadline, 'exit');
  if (!hasExit && exitDeadline !== null) {
    return { ...done(PHASE.EXIT_OPEN, 'No price arrived in time for the end of your window.'),
      detail: 'The shot will be returned once someone finalises it.' };
  }

  return { ...done(PHASE.EXIT_CAPTURED, 'Both prices are in. Settling.'),
    detail: 'Nothing is left to wait for on the oracle side.' };
}

// When the page may next usefully look. It is not a poll interval: every moment
// something can happen is KNOWN IN ADVANCE from the spec, so the page waits for
// the next one instead of asking repeatedly. That is also why the outage of
// 2026-09-05 cannot happen on this path.
export function nextInterestingTs(shot, spec, now) {
  const s = waitState(shot, spec, now);
  return s.deadline ?? null;
}
