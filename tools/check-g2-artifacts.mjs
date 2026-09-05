#!/usr/bin/env node
// Read-only B1 artifact check. No builds, installation, vector writes or SVM execution.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { ROOT, PROGRAMS, TOOLCHAIN, FORBIDDEN_ID, sourceStamp, assertUnchanged,
  assertSourceIdentities, artifactEnvironment } from './g2-build-artifacts.mjs';

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const SCOPE = 'B1 artifact-only; runtime, vectors and mainnet acceptance are not assessed';

function readRegular(file, label) {
  const entry = fs.lstatSync(file);
  if (!entry.isFile() || entry.isSymbolicLink()) throw new Error(label + ' must be a regular non-symlink file: ' + file);
  return fs.readFileSync(file);
}

function recordedPathFlavor(program, artifact) {
  if (!artifact || artifact.programId !== program.id || !/^[0-9a-f]{64}$/.test(artifact.sha256)
    || !Number.isSafeInteger(artifact.size) || artifact.size <= 0 || typeof artifact.path !== 'string') {
    throw new Error(program.name + ' artifact tuple is missing or not canonical');
  }
  const value = artifact.path;
  const windows = /^[A-Za-z]:[\\/]/.test(value) || /^\\\\[^\\?.]/.test(value);
  const parser = windows ? path.win32 : path.posix;
  const normalized = windows ? value.replaceAll('/', '\\') : value;
  const parts = normalized.split(parser.sep);
  if (!parser.isAbsolute(value) || value.includes('\0') || (!windows && value.includes('\\'))
    || parser.normalize(normalized) !== normalized
    || parts.some(part => part === '.' || part === '..' || part.toLowerCase() === 'target')
    || parts.slice(-3).join('/') !== 'ratchetx-onchain-sbf/' + artifact.sha256 + '/' + program.filename) {
    throw new Error(program.name + ' artifact provenance path must be absolute and use its exact hash-addressed cache path and filename');
  }
  return windows ? 'win32' : 'posix';
}

function readArtifact(program, artifact, cacheRoot, explicitCache) {
  const flavor = recordedPathFlavor(program, artifact);
  if (!explicitCache && flavor !== (process.platform === 'win32' ? 'win32' : 'posix')) {
    throw new Error(program.name + ' artifact has a foreign provenance path; supply an explicit local cacheRoot');
  }
  const configured = explicitCache ? path.join(cacheRoot, artifact.sha256, program.filename) : path.resolve(artifact.path);
  const real = fs.realpathSync(configured);
  if ([configured, real, cacheRoot].some(file => file.split(path.sep).some(part => part.toLowerCase() === 'target'))) {
    throw new Error(program.name + ' artifact uses a mutable target path');
  }
  const relative = path.join(artifact.sha256, program.filename);
  const cacheEntry = fs.lstatSync(cacheRoot), hashEntry = fs.lstatSync(path.dirname(configured));
  if (!cacheEntry.isDirectory() || cacheEntry.isSymbolicLink() || !hashEntry.isDirectory() || hashEntry.isSymbolicLink()
    || path.relative(path.resolve(cacheRoot), configured) !== relative
    || path.relative(fs.realpathSync(cacheRoot), real) !== relative) {
    throw new Error(program.name + ' artifact must use its exact non-symlink hash-addressed cache path and filename');
  }
  const bytes = readRegular(configured, program.name + ' artifact');
  if (bytes.length !== artifact.size || sha256(bytes) !== artifact.sha256) {
    throw new Error(program.name + ' artifact bytes do not match the recorded size and hash');
  }
  return real;
}

function assertVerifierTuple(program, artifact, file, output, cacheRoot, explicitCache) {
  const requiredChecks = [
    'is ELF64 little-endian', 'path excludes mutable target components',
    'artifact is a regular non-symlink file', 'id embedded (declare_id baked)', 'id is 32 bytes',
    explicitCache ? 'content-addressed explicit cache path' : 'content-addressed temp cache path',
    'sbpf version == 3', 'sha256 matches expected', 'size matches expected',
    'forbidden id absent: ' + FORBIDDEN_ID,
  ];
  if (output?.verdict !== 'PASS' || !Array.isArray(output.checks) || !output.checks.length
    || output.checks.some(check => check.ok !== true)
    || requiredChecks.some(name => !output.checks.some(check => check.check === name && check.ok === true))) {
    throw new Error(program.name + ' verifier did not return every required passing check');
  }
  if (output.file !== file || output.programId !== program.id || output.sha256 !== artifact.sha256
    || output.size !== artifact.size || output.elf?.isElf64Le !== true || output.elf?.sbpfVersion !== 3
    || output.cacheRoot !== cacheRoot || output.cacheRootSource !== (explicitCache ? 'explicit' : 'default-temp')
    || output.contentAddress !== (explicitCache ? '' : 'ratchetx-onchain-sbf/') + artifact.sha256 + '/' + program.filename) {
    throw new Error(program.name + ' verifier output does not match the exact artifact tuple');
  }
}

export function checkG2Artifacts({ root = ROOT, cacheRoot, spawn = spawnSync } = {}) {
  const explicitCache = cacheRoot !== undefined;
  cacheRoot ??= path.join(os.tmpdir(), 'ratchetx-onchain-sbf');
  const receiptPath = path.join(root, 'docs/receipts/g2-build-artifacts.json');
  const report = { schema: 1, gate: 'B1', scope: SCOPE, runtimeChecked: false, verdict: 'FAIL',
    receiptPath, verifiers: [] };
  try {
    if (typeof cacheRoot !== 'string' || !path.isAbsolute(cacheRoot)
      || cacheRoot.split(path.sep).some(part => part === '.' || part === '..')) {
      throw new Error('cacheRoot must be an absolute local directory without traversal');
    }
    cacheRoot = path.resolve(cacheRoot);
    report.cacheRootSource = explicitCache ? 'explicit' : 'default-temp';
    report.configuredCacheRoot = cacheRoot;
    report.cacheRoot = fs.realpathSync(cacheRoot);
    const receiptBytes = readRegular(receiptPath, 'build receipt');
    const receipt = JSON.parse(receiptBytes.toString('utf8'));
    report.receiptSha256 = sha256(receiptBytes);
    report.receiptStatus = receipt.status;
    if (receipt.schema !== 1 || receipt.buildStatus !== 'BUILT' || !['BUILT', 'FAIL', 'PASS'].includes(receipt.status)) {
      throw new Error('B1 requires schema 1, buildStatus BUILT and a completed BUILT, FAIL or PASS receipt');
    }
    if (Object.entries(TOOLCHAIN).some(([key, value]) => receipt.toolchain?.[key] !== value)) {
      throw new Error('build receipt does not pin cargo-build-sbf 4.3.0, platform-tools v1.56 and SBPFv3');
    }
    const names = PROGRAMS.map(program => program.name).sort();
    if (!receipt.artifacts || JSON.stringify(Object.keys(receipt.artifacts).sort()) !== JSON.stringify(names)) {
      throw new Error('build receipt must contain exactly the canonical Timepin and Core artifact pair');
    }
    if (!receipt.sourceHashes || Array.isArray(receipt.sourceHashes) || typeof receipt.sourceHashes !== 'object'
      || !Object.keys(receipt.sourceHashes).length) throw new Error('build receipt has no source snapshot');
    assertSourceIdentities(root);
    const beforeSources = sourceStamp(root);
    assertUnchanged(receipt.sourceHashes, beforeSources);
    report.toolchain = { ...TOOLCHAIN };
    report.sourceHashes = beforeSources;
    report.artifacts = structuredClone(receipt.artifacts);
    const files = Object.fromEntries(PROGRAMS.map(program =>
      [program.name, readArtifact(program, receipt.artifacts[program.name], cacheRoot, explicitCache)]));
    report.resolvedArtifactPaths = files;
    const localArtifacts = Object.fromEntries(PROGRAMS.map(program => [program.name,
      { ...receipt.artifacts[program.name], path: files[program.name] }]));
    const verifier = path.join(root, 'tools/verify-artifact.mjs');
    readRegular(verifier, 'artifact verifier');
    for (const program of PROGRAMS) {
      const artifact = receipt.artifacts[program.name];
      const args = [verifier, files[program.name], program.id, artifact.sha256, String(artifact.size)];
      if (explicitCache) args.push('--cache-root', cacheRoot);
      const result = spawn(process.execPath, args,
        { cwd: root, env: artifactEnvironment(localArtifacts), encoding: 'utf8', windowsHide: true,
          maxBuffer: 4 * 1024 * 1024, timeout: 30000 });
      const verification = { program: program.name, exit: result.status ?? null, signal: result.signal ?? null,
        error: result.error?.message || null, stdout: String(result.stdout || ''), stderr: String(result.stderr || '') };
      report.verifiers.push(verification);
      if (result.error || result.status !== 0 || result.signal) {
        throw new Error(program.name + ' artifact verifier failed: ' + (result.error?.message || 'exit ' + verification.exit));
      }
      let output;
      try { output = JSON.parse(verification.stdout); }
      catch { throw new Error(program.name + ' verifier did not return JSON evidence'); }
      assertVerifierTuple(program, artifact, files[program.name], output, report.cacheRoot, explicitCache);
    }
    assertSourceIdentities(root);
    assertUnchanged(beforeSources, sourceStamp(root));
    for (const program of PROGRAMS) readArtifact(program, receipt.artifacts[program.name], cacheRoot, explicitCache);
    if (!readRegular(receiptPath, 'build receipt').equals(receiptBytes)) {
      throw new Error('build receipt changed during the B1 artifact check');
    }
    report.verdict = 'PASS';
  } catch (error) {
    report.failure = error.message;
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const report = args.length === 0 ? checkG2Artifacts()
    : args.length === 2 && args[0] === '--cache-root' ? checkG2Artifacts({ cacheRoot: path.resolve(args[1]) })
    : { schema: 1, gate: 'B1', scope: SCOPE, runtimeChecked: false, verdict: 'FAIL',
      failure: 'usage: node tools/check-g2-artifacts.mjs [--cache-root <local-directory>]' };
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.verdict === 'PASS' ? 0 : 1;
}
