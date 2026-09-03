// The legacy root decides who owns what after the migration, so every property
// it depends on is pinned here rather than trusted.
//
// The most important test in this file is the first one. The tree is built by
// tools/legacy_root.mjs and verified on chain by verify_proof in lib.rs, with
// scripts/set-legacy-root.mjs mirroring that rule in JS as a third copy. Three
// implementations of one hash rule is exactly how a migration quietly produces a
// root nobody can claim against, so the leaf is checked against the canonical
// base58 decoder and the byte layout the program compiles in.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { leafOf, pairUp, buildTree, proofFor, foldProof, reconcile, buildRoot }
  from '../tools/legacy_root.mjs';

const require = createRequire(import.meta.url);
// An INDEPENDENT base58 implementation. The builder carries its own decoder so it
// can run years from now from the archive bundle with no dependency at all, and a
// decoder nobody cross-checked is exactly the kind of thing that mints a root
// nobody can claim against.
// @solana/web3.js is already a dependency of this project and carries its own
// base58, so the cross-check costs nothing and uses the same implementation the
// rest of the Solana ecosystem does.
const { PublicKey } = require('@solana/web3.js');
const toBuffer = wallet => new PublicKey(wallet).toBuffer();
const b58encode = bytes => new PublicKey(bytes).toBase58();
const sha256 = b => crypto.createHash('sha256').update(b).digest();

let checks = 0;
const wallets = Array.from({ length: 40 }, () => b58encode(crypto.randomBytes(32)));

// ---- 1. the leaf is the program's leaf ------------------------------------
{
  // The formula from scripts/set-legacy-root.mjs, which mirrors lib.rs:474-479.
  const canonical = (wallet, cr, xp) => {
    const c = Buffer.alloc(8); c.writeBigUInt64LE(BigInt(cr));
    const x = Buffer.alloc(8); x.writeBigUInt64LE(BigInt(xp));
    return sha256(Buffer.concat([toBuffer(wallet), c, x]));
  };
  for (const wallet of wallets.slice(0, 12)) {
    checks++;
    assert.ok(leafOf(wallet, 12345, 678).equals(canonical(wallet, 12345, 678)),
      'the builder and the on-chain rule must agree on the leaf, byte for byte');
  }
  checks++;
  assert.equal(leafOf(wallets[0], 0, 0).length, 32);
  // and the preimage really is 48 bytes: pubkey ‖ u64 ‖ u64
  checks++;
  assert.ok(leafOf(wallets[0], 1, 0).equals(
    sha256(Buffer.concat([toBuffer(wallets[0]),
      Buffer.from([1,0,0,0,0,0,0,0]), Buffer.alloc(8)]))),
    'credits are little-endian u64, not big-endian and not a string');
}

// ---- 2. every proof reaches the root, at every awkward size ---------------
for (const size of [1, 2, 3, 5, 8, 17, 64, 1000]) {
  const players = Array.from({ length: size }, (_, i) => {
    const wallet = i < wallets.length ? wallets[i] : b58encode(crypto.randomBytes(32));
    return { wallet, credits: i * 7, xp: i * 13, key32: toBuffer(wallet) };
  }).sort((a, b) => Buffer.compare(a.key32, b.key32));
  const tree = buildRoot(players);
  checks++;
  assert.equal(Object.keys(tree.accounts).length, size);
  for (const [wallet, account] of Object.entries(tree.accounts)) {
    const folded = foldProof(leafOf(wallet, account.cr, account.xp),
      account.proof.map(hex => Buffer.from(hex, 'hex')));
    assert.equal(folded.toString('hex'), tree.root, `proof fails for ${wallet} in a tree of ${size}`);
    assert.ok(account.proof.length <= 32, 'the program accepts at most 32 proof elements');
  }
  checks++;
  if (size === 1000) console.log(`  1000 players: depth ${tree.depth}, longest proof ${
    Math.max(...Object.values(tree.accounts).map(a => a.proof.length))} hashes`);
}

// ---- 3. the builder is deterministic, the verifier is order-blind ---------
{
  const rows = wallets.slice(0, 9).map((w, i) => ['u:' + w, { cr: 100 + i, xp: i }, null, null]);
  const a = buildRoot(reconcile(rows).players).root;
  const b = buildRoot(reconcile([...rows].reverse()).players).root;
  checks++; assert.equal(a, b, 'the same players in a different order must give the same root');
}

// ---- 4. and it notices a single changed credit ----------------------------
{
  const rows = wallets.slice(0, 6).map((w, i) => ['u:' + w, { cr: 100, xp: i }, null, null]);
  const before = buildRoot(reconcile(rows).players).root;
  rows[3][1] = { cr: 101, xp: 3 };
  const after = buildRoot(reconcile(rows).players).root;
  checks++; assert.notEqual(before, after, 'one credit must move the root');
}

// ---- 5. an odd level PROMOTES, it does not duplicate ----------------------
{
  // With three leaves, duplicating the last would give it a two-element proof
  // and make the tree authenticate a fourth position that never existed.
  const leaves = [Buffer.alloc(32, 1), Buffer.alloc(32, 2), Buffer.alloc(32, 3)];
  const levels = buildTree(leaves);
  checks++; assert.equal(levels.length, 3, 'three leaves make two levels above them');
  checks++; assert.equal(levels[1].length, 2, 'the odd leaf is promoted, not paired with itself');
  checks++; assert.ok(levels[1][1].equals(leaves[2]), 'promotion carries the node up unchanged');
  const root = levels[2][0];
  leaves.forEach((leaf, i) => {
    checks++;
    assert.ok(foldProof(leaf, proofFor(levels, i)).equals(root), 'promoted or not, every leaf proves');
  });
  checks++;
  assert.notEqual(pairUp(leaves[2], leaves[2]).toString('hex'), levels[1][1].toString('hex'),
    'a self-paired node is exactly what this construction avoids');
}

// ---- 6. reconcile refuses what it cannot turn into a leaf -----------------
{
  const good = 'u:' + wallets[0];
  const out = reconcile([
    [good, { cr: 10, xp: 2 }, null, null],
    ['g:day', { anything: true }, null, null],                       // not a player
    ['u:not-a-real-base58-address-!!!', { cr: 1, xp: 1 }, null, null],
    [good, { cr: 999, xp: 999 }, null, null],                        // duplicate
    ['u:' + wallets[1], { cr: 5, xp: 1, open: [{ stake: 250 }, { stake: 40 }] }, null, null],
    ['u:' + wallets[2], { cr: 1, xp: 1 }, '2020-01-01T00:00:00Z', null],   // expired
    ['u:' + wallets[3], { cr: -1, xp: 0 }, null, null],               // negative
    ['u:' + wallets[4], { cr: 1.5, xp: 0 }, null, null],              // not an integer
  ]);
  checks++; assert.equal(out.players.length, 2, 'only the two clean players become leaves');
  checks++; assert.equal(out.skippedExpired, 1);
  checks++; assert.equal(out.openStake, 290, 'stake in flight is counted, not silently dropped');
  checks++; assert.equal(out.openShots, 2);
  checks++; assert.equal(out.problems.length, 4, 'bad address, duplicate, negative and fractional');
  for (const problem of out.problems)
    assert.ok(!/[1-9A-HJ-NP-Za-km-z]{30,}/.test(problem), 'a problem line must not print a whole address');
}

// ---- 7. an empty tree is an error, not an all-zero root -------------------
{
  checks++;
  assert.throws(() => buildRoot([]), /EMPTY_TREE/,
    'the program treats an all-zero root as "no migration"; producing one by accident would be silent');
}

// ---- 8. a demo wallet is excluded by rule, not refused, and never silently ----
//
// The tool's stance -- "a root is a claim about every player, it cannot be built
// around the ones that did not parse" -- is right and stays. A demo wallet is
// not one of those. It is not an address at all: demo mode issues `demo-1ff` so
// somebody can try the game with no wallet, and no keypair anywhere could sign a
// claim for it. Refusing over them means no root can ever exist; dropping them
// quietly means a root that decided who counts without saying so.
{
  const real = 'HXFDaHyZ3i477z1BakiTWZg9UQN8rcreruuv9ifC1HvM';
  const out = reconcile([
    ['u:demo-1ff', { cr: 10, xp: 1 }, null, null],
    ['u:demo-009', { cr: 5, xp: 0 }, null, null],
    ['u:' + real, { cr: 100, xp: 20 }, null, null],
    ['u:not-a-wallet-0OIl', { cr: 1, xp: 1 }, null, null],
  ]);
  checks++; assert.equal(out.players.length, 1, 'the real wallet is the only leaf');
  checks++; assert.equal(out.excluded.length, 2, 'both demo wallets are excluded');
  checks++; assert.deepEqual(out.excluded.map(r => r.wallet), ['demo-009', 'demo-1ff'],
    'exclusions are sorted, so two honest runs list them the same way');
  checks++; assert.ok(out.excluded.every(r => /demo wallet/.test(r.reason)),
    'every exclusion carries the reason it was excluded');
  checks++; assert.equal(out.problems.length, 1,
    'an address that is malformed rather than a demo wallet still refuses the whole root');
  checks++; assert.match(out.problems[0], /not base58/);

  // The rule is the game's, not this tool's. If lib/verify.js ever changes what
  // counts as a demo wallet, this must follow it rather than keep its own copy.
  const src = readFileSync(new URL('../tools/legacy_root.mjs', import.meta.url), 'utf8');
  checks++; assert.match(src, /require\('\.\.\/lib\/verify\.js'\)/,
    'the demo rule must be imported from lib/verify.js, never restated here');
  checks++; assert.ok(!/startsWith\('demo-'\)/.test(src),
    'a second copy of a rule is how the Supabase import got five key families wrong');
}

console.log(`PASS  legacy root: ${checks} checks — leaf matches the program, every proof folds, promotion not duplication`);
