// Keyless incentive/gap model (Sol 04:41Z). Under STRICT_PREDECESSOR_ONLY with permissionless access:
//   - the admissible set per target is a SINGLETON, so submitting cannot express a preference;
//   - no party holds it exclusively, so withholding is overridden by anyone else's submission.
// What remains is two distinct causes of an unsettled Need, which must never be conflated:
//   G1 universal silence  — every party with access declines; needs UNANIMITY over an open set.
//   G2 emission gap       — Pyth never emitted the bracket leaf; nobody can post it, on any channel.
import { POLICY, STATE, bracket, openSPO, submitSPO, expireSPO, terminalOf } from './strict_predecessor.mjs';

/** Probability a Need goes unsettled through G1 alone: every one of n independent posters fails. */
export function silenceProbability(n, q) {
  if (!(q >= 0 && q <= 1)) throw new Error('q out of range');
  return Math.pow(q, Math.max(0, n));
}

/**
 * One target played out. posters: [{ id, fails, withholds }] — `fails` is an accident (offline, RPC, funds),
 * `withholds` is a deliberate choice. emitted=false models G2: the leaf does not exist for anyone.
 * Returns the terminal state and who ended up paying the posting fee.
 */
export function play({ spec, target_ts, policy, posters, emitted, bracketMessage }) {
  const need = openSPO(spec, target_ts, policy);
  let poster = null;
  if (emitted) {
    for (const p of posters) {
      if (p.fails || p.withholds) continue;
      const r = submitSPO(need, bracketMessage, p.id, target_ts + 5, spec);
      if (r.accepted) { poster = p.id; break; }        // the first to land settles; the message is unique
    }
  }
  if (need.state === STATE.OPEN) expireSPO(need, need.deadline_ts);
  return { state: need.state, poster, cause: need.state === STATE.FINAL ? null : (emitted ? 'G1' : 'G2'),
    price: need.winner ? need.winner.message.price : null };
}

/** Does any single party have a decisive choice? Compare every unilateral deviation against the baseline. */
export function decisiveChoiceExists(base) {
  const baseline = play(base);
  for (let i = 0; i < base.posters.length; i++) {
    const flipped = base.posters.map((p, k) => k === i ? { ...p, withholds: !p.withholds } : p);
    const alt = play({ ...base, posters: flipped });
    if (alt.price !== baseline.price) return { party: base.posters[i].id, baseline: baseline.price, deviated: alt.price };
  }
  return null;
}

/** Terminal-state accounting for the gap: who carries an unsettled Need under each policy. */
export function gapBearer(policy) {
  return { [POLICY.A]: 'both sides, indefinitely (capital stranded)', [POLICY.B]: 'nobody (both refunded)',
    [POLICY.C1]: 'the bonded poster (charged as if it lost)', [POLICY.C2]: 'both players (stakes burned)' }[policy];
}
export { POLICY, STATE, terminalOf, bracket };
