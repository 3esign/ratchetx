#!/usr/bin/env node
// A compile receipt: evidence that THESE EXACT BYTES compiled, carried in the tree.
//
// The problem this solves is stated plainly. The machine where agents run the
// mainnet gate has no Rust toolchain (measured 2026-09-05: `cargo` is not on
// PATH in the device VM, and that VM has no network to install one). The machine
// that HAS a toolchain is a cloud container that does not hold the repository.
// So the gate could read source text and report GO on a program that does not
// compile - which is what happened on 2026-09-05, when M3 reported GO while the
// crate was six errors red.
//
// The bridge is not a promise, it is a hash. Whoever has a compiler runs this,
// and it records the sha256 of every file it compiled next to the exit codes.
// The gate then re-hashes those same files. If one byte moved, the receipt
// describes a different program and counts for nothing. A receipt can therefore
// be stale, but it can never be wrong about which source it is talking about.
//
//   node tools/compile-receipt.mjs            # regenerate both receipts
//   node tools/compile-receipt.mjs --verify   # only re-hash, run no compiler
//
// Compiling somewhere else (a cloud container, a laptop) is supported by
// pointing the crate at its root:
//   CORE_ROOT=~/cg TIMEPIN_ROOT=~/tp node tools/compile-receipt.mjs
// The hashes are keyed by path WITHIN the crate, so a receipt made anywhere
// verifies here.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

export const CRATES = [
  {
    name: 'ratchet-core-g2',
    repoPath: 'onchain/ratchet-core-g2/programs/ratchet-core-g2',
    workspace: 'onchain/ratchet-core-g2',
    rootEnv: 'CORE_ROOT',
    receipt: 'docs/receipts/compile-ratchet-core-g2.json',
  },
  {
    name: 'rcx-timepin-v2',
    repoPath: 'onchain/rcx-timepin-v2/programs/rcx-timepin-v2',
    workspace: 'onchain/rcx-timepin-v2',
    rootEnv: 'TIMEPIN_ROOT',
    receipt: 'docs/receipts/compile-rcx-timepin-v2.json',
  },
];

const sha256 = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

// The hashed set is the crate manifest plus every .rs file under src/. Cargo.lock
// is deliberately NOT hashed: it lives at workspace root, differs between a
// checkout and a scratch crate, and a lock change that does not change a source
// byte cannot change what the compiler is asked to compile from this tree.
export function hashCrate(crateDir) {
  const files = {};
  const manifest = path.join(crateDir, 'Cargo.toml');
  if (fs.existsSync(manifest)) files['Cargo.toml'] = sha256(manifest);
  const src = path.join(crateDir, 'src');
  if (fs.existsSync(src)) {
    for (const f of fs.readdirSync(src).filter(f => f.endsWith('.rs')).sort()) {
      files['src/' + f] = sha256(path.join(src, f));
    }
  }
  return files;
}

// Where the crate's sources live for THIS invocation. In the repository it is
// repoPath. Elsewhere, <root>/programs/<name>.
function crateDirFor(c) {
  const root = process.env[c.rootEnv];
  if (root) {
    const expanded = root.startsWith('~') ? path.join(process.env.HOME || '', root.slice(1)) : root;
    return path.join(expanded, 'programs', c.name);
  }
  return c.repoPath;
}

function parseTestSummary(out) {
  const m = /test result: \w+\. (\d+) passed; (\d+) failed/.exec(out);
  const failing = [...out.matchAll(/^---- (\S+) stdout ----$/gm)].map(x => x[1]);
  return m ? { passed: +m[1], failed: +m[2], failing } : { passed: null, failed: null, failing };
}

function generate() {
  const cargo = spawnSync('cargo', ['--version'], { encoding: 'utf8' });
  if (cargo.status !== 0) {
    console.error('[FAIL] no cargo on PATH. This tool WRITES evidence; it cannot invent it.');
    console.error('       Run it where a toolchain exists and commit the receipt it writes.');
    process.exit(2);
  }
  for (const c of CRATES) {
    const dir = crateDirFor(c);
    if (!fs.existsSync(dir)) { console.error(`[SKIP] ${c.name}: ${dir} not here`); continue; }
    // The workspace is the crate's parent-parent when running from a scratch root.
    const ws = process.env[c.rootEnv]
      ? path.resolve(dir, '..', '..')
      : c.workspace;
    const files = hashCrate(dir);
    const chk = spawnSync('cargo', ['check', '--lib'], { cwd: ws, encoding: 'utf8', timeout: 900000 });
    const tst = spawnSync('cargo', ['test', '--lib'], { cwd: ws, encoding: 'utf8', timeout: 900000 });
    const out = (tst.stdout || '') + (tst.stderr || '');
    const receipt = {
      receiptVersion: 1,
      crate: c.name,
      repoPath: c.repoPath,
      files,
      toolchain: (cargo.stdout || '').trim(),
      compiledOn: process.env.COMPILE_HOST || 'unspecified host',
      generatedAt: new Date().toISOString(),
      check: { exit: chk.status },
      test: { exit: tst.status, ...parseTestSummary(out) },
    };
    fs.mkdirSync(path.dirname(c.receipt), { recursive: true });
    fs.writeFileSync(c.receipt, JSON.stringify(receipt, null, 2) + '\n');
    console.log(`[WROTE] ${c.receipt}  check=${chk.status}  test=${tst.status} `
      + `(${receipt.test.passed} passed, ${receipt.test.failed} failed)`);
  }
}

// The half the gate calls. Reads the receipt, re-hashes the files it names, and
// says nothing at all about a program whose bytes have moved.
export function verifyCrate(c, readFile = f => fs.readFileSync(f)) {
  let receipt;
  try { receipt = JSON.parse(fs.readFileSync(c.receipt, 'utf8')); }
  catch { return { ok: false, reason: `no compile receipt at ${c.receipt}` }; }
  const drift = [];
  for (const [rel, want] of Object.entries(receipt.files || {})) {
    const p = path.join(c.repoPath, rel);
    if (!fs.existsSync(p)) { drift.push(`${rel} MISSING`); continue; }
    if (sha256(p) !== want) drift.push(rel);
  }
  const now = hashCrate(c.repoPath);
  for (const rel of Object.keys(now)) {
    if (!(rel in (receipt.files || {}))) drift.push(`${rel} is new since the receipt`);
  }
  if (drift.length) return { ok: false, receipt, reason: `receipt describes different bytes: ${drift.join(', ')}` };
  return { ok: true, receipt };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes('--verify')) {
    let bad = 0;
    for (const c of CRATES) {
      const v = verifyCrate(c);
      if (!v.ok) { console.log(`[STALE] ${c.name}: ${v.reason}`); bad++; continue; }
      const t = v.receipt.test || {};
      console.log(`[FRESH] ${c.name}: check exit ${v.receipt.check?.exit}, `
        + `tests ${t.passed} passed / ${t.failed} failed, ${v.receipt.generatedAt}`);
      if (v.receipt.check?.exit !== 0 || t.failed) bad++;
    }
    process.exit(bad ? 1 : 0);
  }
  generate();
}
