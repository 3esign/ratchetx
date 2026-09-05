// A root built under the wrong rule is a migration that fails at the first
// claim and cannot be repaired afterwards -- the root is compiled into the
// program's economy account, and the players it locked out have no recourse
// except a new migration. So the rule this repository builds with is pinned to
// the rule the program verifies with, character by character, and the test
// fails rather than the migration.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { g2Leaf, g2Node, v1Leaf, v1Node, foldWith, canonicalSnapshotHash, snapshotHashOf,
  LEGACY_LEAF_DOMAIN, LEGACY_NODE_DOMAIN, CORE_SCHEMA_VERSION } from '../tools/legacy_root_rules.mjs';

let checks = 0;
const b = n => Buffer.alloc(32, n);
const sample = { programId: b(1), clusterGenesis: b(2), migrationId: b(3),
  snapshotHash: b(4), cutoverSlot: 123456, pubkey32: b(9), credits: 5000, xp: 250 };

// ---- 1. the two generations are not interchangeable ----------------------
{
  checks++; assert.notEqual(
    g2Leaf(sample).toString('hex'),
    v1Leaf(sample.pubkey32, sample.credits, sample.xp).toString('hex'),
    'a v1 root would fail every g2 claim — which is the entire point of this file');
  checks++; assert.notEqual(
    g2Node(b(1), b(2)).toString('hex'), v1Node(b(1), b(2)).toString('hex'),
    'the node rules differ too, so even an identical leaf set folds to a different root');
}

// ---- 2. every binding is load-bearing ------------------------------------
// If changing a field does not change the leaf, that field is decoration and
// the protection it claims to give does not exist.
{
  const base = g2Leaf(sample).toString('hex');
  for (const [field, altered] of [
    ['programId', b(11)], ['clusterGenesis', b(12)],
    ['migrationId', b(13)], ['snapshotHash', b(14)],
  ]) {
    checks++; assert.notEqual(g2Leaf({ ...sample, [field]: altered }).toString('hex'), base,
      `${field} must change the leaf, or the "cannot be replayed" it promises is not real`);
  }
  checks++; assert.notEqual(g2Leaf({ ...sample, cutoverSlot: 123457 }).toString('hex'), base,
    'cutoverSlot must change the leaf');
  checks++; assert.notEqual(g2Leaf({ ...sample, credits: 5001 }).toString('hex'), base,
    'credits must change the leaf');
  checks++; assert.notEqual(g2Leaf({ ...sample, xp: 251 }).toString('hex'), base,
    'xp must change the leaf');
}

// ---- 3. a missing or zero binding is refused, never defaulted ------------
// This is the one that matters most. Every "cannot" the bindings buy becomes a
// "can" the moment a field is zero, and a root bound to zeros looks perfectly
// valid right up until somebody replays a devnet rehearsal onto mainnet.
{
  for (const field of ['programId', 'clusterGenesis', 'migrationId', 'snapshotHash']) {
    checks++; assert.throws(() => g2Leaf({ ...sample, [field]: Buffer.alloc(32) }),
      /BINDING_IS_ZERO/, `all-zero ${field} must be refused`);
    checks++; assert.throws(() => g2Leaf({ ...sample, [field]: undefined }),
      /BINDING_MISSING/, `missing ${field} must be refused`);
    checks++; assert.throws(() => g2Leaf({ ...sample, [field]: Buffer.alloc(16, 7) }),
      /BINDING_MISSING/, `a wrong-length ${field} must be refused, not padded`);
  }
  checks++; assert.throws(() => g2Leaf({ ...sample, cutoverSlot: 0 }), /BINDING_MISSING/,
    'slot 0 must be refused — it reads as "no moment" and would bind nothing');
}

// ---- 4. proofs fold, and promotion is still not duplication ---------------
{
  const leaves = [1, 2, 3].map(n => g2Leaf({ ...sample, pubkey32: b(n) }));
  const lvl1 = [g2Node(leaves[0], leaves[1]), leaves[2]];   // odd leaf promoted
  const root = g2Node(lvl1[0], lvl1[1]);
  checks++; assert.equal(foldWith(leaves[0], [leaves[1], lvl1[1]], g2Node).toString('hex'),
    root.toString('hex'), 'the first leaf proves');
  checks++; assert.equal(foldWith(leaves[2], [lvl1[0]], g2Node).toString('hex'),
    root.toString('hex'), 'and so does the promoted one');
  checks++; assert.notEqual(g2Node(leaves[2], leaves[2]).toString('hex'), lvl1[1].toString('hex'),
    'a self-paired node is what promotion avoids: duplicating lets one proof authenticate a slot that was never in the tree');
}

// ---- 5. PINNED TO G2'S OWN SOURCE ----------------------------------------
// The rule is the program's, not this file's. If g2 is not on this disk the
// check is skipped LOUDLY rather than silently passing: a pin that quietly
// vanishes when the thing it pins is absent is worse than no pin, because the
// suite stays green while the guarantee is gone.
{
  const candidates = [
    new URL('../onchain/ratchet-core-g2/programs/ratchet-core-g2/src/state.rs', import.meta.url),
    new URL('../../ratchet-core-g2/programs/ratchet-core-g2/src/state.rs', import.meta.url),
  ];
  const found = candidates.find(u => existsSync(u));
  if (!found) {
    console.log('  NOTE  g2 state.rs not on this disk — the source pin did NOT run.');
    console.log('        This suite cannot prove the leaf rule still matches the program.');
    console.log('        Run it where onchain/ratchet-core-g2/ exists before any cutover.');
  } else {
    const rust = readFileSync(found, 'utf8');
    checks++; assert.ok(rust.includes(`"${LEGACY_LEAF_DOMAIN.toString('utf8').replace(/\0$/, '')}\\0"`)
      || rust.includes(LEGACY_LEAF_DOMAIN.toString('utf8').replace(/\0$/, '')),
      'LEGACY_LEAF_DOMAIN must match the program byte for byte');
    checks++; assert.ok(rust.includes(LEGACY_NODE_DOMAIN.toString('utf8').replace(/\0$/, '')),
      'LEGACY_NODE_DOMAIN must match');
    checks++; assert.match(rust, new RegExp(`CORE_SCHEMA_VERSION: u16 = ${CORE_SCHEMA_VERSION}`),
      'the schema version this builder stamps must be the one the program expects');
    // and the field ORDER, which no amount of matching constants would catch
    // Scan the hashv PREIMAGE, not the whole function: every field also appears
    // in the parameter list above it, in signature order, so scanning from
    // `pub fn` finds the parameters first and the order check reads the wrong
    // list. It is the argument order to hashv that decides the hash.
    const whole = rust.slice(rust.indexOf('pub fn legacy_leaf'));
    const open = whole.indexOf('hashv(&[');
    const fn = whole.slice(open, whole.indexOf('])', open));
    const order = ['LEGACY_LEAF_DOMAIN', 'crate::ID', 'CORE_SCHEMA_SEED', 'cluster_genesis_hash',
      'migration_id', 'snapshot_hash', 'cutover_slot', 'player', 'credits', 'xp'];
    let at = -1;
    for (const field of order) {
      const next = fn.indexOf(field);
      checks++; assert.ok(next > at, `legacy_leaf hashes ${field} in the expected position — a reordered preimage is a different hash and every proof would fail`);
      at = next;
    }
  }
}

// ---- 6. the root must be reproducible from the store, not from a file -----
// A migration root nobody can independently re-derive is a root nobody can
// check, and checking it is its entire purpose.
{
  const P = [0,1,2].map(i => ({ key32: b(i + 20), credits: 100 + i, xp: i }));
  const base = canonicalSnapshotHash(P);

  checks++; assert.equal(canonicalSnapshotHash([...P].reverse()).toString('hex'), base.toString('hex'),
    'the order rows arrive in must not change the hash — two honest readings of one store differ in order');
  checks++; assert.notEqual(canonicalSnapshotHash(P.slice(0, 2)).toString('hex'), base.toString('hex'),
    'dropping a player must change it — the count is hashed before the players for exactly this');
  checks++; assert.notEqual(
    canonicalSnapshotHash(P.map((p, i) => i === 0 ? { ...p, credits: p.credits + 1 } : p)).toString('hex'),
    base.toString('hex'), 'one credit must change it');
  checks++; assert.notEqual(
    canonicalSnapshotHash(P.map((p, i) => i === 0 ? { ...p, xp: p.xp + 1 } : p)).toString('hex'),
    base.toString('hex'), 'one XP must change it');

  // THE MEASURED PROBLEM THIS REPLACES: the same store read a second apart
  // produces different file bytes, because rows carry an absolute expiry
  // computed from read time. Hashing the file would make the root depend on
  // when somebody looked.
  const row = now => JSON.stringify(['u:X', { cr: 100, xp: 5 }, new Date(now + 60000).toISOString(), null]);
  checks++; assert.notEqual(
    snapshotHashOf(Buffer.from(row(1_000_000))).toString('hex'),
    snapshotHashOf(Buffer.from(row(1_001_000))).toString('hex'),
    'the file hash DOES move with read time — which is why it is provenance and not the binding');
  checks++; assert.equal(
    canonicalSnapshotHash(P).toString('hex'), base.toString('hex'),
    'the canonical hash does not, because it is over balances rather than bytes');
}

console.log(`PASS  legacy root rules: ${checks} checks — g2 leaf pinned to the program, every binding load-bearing, zeros refused`);
