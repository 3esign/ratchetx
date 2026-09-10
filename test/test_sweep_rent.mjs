// The two predicates that decide whether somebody's rent moves.
//
// They live in ops/g2-crank/sweep-rent.mjs as exported functions rather than
// inside the sweep loop, for the same reason withinFeeBudget was pulled out of
// the keeper's watch loop: a rule that can only be reached by running the whole
// program against a live cluster is a rule with no test.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as web3 from '@solana/web3.js';
import { holdIsReleasable, needIsClosable, parseArgs } from '../ops/g2-crank/sweep-rent.mjs';

const CLOSE_DELAY = 7n * 24n * 60n * 60n;
const closed = { lamports: 0, data: Buffer.alloc(0), owner: web3.SystemProgram.programId };

test('a hold is releasable only when its holder account is really gone', () => {
  // The absence of the Shot is the whole proof. Only the program that owned that
  // account could have closed it, which is why no signature is needed and why
  // every near-miss below has to stay refused.
  assert.equal(holdIsReleasable(null), true);
  assert.equal(holdIsReleasable(closed), true);

  // Alive: still owned by Core.
  assert.equal(holdIsReleasable({ ...closed, owner: new web3.PublicKey(Buffer.alloc(32, 7)) }), false);
  // Emptied but still funded - a rent-exempt account that was merely zeroed is
  // not a closed one, and treating it as closed would release a live game's hold.
  assert.equal(holdIsReleasable({ ...closed, lamports: 1 }), false);
  // System-owned and unfunded, but carrying data: not the shape close leaves.
  assert.equal(holdIsReleasable({ ...closed, data: Buffer.alloc(1) }), false);
});

test('a Need closes only when terminal, unheld, and a week past its capture deadline', () => {
  const base = { state: 2, openRefs: 0, captureDeadlineTs: 1_000_000n };
  const ripe = Number(base.captureDeadlineTs + CLOSE_DELAY);

  assert.equal(needIsClosable(base, ripe).ok, true);
  assert.equal(needIsClosable({ ...base, state: 4 }, ripe).ok, true, 'an expired Need closes too');
  assert.equal(needIsClosable({ ...base, state: 3 }, ripe).ok, true, 'so does an ambiguous one');

  // Open and candidate are not terminal: a capture can still arrive.
  assert.equal(needIsClosable({ ...base, state: 0 }, ripe).ok, false);
  assert.equal(needIsClosable({ ...base, state: 1 }, ripe).ok, false);

  // THE COUNTER OUTRANKS THE CLOCK. A held Need does not close at any age - this
  // is the guarantee; the week is only a belt for games sealed before Core took
  // holds at all.
  assert.equal(needIsClosable({ ...base, openRefs: 1 }, ripe + 10_000_000).ok, false);

  // One second short, and the boundary itself.
  assert.equal(needIsClosable(base, ripe - 1).ok, false);
  assert.match(needIsClosable(base, ripe - 1).why, /delay/);
});

test('the sweep refuses to guess a cluster, an operator, or a signer', () => {
  assert.throws(() => parseArgs([]), /--rpc/);
  assert.throws(() => parseArgs(['--rpc', 'http://localhost:1']), /--operator/);
  assert.throws(() => parseArgs(['--rpc', 'http://localhost:1', '--operator', 'x', '--send']), /--keypair/);
  const ok = parseArgs(['--rpc', 'http://localhost:1', '--operator', 'x']);
  assert.equal(ok.send, undefined, 'dry-run is the default, and nothing else may be');
});
