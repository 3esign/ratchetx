import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PASSPORT_SCHEMA,
  buildPassportFields,
  canonicalSnapshot,
  checkpointUpdates,
  fixedUnsigned,
  hashSnapshot,
  shouldCheckpoint,
} from '../src/model.mjs';

const PLAYER = '11111111111111111111111111111111';

test('canonical snapshot uses fixed-width numeric fields', () => {
  const value = canonicalSnapshot({ lifetimeXp: 42, bestStreak: 7, shots: 99 });
  assert.equal(value.lifetimeXp, '00000000000000000042');
  assert.equal(value.bestStreak, '0000000007');
  assert.equal(value.shots, '00000000000000000099');
});

test('fixed-width encoding rejects negative and overflowing numbers', () => {
  assert.throws(() => fixedUnsigned(-1, 2), /non-negative/);
  assert.throws(() => fixedUnsigned(100, 2), /exceeds/);
});

test('passport metadata is deterministic and self-hashed', () => {
  const checkpoint = { lifetimeXp: 42, shots: 3, checkpointUnix: 1_787_350_400 };
  const fields = buildPassportFields({ player: PLAYER, checkpoint });
  assert.equal(fields.get('ratchet.schema'), PASSPORT_SCHEMA);
  assert.equal(fields.get('ratchet.player'), PLAYER);
  assert.equal(fields.get('ratchet.checkpoint_hash'), hashSnapshot(PLAYER, checkpoint));
  assert.equal(fields.get('ratchet.checkpoint_hash').length, 64);
});

test('checkpoint update list excludes immutable identity and schema fields', () => {
  const updates = checkpointUpdates({ player: PLAYER, checkpoint: { lifetimeXp: 10 } });
  const keys = updates.map(item => item.key);
  assert.equal(keys.length, 7);
  assert.ok(keys.includes('ratchet.lifetime_xp'));
  assert.ok(!keys.includes('ratchet.player'));
  assert.ok(!keys.includes('ratchet.schema'));
});

test('checkpoint policy ignores per-shot noise but captures durable boundaries', () => {
  const previous = { shots: 10, epochDay: 20, checkpointUnix: 100 };
  assert.deepEqual(
    shouldCheckpoint({ previous, next: { ...previous, shots: 11 }, nowUnix: 101 }),
    { yes: false, reason: 'no-durable-change' },
  );
  assert.deepEqual(
    shouldCheckpoint({ previous, next: { ...previous, epochDay: 21 }, nowUnix: 101 }),
    { yes: true, reason: 'daily-rollover' },
  );
  assert.deepEqual(
    shouldCheckpoint({ previous, next: { ...previous, podiumWins: 1 }, nowUnix: 101 }),
    { yes: true, reason: 'podium-milestone' },
  );
});
