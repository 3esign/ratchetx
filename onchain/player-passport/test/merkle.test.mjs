import test from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_ROOT, buildAchievementTree, canonicalPlayerLeaf, verifyAchievementProof } from '../src/merkle.mjs';

const records = [
  { player: 'Charlie', lifetimeXp: 30, shots: 3, burned: 9 },
  { player: 'Alice', lifetimeXp: 10, shots: 1, burned: 3 },
  { player: 'Bob', lifetimeXp: 20, shots: 2, burned: 6 },
];

test('achievement root is deterministic regardless of input order', () => {
  const a = buildAchievementTree(records), b = buildAchievementTree([...records].reverse());
  assert.equal(a.root, b.root); assert.deepEqual(a.leaves.map(x => x.player), ['Alice', 'Bob', 'Charlie']);
});

test('every player receives a valid inclusion proof, including an odd final leaf', () => {
  const tree = buildAchievementTree(records);
  for (const record of records) assert.equal(verifyAchievementProof(record, tree.proofs.get(record.player), tree.root), true);
});

test('tampered achievement and proof are rejected', () => {
  const tree = buildAchievementTree(records), proof = tree.proofs.get('Alice');
  assert.equal(verifyAchievementProof({ ...records[1], lifetimeXp: 11 }, proof, tree.root), false);
  assert.equal(verifyAchievementProof(records[1], [{ ...proof[0], hash: 'f'.repeat(64) }, ...proof.slice(1)], tree.root), false);
});

test('duplicates are rejected and empty tree has an explicit domain root', () => {
  assert.throws(() => buildAchievementTree([records[0], records[0]]), /duplicate player/);
  assert.equal(buildAchievementTree([]).root, EMPTY_ROOT);
  assert.equal(canonicalPlayerLeaf({ player: 'A', shots: 2 }).shots, '00000000000000000002');
});
