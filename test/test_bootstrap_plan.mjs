// The ordered sequence from two deployed programs to one whole game, and the
// point in it where honesty costs something.
//
// The useful result this file protects: L1 (seal_forward landing) is reachable
// with NO Pyth observer at all, and L2 (settle_final) is not. Eight steps run,
// then the sequence stops at capture_first and waits for a live print. That is
// worth knowing before the deploy rather than at step nine with rent spent.
import assert from 'node:assert/strict';
import { STEPS, validatePlan, reachableToday, gateStep, CORE, TIMEPIN } from '../ops/g2-devnet/bootstrap-plan.mjs';
import { INSTRUCTION_ACCOUNTS } from '../onchain/ratchet-core-g2/client/client-v2.mjs';

let checks = 0;
const ok = (c, msg) => { checks += 1; assert.ok(c, msg); };
const eq = (a, b, msg) => { checks += 1; assert.equal(a, b, msg); };

// ---- every step names a real instruction ------------------------------------
// The account map is PARSED from the Rust, not typed, so this compares the plan
// against the programs rather than against someone's memory of them.
eq(validatePlan().length, 0, `the plan names instructions the programs do not have: ${validatePlan().join('; ')}`);

// And the validator must actually be able to fail, or it is decoration.
ok(validatePlan([{ crate: CORE, ix: 'settle_finalll', why: 'typo' }]).length > 0,
  'a misspelled instruction passed validation');
ok(validatePlan([{ crate: 'ratchet-core-g3', ix: 'seal_forward', why: 'wrong crate' }]).length > 0,
  'a crate that does not exist passed validation');
ok(validatePlan([{ crate: CORE, ix: 'seal_forward' }]).length > 0,
  'a step with no stated reason passed - an unexplained step is one nobody can review');

// ---- order: the things a shot depends on come before the shot ---------------
const at = ix => STEPS.findIndex(s => s.ix === ix);
ok(at('register_evidence_spec') < at('open_need'),
  'a Need is opened before the evidence spec it points at exists');
ok(at('register_economy') < at('register_ruleset'),
  'the ruleset is registered before the economy it belongs to');
ok(at('register_ruleset') < at('seal_forward'), 'a shot is sealed before there are rules');
ok(at('open_ledger') < at('seal_forward'), 'a shot is sealed before the player has a ledger');
ok(at('open_history_page') < at('seal_forward'), 'a shot is sealed before the page its result folds into exists');
ok(at('open_need') < at('seal_forward'), 'a shot is sealed before either Need exists');
ok(at('seal_forward') < at('settle_final'), 'settlement comes before the shot, which is not a game');
ok(at('activate_entry') < at('settle_final'), 'the exit is settled before the entry was ever activated');
ok(at('settle_final') < at('reveal'), 'the commitment is revealed before there is an outcome to score');

// TWO Needs, not one. Core refuses a shot whose entry and exit Need are the same
// account, and a plan with one open_need would look complete and fail on chain.
eq(STEPS.filter(s => s.ix === 'open_need').length, 2,
  'the plan opens a number of Needs other than two; Core requires entry_need != exit_need');

// ---- the gates this plan exists to close ------------------------------------
eq(gateStep('L1').ix, 'seal_forward', 'L1 is not the seal');
eq(gateStep('L2').ix, 'settle_final', 'L2 is not the settlement');
eq(gateStep('L3'), null, 'a gate nobody defined resolved to a step');

// ---- and the honest part ----------------------------------------------------
const r = reachableToday();
eq(r.runnable.length, 8, 'the number of steps runnable without a Pyth observer changed');
eq(r.runnable[r.runnable.length - 1].ix, 'seal_forward',
  'L1 is no longer the last step reachable without a live Pyth observation - if this moved, say so out loud '
  + 'rather than adjusting the number');
eq(r.blocked[0].ix, 'capture_first', 'the first blocked step is not the capture');
ok(r.blocked.some(s => s.ix === 'settle_final'),
  'settle_final is not marked as depending on an observation, which would make L2 look closer than it is');
ok(/no history/.test(r.blockedBy), 'the blocking reason no longer explains WHY a Pyth push account is not enough');

// Every blocked step must be at or after the first blocked one: a plan cannot
// resume after a blocker and then claim the earlier steps were fine.
const firstBlocked = STEPS.findIndex(s => s.needsObservation);
for (const [i, s] of STEPS.entries()) {
  if (s.needsObservation) ok(i >= firstBlocked, `step ${i} is blocked but sits before the first blocker`);
}
ok(r.runnable.every(s => !s.needsObservation), 'a step needing an observation was reported as runnable today');

console.log(`ok - L1 is reachable without an observer, L2 is not, and the plan matches the parsed programs (${checks} checks)`);
