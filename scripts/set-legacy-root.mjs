// Writes the legacy Merkle root into the core program source as the compiled-in
// LEGACY_ROOT constant, and proves the root is what merkle_tree.json says:
// every proof in the file is re-verified here with the program's exact rule
// (leaf = sha256(wallet ‖ credits_le ‖ xp_le); node = sha256(sorted pair)),
// and the credits/XP totals are printed so they can be compared with the
// snapshot before the 4th build is even started.
//
//   node scripts/set-legacy-root.mjs [merkle_tree.json]
//
// Then: commit, push → the core-build workflow builds the 4th build, its
// sha256 goes into docs/CORE.md, the .so is deployed with the program's
// upgrade authority, and players claim once each with claim_legacy.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { PublicKey } from '@solana/web3.js';

const file = process.argv[2] || 'merkle_tree.json';
const LIB = 'onchain/ratchet-core/programs/ratchet-core/src/lib.rs';
const sha256 = b => crypto.createHash('sha256').update(b).digest();
const leafOf = (wallet, cr, xp) => { const c = Buffer.alloc(8); c.writeBigUInt64LE(BigInt(cr)); const x = Buffer.alloc(8); x.writeBigUInt64LE(BigInt(xp)); return sha256(Buffer.concat([new PublicKey(wallet).toBuffer(), c, x])); };
const fold = (leaf, proof) => proof.reduce((acc, hex) => { const el = Buffer.from(hex, 'hex'); return Buffer.compare(acc, el) <= 0 ? sha256(Buffer.concat([acc, el])) : sha256(Buffer.concat([el, acc])); }, leaf);

if (!fs.existsSync(file)) { console.error(`${file} not found — run LEGACY_ROOT.cmd (dump → reconcile → merkle) first`); process.exit(2); }
const tree = JSON.parse(fs.readFileSync(file, 'utf8'));
const root = Buffer.from(tree.root, 'hex');
if (root.length !== 32 || root.equals(Buffer.alloc(32))) { console.error('root is not a 32-byte non-zero hash'); process.exit(2); }

let n = 0, credits = 0n, xp = 0n, badProofs = 0;
// merkle_balances.json (reconcile's output) carries the open stake per wallet;
// the tree does not. A snapshot with open stake is a snapshot taken too early.
const staked = fs.existsSync('merkle_balances.json') ? JSON.parse(fs.readFileSync('merkle_balances.json', 'utf8')).filter(b => Number(b.staked) > 0).length : 0;
for (const [wallet, a] of Object.entries(tree.accounts)) {
  n++; credits += BigInt(a.cr); xp += BigInt(a.xp);
  if (!fold(leafOf(wallet, a.cr, a.xp), a.proof).equals(root)) { badProofs++; if (badProofs < 5) console.error(`proof does not reach the root: ${wallet}`); }
}
console.log(`root      ${tree.root}\naccounts  ${n}\ncredits   ${credits}\nxp        ${xp}\nbad proofs ${badProofs}`);
if (badProofs) { console.error('STOP: the tree is inconsistent; do not build from it'); process.exit(1); }
if (staked) { console.error(`STOP: ${staked} account(s) still carry open stake — settle or refund every open shot before the snapshot, or those credits are lost`); process.exit(1); }

const src = fs.readFileSync(LIB, 'utf8');
const literal = `pub const LEGACY_ROOT: [u8; 32] = [${[...root].map(b => `0x${b.toString(16).padStart(2, '0')}`).join(', ')}];`;
const re = /pub const LEGACY_ROOT: \[u8; 32\] = \[[^\]]*\];/;
if (!re.test(src)) { console.error(`LEGACY_ROOT constant not found in ${LIB}`); process.exit(1); }
const out = src.replace(re, literal);
fs.writeFileSync(LIB, out);
const check = out.match(re)[0];
console.log(`\nwritten to ${LIB}:\n${check}\n\nNext: git add ${LIB} && git commit -m "core 4th build: LEGACY_ROOT ${tree.root.slice(0, 16)}… (${n} accounts, ${credits} credits, ${xp} xp)" && git push\nCI (core-build) builds it; the committed artifact check will FAIL on purpose until the new .so is added under onchain/ratchet-core/artifacts/ — download it from the workflow run, add it, record its sha256 in docs/CORE.md, push again.`);
