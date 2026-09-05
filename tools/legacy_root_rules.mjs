// The two legacy-root rules, side by side, because there are now two programs
// and a root built under the wrong one is a migration that fails at the first
// claim and cannot be repaired afterwards.
//
// A ROOT IS NOT PORTABLE BETWEEN THEM. This is the whole reason this file
// exists as its own module rather than a flag inside the builder: the g2 rule
// is not "the old rule plus a prefix", it commits to six things the old one
// never mentioned, and a builder that quietly defaulted them would produce a
// root that verifies against nothing.
//
//   ratchet-core (generation 1, superseded)
//     leaf = sha256( pubkey ‖ credits_le ‖ xp_le )
//     node = sha256( min(a,b) ‖ max(a,b) )
//     No domain separation on either. Documented at the time as "worth fixing
//     in a future generation" -- this is that generation.
//
//   ratchet-core-g2 (current)
//     leaf = sha256( LEGACY_LEAF_DOMAIN ‖ program_id ‖ schema_le
//                    ‖ cluster_genesis ‖ migration_id ‖ snapshot_hash
//                    ‖ cutover_slot_le ‖ pubkey ‖ credits_le ‖ xp_le )
//     node = sha256( LEGACY_NODE_DOMAIN ‖ min(a,b) ‖ max(a,b) )
//
// What the six added fields buy, and why none of them may be defaulted:
//
//   program_id + schema   a root for one program generation cannot be replayed
//                         into another
//   cluster_genesis       a devnet rehearsal root cannot be claimed on mainnet
//   migration_id          a root from a cancelled migration cannot be revived
//   snapshot_hash         the root names the exact snapshot it came from
//   cutover_slot          and the exact moment
//
// Every one of those is a "cannot" that becomes a "can" the moment the field is
// zero. So `g2Leaf` REFUSES a missing or all-zero binding rather than filling
// one in. A root bound to zeros is a root bound to nothing, and it would look
// perfectly valid right up until somebody replayed it.
import crypto from 'node:crypto';

const sha256 = (...parts) => crypto.createHash('sha256').update(Buffer.concat(parts)).digest();

export const LEGACY_LEAF_DOMAIN = Buffer.from('rcx-core:legacy-leaf:g2\0', 'utf8');
export const LEGACY_NODE_DOMAIN = Buffer.from('rcx-core:legacy-node:g2\0', 'utf8');
export const CORE_SCHEMA_VERSION = 2;

const le = (value, bytes) => {
  const b = Buffer.alloc(bytes);
  if (bytes === 8) b.writeBigUInt64LE(BigInt(value));
  else b.writeUInt16LE(Number(value));
  return b;
};

const bound = (name, buf, len) => {
  if (!Buffer.isBuffer(buf) || buf.length !== len)
    throw new Error(`BINDING_MISSING ${name}: expected ${len} bytes`);
  if (buf.every(byte => byte === 0))
    throw new Error(`BINDING_IS_ZERO ${name}: a root bound to zeros is bound to nothing`);
  return buf;
};

/** Generation 1. Kept so a root built for `ratchet-core` can still be verified,
 *  never as a default. */
export const v1Leaf = (pubkey32, credits, xp) =>
  sha256(pubkey32, le(credits, 8), le(xp, 8));

export const v1Node = (a, b) =>
  Buffer.compare(a, b) <= 0 ? sha256(a, b) : sha256(b, a);

/** Generation 2, matching `legacy_leaf` in
 *  onchain/ratchet-core-g2/programs/ratchet-core-g2/src/state.rs. */
export function g2Leaf({ programId, clusterGenesis, migrationId, snapshotHash,
  cutoverSlot, pubkey32, credits, xp, schemaVersion = CORE_SCHEMA_VERSION }) {
  bound('programId', programId, 32);
  bound('clusterGenesis', clusterGenesis, 32);
  bound('migrationId', migrationId, 32);
  bound('snapshotHash', snapshotHash, 32);
  if (!Number.isInteger(Number(cutoverSlot)) || Number(cutoverSlot) <= 0)
    throw new Error('BINDING_MISSING cutoverSlot: a root must name the moment it was taken');
  if (!Buffer.isBuffer(pubkey32) || pubkey32.length !== 32)
    throw new Error('BAD_PUBKEY: expected 32 bytes');
  return sha256(
    LEGACY_LEAF_DOMAIN,
    programId,
    le(schemaVersion, 2),
    clusterGenesis,
    migrationId,
    snapshotHash,
    le(cutoverSlot, 8),
    pubkey32,
    le(credits, 8),
    le(xp, 8),
  );
}

export const g2Node = (a, b) =>
  Buffer.compare(a, b) <= 0
    ? sha256(LEGACY_NODE_DOMAIN, a, b)
    : sha256(LEGACY_NODE_DOMAIN, b, a);

/** The program's own fold, restated: a proof is bare sibling hashes with no
 *  side flags, so the sort decides the order at every level. */
export const foldWith = (node, proof, pair) => proof.reduce((acc, s) => pair(acc, s), node);

// ---------------------------------------------------------------------------
//  Clusters, by name rather than by pasted hash
// ---------------------------------------------------------------------------
// `cluster_genesis` is what stops a devnet rehearsal root being claimed on
// mainnet, so it is the field most worth getting right and the easiest to get
// wrong: one mistyped character in a base58 hash produces a root that binds to
// a cluster that does not exist, and nothing catches it until the claim.
//
// So the operator names a cluster and this file supplies the hash. Mainnet and
// devnet differ in 31 of their 32 bytes (mainnet and testnet in 32) -- near
// enough to total that no transposition turns one into the other, which is the
// property that matters: a rehearsal built with `--cluster devnet` cannot be
// replayed on mainnet even by someone holding the whole tree, and the mistake
// is impossible to make silently.
//
// The first version of this comment said "differ in every byte". They do not,
// and an overclaim in a safety note is worse than no note, because the next
// reader trusts it instead of checking.
export const CLUSTER_GENESIS = Object.freeze({
  mainnet: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
  devnet:  'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
  testnet: '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY',
});

/** Hash of the literal snapshot file. Kept for provenance -- it names one exact
 *  artifact -- but NOT what the root binds to. See below. */
export const snapshotHashOf = bytes =>
  crypto.createHash('sha256').update(bytes).digest();

export const SNAPSHOT_DOMAIN = Buffer.from('rcx-core:legacy-snapshot:g2\0', 'utf8');

/** THE HASH THE ROOT BINDS TO: the canonical balance set, not the file.
 *
 *  The obvious choice is to hash the snapshot file, and it is wrong. Rows carry
 *  `expiresAt` as an ABSOLUTE instant computed from `now + pttl` at read time --
 *  correct for the file, because a relative TTL written into a file stops being
 *  true the moment it is written, but it means the same store read one second
 *  apart produces different bytes. Measured: identical balances, two reads, two
 *  different hashes, therefore two different roots.
 *
 *  A migration root that cannot be reproduced from the store is a root nobody
 *  can independently check. Its whole value is that a player, or an auditor,
 *  can take their own reading and confirm the same answer. So the binding is
 *  over what the root is actually a claim ABOUT: every claimable wallet, its
 *  credits and its XP, in the same order the tree uses.
 *
 *  The count is hashed first. Without it a set and a truncated version of that
 *  set could in principle be argued over; with it, the preimage says how many
 *  players it is a claim about before it says who they are.
 *
 *  The file hash still belongs in merkle_tree.json as provenance -- it says
 *  which reading produced this root -- it just is not the thing bound into
 *  every leaf. */
export function canonicalSnapshotHash(players) {
  const sorted = [...players].sort((a, b) => Buffer.compare(a.key32, b.key32));
  const count = Buffer.alloc(4);
  count.writeUInt32LE(sorted.length);
  const parts = [SNAPSHOT_DOMAIN, count];
  for (const p of sorted) {
    const cr = Buffer.alloc(8); cr.writeBigUInt64LE(BigInt(p.credits));
    const xp = Buffer.alloc(8); xp.writeBigUInt64LE(BigInt(p.xp));
    parts.push(p.key32, cr, xp);
  }
  return crypto.createHash('sha256').update(Buffer.concat(parts)).digest();
}
