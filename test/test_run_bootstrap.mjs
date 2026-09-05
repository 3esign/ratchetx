// The bootstrap loop: the sequencing, proved without a chain.
//
// This is the file L1 names — one that both builds an instruction and sends it.
// Whether the instructions are right is client-v2's business and is tested
// elsewhere; what is tested HERE is the part that goes wrong in loops like this
// one: continuing past a failure, sending a step twice, treating a builder that
// returned nothing as nothing to do, and reporting success because the last step
// happened to work.
import assert from 'node:assert/strict';
import { runBootstrap, StepFailed } from '../ops/g2-devnet/run-bootstrap.mjs';
import { reachableToday, STEPS } from '../ops/g2-devnet/bootstrap-plan.mjs';

let checks = 0;
const ok = (c, msg) => { checks += 1; assert.ok(c, msg); };
const eq = (a, b, msg) => { checks += 1; assert.equal(a, b, msg); };

const landed = sig => ({ sent: true, signature: sig, evidence: { evidence: true, problems: [] } });
const quiet = () => {};

// ---- the happy path runs exactly the reachable steps, in order --------------
{
  const built = [], sent = [];
  const r = await runBootstrap({
    build: (s, i) => { built.push(s.ix); return { ix: s.ix, i }; },
    send: (instruction, s, i) => { sent.push(s.ix); return landed('sig' + i); },
    log: quiet,
  });
  const expected = reachableToday(STEPS).runnable.map(s => s.ix);
  eq(built.join(','), expected.join(','), 'the runner built something other than the reachable plan, in order');
  eq(sent.join(','), expected.join(','), 'a built instruction was not sent');
  eq(r.landed, expected.length, 'the landed count does not match what was sent');
  eq(r.sealSignature, 'sig' + (expected.length - 1), 'the seal signature was not reported as the seal');
  ok(r.sealSignature, 'L1 asks for a seal signature and the run reported none');
}

// ---- IT DOES NOT ATTEMPT WHAT CANNOT SUCCEED --------------------------------
// capture_first needs a live Pyth observation. Sending it anyway is not ambition,
// it is a transaction that cannot succeed and a fee that buys nothing.
{
  const built = [];
  await runBootstrap({ build: s => { built.push(s.ix); return { ix: s.ix }; }, send: () => landed('s'), log: quiet });
  ok(!built.includes('capture_first'), 'the default run attempted a step that needs a live Pyth observation');
  ok(!built.includes('settle_final'), 'the default run attempted settlement, which inherits the same dependency');
  ok(built.includes('seal_forward'), 'the default run did not reach the seal, which is the point of it');
}

// ---- a step that does not land STOPS the sequence ---------------------------
{
  const built = [];
  const failAt = 'open_ledger';
  let err = null;
  try {
    await runBootstrap({
      build: s => { built.push(s.ix); return { ix: s.ix }; },
      send: (i, s) => (s.ix === failAt
        ? { sent: true, signature: 'sig', evidence: { evidence: false, problems: ['the account does not exist'] } }
        : landed('sig')),
      log: quiet,
    });
  } catch (e) { err = e; }
  checks += 1;
  assert.ok(err instanceof StepFailed, 'a step that did not land did not stop the sequence');
  eq(err.step.ix, failAt, 'the wrong step was reported as the failure');
  eq(built[built.length - 1], failAt,
    'THE SEQUENCE CONTINUED PAST A FAILURE. Every later step assumes the accounts this one was supposed to '
    + 'create, so the cascade that follows has its first cause four screens up.');
  ok(/does not exist/.test(err.reason), 'the failure did not carry the read-back problem that caused it');
}

// ---- a CONFIRMED transaction with no evidence is still a failure ------------
{
  let err = null;
  try {
    await runBootstrap({
      build: s => ({ ix: s.ix }),
      // sent: true and a signature, but the read-back found nothing. This is the
      // exact shape ops/g2-send/gate.mjs exists to refuse.
      send: () => ({ sent: true, signature: 'looks-fine', evidence: { evidence: false, problems: ['not read back'] } }),
      log: quiet,
    });
  } catch (e) { err = e; }
  checks += 1;
  assert.ok(err instanceof StepFailed,
    'A SIGNATURE COUNTED AS A LANDED STEP. A confirmed transaction whose account was never read back is not '
    + 'evidence that anything changed.');
}

// ---- a builder that returns nothing is a failure, not a no-op ---------------
{
  let err = null;
  try {
    await runBootstrap({ build: () => null, send: () => landed('s'), log: quiet });
  } catch (e) { err = e; }
  checks += 1;
  assert.ok(err instanceof StepFailed, 'a builder returning nothing was treated as having nothing to do');
  ok(/not the same as having nothing to do/.test(err.reason), 'the empty-builder failure does not say why');
}

// ---- an explicit skip is allowed, and is not silent -------------------------
{
  const r = await runBootstrap({
    build: s => (s.ix === 'open_ledger' ? { skip: 'the ledger already exists on this cluster' } : { ix: s.ix }),
    send: () => landed('s'),
    log: quiet,
  });
  const skipped = r.transcript.filter(t => t.skipped);
  eq(skipped.length, 1, 'an explicit skip was not recorded');
  ok(/already exists/.test(skipped[0].reason), 'the skip did not carry its reason');
  ok(r.sealSignature, 'a skipped prerequisite stopped the seal from being reached');
}

// ---- a build that throws is caught and named --------------------------------
{
  let err = null;
  try {
    await runBootstrap({
      build: s => { if (s.ix === 'register_ruleset') throw new Error('grid disagreed with the manifest'); return { ix: s.ix }; },
      send: () => landed('s'), log: quiet,
    });
  } catch (e) { err = e; }
  checks += 1;
  assert.ok(err instanceof StepFailed, 'a builder that threw did not stop the run');
  ok(/grid disagreed/.test(err.reason), 'the build failure lost the reason it threw');
}

// ---- stopOnFailure:false records everything and still does not lie ----------
{
  const r = await runBootstrap({
    build: s => ({ ix: s.ix }),
    send: (i, s) => (s.ix === 'open_ledger'
      ? { sent: false, reason: 'refused: insufficient funds' }
      : landed('sig')),
    stopOnFailure: false, log: quiet,
  });
  const bad = r.transcript.filter(t => !t.ok);
  eq(bad.length, 1, 'the failed step was not recorded when the run continued');
  ok(/insufficient funds/.test(bad[0].reason), 'the refusal reason was lost');
  ok(r.landed < r.attempted, 'a run with a failure reported every step as landed');
}

// ---- the injected halves are required ---------------------------------------
for (const [args, what] of [[{ send: () => landed('s') }, 'build'], [{ build: () => ({}) }, 'send']]) {
  checks += 1;
  await assert.rejects(() => runBootstrap({ ...args, log: quiet }), TypeError,
    `runBootstrap ran without a ${what} function`);
}

console.log(`ok - the sequence stops at the first step that did not land, and a signature is not landing (${checks} checks)`);
