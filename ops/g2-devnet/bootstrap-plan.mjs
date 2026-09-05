// The ordered sequence from two deployed programs to one whole game on devnet.
//
// Pure. It names the steps, their order, what each one needs to exist first, and
// which of them cannot be planned yet and why. It sends nothing and reads no
// chain, so the ORDER can be wrong here and be caught here, rather than at step
// nine of a live run with rent already spent.
//
// L1 is step `seal_forward` actually landing. L2 is `settle_final` landing.
// Everything before them is what has to be true first, and the reason this file
// exists is that "deploy and then play" hides eleven prerequisites.
import { INSTRUCTION_ACCOUNTS } from '../../onchain/ratchet-core-g2/client/client-v2.mjs';

export const CORE = 'ratchet-core-g2';
export const TIMEPIN = 'rcx-timepin-v2';

// needsObservation marks a step that cannot be built without a REAL Pyth price
// update account. ops/g2-crank/pyth.mjs records why: a Pyth push account holds
// only the latest price and no history, so MIN-CAPTURE needs a live observer
// posting the print that belongs to the target. Nothing offline substitutes for
// that, and a plan that pretended otherwise would be the most expensive kind of
// wrong - one that looks finished.
export const STEPS = [
  { crate: TIMEPIN, ix: 'register_evidence_spec', why: 'the evidence policy becomes an account, and its hash is what every Need and ruleset points at' },
  { crate: CORE, ix: 'register_economy', why: 'the economy hash the manifest approved becomes an account' },
  { crate: CORE, ix: 'register_ruleset', why: 'grid 300, lag 299, lead 60 - the approved numbers, bound to the evidence spec' },
  { crate: CORE, ix: 'open_ledger', why: 'the player record: credits, xp, streak, both nonces' },
  { crate: CORE, ix: 'open_history_page', why: 'the fixed 118-byte page whose results_root the terminal rows fold into' },
  { crate: TIMEPIN, ix: 'open_need', why: 'the ENTRY target opens a Need that a price must answer' },
  { crate: TIMEPIN, ix: 'open_need', why: 'the EXIT target, a second Need - Core refuses a shot whose two Needs are the same account' },
  { crate: CORE, ix: 'seal_forward', why: 'THE SHOT. L1 is this instruction landing and the Shot account reading back.', gate: 'L1' },
  { crate: TIMEPIN, ix: 'capture_first', why: 'the first admissible print for the entry target', needsObservation: true },
  { crate: TIMEPIN, ix: 'finalize', why: 'the entry Need closes on the minimum publish_time at or after its target', needsObservation: true },
  { crate: CORE, ix: 'activate_entry', why: 'Core reads the finalized entry Need and the shot becomes Active' },
  { crate: TIMEPIN, ix: 'capture_first', why: 'the same for the exit target', needsObservation: true },
  { crate: TIMEPIN, ix: 'finalize', why: 'the exit Need closes', needsObservation: true },
  { crate: CORE, ix: 'settle_final', why: 'SETTLEMENT. L2 is this being cranked by something that exists.', gate: 'L2' },
  { crate: CORE, ix: 'reveal', why: 'the player opens the commitment and the outcome is scored' },
];

// Every instruction named above must exist in the GENERATED account map, which
// is parsed from the Rust rather than typed. A step naming an instruction the
// programs do not have is a plan that cannot run, and it should fail here.
export function validatePlan(steps = STEPS, accounts = INSTRUCTION_ACCOUNTS) {
  const problems = [];
  for (const [i, s] of steps.entries()) {
    const crate = accounts[s.crate];
    if (!crate) { problems.push(`step ${i} names crate ${s.crate}, which the generated account map does not have`); continue; }
    if (!crate[s.ix]) problems.push(`step ${i}: ${s.crate} has no instruction ${s.ix}`);
    if (!s.why) problems.push(`step ${i} (${s.ix}) gives no reason, and an unexplained step is one nobody can review`);
  }
  return problems;
}

// What can actually be attempted today, and what is honestly blocked.
export function reachableToday(steps = STEPS) {
  const blockedFrom = steps.findIndex(s => s.needsObservation);
  return {
    runnable: blockedFrom === -1 ? steps : steps.slice(0, blockedFrom),
    blocked: blockedFrom === -1 ? [] : steps.slice(blockedFrom),
    blockedBy: blockedFrom === -1 ? null
      : 'a live Pyth observation. A Pyth push account holds only the latest price and no history, so the '
        + 'print that belongs to a target has to be captured as it arrives. Nothing offline substitutes for it.',
  };
}

export const gateStep = id => STEPS.find(s => s.gate === id) || null;
