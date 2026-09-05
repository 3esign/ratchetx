// Host-only build handoff regressions. Cargo execution is replaced with a
// recorder; fixtures are synthetic ELF headers, never deployable binaries.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { PublicKey } from '@solana/web3.js';
import { ROOT, PROGRAMS, FORBIDDEN_ID, assertToolchain, assertSourceIdentities,
  sourceStamp, assertUnchanged, pinArtifact, runBuild, resolvePlatformCompilers } from '../tools/g2-build-artifacts.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ratchetx-g2-test-'));
  const rawDirs = new Set();
  const write = (rel, text) => {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  };
  for (const p of PROGRAMS) {
    write(p.workspace + '/Cargo.toml', '[workspace]\nmembers = []\n');
    write(p.workspace + '/Cargo.lock', 'version = 4\n');
    write(p.workspace + '/programs/' + p.crate + '/Cargo.toml', '[package]\nname = "' + p.crate + '"\n');
    write(p.workspace + '/programs/' + p.crate + '/src/lib.rs', 'declare_id!("' + p.id + '");\n');
  }
  const timepinBytes = Buffer.from('synthetic-timepin');
  const reviewedVector = JSON.stringify({ programId: PROGRAMS[0].id, deployableIdentity: true,
    localSbfEvidence: { sha256: crypto.createHash('sha256').update(timepinBytes).digest('hex'), size: timepinBytes.length } });
  for (const name of ['register-open-v2.json', 'lifecycle-v2.json']) {
    write(PROGRAMS[0].workspace + '/vectors/' + name, reviewedVector);
  }
  const compilerSuffix = process.platform === 'win32' ? '.exe' : '';
  const platformDir = '.cache/solana/v1.56/platform-tools';
  write(platformDir + '/rust/bin/rustc' + compilerSuffix, 'fixture rustc; never executed');
  write(platformDir + '/llvm/bin/clang' + compilerSuffix, 'fixture clang; never executed');
  t.after(() => {
    for (const dir of [...rawDirs, root]) {
      const resolved = path.resolve(dir);
      assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
      assert.match(path.basename(resolved), /^ratchetx-g2-(test|build)-/);
      fs.rmSync(resolved, { recursive: true, force: true });
    }
  });
  return { root, rawDirs, write, platformHome: root, cacheRoot: path.join(root, 'ratchetx-onchain-sbf') };
}

function fakeSpawn(f, calls, hook = () => {}) {
  return (command, args, options) => {
    const call = { command, args, ...options };
    calls.push(call);
    if (args[0] === 'build-sbf') {
      const p = PROGRAMS.find(program => path.join(f.root, program.workspace) === options.cwd);
      assert.ok(p, 'build executes in one of the two crate workspaces');
      const out = args[args.indexOf('--sbf-out-dir') + 1];
      const runDir = path.resolve(out, '..', '..');
      f.rawDirs.add(runDir);
      fs.mkdirSync(out, { recursive: true });
      fs.writeFileSync(path.join(out, p.filename), Buffer.from('synthetic-' + p.name));
    }
    const overridden = hook(call);
    if (overridden) return overridden;
    const output = command === 'cargo-build-sbf' ? 'solana-cargo-build-sbf 4.3.0\nplatform-tools v1.57\n'
      : /^rustc(?:\.exe)?$/.test(path.basename(command)) ? 'rustc 1.89.0-dev (e57530ef2 2026-08-14)\n'
      : /^clang(?:\.exe)?$/.test(path.basename(command)) ? 'clang version 20.1.7-rust-dev\nTarget: fixture-host\n' : '';
    return { status: 0, stdout: output, stderr: '' };
  };
}

test('toolchain pin rejects wrong, prerelease and unrelated version strings', () => {
  assert.doesNotThrow(() => assertToolchain('solana-cargo-build-sbf 4.3.0\nplatform-tools v1.56'));
  for (const bad of ['solana-cargo-build-sbf 4.3.1', 'cargo-build-sbf 4.3.0-beta', 'cargo-build-sbf 14.3.0', 'cargo 4.3.0']) {
    assert.throws(() => assertToolchain(bad), /must be exactly 4\.3\.0/);
  }
});

test('source identity and workspace lockfile changes refuse the candidate', t => {
  const f = fixture(t);
  assert.doesNotThrow(() => assertSourceIdentities(f.root));
  const original = sourceStamp(f.root);
  f.write(PROGRAMS[0].workspace + '/Cargo.lock', 'version = 4\n# changed resolution\n');
  assert.throws(() => assertUnchanged(original, sourceStamp(f.root)), /Cargo\.lock/);
  f.write(PROGRAMS[1].workspace + '/programs/' + PROGRAMS[1].crate + '/src/lib.rs',
    'declare_id!("' + FORBIDDEN_ID + '");\n');
  assert.throws(() => assertSourceIdentities(f.root), /core source declare_id/);
});

test('artifact snapshots are idempotent and refuse to overwrite corrupted cached bytes', t => {
  const f = fixture(t);
  const p = PROGRAMS[0];
  const raw = path.join(f.root, p.filename);
  fs.writeFileSync(raw, 'same immutable bytes');
  const first = pinArtifact(raw, p.filename, f.cacheRoot);
  assert.equal(path.basename(path.dirname(first.path)), first.sha256);
  assert.deepEqual(pinArtifact(raw, p.filename, f.cacheRoot), first);
  fs.chmodSync(first.path, 0o644);
  fs.writeFileSync(first.path, 'corrupted cache');
  assert.throws(() => pinArtifact(raw, p.filename, f.cacheRoot), /refusing overwrite/);
  assert.equal(fs.readFileSync(first.path, 'utf8'), 'corrupted cache');
  assert.throws(() => pinArtifact(raw, 'generated-keypair.json', f.cacheRoot), /only canonical/);
});

test('the recorded build pins both toolchains and sends only verified immutable paths to consumers', t => {
  const f = fixture(t);
  const calls = [];
  const receipt = runBuild({ ...f, spawn: fakeSpawn(f, calls), log: () => {} });
  assert.equal(receipt.status, 'PASS');
  assert.equal(receipt.platformCompilers.version, 'v1.56');
  assert.equal(receipt.platformCompilers.rustc.versionOutput, 'rustc 1.89.0-dev (e57530ef2 2026-08-14)');
  assert.match(receipt.platformCompilers.clang.versionOutput, /^clang version 20\.1\.7-rust-dev/);
  assert.ok(receipt.platformCompilers.rustc.path.includes(path.join('v1.56', 'platform-tools')));
  assert.ok(receipt.buildSbfVersionOutput.includes('v1.57'), 'builder default output is not mistaken for the selected compiler');
  const builds = calls.filter(c => c.args[0] === 'build-sbf');
  assert.equal(builds.length, 2);
  for (const c of builds) {
    assert.deepEqual(c.args.slice(0, 5), ['build-sbf', '--arch', 'v3', '--tools-version', 'v1.56']);
    assert.deepEqual(c.args.slice(-2), ['--', '--locked']);
    assert.equal(c.windowsHide, true);
    const out = c.args[c.args.indexOf('--sbf-out-dir') + 1];
    assert.ok(!out.startsWith(f.root), 'throwaway output stays outside the checkout');
  }
  const verifications = calls.filter(c => c.args[0]?.endsWith('verify-artifact.mjs'));
  assert.equal(verifications.length, 6, 'both artifacts verified after build, before consumers, and after consumers');
  for (const c of verifications) {
    assert.equal(c.env.EXPECT_SBPF, '3');
    assert.equal(c.env.REQUIRE_CONTENT_ADDRESS, '1');
    assert.equal(c.env.FORBID_PROGRAM_IDS, FORBIDDEN_ID);
    assert.match(c.args[3], /^[0-9a-f]{64}$/);
    assert.ok(Number(c.args[4]) > 0);
    assert.equal(path.basename(path.dirname(c.args[1])), c.args[3]);
    assert.ok(!c.args[1].split(path.sep).includes('target'));
  }
  const firstRepin = calls.findIndex(c => c.args[0]?.endsWith('repin-timepin-vectors.mjs'));
  const firstPairVerified = calls.indexOf(verifications[1]);
  assert.ok(firstPairVerified < firstRepin, 'vectors change only after both artifact verifications');
  const matrices = calls.filter(c => c.command === 'cargo' && c.args[0] === 'test');
  assert.equal(matrices.length, 2);
  for (const c of matrices) {
    assert.deepEqual(c.args, ['test', '--locked', '--', '--nocapture']);
    assert.equal(c.env.RATCHET_ALLOW_SKIPS, undefined);
    for (const p of PROGRAMS) {
      assert.equal(c.env[p.env], receipt.artifacts[p.name].path);
      assert.equal(c.env[p.hashEnv], receipt.artifacts[p.name].sha256);
      assert.equal(c.env[p.env + '_SHA256'], receipt.artifacts[p.name].sha256);
    }
  }
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.root, 'docs/receipts/g2-build-artifacts.json'))).status, 'PASS');
});

test('a failed child stops the sequence and writes FAIL instead of an accepted pair', t => {
  const f = fixture(t);
  const calls = [];
  const spawn = fakeSpawn(f, calls, c => c.args[0] === 'build-sbf'
    ? { status: 17, stdout: '', stderr: 'controlled build failure' } : undefined);
  assert.throws(() => runBuild({ ...f, spawn, log: () => {} }), /exit 17/);
  assert.equal(calls.filter(c => c.args[0] === 'build-sbf').length, 1);
  assert.equal(calls.some(c => c.args[0]?.endsWith('repin-timepin-vectors.mjs')), false);
  const receipt = JSON.parse(fs.readFileSync(path.join(f.root, 'docs/receipts/g2-build-artifacts.json')));
  assert.equal(receipt.status, 'FAIL');
  assert.deepEqual(receipt.artifacts, {});
});

test('source changes during the second build fail before repin or either matrix', t => {
  const f = fixture(t);
  const calls = [];
  const spawn = fakeSpawn(f, calls, c => {
    if (c.args[0] === 'build-sbf' && c.cwd.endsWith('ratchet-core-g2')) {
      f.write(PROGRAMS[0].workspace + '/Cargo.lock', 'version = 4\n# concurrent change\n');
    }
  });
  assert.throws(() => runBuild({ ...f, spawn, log: () => {} }), /source\/lockfile drift.*Cargo\.lock/);
  assert.equal(calls.some(c => c.args[0]?.endsWith('repin-timepin-vectors.mjs')), false);
  assert.equal(calls.some(c => c.command === 'cargo' && c.args[0] === 'test'), false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.root, 'docs/receipts/g2-build-artifacts.json'))).status, 'FAIL');
});

test('a synthetic pinned ELF crosses the real strict verifier and wrong hashes fail', t => {
  const f = fixture(t);
  const p = PROGRAMS[0];
  const bytes = Buffer.concat([Buffer.alloc(64), new PublicKey(p.id).toBuffer(), crypto.randomBytes(32)]);
  bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1], 0);
  bytes.writeUInt32LE(3, 48);
  const raw = path.join(f.root, p.filename);
  fs.writeFileSync(raw, bytes);
  const pinned = pinArtifact(raw, p.filename);
  t.after(() => {
    const cache = fs.realpathSync(path.join(os.tmpdir(), 'ratchetx-onchain-sbf'));
    const dir = path.dirname(pinned.path);
    assert.equal(path.relative(cache, dir), pinned.sha256);
    assert.deepEqual(fs.readdirSync(dir), [p.filename]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const env = { ...process.env, EXPECT_SBPF: '3', REQUIRE_CONTENT_ADDRESS: '1', FORBID_PROGRAM_IDS: FORBIDDEN_ID };
  const args = [path.join(ROOT, 'tools/verify-artifact.mjs'), pinned.path, p.id, pinned.sha256, String(pinned.size)];
  const valid = spawnSync(process.execPath, args, { env, encoding: 'utf8', windowsHide: true });
  assert.equal(valid.status, 0, valid.stdout + valid.stderr);
  assert.equal(JSON.parse(valid.stdout).verdict, 'PASS');
  args[3] = '0'.repeat(64);
  const invalid = spawnSync(process.execPath, args, { env, encoding: 'utf8', windowsHide: true });
  assert.equal(invalid.status, 1);
  assert.equal(JSON.parse(invalid.stdout).verdict, 'FAIL');
});

test('CI compares fresh hashes without rewriting vectors or invoking npm', t => {
  const f = fixture(t);
  const p = PROGRAMS[0];
  const bytes = Buffer.from('synthetic-' + p.name);
  const artifact = { sha256: crypto.createHash('sha256').update(bytes).digest('hex'), size: bytes.length };
  const vector = JSON.stringify({ programId: p.id, deployableIdentity: true, localSbfEvidence: artifact });
  for (const file of ['register-open-v2.json', 'lifecycle-v2.json']) f.write(p.workspace + '/vectors/' + file, vector);
  const calls = [];
  const receipt = runBuild({ ...f, ci: true, spawn: fakeSpawn(f, calls), log: () => {} });
  assert.equal(receipt.status, 'PASS');
  assert.equal(receipt.mode, 'ci');
  assert.ok(!receipt.stages.some(s => s.name === 'JS release gate'));
  const vectorCalls = calls.filter(c => c.args[0]?.endsWith('repin-timepin-vectors.mjs'));
  assert.equal(vectorCalls.length, 1);
  assert.deepEqual(vectorCalls[0].args.slice(1), ['--check']);
  for (const file of ['register-open-v2.json', 'lifecycle-v2.json']) {
    assert.equal(fs.readFileSync(path.join(f.root, p.workspace, 'vectors', file), 'utf8'), vector);
  }
  const changed = JSON.stringify({ programId: p.id, deployableIdentity: true, localSbfEvidence: { ...artifact, sha256: '0'.repeat(64) } });
  f.write(p.workspace + '/vectors/lifecycle-v2.json', changed);
  const rejectedCalls = [];
  assert.throws(() => runBuild({ ...f, ci: true, spawn: fakeSpawn(f, rejectedCalls), log: () => {} }), /lifecycle-v2\.json does not pin/);
  assert.ok(!rejectedCalls.some(c => c.command === 'cargo' && c.args[0] === 'test'));
  assert.equal(fs.readFileSync(path.join(f.root, p.workspace, 'vectors/lifecycle-v2.json'), 'utf8'), changed);
});

test('cargo exit zero with LLVM stack-frame overflow stops before artifact acceptance', t => {
  const f = fixture(t);
  const calls = [];
  const spawn = fakeSpawn(f, calls, c => c.args[0] === 'build-sbf'
    ? { status: 0, stdout: 'Finished release profile\n',
      stderr: 'Error: Function _ZN7example Stack offset of 4200 exceeded max offset of 4096 by 104 bytes\n' }
    : undefined);
  assert.throws(() => runBuild({ ...f, spawn, log: () => {} }), /SBF stack-frame overflow despite cargo exit 0/);
  const receipt = JSON.parse(fs.readFileSync(path.join(f.root, 'docs/receipts/g2-build-artifacts.json')));
  assert.equal(receipt.status, 'FAIL');
  assert.equal(receipt.stages.at(-1).exit, 0);
  assert.equal(receipt.stages.at(-1).diagnosticFailure, 'SBF stack-frame overflow');
  assert.deepEqual(receipt.artifacts, {});
  assert.equal(calls.filter(c => c.args[0] === 'build-sbf').length, 1);
  assert.ok(!calls.some(c => c.args[0]?.endsWith('repin-timepin-vectors.mjs')));
});

test('platform compilers resolve by pinned cache version on Windows and Unix', t => {
  const f = fixture(t);
  for (const platform of ['linux', 'win32']) {
    const suffix = platform === 'win32' ? '.exe' : '';
    f.write('.cache/solana/v1.56/platform-tools/rust/bin/rustc' + suffix, 'fixture');
    f.write('.cache/solana/v1.56/platform-tools/llvm/bin/clang' + suffix, 'fixture');
    const found = resolvePlatformCompilers({ home: f.root, platform });
    assert.equal(found.rustc, path.join(f.root, '.cache/solana/v1.56/platform-tools/rust/bin/rustc' + suffix));
    assert.equal(found.clang, path.join(f.root, '.cache/solana/v1.56/platform-tools/llvm/bin/clang' + suffix));
  }
  assert.throws(() => resolvePlatformCompilers({ home: path.join(f.root, 'missing'), platform: 'linux' }), /pinned v1\.56 rustc executable is missing/);
});

test('generated target trees and the platform cache do not change the source stamp', t => {
  const f = fixture(t);
  const original = sourceStamp(f.root);
  for (const p of PROGRAMS) {
    f.write(p.workspace + '/target/sbf-solana-solana/release/build/generated.rs', 'generated output');
    f.write(p.workspace + '/target/platform-tools/rust/Cargo.toml', 'generated compiler manifest');
    f.write(p.workspace + '/svm-tests/target/debug/build/Cargo.lock', 'generated target lock');
  }
  f.write('.cache/solana/v1.56/platform-tools/rust/Cargo.toml', 'compiler package');
  assert.deepEqual(sourceStamp(f.root), original);
});

test('build-only records BUILT without vector checks, matrices or an exact-SBF claim', t => {
  const f = fixture(t);
  f.write(PROGRAMS[0].workspace + '/vectors/lifecycle-v2.json', '{"deliberately":"stale"}');
  const calls = [];
  const receipt = runBuild({ ...f, buildOnly: true, spawn: fakeSpawn(f, calls), log: () => {} });
  assert.equal(receipt.status, 'BUILT');
  assert.equal(receipt.buildStatus, 'BUILT');
  assert.match(receipt.evidenceTier, /vectors and exact-SBF not run/);
  assert.equal(calls.filter(c => c.args[0] === 'build-sbf').length, 2);
  assert.ok(!calls.some(c => c.command === 'cargo' && c.args[0] === 'test'));
  assert.ok(!calls.some(c => c.args[0]?.endsWith('repin-timepin-vectors.mjs')));
});

test('reuse consumes the recorded pair without a build or vector rewrite', t => {
  const f = fixture(t);
  const built = runBuild({ ...f, buildOnly: true, spawn: fakeSpawn(f, []), log: () => {} });
  const calls = [];
  const verified = runBuild({ ...f, verifyArtifacts: true, spawn: fakeSpawn(f, calls), log: () => {} });
  assert.equal(verified.status, 'PASS');
  assert.equal(verified.mode, 'verify-artifacts');
  assert.deepEqual(verified.artifacts, built.artifacts);
  assert.ok(!calls.some(c => c.args[0] === 'build-sbf'));
  assert.ok(!calls.some(c => c.command === 'cargo-build-sbf'));
  const vectorCalls = calls.filter(c => c.args[0]?.endsWith('repin-timepin-vectors.mjs'));
  assert.equal(vectorCalls.length, 1);
  assert.deepEqual(vectorCalls[0].args.slice(1), ['--check']);
  const readbacks = calls.filter(c => c.args[0]?.endsWith('verify-artifact.mjs'));
  assert.equal(readbacks.length, 4);
  const firstConsumer = calls.findIndex(c => c.args[0]?.endsWith('repin-timepin-vectors.mjs'));
  assert.ok(calls.indexOf(readbacks[1]) < firstConsumer, 'strict readback of both comes before consumers');
  assert.equal(calls.filter(c => c.command === 'cargo' && c.args[0] === 'test').length, 2);
  assert.ok(verified.stages.some(s => s.name === 'JS release gate'));
});

test('reuse refuses source or artifact tampering before any matrix or vector consumer', t => {
  for (const mutation of ['source', 'artifact']) {
    const f = fixture(t);
    const built = runBuild({ ...f, buildOnly: true, spawn: fakeSpawn(f, []), log: () => {} });
    if (mutation === 'source') f.write(PROGRAMS[1].workspace + '/Cargo.lock', 'concurrent source dependency change');
    else {
      fs.chmodSync(built.artifacts.timepin.path, 0o644);
      fs.writeFileSync(built.artifacts.timepin.path, 'changed bytes');
    }
    const calls = [];
    assert.throws(() => runBuild({ ...f, verifyArtifacts: true, spawn: fakeSpawn(f, calls), log: () => {} }),
      mutation === 'source' ? /source\/lockfile drift/ : /recorded artifact bytes changed/);
    assert.ok(!calls.some(c => c.args[0] === 'build-sbf'));
    assert.ok(!calls.some(c => c.command === 'cargo' && c.args[0] === 'test'));
    assert.ok(!calls.some(c => c.args[0]?.endsWith('repin-timepin-vectors.mjs')));
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.root, 'docs/receipts/g2-build-artifacts.json'))).status, 'FAIL');
  }
});

test('failed vector verification can retry the completed BUILT pair after vector repair', t => {
  const f = fixture(t);
  runBuild({ ...f, buildOnly: true, spawn: fakeSpawn(f, []), log: () => {} });
  const vectorPath = path.join(f.root, PROGRAMS[0].workspace, 'vectors/lifecycle-v2.json');
  const reviewed = fs.readFileSync(vectorPath);
  fs.writeFileSync(vectorPath, '{}');
  assert.throws(() => runBuild({ ...f, verifyArtifacts: true, spawn: fakeSpawn(f, []), log: () => {} }),
    /regenerate vectors from source \+ this artifact/);
  fs.writeFileSync(vectorPath, reviewed);
  const calls = [];
  const receipt = runBuild({ ...f, verifyArtifacts: true, spawn: fakeSpawn(f, calls), log: () => {} });
  assert.equal(receipt.status, 'PASS');
  assert.ok(!calls.some(c => c.args[0] === 'build-sbf'));
});
