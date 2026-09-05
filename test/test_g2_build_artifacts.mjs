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
import { ROOT, PROGRAMS, REQUIRED_SVM_TARGETS, FORBIDDEN_ID, assertToolchain, assertSourceIdentities,
  sourceStamp, assertUnchanged, pinArtifact, runBuild, resolvePlatformCompilers, ensureWindowsRustcAlias, inspectSbfTestResult } from '../tools/g2-build-artifacts.mjs';

function fixture(t, platform = process.platform) {
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
    write(p.workspace + '/svm-tests/Cargo.toml', '[package]\nname = "fixture-svm"\n');
    write(p.workspace + '/svm-tests/Cargo.lock', 'version = 4\n');
    for (const target of REQUIRED_SVM_TARGETS[p.name]) write(p.workspace + '/svm-tests/tests/' + target + '.rs', '// synthetic harness source\n');
  }
  const timepinBytes = Buffer.from('synthetic-timepin');
  const reviewedVector = JSON.stringify({ programId: PROGRAMS[0].id, deployableIdentity: true,
    localSbfEvidence: { sha256: crypto.createHash('sha256').update(timepinBytes).digest('hex'), size: timepinBytes.length } });
  for (const name of ['register-open-v2.json', 'lifecycle-v2.json']) {
    write(PROGRAMS[0].workspace + '/vectors/' + name, reviewedVector);
  }
  const compilerSuffix = platform === 'win32' ? '.exe' : '';
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
  return { root, rawDirs, write, platform, platformHome: root, cacheRoot: path.join(root, 'ratchetx-onchain-sbf') };
}

const PASSING_LIBTEST = 'running 2 tests\n'
  + 'test economic_kernel::commits_state ... ok\n'
  + 'test rejects_invalid_state ... ok\n\n'
  + 'test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s\n';
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
    if (command === 'cargo' && args[0] === 'metadata') {
      const targets = fs.readdirSync(path.join(options.cwd, 'tests')).filter(file => file.endsWith('.rs'))
        .map(file => ({ name: file.slice(0, -3), kind: ['test'], test: true }));
      return { status: 0, stdout: JSON.stringify({ packages: [{ manifest_path: path.join(options.cwd, 'Cargo.toml'), targets }] }), stderr: 'warning: fixture metadata diagnostic\n' };
    }
    if (command === 'cargo' && args[0] === 'test') return { status: 0, stdout: PASSING_LIBTEST, stderr: '' };
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
  assert.equal(matrices.length, 4);
  for (const c of matrices) {
    const program = PROGRAMS.find(p => c.cwd === path.join(f.root, p.workspace, 'svm-tests'));
    assert.ok(REQUIRED_SVM_TARGETS[program.name].includes(c.args[3]));
    assert.deepEqual(c.args, ['test', '--locked', '--test', c.args[3], '--', '--format', 'pretty', '--show-output', '--test-threads', '1']);
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
  assert.equal(calls.filter(c => c.command === 'cargo' && c.args[0] === 'test').length, 4);
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

test('Windows rustc alias is an exclusive hardlink and existing identical bytes are reused', t => {
  const f = fixture(t, 'win32');
  const first = ensureWindowsRustcAlias({ home: f.root, platform: f.platform });
  assert.equal(first.method, 'hardlink-created');
  assert.equal(first.target, first.path + '.exe');
  assert.equal(fs.statSync(first.path).ino, fs.statSync(first.target).ino);
  assert.equal(first.sha256, crypto.createHash('sha256').update(fs.readFileSync(first.target)).digest('hex'));
  assert.equal(first.size, fs.statSync(first.target).size);
  const reused = ensureWindowsRustcAlias({ home: f.root, platform: f.platform });
  assert.equal(reused.method, 'existing-hardlink');
  assert.equal(reused.sha256, first.sha256);
  fs.unlinkSync(first.path);
  fs.copyFileSync(first.target, first.path);
  const copy = ensureWindowsRustcAlias({ home: f.root, platform: f.platform });
  assert.equal(copy.method, 'existing-identical-file');
  assert.equal(copy.sha256, first.sha256);
});

test('Windows alias refuses different bytes and symbolic links without overwriting', t => {
  for (const kind of ['different-bytes', 'symlink']) {
    const f = fixture(t, 'win32');
    const { rustc } = resolvePlatformCompilers({ home: f.root, platform: f.platform });
    const alias = rustc.slice(0, -4);
    if (kind === 'different-bytes') fs.writeFileSync(alias, 'unrelated compiler');
    else fs.symlinkSync(path.dirname(rustc), alias, 'junction');
    assert.throws(() => ensureWindowsRustcAlias({ home: f.root, platform: f.platform }),
      kind === 'different-bytes' ? /bytes differ; refusing overwrite/ : /regular non-symlink/);
    if (kind === 'different-bytes') assert.equal(fs.readFileSync(alias, 'utf8'), 'unrelated compiler');
    else assert.ok(fs.lstatSync(alias).isSymbolicLink());
  }
});

test('non-Windows preparation needs no rustc alias or filesystem changes', t => {
  const f = fixture(t, 'linux');
  const home = path.join(f.root, 'absent-home');
  assert.equal(ensureWindowsRustcAlias({ home, platform: 'linux' }), null);
  assert.equal(fs.existsSync(home), false);
});

test('fresh Windows builds install pinned tools before alias preparation and record executable evidence', t => {
  const f = fixture(t, 'win32');
  const initial = resolvePlatformCompilers({ home: f.root, platform: f.platform });
  fs.unlinkSync(initial.rustc);
  fs.unlinkSync(initial.clang);
  const calls = [];
  const spawn = fakeSpawn(f, calls, c => {
    if (c.command === 'cargo-build-sbf' && c.args[0] === '--install-only') {
      assert.deepEqual(c.args, ['--install-only', '--tools-version', 'v1.56']);
      assert.equal(c.windowsHide, true);
      assert.equal(fs.existsSync(initial.rustc), false);
      fs.writeFileSync(initial.rustc, 'mock installer rustc');
      fs.writeFileSync(initial.clang, 'mock installer clang');
    }
    if (c.args[0] === 'build-sbf') assert.ok(fs.existsSync(initial.rustc.slice(0, -4)));
  });
  const receipt = runBuild({ ...f, buildOnly: true, spawn, log: () => {} });
  assert.equal(receipt.status, 'BUILT');
  const installs = calls.filter(c => c.command === 'cargo-build-sbf' && c.args[0] === '--install-only');
  assert.equal(installs.length, 1);
  assert.ok(calls.indexOf(installs[0]) < calls.findIndex(c => c.args[0] === 'build-sbf'));
  const alias = receipt.platformPreparation.rustcAlias;
  assert.equal(alias.method, 'hardlink-created');
  assert.match(alias.versionOutput, /^rustc 1\.89\.0-dev/);
  assert.equal(alias.sha256, receipt.platformCompilers.rustc.sha256);
  assert.match(receipt.platformCompilers.clang.sha256, /^[0-9a-f]{64}$/);
  assert.equal(receipt.platformPreparation.version, 'v1.56');
  assert.equal(receipt.platformPreparation.platform, 'win32');
});

test('failed pinned-tool installation stops before alias creation or either build', t => {
  const f = fixture(t, 'win32');
  const { rustc } = resolvePlatformCompilers({ home: f.root, platform: f.platform });
  const calls = [];
  const spawn = fakeSpawn(f, calls, c => c.args[0] === '--install-only'
    ? { status: 21, stdout: '', stderr: 'controlled install failure' } : undefined);
  assert.throws(() => runBuild({ ...f, buildOnly: true, spawn, log: () => {} }), /install pinned platform tools: exit 21/);
  assert.equal(fs.existsSync(rustc.slice(0, -4)), false);
  assert.ok(!calls.some(c => c.args[0] === 'build-sbf'));
  const receipt = JSON.parse(fs.readFileSync(path.join(f.root, 'docs/receipts/g2-build-artifacts.json')));
  assert.equal(receipt.status, 'FAIL');
  assert.deepEqual(receipt.artifacts, {});
});

test('an alias without a reported rustc version is rejected before either build', t => {
  const f = fixture(t, 'win32');
  const calls = [];
  const spawn = fakeSpawn(f, calls, c => path.basename(c.command) === 'rustc'
    ? { status: 0, stdout: 'not a compiler version', stderr: '' } : undefined);
  assert.throws(() => runBuild({ ...f, buildOnly: true, spawn, log: () => {} }), /alias did not report a compiler version/);
  assert.ok(!calls.some(c => c.args[0] === 'build-sbf'));
});

test('artifact reuse never installs tools or repairs a removed Windows alias', t => {
  const f = fixture(t, 'win32');
  const built = runBuild({ ...f, buildOnly: true, spawn: fakeSpawn(f, []), log: () => {} });
  const alias = built.platformPreparation.rustcAlias;
  fs.unlinkSync(alias.path);
  fs.writeFileSync(alias.target, 'compiler changed after the completed build');
  const calls = [];
  const verified = runBuild({ ...f, verifyArtifacts: true, spawn: fakeSpawn(f, calls), log: () => {} });
  assert.equal(verified.status, 'PASS');
  assert.equal(fs.existsSync(alias.path), false);
  assert.equal(fs.readFileSync(alias.target, 'utf8'), 'compiler changed after the completed build');
  assert.deepEqual(verified.platformPreparation, built.platformPreparation);
  assert.ok(!calls.some(c => c.command === 'cargo-build-sbf' || c.args[0] === 'build-sbf'
    || c.command === alias.path || c.command === alias.target));
});

test('SBF receipts preserve exact test results, raw streams and source/artifact bindings', t => {
  const f = fixture(t);
  f.write(PROGRAMS[0].workspace + '/svm-tests/tests/additional_gate.rs', '// additional required execution\n');
  const calls = [];
  const receipt = runBuild({ ...f, ci: true, spawn: fakeSpawn(f, calls), log: () => {} });
  const executions = receipt.stages.filter(stage => stage.execution);
  assert.equal(executions.length, 5, 'new targets execute alongside the four mandatory targets');
  assert.ok(executions.some(stage => stage.execution.target === 'additional_gate'));
  for (const stage of executions) {
    const evidence = stage.execution;
    assert.equal(evidence.accepted, true);
    assert.equal(evidence.exit, 0);
    assert.equal(evidence.target, stage.args[3]);
    assert.deepEqual(evidence.tests, [{ name: 'economic_kernel::commits_state', result: 'passed' },
      { name: 'rejects_invalid_state', result: 'passed' }]);
    assert.deepEqual(evidence.counts, { passed: 2, failed: 0, ignored: 0, measured: 0, filteredOut: 0 });
    assert.equal(evidence.reportedTests, 2);
    assert.equal(evidence.stdout, PASSING_LIBTEST);
    assert.equal(evidence.stderr, '');
    assert.equal(evidence.stdoutSha256, crypto.createHash('sha256').update(evidence.stdout).digest('hex'));
    assert.equal(evidence.stderrSha256, crypto.createHash('sha256').update(evidence.stderr).digest('hex'));
    assert.deepEqual(evidence.sourceHashes, sourceStamp(f.root));
    assert.deepEqual(evidence.artifactBindings, receipt.artifacts);
    assert.deepEqual(evidence.computeUnits, { status: 'unavailable', measurements: [] });
    assert.deepEqual(evidence.requiredTargets, REQUIRED_SVM_TARGETS[evidence.program]);
  }
  const saved = JSON.parse(fs.readFileSync(path.join(f.root, 'docs/receipts/g2-build-artifacts.json')));
  assert.deepEqual(saved.stages.filter(stage => stage.execution), executions);
  assert.match(fs.readFileSync(path.join(f.root, 'build_g2_report.txt'), 'utf8'), /warning: fixture metadata diagnostic/);
});

test('CU evidence contains only explicitly emitted lines and preserves raw Windows output', () => {
  const stdout = (PASSING_LIBTEST + '\nTimepin v2 large-account CU: register=123, open=456\nfixture register=999; account bytes=168\n').replace(/\n/g, '\r\n');
  const stderr = 'diagnostic compute_units=17\n';
  const evidence = inspectSbfTestResult({ status: 0, stdout, stderr });
  assert.equal(evidence.accepted, true);
  assert.equal(evidence.stdout, stdout);
  assert.equal(evidence.computeUnits.status, 'emitted-log-lines');
  assert.deepEqual(evidence.computeUnits.measurements.map(item => item.text),
    ['Timepin v2 large-account CU: register=123, open=456', 'diagnostic compute_units=17']);
  assert.deepEqual(evidence.computeUnits.measurements.map(item => item.stream), ['stdout', 'stderr']);
});

test('failed, empty, ignored, filtered and inconsistent SBF executions persist rejected evidence', t => {
  const cases = [
    { label: 'failed', status: 101, stdout: PASSING_LIBTEST.replace('commits_state ... ok', 'commits_state ... FAILED')
      .replace('result: ok. 2 passed; 0 failed', 'result: FAILED. 1 passed; 1 failed') },
    { label: 'empty output', status: 0, stdout: '' },
    { label: 'zero tests', status: 0, stdout: 'running 0 tests\ntest result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0s\n' },
    { label: 'ignored', status: 0, stdout: PASSING_LIBTEST.replace('rejects_invalid_state ... ok', 'rejects_invalid_state ... ignored, required artifact missing')
      .replace('2 passed; 0 failed; 0 ignored', '1 passed; 0 failed; 1 ignored') },
    { label: 'filtered', status: 0, stdout: PASSING_LIBTEST.replace('0 filtered out', '1 filtered out') },
    { label: 'inconsistent', status: 0, stdout: PASSING_LIBTEST.replace('test rejects_invalid_state ... ok\n', '') },
  ];
  for (const example of cases) {
    const f = fixture(t), calls = [];
    const spawn = fakeSpawn(f, calls, c => c.command === 'cargo' && c.args[0] === 'test'
      ? { status: example.status, stdout: example.stdout, stderr: 'controlled ' + example.label } : undefined);
    assert.throws(() => runBuild({ ...f, ci: true, spawn, log: () => {} }), /exact-SBF/);
    const saved = JSON.parse(fs.readFileSync(path.join(f.root, 'docs/receipts/g2-build-artifacts.json')));
    assert.equal(saved.status, 'FAIL', example.label);
    const stages = saved.stages.filter(stage => stage.execution);
    assert.equal(stages.length, 1, example.label);
    const evidence = stages[0].execution;
    assert.equal(evidence.accepted, false, example.label);
    assert.equal(evidence.exit, example.status, example.label);
    assert.equal(stages[0].exit, example.status, example.label);
    assert.equal(evidence.stdout, example.stdout);
    assert.equal(evidence.stderr, 'controlled ' + example.label);
    assert.ok(evidence.problems.length);
    assert.deepEqual(evidence.artifactBindings, saved.artifacts);
    if (example.label === 'ignored') assert.equal(evidence.counts.ignored, 1);
    assert.equal(calls.filter(c => c.command === 'cargo' && c.args[0] === 'test').length, 1);
    assert.ok(!saved.stages.some(stage => stage.name === 'JS release gate'));
  }
});

test('empty or reduced Cargo target inventories cannot certify a smaller SBF suite', t => {
  for (const empty of [true, false]) {
    const f = fixture(t), calls = [];
    const spawn = fakeSpawn(f, calls, c => {
      if (c.command === 'cargo' && c.args[0] === 'metadata') {
        return { status: 0, stdout: JSON.stringify({ packages: [{ manifest_path: path.join(c.cwd, 'Cargo.toml'),
          targets: empty ? [] : [{ name: 'registration_open', kind: ['test'] }] }] }), stderr: '' };
      }
    });
    assert.throws(() => runBuild({ ...f, ci: true, spawn, log: () => {} }), /targets are empty or invalid|required SVM targets are missing/);
    assert.ok(!calls.some(c => c.command === 'cargo' && c.args[0] === 'test'));
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.root, 'docs/receipts/g2-build-artifacts.json'))).status, 'FAIL');
  }
});

test('a passing test log cannot certify source drift during SBF execution', t => {
  const f = fixture(t), calls = [];
  const spawn = fakeSpawn(f, calls, c => {
    if (c.command === 'cargo' && c.args[0] === 'test') f.write(PROGRAMS[0].workspace + '/Cargo.lock', 'changed during execution');
  });
  assert.throws(() => runBuild({ ...f, ci: true, spawn, log: () => {} }), /source\/lockfile drift/);
  const saved = JSON.parse(fs.readFileSync(path.join(f.root, 'docs/receipts/g2-build-artifacts.json')));
  const evidence = saved.stages.find(stage => stage.execution).execution;
  assert.equal(evidence.exit, 0);
  assert.equal(evidence.counts.passed, 2);
  assert.equal(evidence.accepted, false);
  assert.ok(evidence.problems.some(problem => problem.includes('source/lockfile drift')));
});


test('verification records its own host without rewriting original build provenance', t => {
  const f = fixture(t), calls = [];
  const built = runBuild({ ...f, buildOnly: true, spawn: fakeSpawn(f, calls), log: () => {} });
  assert.deepEqual(built.buildHost, { platform: process.platform, architecture: process.arch,
    osType: os.type(), osRelease: os.release(), osVersion: os.version(),
    nodeVersion: process.version, nodeExecutable: process.execPath, workspace: fs.realpathSync(f.root) });
  assert.equal(built.verificationHost, undefined);
  const file = path.join(f.root, 'docs/receipts/g2-build-artifacts.json');
  const originalHost = { ...built.buildHost, platform: 'fixture-other-platform', workspace: '/original/build/workspace' };
  fs.writeFileSync(file, JSON.stringify({ ...built, buildHost: originalHost }));
  const verified = runBuild({ ...f, verifyArtifacts: true, spawn: fakeSpawn(f, []), log: () => {} });
  assert.deepEqual(verified.buildHost, originalHost);
  assert.deepEqual(verified.verificationHost, built.buildHost);
  assert.equal(verified.status, 'PASS');
});

test('legacy receipt verification leaves an unrecorded builder host unrecorded', t => {
  const f = fixture(t);
  const built = runBuild({ ...f, buildOnly: true, spawn: fakeSpawn(f, []), log: () => {} });
  delete built.buildHost;
  fs.writeFileSync(path.join(f.root, 'docs/receipts/g2-build-artifacts.json'), JSON.stringify(built));
  const verified = runBuild({ ...f, verifyArtifacts: true, spawn: fakeSpawn(f, []), log: () => {} });
  assert.equal(Object.hasOwn(verified, 'buildHost'), false);
  assert.equal(verified.verificationHost.platform, process.platform);
  assert.equal(verified.status, 'PASS');
});
