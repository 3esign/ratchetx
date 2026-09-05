// Whether a devnet deployment may proceed, and what makes one real afterwards.
//
// The deploy runs on a machine this session cannot reach - no network on the
// device VM, and the cloud container's egress allowlist refuses Solana's RPC
// with a 403. So every rule that CAN be settled here is settled here, and the
// half that runs elsewhere is left as thin as possible.
//
// The rule this file exists for is the identity check. A program's id is baked
// into its ELF by declare_id!, and it is ALSO the address its keypair deploys
// to. If those disagree the program lands at an address its own code does not
// believe it lives at, every PDA it derives is wrong, and the only repair is to
// deploy again and pay the rent a second time. Nothing recovers it in place.
import assert from 'node:assert/strict';
import {
  planDeployment, deploymentIsReal,
  MAINNET_GENESIS, DEVNET_GENESIS, TESTNET_GENESIS, FEE_ALLOWANCE_LAMPORTS,
} from '../ops/g2-deploy/plan.mjs';

let checks = 0;
const ok = (c, msg) => { checks += 1; assert.ok(c, msg); };
const eq = (a, b, msg) => { checks += 1; assert.equal(a, b, msg); };

const CORE_ID = 'ANVGVtDrECeyQkS56UZ9ZiWCUxk2JWEVNJioFW8JEwbL';
const TIMEPIN_ID = 'C8wwxUGmoKAV22MaY3oW2Q6QeDbmB9dbNdbohsRjJkYp';
const ARTIFACTS = [
  { name: 'timepin', bytes: 375944, expectedProgramId: TIMEPIN_ID, keypairProgramId: TIMEPIN_ID },
  { name: 'core', bytes: 1014408, expectedProgramId: CORE_ID, keypairProgramId: CORE_ID },
];
const RICH = 20_000_000_000;
const base = over => planDeployment({ cluster: DEVNET_GENESIS, artifacts: ARTIFACTS, payerLamports: RICH, ...over });

const refuses = (plan, match, msg) => {
  checks += 1;
  assert.equal(plan.ok, false, msg);
  checks += 1;
  assert.ok(plan.refusals.some(r => match.test(r)), `refused for the wrong reason: ${plan.refusals.join(' | ')}`);
};

// ---- the one that must work -------------------------------------------------
{
  const p = base();
  ok(p.ok, `a funded devnet deployment with matching identities was refused: ${p.refusals.join('; ')}`);
  eq(p.steps.map(s => s.name).join(','), 'core,timepin', 'the plan does not deploy the larger program first');
  eq(p.required, p.peak + FEE_ALLOWANCE_LAMPORTS, 'the requirement does not include a fee allowance');
  ok(p.steps[1].requiredAtThisStep > p.steps[1].cost.peak,
    'the second step does not account for what the first one left locked');
}

// ---- mainnet, and every shape of not-devnet --------------------------------
refuses(base({ cluster: MAINNET_GENESIS }), /MAINNET/,
  'MAINNET WAS DEPLOYABLE FROM THIS PLANNER. That is the one thing it must never allow.');
refuses(base({ cluster: '' }), /unidentified/, 'an empty genesis hash was treated as deployable');
refuses(base({ cluster: null }), /unidentified/, 'a null cluster was treated as deployable');
refuses(base({ cluster: 'SomeOtherChainGenesisHash1111111111111111111' }), /unidentified/,
  'an unknown cluster was treated as deployable');
{
  const p = base({ cluster: TESTNET_GENESIS });
  ok(p.ok, 'testnet was refused, though it is as safe as devnet and sometimes the only faucet that works');
}

// ---- the identity check, which is the point of this file --------------------
refuses(
  planDeployment({ cluster: DEVNET_GENESIS, payerLamports: RICH, artifacts: [
    { name: 'core', bytes: 1014408, expectedProgramId: CORE_ID, keypairProgramId: TIMEPIN_ID }] }),
  /does not believe it lives at/,
  'A PROGRAM WAS DEPLOYED TO AN ADDRESS ITS OWN CODE DOES NOT CARRY. Every PDA it derives would be wrong, '
  + 'and the only repair is deploying again and paying the rent twice.');
refuses(
  planDeployment({ cluster: DEVNET_GENESIS, payerLamports: RICH, artifacts: [
    { name: 'core', bytes: 1014408, expectedProgramId: CORE_ID, keypairProgramId: null }] }),
  /no program keypair was resolved/,
  'a missing keypair was treated as a matching one');
// The keyless placeholder is the specific wrong id this project has already
// shipped once, so it gets its own case rather than relying on the general rule.
refuses(
  planDeployment({ cluster: DEVNET_GENESIS, payerLamports: RICH, artifacts: [
    { name: 'core', bytes: 1014408, expectedProgramId: CORE_ID,
      keypairProgramId: 'US517G5965aydkZ46HS38QLi7UQiSojurfbQfKCELFx' }] }),
  /US517G5965aydkZ46HS38QLi7UQiSojurfbQfKCELFx/,
  'the keyless US517 placeholder was accepted as a deploy target');

// ---- money, and the unread balance -----------------------------------------
refuses(base({ payerLamports: undefined }), /unread balance is not a sufficient one/,
  'an unread balance passed as a sufficient one - the same shape as a check that never ran');
refuses(base({ payerLamports: 5_000_000_000 }), /stranded buffer/,
  'a deployment was allowed to start with too little, which strands a funded buffer');
{
  // Exactly enough must pass, and one lamport less must not. An off-by-one here
  // is a deploy that dies in the last transaction.
  const p = base({ payerLamports: 0 });
  const need = p.required;
  ok(base({ payerLamports: need }).ok, 'exactly the required balance was refused');
  refuses(base({ payerLamports: need - 1 }), /stranded buffer/, 'one lamport short was accepted');
  // The fee allowance is not decoration: rent alone must NOT be enough.
  refuses(base({ payerLamports: p.peak }), /stranded buffer/,
    'rent with no fee allowance was accepted, so the last write transaction would fail unpaid');
}

// ---- headroom costs more, and says so --------------------------------------
ok(base({ maxLenMultiplier: 2 }).required > base().required,
  'doubling the allocation did not increase the requirement');

// ---- what makes a deploy REAL afterwards ------------------------------------
const LOADER = 'BPFLoaderUpgradeab1e11111111111111111111111';
ok(deploymentIsReal({ programId: CORE_ID,
  account: { exists: true, executable: true, owner: LOADER } }).real,
  'a correctly deployed program was not accepted');

const notReal = (account, match, msg) => {
  const r = deploymentIsReal({ programId: CORE_ID, account });
  checks += 1;
  assert.equal(r.real, false, msg);
  checks += 1;
  assert.ok(r.problems.some(p => match.test(p)), `wrong problem: ${r.problems.join(' | ')}`);
};
notReal(null, /not read back/, 'A SUCCESSFUL CLI EXIT COUNTED AS A DEPLOYED PROGRAM, with nothing read back.');
notReal({ exists: false }, /no account at that address/, 'a missing account counted as a deploy');
notReal({ exists: true, executable: false, owner: LOADER }, /NOT executable/,
  'a non-executable account counted as a program - this is what a half-finished deploy leaves behind');
notReal({ exists: true, executable: true, owner: '11111111111111111111111111111111' }, /owned by/,
  'an account owned by the system program counted as a deployed program');

console.log(`ok - mainnet is unreachable, identity must match, and a CLI exit is not a program (${checks} checks)`);
