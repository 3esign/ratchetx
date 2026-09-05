import assert from 'node:assert/strict';
import {
  STATE, NextPrintError, comparePrice, openNextPrint, observeNextPrint,
  timeoutNextPrint,
} from '../onchain/ratchet-next-print/model-v1.mjs';

const policy = Object.freeze({
  adapterId: 'PYTH_PUSH_V1',
  rulesetHash: 'next-print-v1-test',
  pythReceiver: 'PYTH_RECEIVER',
  feedIds: ['SOL', 'TSLA'],
  maxFutureSkewSec: 5,
  maxEntryAgeSec: 30,
  maxWaitSec: 7200,
  maxConfBps: 200,
});
const clock = (unixTimestamp, slot = 1000) => ({ unixTimestamp, slot });
const evidence = (overrides = {}) => ({
  owner: 'PYTH_RECEIVER',
  sourceAccount: 'SOL_SOURCE',
  expectedSourceAccount: 'SOL_SOURCE',
  writeAuthority: 'SOL_SOURCE',
  executable: false,
  dataLength: 134,
  verification: 'Full',
  feedId: 'SOL',
  price: 100_000_000n,
  conf: 10_000n,
  exponent: -8,
  publishTime: 1000,
  prevPublishTime: 990,
  postedSlot: 900n,
  ...overrides,
});
const open = (e = evidence()) => openNextPrint({
  player: 'PLAYER', nonce: 7, commit: 'ab'.repeat(32), evidence: e,
  policy, clock: clock(1001),
});
const code = (fn, wanted) => assert.throws(fn, e => e instanceof NextPrintError && e.code === wanted);

{
  const shot = open();
  assert.equal(shot.state, STATE.OPEN);
  assert.equal(shot.entry.publishTime, 1000);
  assert.equal(shot.deadline, 8201);
}

for (const [field, value, wanted] of [
  ['owner', 'OTHER', 'WRONG_RECEIVER_OWNER'],
  ['sourceAccount', 'OTHER', 'WRONG_SOURCE_PDA'],
  ['writeAuthority', 'OTHER', 'WRONG_WRITE_AUTHORITY'],
  ['dataLength', 133, 'BAD_PRICE_ACCOUNT_LENGTH'],
  ['verification', 'Partial', 'PARTIAL_VERIFICATION'],
  ['feedId', 'UNKNOWN', 'FEED_NOT_ALLOWED'],
]) code(() => open(evidence({ [field]: value })), wanted);

code(() => open(evidence({ publishTime: 970, prevPublishTime: 960 })), 'STALE_ENTRY');
code(() => open(evidence({ publishTime: 1007 })), 'ORACLE_TIME_IN_FUTURE');
code(() => open(evidence({ prevPublishTime: 1000 })), 'BAD_SOURCE_INTERVAL');
code(() => open(evidence({ postedSlot: 1001n })), 'POSTED_SLOT_IN_FUTURE');
code(() => open(evidence({ conf: 2_000_001n })), 'CONFIDENCE_TOO_WIDE');
code(() => openNextPrint({
  player: 'P', nonce: 1, commit: 'ab'.repeat(32), evidence: evidence(),
  policy: { ...policy, adapterId: 'MUTABLE_VENDOR_CHOICE' }, clock: clock(1001),
}), 'UNSUPPORTED_ADAPTER');

{
  const shot = open();
  assert.strictEqual(observeNextPrint(shot, evidence(), policy, clock(1002)), shot,
    'same immutable source print is a no-op');
  const captured = observeNextPrint(shot, evidence({
    price: 100_000_001n, prevPublishTime: 1000, publishTime: 1010, postedSlot: 910n,
  }), policy, clock(1010));
  assert.equal(captured.state, STATE.CAPTURED);
  assert.equal(captured.outcome, 'UP');
}

{
  const shot = open();
  const down = observeNextPrint(shot, evidence({
    price: 99_999_999n, prevPublishTime: 1000,
    publishTime: 1010, postedSlot: 910n,
  }), policy, clock(1010));
  assert.equal(down.outcome, 'DOWN');
  assert.equal(comparePrice({ price: 1n, exponent: 0 }, { price: 10n, exponent: -1 }), 0);
  const scale = observeNextPrint(shot, evidence({
    price: 999_999_999n, exponent: -9, prevPublishTime: 1000,
    publishTime: 1010, postedSlot: 910n,
  }), policy, clock(1010));
  assert.equal(scale.state, STATE.VOID_SCALE_CHANGE,
    'an oracle scale change cannot reinterpret an open shot');
}

{
  const shot = open();
  const equal = observeNextPrint(shot, evidence({
    prevPublishTime: 1000, publishTime: 1010, postedSlot: 910n,
  }), policy, clock(1010));
  assert.equal(equal.state, STATE.VOID_EQUAL);
}

{
  const shot = open();
  const missed = observeNextPrint(shot, evidence({
    price: 101_000_000n, prevPublishTime: 1010, publishTime: 1020, postedSlot: 920n,
  }), policy, clock(1020));
  assert.equal(missed.state, STATE.VOID_MISSED_SUCCESSOR,
    'a later favorable print cannot replace the direct successor');
}

{
  const shot = open();
  const revised = observeNextPrint(shot, evidence({ price: 100_000_001n }), policy, clock(1002));
  assert.equal(revised.state, STATE.VOID_SOURCE_REVISION);
  const broken = observeNextPrint(shot, evidence({
    prevPublishTime: 995, publishTime: 1010, postedSlot: 910n,
  }), policy, clock(1010));
  assert.equal(broken.state, STATE.VOID_SOURCE_CHAIN);
}

{
  const shot = open();
  code(() => timeoutNextPrint(shot, clock(8200)), 'DEADLINE_OPEN');
  assert.equal(timeoutNextPrint(shot, clock(8201)).state, STATE.VOID_TIMEOUT);
  code(() => timeoutNextPrint(timeoutNextPrint(shot, clock(8201)), clock(8202)), 'TERMINAL_SHOT');
}

{
  const stock = openNextPrint({
    player: 'P', nonce: 1, commit: 'cd'.repeat(32),
    evidence: evidence({
      feedId: 'TSLA', sourceAccount: 'TSLA_SOURCE',
      expectedSourceAccount: 'TSLA_SOURCE', writeAuthority: 'TSLA_SOURCE',
    }),
    policy, clock: clock(1001),
  });
  assert.equal(stock.entry.feedId, 'TSLA', 'a fresh pinned stock feed uses the same proof');
  code(() => observeNextPrint(stock, evidence({
    feedId: 'TSLA', sourceAccount: 'TSLA_SOURCE',
    expectedSourceAccount: 'TSLA_SOURCE', writeAuthority: 'TSLA_SOURCE',
    prevPublishTime: 1000, publishTime: 1010,
  }), { ...policy, adapterId: 'PYTH_PUSH_V2' }, clock(1010)), 'WRONG_ADAPTER');
}

console.log('PASS next-print v1: direct-successor selection, deterministic voids, exact boundaries and stock parity');
