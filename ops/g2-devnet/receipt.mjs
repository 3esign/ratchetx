// The devnet run receipt: what L1 and L2 read instead of somebody editing a row.
//
// Both rows currently say "replace this row with a devnet signature once one
// exists". That instruction is a hand edit, and a hand edit to a gate is the one
// thing this gate exists to make unnecessary. So the run WRITES what it did, and
// the rows READ it.
//
// A receipt cannot prove itself - anyone can type JSON. What it can do is refuse
// to be internally inconsistent, the way tools/compile-receipt.mjs learned to on
// 2026-09-05 after one claimed 28 passed with 29 names in its passing list. Every
// rule below caught a real shape of lie somewhere in this project already.
export const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
export const TESTNET_GENESIS = '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY';
export const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';

// base58, no 0 O I l, and a Solana signature is 64 bytes -> 86-88 characters.
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{86,88}$/;
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function checkRunReceipt(receipt, { expect = {} } = {}) {
  const problems = [];
  const need = (cond, why) => { if (!cond) problems.push(why); };

  need(receipt && typeof receipt === 'object' && !Array.isArray(receipt), 'the receipt is not an object');
  if (problems.length) return { ok: false, problems };

  need(receipt.schema === 1, `schema is ${JSON.stringify(receipt.schema)}, expected 1`);

  // THE CLUSTER IS A GENESIS HASH, NOT A NAME. "devnet" in a field is a claim
  // somebody typed; the genesis hash is the chain identifying itself.
  const g = receipt.clusterGenesis;
  need(typeof g === 'string' && g.length > 0, 'no clusterGenesis: a run that cannot say which chain it ran on is not evidence');
  if (g === MAINNET_GENESIS) problems.push('this receipt claims MAINNET. No row in this gate is closed by a mainnet run.');
  else if (g && g !== DEVNET_GENESIS && g !== TESTNET_GENESIS) problems.push(`clusterGenesis ${g} is not a cluster this gate recognises`);

  for (const [name, id] of Object.entries(expect.programs || {})) {
    const got = (receipt.programs || {})[name];
    need(got === id, `programs.${name} is ${got || '(absent)'} but the manifest says ${id}`);
  }
  for (const [name, id] of Object.entries(receipt.programs || {})) {
    need(ADDRESS.test(String(id)), `programs.${name} is not a base58 address: ${id}`);
  }

  const steps = receipt.steps;
  need(Array.isArray(steps) && steps.length > 0, 'the receipt records no steps, and a run with no steps landed nothing');
  for (const [i, s] of (Array.isArray(steps) ? steps : []).entries()) {
    need(typeof s.step === 'string' && s.step, `step ${i} has no name`);
    if (s.ok) {
      need(SIGNATURE.test(String(s.signature || '')), `step ${i} (${s.step}) is marked ok with no valid signature`);
      // The claim this project has been burned by most: a signature standing in
      // for a read-back. A confirmed transaction whose account was never read is
      // not evidence that anything changed.
      need(s.readBack && s.readBack.evidence === true,
        `step ${i} (${s.step}) is marked ok but carries no read-back. A signature proves a transaction was `
        + 'accepted, not that the account it was meant to write exists.');
    }
  }

  // Internal consistency: the summary must not disagree with the list it summarises.
  if (Array.isArray(steps)) {
    const okCount = steps.filter(s => s.ok).length;
    if (typeof receipt.landed === 'number') {
      need(receipt.landed === okCount,
        `landed says ${receipt.landed} but ${okCount} steps are marked ok - the receipt contradicts itself, `
        + 'so it was assembled rather than produced');
    }
    const seal = steps.find(s => s.step === 'seal_forward');
    if (receipt.sealSignature) {
      need(seal && seal.ok && seal.signature === receipt.sealSignature,
        'sealSignature does not match the seal_forward step in the same receipt');
    }
    const settle = steps.find(s => s.step === 'settle_final');
    if (receipt.settleSignature) {
      need(settle && settle.ok && settle.signature === receipt.settleSignature,
        'settleSignature does not match the settle_final step in the same receipt');
    }
  }

  return { ok: problems.length === 0, problems };
}

// What L1 asks: a seal was SENT and the Shot account was read back.
export function sealEvidence(receipt, opts) {
  const base = checkRunReceipt(receipt, opts);
  if (!base.ok) return { ok: false, problems: base.problems };
  const seal = (receipt.steps || []).find(s => s.step === 'seal_forward' && s.ok);
  if (!seal) return { ok: false, problems: ['no seal_forward step landed in this run'] };
  return { ok: true, signature: seal.signature, cluster: receipt.clusterGenesis };
}

// What L2 asks: settlement was cranked by something that exists.
export function settleEvidence(receipt, opts) {
  const base = checkRunReceipt(receipt, opts);
  if (!base.ok) return { ok: false, problems: base.problems };
  const settle = (receipt.steps || []).find(s => s.step === 'settle_final' && s.ok);
  if (!settle) return { ok: false, problems: ['no settle_final step landed in this run'] };
  return { ok: true, signature: settle.signature, cluster: receipt.clusterGenesis };
}
