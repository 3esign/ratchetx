import test from 'node:test';
import assert from 'node:assert/strict';
import { ZERO_HASH, checkpointMetadataV2, sealCheckpoint, validateCheckpointTransition, verifyCheckpoint } from '../src/checkpoint-v2.mjs';

const H1 = '1'.repeat(64), H2 = '2'.repeat(64), R1 = 'a'.repeat(64), R2 = 'b'.repeat(64);
const base = {
  player: 'player1111111111111111111111111111111111', passportMint: 'mint11111111111111111111111111111111111',
  sequence: 1, previousCheckpointHash: ZERO_HASH, logIndex: 100, logHead: H1, stateRoot: R1,
  snapshot: { lifetimeXp: 100, bestStreak: 2, shots: 5, podiumWins: 0, epochDay: 20, checkpointUnix: 1_000 },
};

test('v2 checkpoint is deterministic and self-verifying', () => {
  const checkpoint = sealCheckpoint(base);
  assert.equal(checkpoint.checkpointHash.length, 64);
  assert.equal(verifyCheckpoint(checkpoint), true);
  assert.equal(sealCheckpoint(base).checkpointHash, checkpoint.checkpointHash);
});

test('initial checkpoint requires sequence one and a zero previous hash', () => {
  assert.equal(validateCheckpointTransition(null, base, { nowUnix: 1_000 }).ok, true);
  const bad = validateCheckpointTransition(null, { ...base, sequence: 2 }, { nowUnix: 1_000 });
  assert.equal(bad.ok, false); assert.ok(bad.errors.includes('initial sequence must be 1'));
});

test('valid transition binds previous checkpoint, advancing log and monotonic state', () => {
  const previous = sealCheckpoint(base);
  const next = { ...base, sequence: 2, previousCheckpointHash: previous.checkpointHash, logIndex: 110,
    logHead: H2, stateRoot: R2,
    snapshot: { lifetimeXp: 140, bestStreak: 3, shots: 8, podiumWins: 1, epochDay: 21, checkpointUnix: 1_100 } };
  const verdict = validateCheckpointTransition(previous, next, { nowUnix: 1_100 });
  assert.equal(verdict.ok, true, verdict.errors.join(', '));
});

test('replay, fork, rollback and future timestamp are rejected', () => {
  const previous = sealCheckpoint(base);
  const bad = validateCheckpointTransition(previous, { ...base, sequence: 3,
    previousCheckpointHash: 'f'.repeat(64), logIndex: 100, logHead: H1, stateRoot: R2,
    snapshot: { lifetimeXp: 99, bestStreak: 1, shots: 4, podiumWins: 0, epochDay: 19, checkpointUnix: 2_000 },
  }, { nowUnix: 1_000, maxFutureSeconds: 5 });
  assert.equal(bad.ok, false);
  for (const reason of ['sequence must increment by one', 'previous checkpoint link mismatch', 'log index must increase',
    'log head must advance', 'lifetimeXp cannot decrease', 'checkpoint timestamp is too far in the future'])
    assert.ok(bad.errors.includes(reason), reason);
});

test('v2 metadata publishes provenance without a centralized URI', () => {
  const fields = checkpointMetadataV2(base);
  assert.equal(fields.get('ratchet.checkpoint_seq'), '00000000000000000001');
  assert.equal(fields.get('ratchet.log_head'), H1); assert.equal(fields.get('ratchet.state_root'), R1);
  assert.equal(fields.get('ratchet.prev_checkpoint_hash'), ZERO_HASH);
});
