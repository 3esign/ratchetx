// The legacy airdrop tree, built by G2's rule.
//
// tools/legacy_root.mjs builds one by V1's rule and its own header says so:
//   leaf = sha256(pubkey || credits || xp), node = sha256(min || max), no domains.
//
// G2 does not accept that, and merkle_tree.json - the snapshot rescued on
// 2026-09-05 - is a V1 tree. Its seventeen addresses, 4,017,817 credits and
// 20,260 XP are still the right DATA. Every proof in it fails on G2.
//
// G2's rule, read from onchain/ratchet-core-g2/.../state.rs:871 and :895:
//
//   leaf = sha256( LEGACY_LEAF_DOMAIN | program_id | CORE_SCHEMA_SEED
//                | cluster_genesis_hash | migration_id | snapshot_hash
//                | cutover_slot LE | player | credits LE | xp LE )
//   node = sha256( LEGACY_NODE_DOMAIN | min(a,b) | max(a,b) )   bytewise, <= on tie
//   proof = bare sibling hashes, no side flags, at most 32
//
// THE LEAF BINDS THE CLUSTER GENESIS HASH, AND THAT IS THE POINT. A devnet
// airdrop root cannot be replayed on mainnet: the same player, the same credits
// and the same proof produce a different leaf on a different chain. It also
// binds the migration id, the snapshot hash and the cutover slot, so a tree
// built for one migration cannot be re-used for another - which is what makes it
// safe to rehearse the whole claim flow on devnet.
import { createHash } from 'node:crypto';

export const LEGACY_LEAF_DOMAIN = Buffer.from('rcx-core:legacy-leaf:g2\0', 'latin1');
export const LEGACY_NODE_DOMAIN = Buffer.from('rcx-core:legacy-node:g2\0', 'latin1');
export const CORE_SCHEMA_VERSION = 2;
export const CORE_SCHEMA_SEED = Buffer.from([CORE_SCHEMA_VERSION & 0xff, (CORE_SCHEMA_VERSION >> 8) & 0xff]);
export const MAX_MERKLE_PROOF = 32;

const sha256 = (...parts) => createHash('sha256').update(Buffer.concat(parts)).digest();
const u64le = v => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b; };

const b32 = (value, what) => {
  const buf = typeof value === 'string' ? Buffer.from(value.replace(/^0x/, ''), 'hex') : Buffer.from(value);
  if (buf.length !== 32) throw new Error(`${what} must be 32 bytes, got ${buf.length}`);
  return buf;
};

export function legacyLeaf({ programId, clusterGenesisHash, migrationId, snapshotHash, cutoverSlot, player, credits, xp }) {
  return sha256(
    LEGACY_LEAF_DOMAIN,
    b32(programId, 'programId'),
    CORE_SCHEMA_SEED,
    b32(clusterGenesisHash, 'clusterGenesisHash'),
    b32(migrationId, 'migrationId'),
    b32(snapshotHash, 'snapshotHash'),
    u64le(cutoverSlot),
    b32(player, 'player'),
    u64le(credits),
    u64le(xp),
  );
}

export const legacyNode = (a, b) =>
  (Buffer.compare(a, b) <= 0 ? sha256(LEGACY_NODE_DOMAIN, a, b) : sha256(LEGACY_NODE_DOMAIN, b, a));

// The tree. Odd nodes are PROMOTED rather than duplicated: hashing a node with
// itself makes an interior node whose two children are equal, which is a shape a
// forged proof can imitate. Promotion cannot be imitated because it produces no
// hash at all.
export function buildLegacyTree(leaves) {
  if (!Array.isArray(leaves) || leaves.length === 0) {
    throw new Error('a legacy tree with no leaves is not a tree; an empty airdrop should be no airdrop');
  }
  const levels = [leaves.slice()];
  while (levels[levels.length - 1].length > 1) {
    const below = levels[levels.length - 1];
    const next = [];
    for (let i = 0; i < below.length; i += 2) {
      next.push(i + 1 < below.length ? legacyNode(below[i], below[i + 1]) : below[i]);
    }
    levels.push(next);
  }
  const root = levels[levels.length - 1][0];
  const proofFor = index => {
    if (!Number.isInteger(index) || index < 0 || index >= leaves.length) throw new Error(`no leaf at index ${index}`);
    const proof = [];
    let i = index;
    for (let level = 0; level < levels.length - 1; level += 1) {
      const sibling = i ^ 1;
      if (sibling < levels[level].length) proof.push(levels[level][sibling]);
      i = Math.floor(i / 2);
    }
    if (proof.length > MAX_MERKLE_PROOF) {
      throw new Error(`proof for leaf ${index} is ${proof.length} long and the program refuses more than ${MAX_MERKLE_PROOF}`);
    }
    return proof;
  };
  return { root, levels, proofFor, depth: levels.length - 1 };
}

// The program's own verification, so a tree can be checked here rather than by
// spending a transaction to find out.
export function foldProof(leaf, proof) {
  if (proof.length > MAX_MERKLE_PROOF) throw new Error('proof too long');
  return proof.reduce((node, sibling) => legacyNode(node, sibling), leaf);
}

export function buildAirdrop({ accounts, programId, clusterGenesisHash, migrationId, snapshotHash, cutoverSlot }) {
  const entries = Object.entries(accounts);
  if (entries.length === 0) throw new Error('no accounts in the snapshot');
  // Sorted by address so the same snapshot always produces the same root. An
  // unsorted tree is a root that depends on object key order, which is a
  // property nobody can reproduce from the data.
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  const leaves = entries.map(([player, v]) => legacyLeaf({
    programId, clusterGenesisHash, migrationId, snapshotHash, cutoverSlot,
    player: bs58Decode(player), credits: v.cr ?? v.credits ?? 0, xp: v.xp ?? 0,
  }));
  const tree = buildLegacyTree(leaves);
  const claims = entries.map(([player, v], i) => ({
    player,
    credits: Number(v.cr ?? v.credits ?? 0),
    xp: Number(v.xp ?? 0),
    proof: tree.proofFor(i).map(p => p.toString('hex')),
  }));
  // Verified here, every leaf, before anything is written. A tree whose own
  // proofs do not fold to its own root is not a tree.
  for (const [i, c] of claims.entries()) {
    const folded = foldProof(leaves[i], c.proof.map(h => Buffer.from(h, 'hex')));
    if (!folded.equals(tree.root)) throw new Error(`leaf ${i} (${c.player}) does not fold to the root`);
  }
  return {
    root: tree.root.toString('hex'),
    depth: tree.depth,
    leafCount: claims.length,
    totalCredits: claims.reduce((t, c) => t + c.credits, 0),
    totalXp: claims.reduce((t, c) => t + c.xp, 0),
    claims,
  };
}

// Minimal base58 decode, so this tool needs no dependency to read an address.
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function bs58Decode(str) {
  let num = 0n;
  for (const ch of str) {
    const v = B58.indexOf(ch);
    if (v < 0) throw new Error(`not base58: ${str}`);
    num = num * 58n + BigInt(v);
  }
  const bytes = [];
  while (num > 0n) { bytes.unshift(Number(num & 0xffn)); num >>= 8n; }
  for (const ch of str) { if (ch === '1') bytes.unshift(0); else break; }
  const out = Buffer.from(bytes);
  if (out.length !== 32) throw new Error(`${str} decodes to ${out.length} bytes, not a 32-byte address`);
  return out;
}
