// Pure devnet first-deployment plan. Funding must use caller-supplied RPC quotes.
import { deploymentCost } from './rent.mjs';

export const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
export const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
export const TESTNET_GENESIS = '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY';
export const FEE_ALLOWANCE_LAMPORTS = 50_000_000; // allowance, not a measured fee quote

export function planDeployment({ cluster, artifacts, payerLamports, maxLenMultiplier = 1, rentForSize }) {
  const refusals = [];
  if (cluster !== DEVNET_GENESIS) refusals.push(cluster === MAINNET_GENESIS
    ? 'this is MAINNET. This tool only deploys to devnet.'
    : 'the genesis hash is not devnet; an unidentified or other cluster is refused');
  if (!Array.isArray(artifacts) || artifacts.length !== 2
    || artifacts.map(a => a?.name).sort().join(',') !== 'core,timepin') {
    refusals.push('the complete canonical Timepin and Core pair is required');
  }
  for (const a of artifacts || []) {
    if (!Number.isSafeInteger(a?.bytes) || a.bytes <= 0) {
      refusals.push(a?.name + ': the artifact is missing or has an invalid size'); continue;
    }
    if (!a.keypairProgramId) refusals.push(a.name + ': no program keypair was resolved');
    else if (a.keypairProgramId !== a.expectedProgramId) refusals.push(a.name
      + ': program keypair ' + a.keypairProgramId + ' does not match accepted artifact ' + a.expectedProgramId);
  }
  if (maxLenMultiplier !== 1) refusals.push('this devnet execution plan requires exact capacity');
  if (typeof rentForSize !== 'function') refusals.push('actual RPC rent quotes are required; no legacy estimate may fund a deploy');
  if (!Number.isSafeInteger(payerLamports) || payerLamports < 0) {
    refusals.push('the payer balance must be a non-negative safe integer; an unread or invalid balance is insufficient');
  }
  if (refusals.length) return { ok: false, refusals, steps: [], peak: null, required: null };

  let running = 0;
  // Both orders have the same fresh-deployment rent peak. Keep the established
  // larger-first execution order without claiming an order-dependent saving.
  const steps = [...artifacts].sort((a, b) => b.bytes - a.bytes).map(a => {
    const cost = deploymentCost(a.bytes, { maxLen: a.bytes, rentForSize });
    running += cost.permanent;
    if (!Number.isSafeInteger(running)) throw new RangeError('pair rent exceeds safe integer precision');
    return { name: a.name, programId: a.expectedProgramId, bytes: a.bytes,
      maxLen: a.bytes, cost, requiredAtThisStep: running };
  });
  const peak = running, required = peak + FEE_ALLOWANCE_LAMPORTS;
  if (!Number.isSafeInteger(required)) throw new RangeError('funding requirement exceeds safe integer precision');
  if (payerLamports < required) refusals.push('the payer holds ' + payerLamports
    + ' lamports; needs ' + required + ' (' + peak + ' rent plus '
    + FEE_ALLOWANCE_LAMPORTS + ' fee allowance). Refusing to leave a partially funded deployment.');
  return { ok: refusals.length === 0, refusals, steps, peak, required,
    rentSource: 'rpc', feeAllowanceLamports: FEE_ALLOWANCE_LAMPORTS, feesMeasured: false };
}

export function deploymentIsReal({ programId, account }) {
  const problems = [];
  if (!account) problems.push(programId + ': the program account was not read back');
  else if (account.exists !== true) problems.push(programId + ': no account at that address after deploy');
  else {
    if (account.executable !== true) problems.push(programId + ': account is NOT executable');
    if (account.owner !== 'BPFLoaderUpgradeab1e11111111111111111111111') {
      problems.push(programId + ': owned by ' + account.owner + ', not the upgradeable loader');
    }
  }
  return { real: problems.length === 0, problems };
}
