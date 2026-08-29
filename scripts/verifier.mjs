import { createRequire } from 'node:module';
import fs from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { verifyEvidence } = require('../lib/verifier.js');

// Offline/keyless receipt verifier. The input is the JSON bundle returned by
// /api/agent-proof-bundle, or a receipt object extracted from it. It performs
// no Pyth HTTP request and accepts no API key.
export async function verifyBundleFile(path) {
  const parsed = JSON.parse(await fs.readFile(path, 'utf8'));
  const receipt = parsed && parsed.bundle ? parsed.bundle.receipt
    : parsed && parsed.receipt ? parsed.receipt : parsed;
  if (!receipt || receipt.proofVersion !== 'ratchetx-keyless-audit-v1')
    return { result:'INSUFFICIENT_EVIDENCE', reason:'not a Ratchet keyless audit receipt' };
  if (!receipt.commitment || receipt.commitment.matches !== true)
    return { result:'DIVERGENCE', reason:'commitment check is not valid' };
  if (!receipt.chainVerification || receipt.chainVerification.ok !== true)
    return { result:'DIVERGENCE', reason:'hash-chain check is not valid' };
  if (!receipt.trustBoundary || receipt.trustBoundary.independentPythReplay !== false)
    return { result:'DIVERGENCE', reason:'receipt overstates its Pyth trust boundary' };
  return receipt;
}

export { verifyEvidence };

const args = process.argv.slice(2);
if (args.length > 0 && process.argv[1] && process.argv[1].endsWith('verifier.mjs')) {
  verifyBundleFile(args[0]).then(receipt => {
    console.log(JSON.stringify(receipt, null, 2));
    if (receipt.result === 'DIVERGENCE') process.exit(1);
    if (receipt.result === 'INSUFFICIENT_EVIDENCE') process.exit(2);
  }).catch(e => { console.error(e); process.exit(1); });
}
