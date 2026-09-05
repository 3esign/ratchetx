// Read-only B1 adapter tests. Artifacts have synthetic ELF headers, not executable programs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { PublicKey } from '@solana/web3.js';
import { checkG2Artifacts } from '../tools/check-g2-artifacts.mjs';
import { ROOT, PROGRAMS, TOOLCHAIN, FORBIDDEN_ID, sourceStamp } from '../tools/g2-build-artifacts.mjs';

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ratchetx-b1-check-'));
  const cacheRoot = path.join(root, 'ratchetx-onchain-sbf');
  const receiptPath = path.join(root, 'docs/receipts/g2-build-artifacts.json');
  const write = (relative, bytes) => {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
  };
  for (const program of PROGRAMS) {
    write(program.workspace + '/Cargo.toml', '[workspace]\nmembers = []\n');
    write(program.workspace + '/Cargo.lock', 'version = 4\n');
    write(program.workspace + '/programs/' + program.crate + '/Cargo.toml', '[package]\nname = "fixture"\n');
    write(program.workspace + '/programs/' + program.crate + '/src/lib.rs', 'declare_id!("' + program.id + '");\n');
  }
  for (const name of ['verify-artifact.mjs', 'g2-build-artifacts.mjs', 'check-g2-artifacts.mjs']) {
    write('tools/' + name, fs.readFileSync(path.join(ROOT, 'tools', name)));
  }
  const artifacts = {};
  for (const program of PROGRAMS) {
    const bytes = Buffer.concat([Buffer.alloc(64), new PublicKey(program.id).toBuffer(), crypto.randomBytes(32)]);
    bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1], 0);
    bytes.writeUInt32LE(3, 48);
    const hash = sha256(bytes);
    const file = path.join(cacheRoot, hash, program.filename);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
    artifacts[program.name] = { programId: program.id, path: file, sha256: hash, size: bytes.length };
  }
  const receipt = { schema: 1, status: 'BUILT', buildStatus: 'BUILT', toolchain: { ...TOOLCHAIN },
    sourceHashes: sourceStamp(root), artifacts };
  const save = () => write('docs/receipts/g2-build-artifacts.json', JSON.stringify(receipt, null, 2) + '\n');
  save();
  const calls = [];
  const childEnv = base => ({ ...base, TEMP: root, TMP: root, TMPDIR: root, NODE_DISABLE_COMPILE_CACHE: '1' });
  const spawn = (command, args, options) => {
    calls.push({ command, args, options });
    assert.equal(command, process.execPath, 'only the existing Node verifier may execute');
    assert.equal(args[0], path.join(root, 'tools/verify-artifact.mjs'));
    assert.equal(options.env.EXPECT_SBPF, '3');
    assert.equal(options.env.REQUIRE_CONTENT_ADDRESS, '1');
    assert.equal(options.env.FORBID_PROGRAM_IDS, FORBIDDEN_ID);
    return spawnSync(command, args, { ...options, env: childEnv(options.env) });
  };
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.match(path.basename(root), /^ratchetx-b1-check-/);
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, cacheRoot, receiptPath, receipt, write, save, spawn, calls, childEnv };
}

function snapshot(root) {
  const files = {};
  const walk = relative => {
    for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
      const child = path.join(relative, entry.name);
      if (entry.isDirectory()) walk(child);
      else {
        const file = path.join(root, child), stat = fs.statSync(file);
        files[child] = { sha256: sha256(fs.readFileSync(file)), mtimeMs: stat.mtimeMs, size: stat.size };
      }
    }
  };
  walk('');
  return files;
}

test('valid BUILT receipt crosses the real verifier without changing any fixture files', t => {
  const f = fixture(t), before = snapshot(f.root);
  const report = checkG2Artifacts(f);
  assert.equal(report.verdict, 'PASS', report.failure);
  assert.equal(report.gate, 'B1');
  assert.equal(report.runtimeChecked, false);
  assert.match(report.scope, /artifact-only.*not assessed/);
  assert.equal(report.receiptStatus, 'BUILT');
  assert.equal(report.receiptSha256, sha256(fs.readFileSync(f.receiptPath)));
  assert.deepEqual(report.artifacts, f.receipt.artifacts);
  assert.equal(f.calls.length, 2);
  assert.ok(report.verifiers.every(verifier => verifier.exit === 0 && JSON.parse(verifier.stdout).verdict === 'PASS'));
  assert.deepEqual(snapshot(f.root), before);
});

test('completed runtime FAIL or PASS receipts still yield only a B1 artifact verdict', t => {
  for (const status of ['FAIL', 'PASS']) {
    const f = fixture(t);
    f.receipt.status = status;
    f.receipt.failure = status === 'FAIL' ? 'recorded required SVM failure' : undefined;
    f.save();
    const before = snapshot(f.root);
    const report = checkG2Artifacts(f);
    assert.equal(report.verdict, 'PASS', report.failure);
    assert.equal(report.receiptStatus, status);
    assert.equal(report.runtimeChecked, false);
    assert.deepEqual(snapshot(f.root), before);
  }
});

test('incomplete receipts and wrong toolchain pins fail before invoking the verifier', t => {
  for (const mutate of [
    receipt => { receipt.schema = 2; },
    receipt => { receipt.status = 'RUNNING'; },
    receipt => { delete receipt.buildStatus; },
    receipt => { receipt.toolchain.buildSbf = '4.1.0'; },
    receipt => { receipt.toolchain.platformTools = 'v1.57'; },
    receipt => { receipt.toolchain.arch = 'v0'; },
    receipt => { receipt.artifacts.extra = receipt.artifacts.core; },
  ]) {
    const f = fixture(t);
    mutate(f.receipt); f.save();
    const before = snapshot(f.root);
    assert.equal(checkG2Artifacts(f).verdict, 'FAIL');
    assert.equal(f.calls.length, 0);
    assert.deepEqual(snapshot(f.root), before);
  }
});

test('changed source, wrong source identity and missing lockfiles refuse stale evidence', t => {
  for (const mutation of ['changed', 'identity', 'missing-lock']) {
    const f = fixture(t), core = PROGRAMS[1];
    if (mutation === 'changed') f.write(core.workspace + '/Cargo.lock', 'changed dependency resolution\n');
    if (mutation === 'identity') f.write(core.workspace + '/programs/' + core.crate + '/src/lib.rs', 'declare_id!("' + FORBIDDEN_ID + '");\n');
    if (mutation === 'missing-lock') fs.unlinkSync(path.join(f.root, core.workspace, 'Cargo.lock'));
    const before = snapshot(f.root);
    const report = checkG2Artifacts(f);
    assert.equal(report.verdict, 'FAIL');
    assert.match(report.failure, mutation === 'identity' ? /source declare_id/ : /Cargo\.lock/);
    assert.equal(f.calls.length, 0);
    assert.deepEqual(snapshot(f.root), before);
  }
});

test('wrong artifact IDs, hashes, sizes, filenames and mutable target paths are refused', t => {
  for (const mutation of ['id', 'hash', 'bytes', 'size', 'filename', 'target']) {
    const f = fixture(t), artifact = f.receipt.artifacts.core;
    if (mutation === 'id') artifact.programId = FORBIDDEN_ID;
    if (mutation === 'hash') artifact.sha256 = '0'.repeat(64);
    if (mutation === 'bytes') fs.appendFileSync(artifact.path, 'changed artifact');
    if (mutation === 'size') artifact.size += 1;
    if (mutation === 'filename' || mutation === 'target') {
      const file = mutation === 'target' ? path.join(f.root, 'target', PROGRAMS[1].filename)
        : path.join(path.dirname(artifact.path), 'wrong.so');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.copyFileSync(artifact.path, file);
      artifact.path = file;
    }
    f.save();
    const before = snapshot(f.root);
    const report = checkG2Artifacts(f);
    assert.equal(report.verdict, 'FAIL', mutation);
    assert.match(report.failure, /artifact/);
    assert.equal(f.calls.length, 0);
    assert.deepEqual(snapshot(f.root), before);
  }
});

test('negative exit, silent success, false checks and mismatched verifier tuples fail closed', t => {
  for (const mutation of ['exit', 'silent', 'check', 'tuple']) {
    const f = fixture(t);
    const spawn = (command, args, options) => {
      const result = f.spawn(command, args, options);
      assert.equal(result.status, 0);
      if (mutation === 'exit') return { ...result, status: 17 };
      if (mutation === 'silent') return { ...result, stdout: '' };
      const output = JSON.parse(result.stdout);
      if (mutation === 'check') output.checks[0].ok = false;
      if (mutation === 'tuple') output.size += 1;
      return { ...result, stdout: JSON.stringify(output) };
    };
    const before = snapshot(f.root);
    const report = checkG2Artifacts({ ...f, spawn });
    assert.equal(report.verdict, 'FAIL', mutation);
    assert.match(report.failure, /verifier/);
    assert.equal(report.verifiers.length, 1);
    assert.equal(report.verifiers[0].exit, mutation === 'exit' ? 17 : 0);
    assert.deepEqual(snapshot(f.root), before);
  }
});

test('source, artifact or receipt changes during verification cannot produce a passing B1 result', t => {
  for (const mutation of ['source', 'artifact', 'receipt']) {
    const f = fixture(t);
    let changed = false;
    const spawn = (command, args, options) => {
      const result = f.spawn(command, args, options);
      if (!changed) {
        changed = true;
        if (mutation === 'source') f.write(PROGRAMS[0].workspace + '/Cargo.lock', 'changed during verification\n');
        if (mutation === 'artifact') fs.appendFileSync(f.receipt.artifacts.timepin.path, 'changed during verification');
        if (mutation === 'receipt') fs.appendFileSync(f.receiptPath, '\n');
      }
      return result;
    };
    const report = checkG2Artifacts({ ...f, spawn });
    assert.equal(report.verdict, 'FAIL', mutation);
    assert.match(report.failure, mutation === 'source' ? /source\/lockfile drift/ : mutation === 'artifact' ? /artifact bytes/ : /receipt changed/);
  }
});

test('CLI is read-only and reads only the fixed primary receipt', t => {
  const f = fixture(t), before = snapshot(f.root);
  const run = () => spawnSync(process.execPath, [path.join(f.root, 'tools/check-g2-artifacts.mjs')], {
    cwd: f.root, env: f.childEnv(process.env), encoding: 'utf8', windowsHide: true, timeout: 30000,
  });
  const valid = run();
  assert.equal(valid.status, 0, valid.stdout + valid.stderr);
  assert.equal(JSON.parse(valid.stdout).verdict, 'PASS');
  assert.deepEqual(snapshot(f.root), before);
  fs.renameSync(f.receiptPath, path.join(path.dirname(f.receiptPath), 'g2-build-only-20260905.json'));
  const missingBefore = snapshot(f.root);
  const missing = run();
  assert.equal(missing.status, 1);
  assert.equal(JSON.parse(missing.stdout).verdict, 'FAIL');
  assert.match(JSON.parse(missing.stdout).failure, /g2-build-artifacts\.json/);
  assert.deepEqual(snapshot(f.root), missingBefore);
});
