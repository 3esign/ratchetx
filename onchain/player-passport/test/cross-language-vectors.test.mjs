import test from 'node:test';
import assert from 'node:assert/strict';
import { ZERO_HASH, sealCheckpoint } from '../src/checkpoint-v2.mjs';
import { buildAchievementTree, hashPlayerLeaf } from '../src/merkle.mjs';

const player = '8MmiTs9CoMT55gdFyCjM9issn9tsG1qVJCfgukYmeeVH';
const passportMint = '4J9Tqmiq4FhNVRpwqcw4xizkWtXT3HYRkugGQr4o2SpY';
const leaf = { player, lifetimeXp: 100, bestStreak: 2, shots: 5, podiumWins: 1, burned: 42 };

test('frozen Rust/JS binary vectors do not drift', () => {
  const stateRoot = buildAchievementTree([leaf]).root;
  assert.equal(hashPlayerLeaf(leaf), 'c0c0814a2b0f0558a0733e95c3da7fa473d8753fbd11babaab5734b8edc6baa8');
  assert.equal(stateRoot, 'c0c0814a2b0f0558a0733e95c3da7fa473d8753fbd11babaab5734b8edc6baa8');
  const checkpoint = sealCheckpoint({
    player, passportMint, sequence: 1, previousCheckpointHash: ZERO_HASH,
    logIndex: 100, logHead: '1'.repeat(64), stateRoot,
    snapshot: { ...leaf, epochDay: 20, checkpointUnix: 1_000 },
  });
  assert.equal(checkpoint.checkpointHash, '9e5bf28d3324e6ef59cf5081f34ad469ba40261c53553e30b77d5c175334ce9c');
});
