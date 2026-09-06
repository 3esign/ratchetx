// The airdrop tree, by G2's rule rather than V1's.
//
// merkle_tree.json is a V1 tree: leaf = sha256(pubkey||credits||xp), no domains.
// G2's legacy_leaf binds the domain, the program id, the schema seed, THE
// CLUSTER GENESIS HASH, a migration id, the snapshot hash and the cutover slot.
// Every proof in that file fails on G2, and the whole point of this file is that
// the failure is found here rather than by a player whose claim reverts.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  legacyLeaf, legacyNode, buildLegacyTree, foldProof, buildAirdrop, bs58Decode,
  LEGACY_LEAF_DOMAIN, LEGACY_NODE_DOMAIN, CORE_SCHEMA_SEED, MAX_MERKLE_PROOF,
} from '../tools/legacy_root_g2.mjs';

let checks = 0;
const ok = (c, msg) => { checks += 1; assert.ok(c, msg); };
const eq = (a, b, msg) => { checks += 1; assert.equal(a, b, msg); };

const CORE = 'ANVGVtDrECeyQkS56UZ9ZiWCUxk2JWEVNJioFW8JEwbL';
const DEVNET = '5c3a9e2b'.repeat(8);
const MAINNET = 'aa11bb22'.repeat(8);
const MIGRATION = '04'.repeat(32);
const SNAPSHOT = '07'.repeat(32);
const base = {
  programId: bs58Decode(CORE), clusterGenesisHash: DEVNET,
  migrationId: MIGRATION, snapshotHash: SNAPSHOT, cutoverSlot: 493790839,
};

// ---- the domains are what they are in the Rust ------------------------------
eq(LEGACY_LEAF_DOMAIN.toString('latin1'), 'rcx-core:legacy-leaf:g2\0', 'the leaf domain drifted from state.rs:32');
eq(LEGACY_NODE_DOMAIN.toString('latin1'), 'rcx-core:legacy-node:g2\0', 'the node domain drifted from state.rs:33');
eq(CORE_SCHEMA_SEED.toString('hex'), '0200', 'CORE_SCHEMA_SEED is not schema 2 little-endian');

// ---- G2's leaf is NOT V1's, and that is the finding -------------------------
{
  const player = bs58Decode('wJYFx75hzP9h2ujQQ6mpJWLeYgPSUdLtuWjrw881rKz');
  const g2 = legacyLeaf({ ...base, player, credits: 630, xp: 50 });
  const v1 = createHash('sha256').update(Buffer.concat([
    player,
    Buffer.from([118, 2, 0, 0, 0, 0, 0, 0]),   // 630 LE
    Buffer.from([50, 0, 0, 0, 0, 0, 0, 0]),    // 50 LE
  ])).digest();
  ok(!g2.equals(v1),
    'G2 AND V1 PRODUCE THE SAME LEAF. If this ever passes, merkle_tree.json would work as-is and this whole '
    + 'file is unnecessary - which would be excellent news and should be checked, not assumed.');
  eq(g2.length, 32, 'the leaf is not 32 bytes');
}

// ---- the cluster binding, which is the safety property ----------------------
{
  const player = bs58Decode(CORE);
  const onDevnet = legacyLeaf({ ...base, player, credits: 100, xp: 1 });
  const onMainnet = legacyLeaf({ ...base, clusterGenesisHash: MAINNET, player, credits: 100, xp: 1 });
  ok(!onDevnet.equals(onMainnet),
    'THE SAME CLAIM PRODUCES THE SAME LEAF ON DEVNET AND MAINNET. That would make a devnet airdrop root '
    + 'replayable against real value, and it is the reason the whole flow can be rehearsed on devnet.');
  // The other three bindings matter for the same reason and are checked the same way.
  for (const [field, value] of [['migrationId', '09'.repeat(32)], ['snapshotHash', '0a'.repeat(32)], ['cutoverSlot', 1]]) {
    const other = legacyLeaf({ ...base, [field]: value, player, credits: 100, xp: 1 });
    ok(!onDevnet.equals(other), `changing ${field} did not change the leaf, so a tree can be reused across migrations`);
  }
  // And the payload itself, obviously.
  ok(!onDevnet.equals(legacyLeaf({ ...base, player, credits: 101, xp: 1 })), 'credits are not bound into the leaf');
  ok(!onDevnet.equals(legacyLeaf({ ...base, player, credits: 100, xp: 2 })), 'xp is not bound into the leaf');
}

// ---- the node rule is order-independent -------------------------------------
{
  const a = Buffer.alloc(32, 1), b = Buffer.alloc(32, 2);
  ok(legacyNode(a, b).equals(legacyNode(b, a)), 'the node rule is not commutative, so proof side flags would be needed');
  ok(!legacyNode(a, b).equals(createHash('sha256').update(Buffer.concat([a, b])).digest()),
    'the node hash has no domain separation, which is V1 behaviour');
}

// ---- every proof folds to the root ------------------------------------------
for (const n of [1, 2, 3, 4, 5, 7, 8, 17, 33]) {
  const leaves = Array.from({ length: n }, (_, i) => Buffer.alloc(32, i + 1));
  const tree = buildLegacyTree(leaves);
  for (let i = 0; i < n; i += 1) {
    checks += 1;
    assert.ok(foldProof(leaves[i], tree.proofFor(i)).equals(tree.root),
      `with ${n} leaves, leaf ${i} does not fold to the root - odd levels are where this breaks`);
  }
  ok(tree.proofFor(0).length <= MAX_MERKLE_PROOF, `a ${n}-leaf tree needs a proof longer than the program accepts`);
}

// ---- a forged claim does not fold -------------------------------------------
{
  const leaves = Array.from({ length: 5 }, (_, i) => Buffer.alloc(32, i + 1));
  const tree = buildLegacyTree(leaves);
  const forged = Buffer.alloc(32, 99);
  ok(!foldProof(forged, tree.proofFor(2)).equals(tree.root), 'a leaf that is not in the tree folded to the root');
}

checks += 1;
assert.throws(() => buildLegacyTree([]), /not a tree/, 'an empty tree was built; an empty airdrop should be no airdrop');

// ---- the whole snapshot, end to end -----------------------------------------
{
  const accounts = {
    'wJYFx75hzP9h2ujQQ6mpJWLeYgPSUdLtuWjrw881rKz': { cr: 630, xp: 50 },
    'ANVGVtDrECeyQkS56UZ9ZiWCUxk2JWEVNJioFW8JEwbL': { cr: 1812776, xp: 9000 },
    'C8wwxUGmoKAV22MaY3oW2Q6QeDbmB9dbNdbohsRjJkYp': { cr: 1709105, xp: 11210 },
  };
  const a = buildAirdrop({ ...base, accounts });
  eq(a.leafCount, 3, 'the airdrop lost an account');
  eq(a.totalCredits, 630 + 1812776 + 1709105, 'the credit total does not match the snapshot');
  eq(a.totalXp, 50 + 9000 + 11210, 'the xp total does not match the snapshot');
  ok(/^[0-9a-f]{64}$/.test(a.root), 'the root is not a 32-byte hex string');

  // Key ORDER must not change the root, or nobody can reproduce it from the data.
  const reordered = Object.fromEntries(Object.entries(accounts).reverse());
  eq(buildAirdrop({ ...base, accounts: reordered }).root, a.root,
    'the root depends on object key order, so it cannot be reproduced from the snapshot');

  // And the cluster changes it, at the whole-tree level too.
  ok(buildAirdrop({ ...base, clusterGenesisHash: MAINNET, accounts }).root !== a.root,
    'the airdrop root is identical on two different chains');
}

console.log(`ok - G2's tree is not V1's, and a devnet root cannot be replayed on mainnet (${checks} checks)`);
