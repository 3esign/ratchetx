import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PublicKey } from '@solana/web3.js';
import {
  CORE_G2_PROGRAM_ID,
  CORE_G2_SCHEMA,
  SNAPSHOT_FORMAT_VERSION,
  SNAPSHOT_DOMAIN,
  LEGACY_LEAF_DOMAIN,
  LEGACY_NODE_DOMAIN,
  MAX_U64,
  buildLegacySnapshot,
  legacyLeafHash,
  legacyMerkleParent,
  verifyLegacyProof,
} from '../onchain/ratchet-core-g2/legacy-snapshot.mjs';

let checks = 0;
const equal = (actual, expected, label) => {
  checks++;
  assert.equal(actual, expected, label);
};
const same = (actual, expected, label) => {
  checks++;
  assert.deepEqual(actual, expected, label);
};
const ok = (actual, label) => {
  checks++;
  assert.ok(actual, label);
};
const throws = (fn, pattern, label) => {
  checks++;
  assert.throws(fn, pattern, label);
};

const sha256 = bytes => createHash('sha256').update(bytes).digest();
const le16 = value => {
  const out = Buffer.alloc(2); out.writeUInt16LE(value); return out;
};
const le64 = value => {
  const out = Buffer.alloc(8); out.writeBigUInt64LE(BigInt(value)); return out;
};

const PLAYER_A_BYTES = Buffer.alloc(32, 1);
const PLAYER_B_BYTES = Buffer.alloc(32, 2);
const PLAYER_C_BYTES = Buffer.alloc(32, 3);
const PLAYER_A = new PublicKey(PLAYER_A_BYTES).toBase58();
const PLAYER_B = new PublicKey(PLAYER_B_BYTES).toBase58();
const PLAYER_C = new PublicKey(PLAYER_C_BYTES).toBase58();
const CUTOVER = 987_654_321n;
const CLUSTER_GENESIS_HASH = Buffer.alloc(32, 0xa1);
const MIGRATION_ID = Buffer.alloc(32, 0xb2);
const snapshotOptions = (cutoverSlot = CUTOVER, overrides = {}) => ({
  cutoverSlot,
  clusterGenesisHash: CLUSTER_GENESIS_HASH,
  migrationId: MIGRATION_ID,
  ...overrides,
});

const ROWS = [
  { wallet: PLAYER_C, credits: '5', xp: 9n },
  { wallet: PLAYER_A, credits: 42, xp: '7' },
  // Deliberately above Number.MAX_SAFE_INTEGER: integer text must stay exact.
  { wallet: PLAYER_B, credits: '9007199254740993', xp: '123456789012345' },
];

const EXPECTED = {
  snapshot: '9949d8cc9b7f2425c5c87a414833ac5a59559f891c15e5f65a7a60ba589e94cf',
  root: 'c77c5f862a813c96b1ea94f97049d01cb9343cd8078cd728d9e23d035f76190e',
  leafA: '7b6e378a299c2adf0e6aee2fea20ec98cbd3766450260b6ae3d9568ca7743160',
  leafB: '3e9d9b02c113b036f78e2b2854a8ca6a3aa8af2838661b7cfd14ede7f10b7025',
  leafC: '09429b169d7abf09d49d14ee0cd6c74ca311499670a4affda8b8a7ec2e887f7f',
};

const built = buildLegacySnapshot(ROWS, snapshotOptions());
const coreState = readFileSync(new URL(
  '../onchain/ratchet-core-g2/programs/ratchet-core-g2/src/state.rs',
  import.meta.url,
), 'utf8');

// The immutable snapshot remains off-chain distribution evidence; after a
// successful Merkle proof, the permanent PlayerLedger is the sole on-chain
// replay tombstone. Pin that rent-minimal architecture alongside the bytes.
{
  ok(/pub legacy_credits: u64,/.test(coreState),
    'ledger permanently records migrated credits');
  ok(/pub legacy_xp: u64,/.test(coreState),
    'ledger permanently records migrated XP');
  ok(/credits > 0 \|\| xp > 0/.test(coreState),
    'zero-value legacy claims fail closed');
  ok(/ledger\.legacy_credits == 0 && ledger\.legacy_xp == 0/.test(coreState),
    'both ledger tombstones must be empty before the one claim');
  ok(!/pub struct LegacyClaim\b/.test(coreState),
    'no duplicate permanent LegacyClaim account remains');
  ok(!/pub struct ReloadReceipt\b/.test(coreState),
    'no standalone permanent ReloadReceipt remains');
  ok(!/pub struct CompletionReceipt\b/.test(coreState),
    'no old Core CompletionReceipt account remains');
  ok(!/pub struct DelegateRequestReceipt\b/.test(coreState),
    'canonical nonce replaces delegated request receipts');
  ok(!/pub struct DelegatedSealIntent\b/.test(coreState),
    'no duplicate delegated intent account remains');
  ok(/pub struct ReloadHistoryPage\b/.test(coreState),
    'reload audit history is retained in packed permanent pages');
}

// Fixed bytes and hashes make an accidental format change visible immediately.
{
  equal(CORE_G2_PROGRAM_ID, 'ANVGVtDrECeyQkS56UZ9ZiWCUxk2JWEVNJioFW8JEwbL',
    'builder defaults to the program ID declared by the Rust prototype');
  equal(CORE_G2_SCHEMA, 2, 'leaf schema is the Rust CORE_SCHEMA_VERSION');
  equal(SNAPSHOT_FORMAT_VERSION, 2, 'canonical snapshot format is explicitly versioned');
  equal(SNAPSHOT_DOMAIN.toString('hex'),
    '7263782d636f72653a6c65676163792d736e617073686f743a673200',
    'snapshot domain includes its terminal NUL byte');
  equal(LEGACY_LEAF_DOMAIN.toString('hex'),
    '7263782d636f72653a6c65676163792d6c6561663a673200',
    'leaf domain exactly matches Rust');
  equal(LEGACY_NODE_DOMAIN.toString('hex'),
    '7263782d636f72653a6c65676163792d6e6f64653a673200',
    'node domain exactly matches Rust');
  equal(built.canonicalBytes.length, 284, 'three rows have one exact binary length');
  equal(built.canonicalBytes.subarray(28, 30).toString('hex'), '0200',
    'format version is u16 little-endian');
  equal(built.canonicalBytes.subarray(30, 62).toString('hex'),
    '8b3a5756462d1956ea5cc57213b33102fb297208deb3a61e8d18511993cd6317',
    'program ID is raw bytes, not base58 text');
  equal(built.canonicalBytes.subarray(62, 64).toString('hex'), '0200',
    'Core schema is u16 little-endian');
  equal(built.canonicalBytes.subarray(64, 96).toString('hex'), 'a1'.repeat(32),
    'cluster genesis hash is an exact 32-byte identity');
  equal(built.canonicalBytes.subarray(96, 128).toString('hex'), 'b2'.repeat(32),
    'migration ID is an exact 32-byte identity');
  equal(built.canonicalBytes.subarray(128, 136).toString('hex'), 'b168de3a00000000',
    'cutover slot is u64 little-endian');
  equal(built.canonicalBytes.subarray(136, 140).toString('hex'), '03000000',
    'leaf count is u32 little-endian');
  equal(built.canonicalBytes.subarray(140, 172).toString('hex'), '01'.repeat(32),
    'first canonical row is the lowest raw public key');
  equal(built.manifest.cluster_genesis_hash, 'a1'.repeat(32),
    'manifest publishes the frozen cluster identity');
  equal(built.manifest.migration_id, 'b2'.repeat(32),
    'manifest publishes the frozen migration identity');
  equal(sha256(built.canonicalBytes).toString('hex'), EXPECTED.snapshot,
    'snapshot hash is SHA-256 of exactly the canonical bytes');
  equal(built.manifest.legacy_snapshot_hash, EXPECTED.snapshot,
    'manifest publishes the frozen snapshot hash');
  equal(built.manifest.legacy_root, EXPECTED.root,
    'manifest publishes the frozen Merkle root');
  same(built.manifest.claims.map(claim => claim.leaf),
    [EXPECTED.leafA, EXPECTED.leafB, EXPECTED.leafC],
    'frozen leaf vectors catch any Rust ABI drift');
}

// Independently spell the Rust hashv slices for one leaf.
{
  const rustSlices = Buffer.concat([
    Buffer.from('rcx-core:legacy-leaf:g2\0', 'ascii'),
    Buffer.from('8b3a5756462d1956ea5cc57213b33102fb297208deb3a61e8d18511993cd6317', 'hex'),
    le16(2),
    CLUSTER_GENESIS_HASH,
    MIGRATION_ID,
    Buffer.from(EXPECTED.snapshot, 'hex'),
    le64(CUTOVER),
    PLAYER_A_BYTES,
    le64(42n),
    le64(7n),
  ]);
  equal(sha256(rustSlices).toString('hex'), EXPECTED.leafA,
    'leaf binds program + schema + cluster + migration before snapshot + cutover + balance');
  equal(legacyLeafHash({
    clusterGenesisHash: CLUSTER_GENESIS_HASH,
    migrationId: MIGRATION_ID,
    snapshotHash: built.snapshotHash,
    cutoverSlot: CUTOVER,
    player: PLAYER_A,
    credits: 42n,
    xp: 7n,
  }).toString('hex'), EXPECTED.leafA, 'exported leaf helper matches the independent vector');
}

// Input order and JS integer representation have no effect on the artifact.
{
  const shuffled = buildLegacySnapshot([
    { wallet: Buffer.from(PLAYER_B_BYTES), credits: 9007199254740993n, xp: 123456789012345n },
    { wallet: PLAYER_C, credits: 5n, xp: 9 },
    { wallet: PLAYER_A_BYTES, credits: '42', xp: 7n },
  ], snapshotOptions(CUTOVER.toString()));
  equal(shuffled.manifestJson, built.manifestJson,
    'shuffled rows and equivalent integer forms produce byte-identical JSON');
  same(shuffled.canonicalBytes, built.canonicalBytes,
    'shuffled rows produce byte-identical canonical snapshot bytes');
  same(built.manifest.claims.map(claim => claim.wallet), [PLAYER_A, PLAYER_B, PLAYER_C],
    'manifest claims are sorted by raw public key bytes');
  equal(built.manifest.legacy_total_credits, '9007199254741040',
    'credit total remains exact above the JS safe-integer boundary');
  equal(built.manifest.legacy_total_xp, '123456789012361',
    'XP total is canonical unsigned decimal text');
  ok(built.manifestJson.endsWith('\n'), 'canonical manifest JSON has one final newline');
  ok(!/(created|generated|timestamp)/i.test(built.manifestJson),
    'reproducible manifest contains no wall-clock metadata');
}

// Every generated proof is directly consumable by Rust's sorted-pair fold.
{
  for (const claim of built.manifest.claims) {
    ok(verifyLegacyProof(claim.leaf, claim.proof, built.root),
      `proof verifies for sorted claim ${claim.index}`);
  }
  equal(built.manifest.claims[2].proof[0], built.manifest.claims[2].leaf,
    'an odd final node uses the explicit duplicate-self rule');
  same(legacyMerkleParent(Buffer.from(EXPECTED.leafA, 'hex'), Buffer.from(EXPECTED.leafB, 'hex')),
    legacyMerkleParent(Buffer.from(EXPECTED.leafB, 'hex'), Buffer.from(EXPECTED.leafA, 'hex')),
    'Merkle node hashing sorts each pair exactly as Rust does');

  const tamperedProof = built.manifest.claims[0].proof.map(value => Buffer.from(value, 'hex'));
  tamperedProof[0][0] ^= 1;
  ok(!verifyLegacyProof(EXPECTED.leafA, tamperedProof, built.root),
    'one changed proof byte cannot verify');
  const tamperedLeaf = legacyLeafHash({
    clusterGenesisHash: CLUSTER_GENESIS_HASH,
    migrationId: MIGRATION_ID,
    snapshotHash: built.snapshotHash,
    cutoverSlot: CUTOVER,
    player: PLAYER_A,
    credits: 43n,
    xp: 7n,
  });
  ok(!verifyLegacyProof(tamperedLeaf, built.manifest.claims[0].proof, built.root),
    'one changed balance cannot verify with the original proof');
}

// Cluster, migration, snapshot identity and cutover are all bound into every leaf.
{
  const anotherSnapshot = buildLegacySnapshot([
    ROWS[0], ROWS[1], { ...ROWS[2], xp: '123456789012346' },
  ], snapshotOptions());
  ok(!anotherSnapshot.snapshotHash.equals(built.snapshotHash),
    'changing one source row changes snapshot identity');
  const crossSnapshotLeaf = legacyLeafHash({
    clusterGenesisHash: CLUSTER_GENESIS_HASH,
    migrationId: MIGRATION_ID,
    snapshotHash: anotherSnapshot.snapshotHash,
    cutoverSlot: CUTOVER,
    player: PLAYER_A,
    credits: 42n,
    xp: 7n,
  });
  ok(!verifyLegacyProof(crossSnapshotLeaf, built.manifest.claims[0].proof, built.root),
    'proof cannot cross snapshot identity');

  const crossCutoverLeaf = legacyLeafHash({
    clusterGenesisHash: CLUSTER_GENESIS_HASH,
    migrationId: MIGRATION_ID,
    snapshotHash: built.snapshotHash,
    cutoverSlot: CUTOVER + 1n,
    player: PLAYER_A,
    credits: 42n,
    xp: 7n,
  });
  ok(!verifyLegacyProof(crossCutoverLeaf, built.manifest.claims[0].proof, built.root),
    'proof cannot cross cutover slot even if snapshot hash is held constant');
  const anotherCutover = buildLegacySnapshot(ROWS, snapshotOptions(CUTOVER + 1n));
  ok(!anotherCutover.snapshotHash.equals(built.snapshotHash),
    'canonical snapshot identity itself also commits the cutover slot');
  ok(!anotherCutover.root.equals(built.root),
    'changing cutover therefore changes the final root');

  const crossClusterLeaf = legacyLeafHash({
    clusterGenesisHash: Buffer.alloc(32, 0xa2),
    migrationId: MIGRATION_ID,
    snapshotHash: built.snapshotHash,
    cutoverSlot: CUTOVER,
    player: PLAYER_A,
    credits: 42n,
    xp: 7n,
  });
  ok(!verifyLegacyProof(crossClusterLeaf, built.manifest.claims[0].proof, built.root),
    'proof cannot cross cluster identity even if snapshot hash is held constant');
  const anotherCluster = buildLegacySnapshot(ROWS, snapshotOptions(CUTOVER, {
    clusterGenesisHash: Buffer.alloc(32, 0xa2),
  }));
  ok(!anotherCluster.snapshotHash.equals(built.snapshotHash),
    'canonical snapshot identity commits the cluster genesis hash');
  ok(!anotherCluster.root.equals(built.root),
    'changing cluster identity changes the final root');

  const crossMigrationLeaf = legacyLeafHash({
    clusterGenesisHash: CLUSTER_GENESIS_HASH,
    migrationId: Buffer.alloc(32, 0xb3),
    snapshotHash: built.snapshotHash,
    cutoverSlot: CUTOVER,
    player: PLAYER_A,
    credits: 42n,
    xp: 7n,
  });
  ok(!verifyLegacyProof(crossMigrationLeaf, built.manifest.claims[0].proof, built.root),
    'proof cannot cross migration identity even if snapshot hash is held constant');
  const anotherMigration = buildLegacySnapshot(ROWS, snapshotOptions(CUTOVER, {
    migrationId: Buffer.alloc(32, 0xb3),
  }));
  ok(!anotherMigration.snapshotHash.equals(built.snapshotHash),
    'canonical snapshot identity commits the migration ID');
  ok(!anotherMigration.root.equals(built.root),
    'changing migration identity changes the final root');
}

// One leaf is valid without an invented sibling; bad or ambiguous input fails closed.
{
  const single = buildLegacySnapshot([
    { wallet: PLAYER_A, credits: MAX_U64.toString(), xp: '0' },
  ], snapshotOptions(1n));
  equal(single.manifest.claims[0].proof.length, 0, 'single-leaf proof is empty');
  equal(single.manifest.legacy_root, single.manifest.claims[0].leaf,
    'single-leaf root is the leaf itself');
  ok(verifyLegacyProof(single.manifest.claims[0].leaf, [], single.root),
    'single-leaf claim verifies');

  throws(() => buildLegacySnapshot([
    { wallet: PLAYER_A, credits: 1, xp: 0 },
    { wallet: PLAYER_A_BYTES, credits: 2, xp: 0 },
  ], snapshotOptions(1)), /duplicate wallet/, 'duplicate raw wallet is rejected across input forms');
  throws(() => buildLegacySnapshot([
    { wallet: 'not-a-solana-key', credits: 1, xp: 0 },
  ], snapshotOptions(1)), /not a valid Solana public key/, 'invalid wallet is rejected');
  throws(() => buildLegacySnapshot([
    { wallet: Buffer.alloc(32), credits: 1, xp: 0 },
  ], snapshotOptions(1)), /default system address/, 'unclaimable zero wallet is rejected');
  throws(() => buildLegacySnapshot([
    { wallet: PLAYER_A, credits: -1, xp: 0 },
  ], snapshotOptions(1)), /outside its unsigned integer range/, 'negative credits are rejected');
  throws(() => buildLegacySnapshot([
    { wallet: PLAYER_A, credits: (MAX_U64 + 1n).toString(), xp: 0 },
  ], snapshotOptions(1)), /outside its unsigned integer range/, 'credits above u64 are rejected');
  throws(() => buildLegacySnapshot([
    { wallet: PLAYER_A, credits: Number.MAX_SAFE_INTEGER + 1, xp: 0 },
  ], snapshotOptions(1)), /safe integer/, 'unsafe JS numbers are rejected instead of rounded');
  throws(() => buildLegacySnapshot([
    { wallet: PLAYER_A, credits: 1, xp: '1.5' },
  ], snapshotOptions(1)), /unsigned decimal integer/, 'fractional XP is rejected');
  throws(() => buildLegacySnapshot([
    { wallet: PLAYER_A, credits: MAX_U64, xp: 0 },
    { wallet: PLAYER_B, credits: 1, xp: 0 },
  ], snapshotOptions(1)), /total credits exceeds u64/, 'aggregate credit overflow is rejected');
  throws(() => buildLegacySnapshot([], snapshotOptions(1)), /at least one claim/,
    'empty claim set is rejected');
  throws(() => buildLegacySnapshot([
    { wallet: PLAYER_A, credits: 0, xp: 0 },
  ], snapshotOptions(1)), /positive credits or XP total/, 'all-zero snapshot cannot enter Economy');
  throws(() => buildLegacySnapshot([
    { wallet: PLAYER_A, credits: 1, xp: 0 },
  ], snapshotOptions(0)), /must be positive/, 'zero cutover cannot enter Economy');
  throws(() => buildLegacySnapshot([
    { wallet: PLAYER_A, credits: 1, xp: 0 },
  ], { cutoverSlot: 1, migrationId: MIGRATION_ID }), /clusterGenesisHash/,
  'missing cluster identity is rejected');
  throws(() => buildLegacySnapshot([
    { wallet: PLAYER_A, credits: 1, xp: 0 },
  ], { cutoverSlot: 1, clusterGenesisHash: CLUSTER_GENESIS_HASH }), /migrationId/,
  'missing migration identity is rejected');
  throws(() => buildLegacySnapshot([
    { wallet: PLAYER_A, credits: 1, xp: 0 },
  ], snapshotOptions(1, { clusterGenesisHash: Buffer.alloc(32) })), /must not be all zero/,
  'zero cluster identity is rejected');
  throws(() => buildLegacySnapshot([
    { wallet: PLAYER_A, credits: 1, xp: 0 },
  ], snapshotOptions(1, { migrationId: Buffer.alloc(31, 1) })), /exactly 32 bytes/,
  'wrong-length migration identity is rejected');
}

console.log(`core g2 legacy snapshot: PASS (${checks} checks)`);
