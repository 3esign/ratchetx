// The devnet run receipt, and every shape of lie it has to refuse.
//
// L1 and L2 both say "replace this row with a devnet signature once one exists".
// That is a hand edit to a gate, which is the one thing this gate exists to make
// unnecessary. So the run writes what it did and the rows read it - and a
// receipt nobody can check is worse than no receipt, because it looks like
// evidence.
//
// Every rule here caught a real shape somewhere in this project already: a
// compile receipt that claimed 28 passed with 29 names, four gate rows that
// answered about files that were not there, and a whole morning of signatures
// standing in for read-backs.
import assert from 'node:assert/strict';
import { checkRunReceipt, sealEvidence, settleEvidence, DEVNET_GENESIS, MAINNET_GENESIS } from '../ops/g2-devnet/receipt.mjs';

let checks = 0;
const ok = (c, msg) => { checks += 1; assert.ok(c, msg); };
const refuses = (receipt, match, msg, opts) => {
  const r = checkRunReceipt(receipt, opts);
  checks += 1;
  assert.equal(r.ok, false, msg);
  checks += 1;
  assert.ok(r.problems.some(p => match.test(p)), `refused for the wrong reason: ${r.problems.join(' | ')}`);
};

const SIG_A = '5'.repeat(87);
const SIG_B = '4'.repeat(87);
const CORE = 'ANVGVtDrECeyQkS56UZ9ZiWCUxk2JWEVNJioFW8JEwbL';
const TIMEPIN = 'C8wwxUGmoKAV22MaY3oW2Q6QeDbmB9dbNdbohsRjJkYp';
const step = (name, sig, over = {}) => ({ step: name, ok: true, signature: sig, readBack: { evidence: true }, ...over });

const GOOD = {
  schema: 1,
  clusterGenesis: DEVNET_GENESIS,
  programs: { core: CORE, timepin: TIMEPIN },
  steps: [step('open_ledger', SIG_A), step('seal_forward', SIG_B)],
  landed: 2,
  sealSignature: SIG_B,
};

// ---- the one that must pass -------------------------------------------------
ok(checkRunReceipt(GOOD).ok, `a well-formed devnet receipt was refused: ${checkRunReceipt(GOOD).problems.join('; ')}`);
ok(sealEvidence(GOOD).ok, 'a landed seal was not accepted as L1 evidence');
ok(sealEvidence(GOOD).signature === SIG_B, 'the wrong signature was reported for the seal');
ok(!settleEvidence(GOOD).ok, 'settlement evidence was claimed from a run that never settled');

// ---- the cluster is a genesis hash, not a name ------------------------------
refuses({ ...GOOD, clusterGenesis: MAINNET_GENESIS }, /claims MAINNET/,
  'A MAINNET RUN CLOSED A GATE ROW. No row in this gate is closed by one.');
refuses({ ...GOOD, clusterGenesis: 'devnet' }, /not a cluster this gate recognises/,
  'the word "devnet" in a field was accepted as the chain identifying itself');
refuses({ ...GOOD, clusterGenesis: undefined }, /cannot say which chain/,
  'a receipt with no cluster at all was accepted');

// ---- a signature is not a read-back -----------------------------------------
refuses({ ...GOOD, steps: [step('seal_forward', SIG_B, { readBack: undefined })], landed: 1, sealSignature: SIG_B },
  /not that the account it was meant to write exists/,
  'A SIGNATURE ALONE CLOSED A ROW. That is the exact failure the send gate was written to refuse.');
refuses({ ...GOOD, steps: [step('seal_forward', SIG_B, { readBack: { evidence: false } })], landed: 1, sealSignature: SIG_B },
  /no read-back/, 'a FAILED read-back was accepted as a landed step');

// ---- signatures must look like signatures -----------------------------------
refuses({ ...GOOD, steps: [step('seal_forward', 'yes-it-worked')], landed: 1, sealSignature: 'yes-it-worked' },
  /no valid signature/, 'a prose string was accepted where a signature belongs');
refuses({ ...GOOD, steps: [step('seal_forward', SIG_B + '0I')], landed: 1, sealSignature: SIG_B + '0I' },
  /no valid signature/, 'a string with base58-illegal characters was accepted as a signature');

// ---- the receipt must not contradict itself ---------------------------------
refuses({ ...GOOD, landed: 5 }, /contradicts itself/,
  'the summary disagreed with the list it summarises and the receipt was still accepted - assembled, not produced');
refuses({ ...GOOD, sealSignature: SIG_A }, /does not match the seal_forward step/,
  'the top-level seal signature named a different transaction than the seal step');

// ---- the programs must be the ones the manifest names -----------------------
refuses(GOOD, /but the manifest says/,
  'a run against a DIFFERENT program closed the row', { expect: { programs: { core: 'SomeOtherProgram1111111111111111111111111111' } } });
refuses({ ...GOOD, programs: { core: 'not base58 !!' } }, /not a base58 address/,
  'a program field that is not an address was accepted');

// ---- and the empty shapes ---------------------------------------------------
refuses({ ...GOOD, steps: [] }, /records no steps/, 'a run with no steps was accepted as having landed something');
refuses({ ...GOOD, schema: 2 }, /schema is 2/, 'a receipt of an unknown schema was read as if its fields meant what we expect');
refuses(null, /not an object/, 'a null receipt was accepted');
refuses([], /not an object/, 'an array was accepted as a receipt');

// A run that landed everything EXCEPT the seal must not close L1.
{
  const noSeal = { ...GOOD, steps: [step('open_ledger', SIG_A)], landed: 1, sealSignature: undefined };
  ok(checkRunReceipt(noSeal).ok, 'a valid run without a seal was refused as malformed, which is a different claim');
  ok(!sealEvidence(noSeal).ok, 'L1 was closed by a run that never sealed');
}

console.log(`ok - a receipt cannot close a row by claiming a name, a signature, or a number (${checks} checks)`);
