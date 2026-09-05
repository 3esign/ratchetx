// Deterministic, offline legacy-ledger snapshot builder for Ratchet Core G2.
//
// Canonical snapshot bytes are exactly:
//   SNAPSHOT_DOMAIN
//   || format_version:u16_le
//   || core_program_id:[u8;32]
//   || core_schema:u16_le
//   || cluster_genesis_hash:[u8;32]
//   || migration_id:[u8;32]
//   || cutover_slot:u64_le
//   || leaf_count:u32_le
//   || repeated(player:[u8;32] || credits:u64_le || xp:u64_le)
//
// Rows in the repeated section are sorted by the unsigned lexicographic order
// of the raw 32-byte player public key. snapshot_hash is SHA-256 of those
// bytes. It intentionally excludes the Merkle root and proofs, avoiding a
// circular commitment while binding every balance, the program, schema,
// cluster, migration and cutover slot.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PublicKey } from '@solana/web3.js';

export const CORE_G2_PROGRAM_ID = 'cGfHiC6Kgg3FpFZvgwGcswsCRtp4aBP2fzuXRQPizuN';
export const CORE_G2_SCHEMA = 2;
export const SNAPSHOT_FORMAT_VERSION = 2;
export const SNAPSHOT_DOMAIN = Buffer.from('rcx-core:legacy-snapshot:g2\0', 'ascii');
export const LEGACY_LEAF_DOMAIN = Buffer.from('rcx-core:legacy-leaf:g2\0', 'ascii');
export const LEGACY_NODE_DOMAIN = Buffer.from('rcx-core:legacy-node:g2\0', 'ascii');
export const MAX_U64 = (1n << 64n) - 1n;
export const MAX_U32 = (1n << 32n) - 1n;
export const MAX_MERKLE_PROOF = 32;

export const CANONICAL_SNAPSHOT_LAYOUT = [
  'ascii("rcx-core:legacy-snapshot:g2\\0")',
  'format_version:u16_le',
  'core_program_id:[u8;32]',
  'core_schema:u16_le',
  'cluster_genesis_hash:[u8;32]',
  'migration_id:[u8;32]',
  'cutover_slot:u64_le',
  'leaf_count:u32_le',
  'rows_sorted_by_raw_player_bytes:[player:[u8;32],credits:u64_le,xp:u64_le]',
].join(' || ');

const sha256 = bytes => createHash('sha256').update(bytes).digest();

function fail(message) {
  throw new TypeError(message);
}

function bytesOfLength(value, length, label) {
  if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array))
    fail(`${label} must be ${length} raw bytes`);
  const out = Buffer.from(value);
  if (out.length !== length) fail(`${label} must be exactly ${length} bytes`);
  return out;
}

function hash32(value, label) {
  if (typeof value === 'string') {
    if (!/^[0-9a-fA-F]{64}$/.test(value)) fail(`${label} must be 32 bytes or 64 hex digits`);
    return Buffer.from(value, 'hex');
  }
  return bytesOfLength(value, 32, label);
}

function nonzeroIdentity32(value, label) {
  const identity = hash32(value, label);
  if (identity.equals(Buffer.alloc(32))) fail(label + ' must not be all zero');
  return identity;
}

function u16(value, label) {
  const parsed = normalizeUnsigned(value, 0xffffn, label);
  const out = Buffer.alloc(2);
  out.writeUInt16LE(Number(parsed));
  return out;
}

function u32(value, label) {
  const parsed = normalizeUnsigned(value, MAX_U32, label);
  const out = Buffer.alloc(4);
  out.writeUInt32LE(Number(parsed));
  return out;
}

function u64(value, label) {
  const parsed = normalizeUnsigned(value, MAX_U64, label);
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(parsed);
  return out;
}

export function normalizeUnsigned(value, maximum = MAX_U64, label = 'value') {
  let parsed;
  if (typeof value === 'bigint') {
    parsed = value;
  } else if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) fail(`${label} number must be a safe integer`);
    parsed = BigInt(value);
  } else if (typeof value === 'string') {
    if (!/^(0|[1-9][0-9]*)$/.test(value)) fail(`${label} must be an unsigned decimal integer`);
    parsed = BigInt(value);
  } else {
    fail(`${label} must be a bigint, safe integer, or unsigned decimal string`);
  }
  if (parsed < 0n || parsed > maximum) fail(`${label} is outside its unsigned integer range`);
  return parsed;
}

export function normalizePubkey(value, label = 'wallet') {
  let key;
  try {
    if (typeof value === 'string') {
      key = new PublicKey(value);
      if (key.toBase58() !== value) fail(`${label} must use canonical base58`);
    } else {
      key = new PublicKey(bytesOfLength(value, 32, label));
    }
  } catch (error) {
    if (error instanceof TypeError && String(error.message).startsWith(label)) throw error;
    fail(`${label} is not a valid Solana public key`);
  }
  const bytes = key.toBuffer();
  if (bytes.equals(Buffer.alloc(32))) fail(`${label} must not be the default system address`);
  return { bytes, base58: key.toBase58() };
}

function normalizeRows(rows) {
  if (!Array.isArray(rows)) fail('rows must be an array');
  if (rows.length === 0) fail('rows must contain at least one claim');
  if (BigInt(rows.length) > MAX_U32) fail('row count exceeds u32');

  const normalized = rows.map((row, sourceIndex) => {
    if (!row || typeof row !== 'object' || Array.isArray(row))
      fail(`rows[${sourceIndex}] must be an object`);
    const player = normalizePubkey(row.wallet, `rows[${sourceIndex}].wallet`);
    return {
      player: player.bytes,
      wallet: player.base58,
      credits: normalizeUnsigned(row.credits, MAX_U64, `rows[${sourceIndex}].credits`),
      xp: normalizeUnsigned(row.xp, MAX_U64, `rows[${sourceIndex}].xp`),
    };
  });

  normalized.sort((a, b) => Buffer.compare(a.player, b.player));
  for (let index = 1; index < normalized.length; index++) {
    if (normalized[index - 1].player.equals(normalized[index].player))
      fail(`duplicate wallet: ${normalized[index].wallet}`);
  }
  return normalized;
}

export function encodeCanonicalSnapshot(rows, {
  cutoverSlot,
  clusterGenesisHash,
  migrationId,
  programId = CORE_G2_PROGRAM_ID,
} = {}) {
  const normalizedRows = normalizeRows(rows);
  const coreProgram = normalizePubkey(programId, 'programId');
  const cluster = nonzeroIdentity32(clusterGenesisHash, 'clusterGenesisHash');
  const migration = nonzeroIdentity32(migrationId, 'migrationId');
  const slot = normalizeUnsigned(cutoverSlot, MAX_U64, 'cutoverSlot');
  if (slot === 0n) fail('cutoverSlot must be positive for a Core G2 legacy snapshot');

  const rowBytes = normalizedRows.map(row => Buffer.concat([
    row.player,
    u64(row.credits, 'credits'),
    u64(row.xp, 'xp'),
  ]));
  const bytes = Buffer.concat([
    SNAPSHOT_DOMAIN,
    u16(SNAPSHOT_FORMAT_VERSION, 'formatVersion'),
    coreProgram.bytes,
    u16(CORE_G2_SCHEMA, 'coreSchema'),
    cluster,
    migration,
    u64(slot, 'cutoverSlot'),
    u32(normalizedRows.length, 'leafCount'),
    ...rowBytes,
  ]);
  return {
    bytes,
    rows: normalizedRows,
    program: coreProgram,
    clusterGenesisHash: cluster,
    migrationId: migration,
    cutoverSlot: slot,
  };
}

// This is byte-for-byte the Rust state::legacy_leaf hashv call. hashv hashes
// concatenated slices, so a single Buffer.concat followed by SHA-256 is exact.
export function legacyLeafHash({
  clusterGenesisHash,
  migrationId,
  snapshotHash,
  cutoverSlot,
  player,
  credits,
  xp,
  programId = CORE_G2_PROGRAM_ID,
}) {
  const program = normalizePubkey(programId, 'programId').bytes;
  const playerBytes = normalizePubkey(player, 'player').bytes;
  const cluster = nonzeroIdentity32(clusterGenesisHash, 'clusterGenesisHash');
  const migration = nonzeroIdentity32(migrationId, 'migrationId');
  return sha256(Buffer.concat([
    LEGACY_LEAF_DOMAIN,
    program,
    u16(CORE_G2_SCHEMA, 'coreSchema'),
    cluster,
    migration,
    hash32(snapshotHash, 'snapshotHash'),
    u64(cutoverSlot, 'cutoverSlot'),
    playerBytes,
    u64(credits, 'credits'),
    u64(xp, 'xp'),
  ]));
}

export function legacyMerkleParent(left, right) {
  const a = hash32(left, 'left');
  const b = hash32(right, 'right');
  const pair = Buffer.compare(a, b) <= 0 ? [a, b] : [b, a];
  return sha256(Buffer.concat([LEGACY_NODE_DOMAIN, ...pair]));
}

export function verifyLegacyProof(leaf, proof, root) {
  if (!Array.isArray(proof)) fail('proof must be an array');
  if (proof.length > MAX_MERKLE_PROOF) fail('proof exceeds the Core G2 maximum depth');
  let node = hash32(leaf, 'leaf');
  for (const sibling of proof) node = legacyMerkleParent(node, sibling);
  return node.equals(hash32(root, 'root'));
}

function buildMerkleTree(leaves) {
  const levels = [leaves.map(leaf => Buffer.from(leaf))];
  while (levels.at(-1).length > 1) {
    const level = levels.at(-1);
    const parents = [];
    for (let index = 0; index < level.length; index += 2) {
      // An unpaired final node is paired with itself. This keeps every proof a
      // plain sequence accepted by the on-chain sorted-pair fold.
      const right = index + 1 < level.length ? level[index + 1] : level[index];
      parents.push(legacyMerkleParent(level[index], right));
    }
    levels.push(parents);
  }
  return levels;
}

function proofFor(levels, leafIndex) {
  const proof = [];
  let index = leafIndex;
  for (let depth = 0; depth < levels.length - 1; depth++) {
    const level = levels[depth];
    let sibling = index ^ 1;
    if (sibling >= level.length) sibling = index;
    proof.push(Buffer.from(level[sibling]));
    index = Math.floor(index / 2);
  }
  if (proof.length > MAX_MERKLE_PROOF)
    fail('snapshot produces proofs deeper than the Core G2 maximum');
  return proof;
}

function checkedTotal(rows, field) {
  let total = 0n;
  for (const row of rows) {
    total += row[field];
    if (total > MAX_U64) fail(`total ${field} exceeds u64`);
  }
  return total;
}

export function canonicalManifestJson(manifest) {
  return JSON.stringify(manifest, null, 2) + '\n';
}

export function buildLegacySnapshot(rows, options = {}) {
  const canonical = encodeCanonicalSnapshot(rows, options);
  const snapshotHash = sha256(canonical.bytes);
  const totalCredits = checkedTotal(canonical.rows, 'credits');
  const totalXp = checkedTotal(canonical.rows, 'xp');
  if (totalCredits === 0n && totalXp === 0n)
    fail('snapshot must contain a positive credits or XP total');

  const leaves = canonical.rows.map(row => legacyLeafHash({
    clusterGenesisHash: canonical.clusterGenesisHash,
    migrationId: canonical.migrationId,
    snapshotHash,
    cutoverSlot: canonical.cutoverSlot,
    player: row.player,
    credits: row.credits,
    xp: row.xp,
    programId: canonical.program.bytes,
  }));
  const levels = buildMerkleTree(leaves);
  const root = Buffer.from(levels.at(-1)[0]);
  const claims = canonical.rows.map((row, index) => ({
    index,
    wallet: row.wallet,
    player_hex: row.player.toString('hex'),
    credits: row.credits.toString(),
    xp: row.xp.toString(),
    leaf: leaves[index].toString('hex'),
    proof: proofFor(levels, index).map(value => value.toString('hex')),
  }));

  const manifest = {
    format: 'ratchetx-core-g2-legacy-snapshot',
    format_version: SNAPSHOT_FORMAT_VERSION,
    hash_algorithm: 'sha256',
    canonical_snapshot_layout: CANONICAL_SNAPSHOT_LAYOUT,
    canonical_snapshot_byte_length: canonical.bytes.length,
    merkle_pair_order: 'unsigned-byte-lexicographic',
    merkle_odd_node: 'duplicate-self',
    core_program_id: canonical.program.base58,
    core_schema_version: CORE_G2_SCHEMA,
    cluster_genesis_hash: canonical.clusterGenesisHash.toString('hex'),
    migration_id: canonical.migrationId.toString('hex'),
    legacy_cutover_slot: canonical.cutoverSlot.toString(),
    legacy_snapshot_hash: snapshotHash.toString('hex'),
    legacy_root: root.toString('hex'),
    legacy_leaf_count: claims.length,
    legacy_total_credits: totalCredits.toString(),
    legacy_total_xp: totalXp.toString(),
    claims,
  };

  return {
    canonicalBytes: Buffer.from(canonical.bytes),
    snapshotHash,
    root,
    manifest,
    manifestJson: canonicalManifestJson(manifest),
  };
}

function cli(argv) {
  const [inputPath, outputPath, ...unexpected] = argv;
  if (!inputPath || unexpected.length > 0) {
    throw new Error(
      'usage: node legacy-snapshot.mjs INPUT.json [OUTPUT.json]\n'
      + 'INPUT.json must be an object with rows, cutover_slot, '
      + 'cluster_genesis_hash and migration_id (each 64 hex digits)',
    );
  }
  const parsed = JSON.parse(readFileSync(resolve(inputPath), 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError(
      'v2 CLI input must be an object with rows, cutover_slot, '
      + 'cluster_genesis_hash and migration_id (each 64 hex digits)',
    );
  }
  const built = buildLegacySnapshot(parsed.rows, {
    cutoverSlot: parsed.cutover_slot ?? parsed.cutoverSlot,
    clusterGenesisHash: parsed.cluster_genesis_hash ?? parsed.clusterGenesisHash,
    migrationId: parsed.migration_id ?? parsed.migrationId,
  });
  if (outputPath) writeFileSync(resolve(outputPath), built.manifestJson, { encoding: 'utf8', flag: 'wx' });
  else process.stdout.write(built.manifestJson);
}

if (process.argv[1]
    && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    cli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`legacy snapshot failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
