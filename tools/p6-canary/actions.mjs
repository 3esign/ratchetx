// P6 canary — write-side scenarios over a pluggable ACTION ADAPTER.
//
// The canary never builds transactions itself. It drives scenarios through an adapter that the
// chain-only client (Astra: onchain/ratchet-core-g2/client/lifecycle-v2.mjs, tools/core-g2-recovery.mjs)
// implements. Until an adapter is wired, every scenario reports SKIPPED — never PASS.
//
// Adapter contract (all async, all return { sig, landed, error, readback } and NEVER throw on program errors):
//   adapter.clock()                         -> { slot, unixTimestamp }         (chain Clock, never Date.now)
//   adapter.readback(subjectKey)            -> { stateName, bytesSha256 }      (finalized)
//   adapter.submit(op, subjectKey, actor)   -> { sig, landed: bool, error: string|null }
//        op in: 'settle_final' | 'forfeit' | 'expire' | 'void_active_shot' | 'finalize_resolved_void' | 'claim' | 'refund'
//   adapter.deadline(subjectKey, op)        -> { unixTimestamp }               (the program's own deadline for op)
//   adapter.expectedReplayError(op)         -> string   (e.g. 'WrongState', 'VoucherNotFunded')
//   adapter.expectedEarlyError(op)          -> string   (e.g. 'DeadlineOpen' / 'BadTimepinDeadline' / 'TooEarly')
// Actors: { name, pubkey } — at least two distinct fee payers for the race scenario.

export const SCENARIOS = ['replay', 'race', 'rollback', 'timeout'];

const skipped = (name, why) => ({ scenario: name, status: 'SKIPPED', why });

// Replay: after a terminal op lands, re-submit the same op for the same subject. Must be rejected with the
// program's state error and the readback must be byte-identical.
export async function replay(adapter, { subject, op, actor }) {
  if (!adapter) return skipped('replay', 'no adapter wired');
  const first = await adapter.submit(op, subject, actor);
  if (!first.landed) return { scenario: 'replay', status: 'FAIL', why: `first ${op} did not land: ${first.error}` };
  const before = await adapter.readback(subject);
  const second = await adapter.submit(op, subject, actor);
  const after = await adapter.readback(subject);
  const expected = adapter.expectedReplayError(op);
  const ok = !second.landed && String(second.error || '').includes(expected) && before.bytesSha256 === after.bytesSha256;
  return { scenario: 'replay', status: ok ? 'PASS' : 'FAIL', first: first.sig, second: second.sig, secondError: second.error, expected, readbackUnchanged: before.bytesSha256 === after.bytesSha256 };
}

// Race: two actors submit the same permissionless op for the same subject. Exactly one lands; the other
// receives the expected state error; both readbacks are identical afterwards.
export async function race(adapter, { subject, op, actors }) {
  if (!adapter) return skipped('race', 'no adapter wired');
  if (!actors || actors.length < 2) return skipped('race', 'need two distinct actors');
  const results = await Promise.all(actors.slice(0, 2).map(a => adapter.submit(op, subject, a)));
  const landed = results.filter(r => r.landed).length;
  const expected = adapter.expectedReplayError(op);
  const losersOk = results.filter(r => !r.landed).every(r => String(r.error || '').includes(expected));
  const rb = await Promise.all(actors.slice(0, 2).map(() => adapter.readback(subject)));
  const identical = rb.every(x => x.bytesSha256 === rb[0].bytesSha256);
  const ok = landed === 1 && losersOk && identical;
  return { scenario: 'race', status: ok ? 'PASS' : 'FAIL', landed, losersOk, readbacksIdentical: identical, results };
}

// Rollback boundary: an op that must fail (wrong state / wrong kind) leaves the subject byte-identical.
export async function rollback(adapter, { subject, op, actor }) {
  if (!adapter) return skipped('rollback', 'no adapter wired');
  const before = await adapter.readback(subject);
  const r = await adapter.submit(op, subject, actor);
  const after = await adapter.readback(subject);
  const ok = !r.landed && before.bytesSha256 === after.bytesSha256;
  return { scenario: 'rollback', status: ok ? 'PASS' : 'FAIL', landed: r.landed, error: r.error, readbackUnchanged: before.bytesSha256 === after.bytesSha256 };
}

// Timeout paths are gated by the chain Clock: one second before the program's deadline the op must be
// rejected with the early error; at/after the deadline it must land. Local wall-clock is never consulted.
export async function timeout(adapter, { subject, op, actor, waitUntil }) {
  if (!adapter) return skipped('timeout', 'no adapter wired');
  const { unixTimestamp: deadline } = await adapter.deadline(subject, op);
  let clock = await adapter.clock();
  if (clock.unixTimestamp >= deadline) return skipped('timeout', 'deadline already passed before the early probe; pick a fresher subject');
  const early = await adapter.submit(op, subject, actor);
  const expectedEarly = adapter.expectedEarlyError(op);
  const earlyOk = !early.landed && String(early.error || '').includes(expectedEarly);
  await waitUntil(deadline);                      // caller polls adapter.clock(); never sleeps on wall time
  clock = await adapter.clock();
  const late = await adapter.submit(op, subject, actor);
  const ok = earlyOk && late.landed && clock.unixTimestamp >= deadline;
  return { scenario: 'timeout', status: ok ? 'PASS' : 'FAIL', deadline, earlyLanded: early.landed, earlyError: early.error, expectedEarly, lateLanded: late.landed, lateClock: clock.unixTimestamp };
}

export function foldScenario(counters, result) {
  if (result.status === 'SKIPPED') return;
  counters.writeSideWired = true;
  if (result.scenario === 'replay' && result.status === 'FAIL') counters.replayAccepted += 1;
  if (result.scenario === 'race' && result.status === 'FAIL') counters.raceDoubleLand += 1;
  if (result.scenario === 'rollback' && result.status === 'FAIL') counters.rollbackLeak += 1;
  if (result.scenario === 'timeout' && result.status === 'FAIL') counters.earlyTimeoutAccepted += 1;
}
