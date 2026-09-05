// The Pyth observer: the loop L2 is waiting for, as a decision function.
//
// A Pyth push account holds only the LATEST price and no history, so the print
// that belongs to a target has to be seen AS IT ARRIVES. That is the entire
// reason this exists and the reason nothing offline substitutes for it.
//
// shouldCapture in ops/g2-crank/pyth.mjs already decides whether ONE print
// belongs to ONE Need. What was missing is everything around it over time: which
// Needs are still worth watching, when to stop, what to do about a Need whose
// window closed with nothing admissible, and how not to send the same capture
// twice. All of that is decided here, purely, so it can be proved before there
// is a chain to prove it against.
import { shouldCapture } from '../g2-crank/pyth.mjs';

export const WATCHING = 'watching';   // the target has not arrived yet
export const OPEN = 'open';           // inside [target, capture_deadline)
export const CLOSED = 'closed';       // the capture window has passed

export function needPhase(need, now) {
  if (now >= need.captureDeadlineTs) return CLOSED;
  if (now >= need.targetTs) return OPEN;
  return WATCHING;
}

// One tick. Given the Needs we know about, the print currently in the price
// account, and the wall clock, decide what to send and what to say.
//
// `sent` is the set of "<needKey>:<messageHash>" this process has already
// submitted. Without it a poll loop that runs every second sends the same
// capture forty times while the first one confirms, and thirty-nine of those
// are refused on chain at the cost of thirty-nine fees.
export function observerTick({ needs, print, now, sent = new Set() }) {
  const actions = [];
  const notes = [];

  if (!Array.isArray(needs)) {
    // NOT an empty result. A crank with nothing to do and a crank that cannot
    // see anything look identical from outside, and this is the third place in
    // this project that has had to say so.
    throw new Error('observerTick was given no Need list. An absent list is not an empty one: '
      + 'a watcher that sees nothing and a watcher that was never told what to watch produce the '
      + 'same silence, and only one of them is healthy.');
  }

  for (const need of needs) {
    const phase = needPhase(need, now);
    if (phase === WATCHING) { notes.push({ need: need.key, phase, why: `target is ${need.targetTs - now}s away` }); continue; }
    if (phase === CLOSED) {
      notes.push({
        need: need.key,
        phase,
        why: need.candidate
          ? 'window closed with a candidate standing - finalize is what happens next, not another capture'
          : 'WINDOW CLOSED WITH NO ADMISSIBLE PRINT. This target voids, and the shot behind it voids with '
            + 'it. That is a correct outcome of the rules and it is also the thing an observer exists to '
            + 'prevent, so it is reported rather than logged quietly.',
        willVoid: !need.candidate,
      });
      continue;
    }

    if (!print) { notes.push({ need: need.key, phase, why: 'window is open but no price has been read' }); continue; }
    const verdict = shouldCapture(need, print, { now });
    if (!verdict.send) { notes.push({ need: need.key, phase, why: verdict.why }); continue; }

    const fingerprint = `${need.key}:${print.messageHash}`;
    if (sent.has(fingerprint)) {
      notes.push({ need: need.key, phase, why: 'already submitted this exact print; waiting for confirmation' });
      continue;
    }
    actions.push({ need: need.key, instruction: verdict.instruction, print, fingerprint, why: verdict.why });
  }

  return { actions, notes, done: needs.length > 0 && needs.every(n => needPhase(n, now) === CLOSED) };
}

// How long to wait before looking again. Inside an open window this is a race
// against a deadline, so it is short; outside one there is nothing to miss.
//
// It is capped rather than clever: a backoff that sleeps past a capture deadline
// has optimised away the only thing the process is for.
export function nextPollMs(needs, now, { openMs = 400, idleMs = 5_000, maxMs = 30_000 } = {}) {
  if (!Array.isArray(needs) || needs.length === 0) return idleMs;
  const phases = needs.map(n => needPhase(n, now));
  if (phases.includes(OPEN)) return openMs;
  const upcoming = needs
    .filter(n => needPhase(n, now) === WATCHING)
    .map(n => (n.targetTs - now) * 1000);
  if (upcoming.length === 0) return idleMs;
  // Wake a little before the nearest target rather than exactly on it.
  return Math.max(openMs, Math.min(maxMs, Math.min(...upcoming) - openMs));
}
