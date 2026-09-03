// Build the legacy migration root from a rescued store snapshot.
//
// This replaces steps 1-3 of LEGACY_ROOT.cmd, which called three scripts that do
// not exist in this repository and never have (dump_kv.mjs, reconcile.mjs,
// merkle_generator.mjs). Only step 4, set-legacy-root.mjs, was ever written, and
// it is a VERIFIER: it folds proofs it is handed and patches the constant into
// lib.rs. Nothing built the tree. This does.
//
// THE RULE IS NOT MINE TO CHOOSE. It is compiled into the program at
// onchain/ratchet-core/programs/ratchet-core/src/lib.rs and must be matched
// exactly or every proof fails on chain:
//
//   leaf = sha256( pubkey[32] ‖ credits u64-LE ‖ xp u64-LE )        (lib.rs:474-479)
//   node = sha256( min(a,b) ‖ max(a,b) )   bytewise compare, <= on tie  (lib.rs:719-729)
//   proof = bare sibling hashes, no side flags, at most 32           (lib.rs:473)
//
// There is no domain separation on either. That is the program's rule as it
// stands; a leaf preimage is 48 bytes and a node's is 64, so the two cannot
// collide by length, but that is incidental rather than designed. Worth fixing in
// a future generation, not worth diverging from today.
//
// Note there are two OTHER Merkle rules in this repository and both are wrong for
// this job: buildSnapshotProof in tools/supabase_final_snapshot.mjs is
// domain-separated, positional and emits no proofs (it is a tamper-evidence digest
// over the whole table), and onchain/player-passport/src/merkle.mjs is the
// achievement tree, with its own domains and sided proofs. Neither will verify
// under the program's verify_proof.
//
// TWO THINGS THE PROGRAM DOES NOT SPECIFY, DECIDED HERE AND PINNED BY TESTS:
//
//   Leaf order: ascending by raw public key bytes. Verification is order-blind
//   because nodes sort their pair, but the BUILDER must commit to something or
//   two honest runs produce two different roots.
//
//   Odd level: promote the last node unchanged to the next level. The alternative
//   is duplicating it, which is common and which this file deliberately does not
//   do: a duplicated final leaf lets the same proof authenticate a position that
//   was never in the tree. Promotion has no such shape.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sha256 = (...parts) => crypto.createHash('sha256').update(Buffer.concat(parts)).digest();
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

// Base58 decode, enough to turn a Solana address into its 32 bytes. Written out
// rather than imported so this tool has no dependency it does not need: it must
// be runnable years from now from the archive bundle alone.
function base58Decode(text) {
  let n = 0n;
  for (const ch of text) {
    const digit = B58.indexOf(ch);
    if (digit < 0) throw new Error('not base58: ' + text.slice(0, 12));
    n = n * 58n + BigInt(digit);
  }
  const bytes = [];
  while (n > 0n) { bytes.unshift(Number(n & 0xffn)); n >>= 8n; }
  for (const ch of text) { if (ch !== '1') break; bytes.unshift(0); }
  return Buffer.from(bytes);
}

const u64le = value => {
  const big = BigInt(value);
  if (big < 0n || big > 0xffffffffffffffffn) throw new Error('u64 out of range: ' + value);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(big);
  return buffer;
};

export const leafOf = (wallet, credits, xp) => {
  const key = base58Decode(wallet);
  if (key.length !== 32) throw new Error('address is not 32 bytes: ' + wallet);
  return sha256(key, u64le(credits), u64le(xp));
};

export const pairUp = (a, b) => Buffer.compare(a, b) <= 0 ? sha256(a, b) : sha256(b, a);

/** The tree, level by level, keeping every level so proofs can be read off it. */
export function buildTree(leaves) {
  if (!leaves.length) throw new Error('EMPTY_TREE');
  const levels = [leaves];
  while (levels[levels.length - 1].length > 1) {
    const below = levels[levels.length - 1];
    const above = [];
    for (let i = 0; i < below.length; i += 2)
      above.push(i + 1 < below.length ? pairUp(below[i], below[i + 1]) : below[i]);
    levels.push(above);
  }
  return levels;
}

export function proofFor(levels, index) {
  const proof = [];
  let i = index;
  for (let level = 0; level < levels.length - 1; level++) {
    const sibling = i ^ 1;
    if (sibling < levels[level].length) proof.push(levels[level][sibling]);
    i >>= 1;                                   // a promoted node keeps its parent slot
  }
  return proof;
}

/** The verifier, identical in shape to the program's verify_proof and to the fold
 *  already in scripts/set-legacy-root.mjs. Every proof this tool emits is checked
 *  with it before the file is written -- a tree nobody verified is a rumour. */
export const foldProof = (leaf, proof) =>
  proof.reduce((accumulator, sibling) => pairUp(accumulator, sibling), leaf);

/** Turn snapshot rows into the (wallet, credits, xp) triples the leaf needs.
 *  Field names follow the conservation SQL in tools/supabase_final_snapshot.mjs,
 *  which is the only written statement of this schema: cr, xp, bal, open[]. */
export function reconcile(rows, { now = Date.now() } = {}) {
  const players = [];
  const problems = [];
  const seen = new Set();
  let skippedExpired = 0, openStake = 0, openShots = 0;

  for (const [key, value, expiresAt] of rows) {
    if (!key.startsWith('u:')) continue;
    if (expiresAt && Date.parse(expiresAt) <= now) { skippedExpired++; continue; }
    const wallet = key.slice(2);
    if (seen.has(wallet)) { problems.push('duplicate player row: ' + wallet.slice(0, 8) + '…'); continue; }
    seen.add(wallet);
    if (!value || typeof value !== 'object') { problems.push('player row is not an object: ' + wallet.slice(0, 8) + '…'); continue; }

    let key32;
    try { key32 = base58Decode(wallet); } catch { problems.push('address is not base58: ' + wallet.slice(0, 8) + '…'); continue; }
    if (key32.length !== 32) { problems.push('address is not 32 bytes: ' + wallet.slice(0, 8) + '…'); continue; }

    const credits = Number(value.cr ?? 0), xp = Number(value.xp ?? 0);
    if (!Number.isInteger(credits) || credits < 0) { problems.push('credits are not a non-negative integer: ' + wallet.slice(0, 8) + '…'); continue; }
    if (!Number.isInteger(xp) || xp < 0) { problems.push('xp is not a non-negative integer: ' + wallet.slice(0, 8) + '…'); continue; }

    // Open stake is credits already committed to a shot that has not settled. It
    // is NOT in `cr`, so a root built while shots are open under-counts somebody.
    const open = Array.isArray(value.open) ? value.open : [];
    for (const shot of open) {
      const stake = Number(shot && shot.stake);
      if (Number.isFinite(stake) && stake > 0) { openStake += stake; openShots++; }
    }
    players.push({ wallet, credits, xp, key32 });
  }

  players.sort((a, b) => Buffer.compare(a.key32, b.key32));
  return { players, problems, skippedExpired, openStake, openShots };
}

export function buildRoot(players) {
  const leaves = players.map(p => leafOf(p.wallet, p.credits, p.xp));
  const levels = buildTree(leaves);
  const root = levels[levels.length - 1][0];
  const accounts = {};
  players.forEach((p, index) => {
    const proof = proofFor(levels, index);
    if (!foldProof(leaves[index], proof).equals(root))
      throw new Error('SELF_CHECK_FAILED for ' + p.wallet);
    if (proof.length > 32) throw new Error('PROOF_TOO_LONG for ' + p.wallet);
    accounts[p.wallet] = { cr: p.credits, xp: p.xp, proof: proof.map(b => b.toString('hex')) };
  });
  return { root: root.toString('hex'), accounts, leafCount: leaves.length, depth: levels.length - 1 };
}

// ---------------------------------------------------------------------------
//  CLI
// ---------------------------------------------------------------------------
function privateRoot() {
  const base = process.platform === 'win32'
    ? process.env.LOCALAPPDATA
    : (process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'));
  if (!base || !path.isAbsolute(base)) throw new Error('PRIVATE_ROOT_UNAVAILABLE');
  return path.join(path.resolve(base), 'RatchetX', 'private-snapshots');
}

function newestSnapshot() {
  const root = privateRoot();
  const file = fs.readdirSync(root)
    .filter(name => /^legacy-kv-.*\.ndjson$/.test(name))
    .map(name => ({ name, at: fs.statSync(path.join(root, name)).mtimeMs }))
    .sort((a, b) => b.at - a.at)[0];
  if (!file) throw new Error('no rescue file in ' + root + ' — run SUPABASE_RESCUE.cmd first');
  return path.join(root, file.name);
}

// Run only when this file IS the entry point. `endsWith('legacy_root.mjs')` was
// true for test_legacy_root.mjs too, so importing the module ran the CLI and the
// test died looking for a snapshot directory.
const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const allowOpen = process.argv.includes('--allow-open-stake');
  const source = process.argv.find(a => a.endsWith('.ndjson')) || newestSnapshot();
  console.log('source   ' + source);

  const rows = [];
  for (const line of fs.readFileSync(source, 'utf8').split('\n')) {
    if (line.trim()) rows.push(JSON.parse(line));
  }
  const { players, problems, skippedExpired, openStake, openShots } = reconcile(rows);

  console.log('');
  console.log('  player rows          ' + String(players.length).padStart(7));
  console.log('  skipped, expired     ' + String(skippedExpired).padStart(7));
  console.log('  open shots           ' + String(openShots).padStart(7));
  console.log('  credits committed    ' + String(openStake).padStart(7) + '   (stake in flight, not in cr)');
  console.log('  credits              ' + String(players.reduce((s, p) => s + p.credits, 0)).padStart(7));
  console.log('  xp                   ' + String(players.reduce((s, p) => s + p.xp, 0)).padStart(7));

  if (problems.length) {
    console.log('');
    console.log('REFUSING: ' + problems.length + ' row(s) cannot be turned into a leaf:');
    for (const problem of problems.slice(0, 12)) console.log('   ' + problem);
    console.log('A root is a claim about every player. It cannot be built around the ones that did not parse.');
    process.exit(1);
  }
  if (openStake > 0 && !allowOpen) {
    console.log('');
    console.log('REFUSING: ' + openShots + ' shot(s) hold ' + openStake + ' credits that are not in anybody\'s cr.');
    console.log('Those players would migrate short by exactly that much. Settle or void them first,');
    console.log('or re-run with --allow-open-stake once you have decided who owns that stake and why.');
    process.exit(1);
  }

  const tree = buildRoot(players);
  console.log('');
  console.log('  leaves               ' + String(tree.leafCount).padStart(7));
  console.log('  depth                ' + String(tree.depth).padStart(7));
  console.log('  root                 ' + tree.root);
  console.log('');
  console.log('  every proof re-verified with the program\'s own fold before writing.');

  fs.writeFileSync('merkle_tree.json', JSON.stringify({ root: tree.root, accounts: tree.accounts }, null, 1) + '\n');
  fs.writeFileSync('merkle_balances.json', JSON.stringify(
    players.map(p => ({ wallet: p.wallet, cr: p.credits, xp: p.xp, staked: 0 })), null, 1) + '\n');
  console.log('  wrote merkle_tree.json and merkle_balances.json');
  console.log('');
  console.log('  next: node scripts/set-legacy-root.mjs merkle_tree.json');
}
