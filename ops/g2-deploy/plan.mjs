// Whether a devnet deployment may proceed, and in what order.
//
// Pure. Facts in, a plan or a list of refusals out. Nothing here reads a file,
// opens a socket, or signs anything - which is why it can be trusted before the
// deployment exists, and why every rule below has a test.
//
// The deploy itself has to run on a machine with the Solana CLI and network
// access. Neither of those is true here: this device VM has no network at all
// (measured 2026-09-05: fetch failed to api.devnet.solana.com) and the cloud
// container's egress allowlist refuses the same host with a 403. So this file is
// the reviewable half, and ops/g2-deploy/deploy-devnet.mjs is the half that runs
// where the CLI is.
import { deploymentCost } from './rent.mjs';

export const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
export const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
export const TESTNET_GENESIS = '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY';

// A deploy transaction fee allowance. Writing a megabyte takes on the order of a
// thousand transactions, and running out of lamports part way leaves a funded
// buffer and no program. This is deliberately generous: the whole cost of being
// wrong upward is a few thousandths of a SOL sitting unused in the payer.
export const FEE_ALLOWANCE_LAMPORTS = 50_000_000; // 0.05 SOL

export function planDeployment({
  cluster,
  artifacts,          // [{ name, bytes, expectedProgramId, keypairProgramId }]
  payerLamports,
  maxLenMultiplier = 1,
}) {
  const refusals = [];

  if (cluster !== DEVNET_GENESIS && cluster !== TESTNET_GENESIS) {
    refusals.push(cluster === MAINNET_GENESIS
      ? 'this is MAINNET. This tool does not deploy there, and no flag changes that.'
      : `the genesis hash ${cluster || '(none)'} is not devnet or testnet, so the cluster is unidentified `
        + 'and an unidentified cluster is never deployed to');
  }

  for (const a of artifacts || []) {
    if (!a.bytes) { refusals.push(`${a.name}: the artifact is missing`); continue; }
    // THE IDENTITY CHECK THAT MATTERS. The program id is baked into the ELF by
    // declare_id!, and it is ALSO the address the keypair deploys to. If those
    // two disagree the program deploys to an address its own code does not
    // believe it lives at, every PDA it derives is wrong, and it is unfixable
    // afterwards without deploying again and paying the rent twice.
    if (!a.keypairProgramId) {
      refusals.push(`${a.name}: no program keypair was resolved, so nothing can say which address this deploys to`);
    } else if (a.keypairProgramId !== a.expectedProgramId) {
      refusals.push(`${a.name}: the program keypair derives to ${a.keypairProgramId} but the artifact `
        + `carries ${a.expectedProgramId}. Deploying this pair puts the program at an address its own `
        + 'code does not believe it lives at, and every PDA it derives would be wrong.');
    }
  }

  // Largest first: everything already deployed stays locked, so its permanent
  // cost is carried into every later step's requirement.
  const order = [...(artifacts || [])]
    .filter(a => a.bytes)
    .sort((x, y) => y.bytes - x.bytes);

  let running = 0;
  let peak = 0;
  const steps = order.map(a => {
    const cost = deploymentCost(a.bytes, { maxLen: a.bytes * maxLenMultiplier });
    const requiredAtThisStep = running + cost.peak;
    peak = Math.max(peak, requiredAtThisStep);
    running += cost.permanent;
    return {
      name: a.name,
      programId: a.expectedProgramId,
      bytes: a.bytes,
      maxLen: a.bytes * maxLenMultiplier,
      cost,
      requiredAtThisStep,
    };
  });

  const required = peak + FEE_ALLOWANCE_LAMPORTS;
  if (typeof payerLamports !== 'number') {
    refusals.push('the payer balance was not read, and an unread balance is not a sufficient one');
  } else if (payerLamports < required) {
    refusals.push(`the payer holds ${payerLamports} lamports and the deployment needs ${required} `
      + `(${peak} of rent plus a ${FEE_ALLOWANCE_LAMPORTS} fee allowance). Starting it now funds a buffer `
      + 'and then stops, leaving a stranded buffer and no program.');
  }

  return { ok: refusals.length === 0, refusals, steps, peak, required };
}

// What must be true of a deployed program AFTER the fact. A successful CLI exit
// is not this: the same claim as ops/g2-send/gate.mjs makes about a signature.
export function deploymentIsReal({ programId, account }) {
  const problems = [];
  if (!account) { problems.push(`${programId}: the program account was not read back`); return { real: false, problems }; }
  if (!account.exists) problems.push(`${programId}: no account at that address after a successful deploy`);
  else {
    if (!account.executable) problems.push(`${programId}: the account exists but is NOT executable, so it is not a program`);
    if (account.owner && account.owner !== 'BPFLoaderUpgradeab1e11111111111111111111111') {
      problems.push(`${programId}: owned by ${account.owner}, not the upgradeable loader`);
    }
  }
  return { real: problems.length === 0, problems };
}
