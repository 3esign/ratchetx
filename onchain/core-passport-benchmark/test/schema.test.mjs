import test from 'node:test';
import assert from 'node:assert/strict';
import { authorityMap, canonicalPassportState, digestPassportState, encodePassportState, validateTransition } from '../src/schema.mjs';

const H0 = '0'.repeat(64), H1 = '1'.repeat(64), H2 = '2'.repeat(64), H3 = '3'.repeat(64);
const base = {
  player: '8MmiTs9CoMT55gdFyCjM9issn9tsG1qVJCfgukYmeeVH', sequence: 1,
  lifetimeXp: 100, bestStreak: 2, shots: 4, podiumWins: 0, burned: 500,
  epochDay: 20687, checkpointUnix: 1787424300, logIndex: 1096,
  previousCheckpointHash: H0, checkpointHash: H1, logHead: H2, stateRoot: H3,
};

test('schema is deterministic and JSON/DAS friendly', () => {
  const a = canonicalPassportState(base);
  assert.equal(JSON.parse(new TextDecoder().decode(encodePassportState(base))).player, base.player);
  assert.equal(digestPassportState(base), digestPassportState({ ...base }));
  assert.equal(a.lifetimeXp, '100');
});

test('authority map separates ownership, metadata and high-frequency state', () => {
  const map = authorityMap({ player: base.player, stateAuthority: 'RatchetStateAuthority11111111111111111111111' });
  assert.equal(map.owner, base.player);
  assert.notEqual(map.owner, map.appDataDataAuthority);
  assert.equal(map.assetUpdateAuthority, base.player);
});

test('valid transition advances sequence, log and monotonic counters', () => {
  const next = { ...base, sequence: 2, lifetimeXp: 101, logIndex: 1097, previousCheckpointHash: H1, checkpointHash: H2, logHead: H3 };
  assert.equal(validateTransition(base, next).sequence, '2');
});

test('invalid transitions are rejected before any transaction is built', () => {
  assert.throws(() => validateTransition(base, { ...base, sequence: 2, lifetimeXp: 99, previousCheckpointHash: H1, checkpointHash: H2, logHead: H3 }), /cannot decrease/);
  assert.throws(() => validateTransition(base, { ...base, sequence: 3, previousCheckpointHash: H1, checkpointHash: H2, logHead: H3 }), /exactly one/);
  assert.throws(() => validateTransition(base, { ...base, sequence: 2, previousCheckpointHash: H0, checkpointHash: H2, logHead: H3 }), /previous checkpoint/);
});
