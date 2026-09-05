// STRICT_PREDECESSOR_ONLY (SPO) — executable model, Sol 04:09Z.
//
// Evidence: any rec2-owned Full PriceUpdateV2 replay (or capture) for the feed whose Pyth-signed fields satisfy
//   prev_publish_time < T <= publish_time.
// There is no minimum-over-submitted fallback and no acceptance of a later print. By Lemma 1 at most one Pythnet
// aggregate satisfies the bracket, so the rule has no candidate choice at all: safety is absolute whenever it settles.
// Everything that can go wrong is liveness, and the terminal policy decides who carries it:
//   'A'  settleable forever: the Need never expires; stakes stay locked until the bracket print is submitted.
//   'B'  finite VOID + refund: at D with no bracket print the Need voids and every stake is refunded.
//   'C1' bonded poster timeout: a designated poster bonds; at D with no bracket print the poster is charged as if
//        every open shot against it had won (silence is a dominated strategy for the poster).
//   'C2' symmetric PvP mutual forfeit: two sides, no poster; at D with no bracket print both stakes are forfeited
//        (burned / raked), so the side that would have won always wants to post and the loser gains nothing by silence.
import { admissible } from './model.mjs';

export const POLICY = Object.freeze({ A: 'A', B: 'B', C1: 'C1', C2: 'C2' });
export const STATE = Object.freeze({ OPEN: 'OPEN', FINAL: 'FINAL', VOID: 'VOID', BOND_LOSS: 'BOND_LOSS', FORFEIT: 'FORFEIT' });

export function bracket(m, target_ts) { return m.prev_publish_time < target_ts && target_ts <= m.publish_time; }

export function openSPO(spec, target_ts, policy) {
  return { target_ts, policy, deadline_ts: policy === POLICY.A ? Infinity : target_ts + spec.window_seconds, state: STATE.OPEN, winner: null, rejected: [] };
}

/** Anyone may submit; only the bracket print is admissible; a second bracket print can only be the same message. */
export function submitSPO(need, m, submitter, now_ts, spec) {
  if (need.state !== STATE.OPEN) return { accepted: false, reason: 'TERMINAL' };
  if (now_ts < need.target_ts) return { accepted: false, reason: 'TARGET_NOT_REACHED' };
  if (now_ts >= need.deadline_ts) return { accepted: false, reason: 'WINDOW_CLOSED' };
  const a = admissible(m, spec, need);
  if (!a.ok) { need.rejected.push(a.reason); return { accepted: false, reason: a.reason }; }
  if (!bracket(m, need.target_ts)) { need.rejected.push('NOT_BRACKET'); return { accepted: false, reason: 'NOT_BRACKET' }; }
  if (need.winner) return need.winner.message.hash === m.hash ? { accepted: true, duplicate: true } : { accepted: false, reason: 'SECOND_BRACKET_IMPOSSIBLE' };
  need.winner = { message: m, submitter, submitted_at: now_ts };
  need.state = STATE.FINAL;                       // nothing can ever replace it: finalize is immediate
  return { accepted: true, final: true };
}

/** Terminal transition when no bracket print arrived. Only meaningful after D (never for policy A). */
export function expireSPO(need, now_ts) {
  if (need.state !== STATE.OPEN) return { ok: false, reason: 'TERMINAL' };
  if (now_ts < need.deadline_ts) return { ok: false, reason: 'WINDOW_OPEN' };
  need.state = need.policy === POLICY.B ? STATE.VOID : need.policy === POLICY.C1 ? STATE.BOND_LOSS : STATE.FORFEIT;
  return { ok: true, state: need.state };
}

/**
 * Payoff to one party from one shot under a terminal state. A party is described by what it gains if it wins and what
 * it loses if it loses: shot = { gain, lose }. outcome = 'WIN' | 'LOSE' is the true outcome under the bracket print.
 * role: 'holder' (any party holding the print), 'poster' (the bonded poster under C1), 'other' (the poster's counterparty).
 */
export function payoff(state, role, outcome, shot) {
  const { gain, lose } = shot;
  if (state === STATE.FINAL) return outcome === 'WIN' ? gain : -lose;
  if (state === STATE.VOID) return 0;                                   // refund
  if (state === STATE.OPEN) return 0;                                   // policy A: nothing realised, capital locked
  if (state === STATE.BOND_LOSS) return role === 'poster' ? -lose : gain; // the poster is charged as if it lost
  if (state === STATE.FORFEIT) return -lose;                            // both sides lose
  throw new Error('unknown state');
}

export function terminalOf(policy) {
  return policy === POLICY.A ? STATE.OPEN : policy === POLICY.B ? STATE.VOID : policy === POLICY.C1 ? STATE.BOND_LOSS : STATE.FORFEIT;
}

/** Value of silence for a party that exclusively holds the bracket print: payoff(withhold) - payoff(submit), floored at 0. */
export function silenceOption(policy, role, outcome, shot) {
  const submit = payoff(STATE.FINAL, role, outcome, shot);
  const withhold = payoff(terminalOf(policy), role, outcome, shot);
  return { submit, withhold, option: Math.max(0, withhold - submit) };
}
