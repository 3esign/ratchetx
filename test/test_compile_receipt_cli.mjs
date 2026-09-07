// Exercise the real CLI in a temporary repository. No Cargo invocation or
// production receipt is needed: --verify reads only these synthetic fixtures.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const toolSource = fs.readFileSync(new URL('../tools/compile-receipt.mjs', import.meta.url));
const crates = ['ratchet-core-g2', 'rcx-timepin-v2'];
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const PREFIX = 'ratchetx-compile-receipt-';

function fixture(t) {
  // Spaces, # and % need URL encoding on POSIX too; on Windows the drive and
  // backslashes additionally make `file://${argv[1]}` fail to enter the CLI.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), PREFIX + 'space # % '));
  t.after(() => {
    const target = path.resolve(dir), tempRoot = path.resolve(os.tmpdir());
    const relative = path.relative(tempRoot, target);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative)
      && path.basename(target).startsWith(PREFIX), 'cleanup is confined to this temporary fixture');
    fs.rmSync(target, { recursive:true, force:true });
  });
  const tool = path.join(dir, 'compile-receipt.mjs');
  fs.writeFileSync(tool, toolSource);
  const receiptPaths = [];
  const sources = [];
  for (const name of crates) {
    const repoPath = `onchain/${name}/programs/${name}`;
    const source = path.join(dir, repoPath, 'src', 'lib.rs');
    fs.mkdirSync(path.dirname(source), { recursive:true });
    const manifest = `[package]\nname = "${name}"\nversion = "0.0.0"\nedition = "2021"\n`;
    const lib = '#[test]\nfn fixture_positive() { assert_eq!(2 + 2, 4); }\n';
    fs.writeFileSync(path.join(dir, repoPath, 'Cargo.toml'), manifest);
    fs.writeFileSync(source, lib);
    const receipt = {
      receiptVersion:1, crate:name, repoPath,
      files:{ 'Cargo.toml':sha(manifest), 'src/lib.rs':sha(lib) },
      toolchain:'synthetic fixture; Cargo is never executed',
      compiledOn:'CLI regression fixture', generatedAt:'2026-09-05T00:00:00.000Z',
      check:{ exit:0 }, test:{ exit:0, passed:1, failed:0, failing:[], passing:['fixture_positive'] },
    };
    const receiptPath = path.join(dir, `docs/receipts/compile-${name}.json`);
    fs.mkdirSync(path.dirname(receiptPath), { recursive:true });
    fs.writeFileSync(receiptPath, JSON.stringify(receipt));
    receiptPaths.push(receiptPath);
    sources.push(source);
  }
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === 'path' || key === 'CORE_ROOT' || key === 'TIMEPIN_ROOT') delete env[key];
  }
  // An accidental generate() call cannot find a compiler, even on the build host.
  env.PATH = path.join(dir, 'no-cargo-here');
  return { dir, tool, receiptPaths, sources, env };
}

function changeReceipt(f, mutate, index = 0) {
  const receiptPath = f.receiptPaths[index];
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  mutate(receipt);
  fs.writeFileSync(receiptPath, JSON.stringify(receipt));
}

function verify(f) {
  const readReceipts = () => f.receiptPaths.map(p => fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null);
  const before = readReceipts();
  const result = spawnSync(process.execPath, [f.tool, '--verify'], {
    cwd:f.dir, env:f.env, encoding:'utf8', windowsHide:true, timeout:15_000,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  assert.deepEqual(readReceipts(), before, '--verify must never generate or rewrite a receipt');
  assert.doesNotMatch(result.stdout + result.stderr, /\[WROTE\]|no cargo on PATH/);
  return result;
}

test('compile-receipt CLI executes from an encoded path and accepts fresh passing evidence', t => {
  const result = verify(fixture(t));
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /\[FRESH\] ratchet-core-g2:/);
  assert.match(result.stdout, /\[FRESH\] rcx-timepin-v2:/);
  assert.equal((result.stdout.match(/\[FRESH\]/g) || []).length, 2, 'both crates were checked');
});

test('importing compile-receipt remains free of CLI side effects', t => {
  const f = fixture(t);
  const result = spawnSync(process.execPath, ['--input-type=module', '-e',
    `await import(${JSON.stringify(pathToFileURL(f.tool).href)}); console.log('import-only');`], {
    cwd:f.dir, env:f.env, encoding:'utf8', windowsHide:true, timeout:15_000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'import-only');
});

test('missing receipt fails the actual CLI', t => {
  const f = fixture(t);
  fs.unlinkSync(f.receiptPaths[0]);
  const result = verify(f);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /\[STALE\] ratchet-core-g2: no compile receipt/);
});

test('changed source fails even when compiler exits and test counts claim success', t => {
  const f = fixture(t);
  fs.appendFileSync(f.sources[0], '// changed after compilation\n');
  const result = verify(f);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /receipt describes different bytes: src\/lib.rs/);
});

test('missing compiled source fails the actual CLI', t => {
  const f = fixture(t);
  fs.unlinkSync(f.sources[0]);
  const result = verify(f);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /src\/lib.rs MISSING/);
});

test('new source omitted by the receipt fails the actual CLI', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(path.dirname(f.sources[0]), 'new.rs'), 'pub const NEW: u8 = 1;\n');
  const result = verify(f);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /src\/new.rs is new since the receipt/);
});

for (const [name, mutate] of [
  ['missing cargo check exit', r => { delete r.check.exit; }],
  ['failed cargo check', r => { r.check.exit = 1; }],
  ['missing cargo test exit', r => { delete r.test.exit; }],
  ['failed cargo test despite passing counts', r => { r.test.exit = 101; }],
  ['terminated cargo test', r => { r.test.exit = null; }],
  ['missing passing-test count', r => { delete r.test.passed; }],
  ['zero tests passed', r => { r.test.passed = 0; r.test.passing = []; }],
  ['unparsed test summary', r => { r.test.passed = null; r.test.failed = null; }],
  ['non-numeric passing-test count', r => { r.test.passed = '1'; }],
  ['missing failed-test count', r => { delete r.test.failed; }],
  ['reported test failure despite zero exit', r => { r.test.failed = 1; }],
]) {
  test(`${name} fails verification instead of being labelled FRESH`, t => {
    const f = fixture(t);
    changeReceipt(f, mutate);
    const result = verify(f);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    // The CLI has two failure labels by design: [STALE] for a receipt that
    // contradicts itself (assembled, not produced) and [FAIL] for a receipt
    // with an invalid or missing field. Both fail verification; neither is
    // FRESH. The loop's contract is exactly that, so accept both labels.
    assert.match(result.stdout, /\[(?:FAIL|STALE)\] ratchet-core-g2:/);
    assert.doesNotMatch(result.stdout, /\[FRESH\] ratchet-core-g2:/);
  });
}

test('a failed second crate also makes the complete CLI fail', t => {
  const f = fixture(t);
  changeReceipt(f, r => { r.test.exit = 101; }, 1);
  const result = verify(f);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /\[FRESH\] ratchet-core-g2:/);
  assert.match(result.stdout, /\[STALE\] rcx-timepin-v2:/);
});
