#!/usr/bin/env node
// Build the legacy airdrop claim set for G2, from a snapshot, by the canonical
// format the devnet bootstrap declares and this tooling reproduces byte for byte
// against a claim the chain already accepted.
//
//   node tools/build-legacy-airdrop.mjs --snapshot merkle_tree.json \
//        --genesis <cluster genesis, base58 or hex> --cutover-slot <slot> \
//        --label "<what this migration is>" [--out <file.json>]
//
// It writes nothing without --out, and it prints the root, the snapshot hash and
// the totals so they can be read before anything is registered.
//
// THE MIGRATION ID IS DERIVED, NOT INVENTED. A migration id typed by a person is
// a value nobody can reproduce from the data, and every leaf binds it - so a
// mistyped one silently produces a tree whose proofs all fail. It is
// sha256("rcx-core:legacy-migration:g2\0" || core program id || cluster genesis
// || cutover slot || label), so the same snapshot, chain, slot and label always
// give the same migration, and a DIFFERENT label gives a different one on
// purpose: that is how a second migration over the same players is possible
// without colliding with the first.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { legacyLeaf, buildLegacyTree, foldProof, canonicalSnapshot, snapshotHash, bs58Decode } from './legacy_root_g2.mjs';

export const CORE_PROGRAM_ID = 'ANVGVtDrECeyQkS56UZ9ZiWCUxk2JWEVNJioFW8JEwbL';
export const MIGRATION_DOMAIN = Buffer.from('rcx-core:legacy-migration:g2\0', 'latin1');

const u64 = v => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b; };
// Accepts what the three callers actually hold: raw bytes, 64 hex characters, or
// base58. Buffers pass through FIRST - a Buffer fails the hex test and then gets
// fed to a base58 decoder character by character, which is how the second run of
// this tool produced "not base58: <mojibake>".
const asBytes32 = v => {
  if (Buffer.isBuffer(v)) return v;
  if (v instanceof Uint8Array) return Buffer.from(v);
  if (typeof v !== 'string') throw new TypeError(`expected bytes, hex or base58, got ${typeof v}`);
  return /^[0-9a-fA-F]{64}$/.test(v) ? Buffer.from(v, 'hex') : bs58Decode(v);
};

export function deriveMigrationId({ programId, clusterGenesisHash, cutoverSlot, label }) {
  if (!label || !String(label).trim()) {
    throw new Error('--label is required: a migration with no name cannot be told apart from the next one, '
      + 'and the label is what makes a second migration over the same players possible');
  }
  return createHash('sha256').update(Buffer.concat([
    MIGRATION_DOMAIN,
    asBytes32(programId),
    asBytes32(clusterGenesisHash),
    u64(cutoverSlot),
    Buffer.from(String(label), 'utf8'),
  ])).digest();
}

// A snapshot file may be a V1 merkle_tree.json (root/accounts/excluded) or a
// plain {address: {cr, xp}} map. The PROOFS in a V1 file are ignored on purpose:
// they were built by V1's rule and none of them verifies against G2.
export function readSnapshot(path) {
  const raw = JSON.parse(fs.readFileSync(path, 'utf8'));
  const accounts = raw.accounts ?? raw;
  const rows = Object.entries(accounts).map(([wallet, v]) => ({
    wallet,
    player: bs58Decode(wallet),
    credits: BigInt(v.cr ?? v.credits ?? 0),
    xp: BigInt(v.xp ?? 0),
  }));
  if (rows.length === 0) throw new Error(`${path} holds no accounts`);
  return { rows, excluded: raw.excluded ?? null, v1Root: raw.root ?? null };
}

export function buildLegacyAirdrop({ snapshotPath, clusterGenesisHash, cutoverSlot, label, programId = CORE_PROGRAM_ID }) {
  const { rows, excluded, v1Root } = readSnapshot(snapshotPath);
  // NORMALISED TO BYTES HERE, ONCE. A genesis hash arrives as base58 from the CLI
  // and as hex from a receipt; legacy_root_g2.mjs accepts only bytes or hex, so a
  // base58 string parsed as hex silently yields an EMPTY buffer and every leaf
  // would then bind nothing where the chain should be. Measured on the first run
  // of this tool: "clusterGenesisHash must be 32 bytes, got 0" - which is the
  // right refusal, and this is the right place to stop needing it.
  const genesis = asBytes32(clusterGenesisHash);
  const migrationId = deriveMigrationId({ programId, clusterGenesisHash: genesis, cutoverSlot, label });
  const args = { programId: asBytes32(programId), clusterGenesisHash: genesis, migrationId, cutoverSlot, rows };
  const canonical = canonicalSnapshot(args);
  const snapHash = snapshotHash(args);

  const ordered = canonical.rows;
  const leaves = ordered.map(r => legacyLeaf({
    programId: args.programId, clusterGenesisHash: genesis, migrationId,
    snapshotHash: snapHash, cutoverSlot, player: r.player, credits: r.credits, xp: r.xp,
  }));
  const tree = buildLegacyTree(leaves);

  const byBytes = new Map(rows.map(r => [r.player.toString('hex'), r.wallet]));
  const claims = ordered.map((r, i) => {
    const proof = tree.proofFor(i);
    // Verified here, every one, before the file exists. A claim set whose proofs
    // do not fold to its own root costs a player a reverted transaction to find.
    if (!foldProof(leaves[i], proof).equals(tree.root)) {
      throw new Error(`leaf ${i} does not fold to the root; the tree is not internally consistent`);
    }
    return {
      index: i,
      wallet: byBytes.get(r.player.toString('hex')),
      player_hex: r.player.toString('hex'),
      credits: r.credits.toString(),
      xp: r.xp.toString(),
      leaf: leaves[i].toString('hex'),
      proof: proof.map(p => p.toString('hex')),
    };
  });

  return {
    format: 'ratchetx-core-g2-legacy-snapshot',
    format_version: 2,
    hash_algorithm: 'sha256',
    merkle_pair_order: 'unsigned-byte-lexicographic',
    merkle_odd_node: 'duplicate-self',
    core_program_id: programId,
    core_schema_version: 2,
    cluster_genesis_hash: genesis.toString('hex'),
    migration_id: migrationId.toString('hex'),
    migration_label: label,
    legacy_cutover_slot: Number(cutoverSlot),
    legacy_snapshot_hash: snapHash.toString('hex'),
    legacy_root: tree.root.toString('hex'),
    legacy_leaf_count: claims.length,
    legacy_total_credits: claims.reduce((t, c) => t + BigInt(c.credits), 0n).toString(),
    legacy_total_xp: claims.reduce((t, c) => t + BigInt(c.xp), 0n).toString(),
    canonical_snapshot_byte_length: canonical.bytes.length,
    source: {
      file: snapshotPath,
      v1_root_ignored: v1Root,
      note: 'The V1 root and its proofs are recorded and IGNORED. They were built by V1\'s rule '
           + '(leaf = sha256(pubkey||credits||xp), no domains) and none of them verifies against G2.',
      excluded: excluded ?? undefined,
    },
    claims,
  };
}

export const isCliEntrypoint = (moduleUrl, argv1, toFileUrl = pathToFileURL) => {
  if (typeof argv1 !== 'string' || argv1 === '') return false;
  try { return moduleUrl === toFileUrl(argv1).href; } catch { return false; }
};

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  const arg = n => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? null : process.argv[i + 1]; };
  try {
    const out = buildLegacyAirdrop({
      snapshotPath: arg('snapshot') || 'merkle_tree.json',
      clusterGenesisHash: arg('genesis'),
      cutoverSlot: arg('cutover-slot'),
      label: arg('label'),
    });
    console.log(`root            ${out.legacy_root}`);
    console.log(`snapshot hash   ${out.legacy_snapshot_hash}`);
    console.log(`migration       ${out.migration_id}  (${out.migration_label})`);
    console.log(`leaves          ${out.legacy_leaf_count}`);
    console.log(`credits / xp    ${out.legacy_total_credits} / ${out.legacy_total_xp}`);
    console.log(`canonical bytes ${out.canonical_snapshot_byte_length}`);
    const dest = arg('out');
    if (dest) { fs.writeFileSync(dest, JSON.stringify(out, null, 2)); console.log(`written         ${dest}`); }
    else console.log('(no --out given, so nothing was written)');
  } catch (e) { console.error(String(e.message || e)); process.exit(1); }
}
