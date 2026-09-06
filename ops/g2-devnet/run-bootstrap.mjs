// Running the bootstrap sequence: the loop that turns a plan into transactions.
//
// L1 says no G2 file both BUILDS an instruction and SENDS it. This is that file.
// It builds each step with onchain/ratchet-core-g2/client/client-v2.mjs and hands
// it to ops/g2-send, and it stops the moment one step does not produce evidence.
//
// The builder and the sender are INJECTED. Not for elegance: it is the only way
// the sequencing can be proved without a chain, and the sequencing is where this
// kind of loop actually goes wrong - continuing past a failure, sending a step
// twice, or reporting success because the last step happened to work.
import { STEPS, reachableToday } from './bootstrap-plan.mjs';
import { checkRunReceipt } from './receipt.mjs';

export class StepFailed extends Error {
  constructor(step, index, reason) {
    super(`step ${index} (${step.crate}.${step.ix}) did not land: ${reason}`);
    this.step = step; this.index = index; this.reason = reason;
  }
}

export async function runBootstrap({
  steps = null,
  build,                  // async (step, index, ctx) -> instruction | { skip: reason }
  send,                   // async (instruction, step, index) -> { sent, signature, evidence }
  ctx = {},
  log = console.log,
  stopOnFailure = true,
  clusterGenesis = null,
  programs = null,
  writeReceipt = null,     // (receipt) -> void; the caller decides where it lands
} = {}) {
  if (typeof build !== 'function') throw new TypeError('runBootstrap needs a build function');
  if (typeof send !== 'function') throw new TypeError('runBootstrap needs a send function');

  // Default to what is actually reachable rather than the whole plan. Attempting
  // capture_first without a live Pyth observation is not ambition, it is a
  // transaction that cannot succeed and a fee that buys nothing.
  const plan = steps ?? reachableToday(STEPS).runnable;
  const transcript = [];

  for (const [index, step] of plan.entries()) {
    let instruction;
    try {
      instruction = await build(step, index, ctx);
    } catch (e) {
      const failure = { step: step.ix, index, ok: false, phase: 'build', reason: String(e.message || e) };
      transcript.push(failure);
      log(`BUILD FAILED ${step.crate}.${step.ix}: ${failure.reason}`);
      if (stopOnFailure) throw new StepFailed(step, index, failure.reason);
      continue;
    }

    if (instruction && instruction.skip) {
      transcript.push({ step: step.ix, index, ok: true, skipped: true, reason: instruction.skip });
      log(`SKIP ${step.crate}.${step.ix}: ${instruction.skip}`);
      continue;
    }
    if (!instruction) {
      // A builder that returns nothing has not built anything, and treating that
      // as "nothing to do" is how a sequence reports success for doing none of it.
      const reason = 'the builder returned no instruction, which is not the same as having nothing to do';
      transcript.push({ step: step.ix, index, ok: false, phase: 'build', reason });
      log(`BUILD FAILED ${step.crate}.${step.ix}: ${reason}`);
      if (stopOnFailure) throw new StepFailed(step, index, reason);
      continue;
    }

    const result = await send(instruction, step, index);
    const landed = Boolean(result && result.sent && result.evidence && result.evidence.evidence);
    transcript.push({
      step: step.ix, index, ok: landed,
      signature: result && result.signature ? result.signature : null,
      // Carried through rather than reconstructed: the receipt must record the
      // read-back the sender actually performed, not a note that one happened.
      readBack: result && result.evidence ? result.evidence : null,
      phase: 'send',
      reason: landed ? null
        : (result && result.reason)
          || (result && result.evidence && result.evidence.problems || []).join('; ')
          || 'no evidence was returned',
    });

    if (!landed) {
      log(`NOT LANDED ${step.crate}.${step.ix}: ${transcript[transcript.length - 1].reason}`);
      // STOPPING IS THE DEFAULT AND IT IS NOT CAUTION. Every step after this one
      // assumes the accounts this one was supposed to create. Continuing produces
      // a cascade of failures whose first cause is four screens up.
      if (stopOnFailure) throw new StepFailed(step, index, transcript[transcript.length - 1].reason);
      continue;
    }
    log(`LANDED ${step.crate}.${step.ix}${result.signature ? ' ' + result.signature : ''}`);
  }

  const landed = transcript.filter(t => t.ok && !t.skipped);
  const result = {
    transcript,
    landed: landed.length,
    attempted: plan.length,
    // The gate row asks for a SEAL that was sent. Naming it explicitly means the
    // answer does not depend on counting.
    sealSignature: (transcript.find(t => t.step === 'seal_forward' && t.ok) || {}).signature || null,
    settleSignature: (transcript.find(t => t.step === 'settle_final' && t.ok) || {}).signature || null,
  };

  // THE RECEIPT IS WRITTEN BY THE RUN, NOT BY A PERSON. L1 and L2 read
  // releases/g2-devnet-run.json, and the whole reason they do is so that nobody
  // has to edit a gate row to make it green.
  //
  // It is CHECKED before it is handed over. A run that produces a receipt its own
  // checker refuses has found a bug in one of the two, and writing it anyway would
  // hide which - the same reason compile-receipt.mjs validates its own output.
  if (writeReceipt) {
    const receipt = {
      schema: 1,
      clusterGenesis,
      programs: programs || undefined,
      generatedAt: new Date().toISOString(),
      steps: transcript.map(t => ({
        step: t.step,
        ok: Boolean(t.ok && !t.skipped),
        skipped: t.skipped || undefined,
        signature: t.signature || undefined,
        readBack: t.readBack || (t.ok && !t.skipped ? { evidence: true } : undefined),
        reason: t.reason || undefined,
      })),
      landed: result.landed,
      sealSignature: result.sealSignature || undefined,
      settleSignature: result.settleSignature || undefined,
    };
    const verdict = checkRunReceipt(receipt);
    if (!verdict.ok) {
      throw new Error('the run produced a receipt its own checker refuses, so one of the two is wrong and '
        + 'writing it would hide which: ' + verdict.problems.join('; '));
    }
    writeReceipt(receipt);
    result.receipt = receipt;
  }
  return result;
}
