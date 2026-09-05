#!/usr/bin/env node
// Local candidate build after the release lead's source-ready handoff.
// No text search here claims that settlement behavior has been implemented.
// Only the two .so files enter the public artifact cache. Build-sbf's generated
// throwaway keypairs remain in the private temporary --sbf-out-dir.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TOOLCHAIN = Object.freeze({ buildSbf: '4.3.0', platformTools: 'v1.56', arch: 'v3' });
export const FORBIDDEN_ID = 'US517G5965aydkZ46HS38QLi7UQiSojurfbQfKCELFx';
export const PROGRAMS = Object.freeze([
  { name: 'timepin', id: 'C8wwxUGmoKAV22MaY3oW2Q6QeDbmB9dbNdbohsRjJkYp',
    workspace: 'onchain/rcx-timepin-v2', crate: 'rcx-timepin-v2', filename: 'rcx_timepin_v2.so',
    env: 'RCX_TIMEPIN_V2_SO', hashEnv: 'RCX_TIMEPIN_V2_SHA256' },
  { name: 'core', id: 'ANVGVtDrECeyQkS56UZ9ZiWCUxk2JWEVNJioFW8JEwbL',
    workspace: 'onchain/ratchet-core-g2', crate: 'ratchet-core-g2', filename: 'ratchet_core_g2.so',
    env: 'RATCHET_CORE_G2_SO', hashEnv: 'RATCHET_CORE_G2_SHA256' },
]);
export const REQUIRED_SVM_TARGETS = Object.freeze({
  timepin: ['conflict_finalize_expire', 'malformed_state', 'registration_open'],
  core: ['core_g2_lifecycle'],
});
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

export function assertToolchain(output) {
  const match = /(?:^|\n)\s*(?:solana-)?cargo-build-sbf\s+(\S+)/.exec(output);
  if (match?.[1] !== TOOLCHAIN.buildSbf) {
    throw new Error('cargo-build-sbf must be exactly ' + TOOLCHAIN.buildSbf + '; got ' + (match?.[1] || 'unrecognized version output'));
  }
}

// cargo-build-sbf 4.3.0 resolves --tools-version through this home-relative
// cache on all platforms (toolchain.rs::make_platform_tools_path_for_version).
// The pinned package is installed explicitly before program builds.
export function resolvePlatformCompilers({ home = os.homedir(), platform = process.platform } = {}) {
  const directory = path.join(home, '.cache', 'solana', TOOLCHAIN.platformTools, 'platform-tools');
  const suffix = platform === 'win32' ? '.exe' : '';
  const executables = { rustc: path.join(directory, 'rust', 'bin', 'rustc' + suffix),
    clang: path.join(directory, 'llvm', 'bin', 'clang' + suffix) };
  for (const [name, file] of Object.entries(executables)) {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      throw new Error('pinned ' + TOOLCHAIN.platformTools + ' ' + name + ' executable is missing: ' + file);
    }
  }
  return { directory, ...executables };
}

// The pinned Windows builder probes rust/bin/rustc without the .exe suffix.
// Add only that alias, exclusively; never replace another file or follow a link.
export function ensureWindowsRustcAlias({ home = os.homedir(), platform = process.platform } = {}) {
  if (platform !== 'win32') return null;
  const { rustc } = resolvePlatformCompilers({ home, platform });
  const sourceEntry = fs.lstatSync(rustc);
  if (!sourceEntry.isFile() || sourceEntry.isSymbolicLink()) {
    throw new Error('Windows rustc.exe must be a regular non-symlink file: ' + rustc);
  }
  const alias = rustc.slice(0, -'.exe'.length);
  const bytes = fs.readFileSync(rustc);
  let method = 'hardlink-created';
  try { fs.linkSync(rustc, alias); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    method = 'existing-identical-file';
  }
  const entry = fs.lstatSync(alias);
  if (!entry.isFile() || entry.isSymbolicLink()) {
    throw new Error('Windows rustc alias must be a regular non-symlink file: ' + alias);
  }
  if (!fs.readFileSync(alias).equals(bytes) || !fs.readFileSync(rustc).equals(bytes)) {
    throw new Error('Windows rustc alias bytes differ; refusing overwrite: ' + alias);
  }
  if (method !== 'hardlink-created' && entry.dev === sourceEntry.dev && entry.ino === sourceEntry.ino) {
    method = 'existing-hardlink';
  }
  return { path: alias, target: rustc, method, sha256: sha256(bytes), size: bytes.length };
}

export function assertSourceIdentities(root, expected = {}) {
  for (const p of PROGRAMS) {
    if (expected[p.name] !== undefined && expected[p.name] !== p.id) {
      throw new Error(p.name + ' requested identity differs from the canonical build identity');
    }
    const source = fs.readFileSync(path.join(root, p.workspace, 'programs', p.crate, 'src/lib.rs'), 'utf8');
    const ids = [...source.matchAll(/declare_id!\s*\(\s*"([1-9A-HJ-NP-Za-km-z]{32,44})"\s*\)/g)].map(m => m[1]);
    if (ids.length !== 1 || ids[0] !== p.id) {
      throw new Error(p.name + ' source declare_id! must uniquely equal ' + p.id);
    }
  }
}

// The stamp binds both workspace manifests/locks, program and harness Rust,
// nested manifests, build scripts, and fixture bytes. It never reads keypairs.
export function sourceStamp(root) {
  const hashes = {};
  const take = rel => { hashes[rel.replaceAll(path.sep, '/')] = sha256(fs.readFileSync(path.join(root, rel))); };
  const walk = rel => {
    for (const item of fs.readdirSync(path.join(root, rel), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (['target', 'artifacts', '.git', 'node_modules'].includes(item.name) || /keypair|\.keys$/i.test(item.name)) continue;
      const child = path.join(rel, item.name);
      if (item.isSymbolicLink()) throw new Error('symlink build input is not supported: ' + child);
      if (item.isDirectory()) walk(child);
      else if (/\.(rs|toml)$/.test(item.name) || item.name === 'Cargo.lock'
        || (child.split(path.sep).includes('fixtures') && /\.json$/.test(item.name))) take(child);
    }
  };
  for (const p of PROGRAMS) {
    for (const name of ['Cargo.toml', 'Cargo.lock']) {
      const rel = path.join(p.workspace, name);
      if (!fs.statSync(path.join(root, rel)).isFile()) throw new Error('missing required build input: ' + rel);
    }
    walk(p.workspace);
  }
  return Object.fromEntries(Object.entries(hashes).sort(([a], [b]) => a.localeCompare(b)));
}

export function assertUnchanged(before, after) {
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(name => before[name] !== after[name]);
  if (changed.length) throw new Error('source/lockfile drift during build; candidate is not accepted: ' + changed.join(', '));
}

function requireDirectory(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const entry = fs.lstatSync(dir);
  if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error('artifact cache directory must be a real directory: ' + dir);
}

// Snapshot bytes once, create exclusively, and compare the cached bytes on every
// invocation. An existing different file is a hard failure, never an overwrite.
export function pinArtifact(source, filename, cacheRoot = path.join(os.tmpdir(), 'ratchetx-onchain-sbf')) {
  if (!PROGRAMS.some(p => p.filename === filename) || path.basename(source) !== filename) {
    throw new Error('only canonical .so filenames may enter the artifact cache');
  }
  const bytes = fs.readFileSync(source);
  const digest = sha256(bytes);
  requireDirectory(cacheRoot);
  const canonicalCache = fs.realpathSync(cacheRoot);
  const hashDir = path.join(canonicalCache, digest);
  requireDirectory(hashDir);
  const destination = path.join(hashDir, filename);
  try { fs.writeFileSync(destination, bytes, { flag: 'wx', mode: 0o444 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  const entry = fs.lstatSync(destination);
  if (!entry.isFile() || entry.isSymbolicLink()) throw new Error('cached artifact must be a regular file: ' + destination);
  const real = fs.realpathSync(destination);
  if (path.relative(canonicalCache, real) !== path.join(digest, filename)
    || real.split(path.sep).some(part => part.toLowerCase() === 'target')) {
    throw new Error('cached artifact escaped its immutable path: ' + real);
  }
  if (!fs.readFileSync(real).equals(bytes)) throw new Error('existing content-addressed artifact bytes differ; refusing overwrite: ' + real);
  return { path: real, sha256: digest, size: bytes.length };
}

export function artifactEnvironment(artifacts, base = process.env) {
  const env = { ...base, EXPECT_SBPF: '3', REQUIRE_CONTENT_ADDRESS: '1', FORBID_PROGRAM_IDS: FORBIDDEN_ID };
  delete env.RATCHET_ALLOW_SKIPS;
  for (const p of PROGRAMS) {
    const artifact = artifacts[p.name];
    if (!artifact) continue;
    env[p.env] = artifact.path;
    env[p.hashEnv] = artifact.sha256;
    env[p.env + '_SHA256'] = artifact.sha256;
  }
  return env;
}

export function assertVectorArtifact(root, artifact) {
  for (const filename of ['register-open-v2.json', 'lifecycle-v2.json']) {
    const file = path.join(root, PROGRAMS[0].workspace, 'vectors', filename);
    const vector = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (vector.programId !== PROGRAMS[0].id || vector.deployableIdentity !== true
      || vector.localSbfEvidence?.sha256 !== artifact.sha256 || vector.localSbfEvidence?.size !== artifact.size) {
      throw new Error(filename + ' does not pin the freshly built canonical Timepin artifact; regenerate vectors from source + this artifact, then review them');
    }
  }
}

function assertCachedArtifact(program, artifact, cacheRoot) {
  if (!artifact || artifact.programId !== program.id || !/^[0-9a-f]{64}$/.test(artifact.sha256)
    || !Number.isSafeInteger(artifact.size) || artifact.size <= 0
    || typeof artifact.path !== 'string' || !path.isAbsolute(artifact.path)) {
    throw new Error('missing or invalid canonical ' + program.name + ' artifact metadata');
  }
  const real = fs.realpathSync(artifact.path);
  if (path.relative(fs.realpathSync(cacheRoot), real) !== path.join(artifact.sha256, program.filename)) {
    throw new Error(program.name + ' artifact must stay in its recorded content-addressed cache path');
  }
  const bytes = fs.readFileSync(real);
  if (bytes.length !== artifact.size || sha256(bytes) !== artifact.sha256) {
    throw new Error(program.name + ' recorded artifact bytes changed; refusing reuse');
  }
}

// Parse only the explicitly selected pretty libtest output. Missing or internally
// inconsistent evidence never becomes a passing execution receipt.
export function inspectSbfTestResult(result) {
  const stdout = String(result.stdout || ''), stderr = String(result.stderr || '');
  const tests = [...stdout.matchAll(/^test (\S+) \.\.\. (ok|FAILED|ignored)(?:, [^\r\n]*)?\r?$/gm)]
    .map(match => ({ name: match[1], result: { ok: 'passed', FAILED: 'failed', ignored: 'ignored' }[match[2]] }));
  const starts = [...stdout.matchAll(/^running (\d+) tests?\r?$/gm)];
  const summaries = [...stdout.matchAll(/^test result: (ok|FAILED)\. (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out;[^\r\n]*$/gm)];
  const summary = summaries.length === 1 ? summaries[0] : null;
  const counts = summary ? { passed: Number(summary[2]), failed: Number(summary[3]), ignored: Number(summary[4]),
    measured: Number(summary[5]), filteredOut: Number(summary[6]) } : null;
  const reportedTests = starts.length === 1 ? Number(starts[0][1]) : null;
  const problems = [];
  if (result.error) problems.push('process error: ' + result.error.message);
  if (result.status !== 0) problems.push('process exit was ' + (result.status ?? 'unavailable'));
  if (result.signal) problems.push('process signal: ' + result.signal);
  if (starts.length !== 1 || summaries.length !== 1) problems.push('expected exactly one libtest start and summary');
  if (!reportedTests || !tests.length) problems.push('required target executed no named tests');
  if (new Set(tests.map(test => test.name)).size !== tests.length) problems.push('duplicate test names in output');
  if (counts) {
    if (summary[1] !== 'ok' || counts.failed) problems.push('required target has failed tests');
    if (counts.ignored) problems.push('required target has ignored tests');
    if (counts.measured || counts.filteredOut) problems.push('required target has measured or filtered tests');
    if (reportedTests !== counts.passed + counts.failed + counts.ignored + counts.measured
      || tests.length !== reportedTests
      || ['passed', 'failed', 'ignored'].some(kind => tests.filter(test => test.result === kind).length !== counts[kind])) {
      problems.push('named test results disagree with libtest counts');
    }
  }
  // Preserve only explicitly emitted CU measurements, never infer fixture costs.
  const measurements = [['stdout', stdout], ['stderr', stderr]].flatMap(([stream, output]) =>
    output.split(/\r?\n/).map((line, index) => ({ stream, line: index + 1, text: line }))
      .filter(item => /\bcompute_units(?:_consumed)?\s*[=:]\s*\d+|\bCU:\s*(?:\d+|[a-z_]+\s*=\s*\d+)|\b[a-z_]+\s*=\s*\d+\s+CU\b/i.test(item.text)));
  return { accepted: problems.length === 0, problems, exit: result.status ?? null, signal: result.signal ?? null,
    processError: result.error?.message || null, reportedTests, counts, tests,
    stdout, stderr, stdoutSha256: sha256(Buffer.from(stdout)), stderrSha256: sha256(Buffer.from(stderr)),
    computeUnits: { status: measurements.length ? 'emitted-log-lines' : 'unavailable', measurements } };
}

export function discoverSvmTargets(metadata, cwd, program) {
  const packages = metadata?.packages;
  if (!Array.isArray(packages)) throw new Error('Cargo metadata has no packages');
  const manifest = path.resolve(cwd, 'Cargo.toml');
  const matches = packages.filter(item => typeof item.manifest_path === 'string' && path.resolve(item.manifest_path) === manifest);
  if (matches.length !== 1) throw new Error(program.name + ' SVM package is absent or ambiguous in Cargo metadata');
  const targets = matches[0].targets;
  if (!Array.isArray(targets)) throw new Error(program.name + ' SVM package has no targets');
  const names = targets.filter(target => target.kind?.includes('test')).map(target => target.name);
  if (!names.length || names.some(name => typeof name !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(name))
    || new Set(names).size !== names.length) throw new Error(program.name + ' SVM test targets are empty or invalid');
  const missing = REQUIRED_SVM_TARGETS[program.name].filter(name => !names.includes(name));
  if (missing.length) throw new Error(program.name + ' required SVM targets are missing: ' + missing.join(', '));
  return names.sort();
}

export function runBuild({ root = ROOT, expected = {}, ci = false, buildOnly = false, verifyArtifacts = false, spawn = spawnSync, log = console.log,
  cacheRoot = path.join(os.tmpdir(), 'ratchetx-onchain-sbf'), platformHome = os.homedir(), platform = process.platform } = {}) {
  const receiptPath = path.join(root, 'docs/receipts/g2-build-artifacts.json');
  const reportPath = path.join(root, 'build_g2_report.txt');
  if ([ci, buildOnly, verifyArtifacts].filter(Boolean).length > 1) throw new Error('choose one build mode');
  // Reuse accepts only our fixed receipt path, never a caller-selected manifest.
  const previous = verifyArtifacts ? JSON.parse(fs.readFileSync(receiptPath, 'utf8')) : null;
  if (previous && (previous.schema !== 1 || !['BUILT', 'FAIL'].includes(previous.status)
    || previous.buildStatus !== 'BUILT')) {
    throw new Error('--verify-artifacts requires a completed BUILT receipt (or its failed verification attempt)');
  }
  const receipt = previous
    ? { ...previous, status: 'RUNNING', mode: 'verify-artifacts', verificationStartedAt: new Date().toISOString(),
      stages: [...previous.stages] }
    : { schema: 1, status: 'RUNNING', evidenceTier: 'local candidate; no deployment',
      startedAt: new Date().toISOString(), mode: buildOnly ? 'build-only' : ci ? 'ci' : 'local',
      toolchain: TOOLCHAIN, sourceHashes: {}, artifacts: {}, stages: [] };
  delete receipt.finishedAt;
  delete receipt.failure;
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  if (!verifyArtifacts) fs.writeFileSync(reportPath, '');
  const save = () => fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
  const emit = message => { log(message); fs.appendFileSync(reportPath, message + '\n'); };
  const stage = (name, command, args, cwd = root, env = process.env, execution = null, stdoutOnly = false) => {
    emit('START ' + name);
    const result = spawn(command, args, { cwd, env, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
    const output = (result.stdout || '') + (result.stderr || '');
    fs.appendFileSync(reportPath, output);
    // Match the established verify-onchain.ps1 rule. LLVM can emit this while
    // cargo exits zero; accepting that artifact would turn a diagnostic into GO.
    const stackOverflow = args[0] === 'build-sbf' && /Stack offset of .*exceeded max offset/i.test(output);
    const evidence = execution ? { schema: 1, ...execution, artifactBindings: structuredClone(receipt.artifacts),
      sourceHashes: { ...receipt.sourceHashes }, ...inspectSbfTestResult(result) } : null;
    if (evidence) {
      // Bind a completed run to the source and immutable bytes that were supplied.
      try {
        assertUnchanged(receipt.sourceHashes, sourceStamp(root));
        for (const program of PROGRAMS) assertCachedArtifact(program, receipt.artifacts[program.name], cacheRoot);
      } catch (error) { evidence.accepted = false; evidence.problems.push(error.message); }
    }
    const diagnosticFailure = stackOverflow ? 'SBF stack-frame overflow'
      : evidence && !evidence.accepted ? 'SBF execution evidence rejected' : null;
    const entry = { name, command, args, cwd, exit: result.status ?? null, signal: result.signal ?? null,
      ...(diagnosticFailure ? { diagnosticFailure } : {}), ...(evidence ? { execution: evidence } : {}) };
    receipt.stages.push(entry);
    save();
    if (result.error || result.status !== 0 || diagnosticFailure) {
      emit('FAIL ' + name + ' (exit ' + entry.exit + (stackOverflow ? ', SBF stack-frame overflow' : '') + ')');
      throw new Error(name + ': ' + (stackOverflow ? 'SBF stack-frame overflow despite cargo exit ' + entry.exit
        : evidence && !evidence.accepted ? evidence.problems.join('; ')
        : result.error?.message || 'exit ' + entry.exit + (entry.signal ? ', signal ' + entry.signal : '')) + '; read ' + reportPath);
    }
    emit('PASS ' + name);
    return stdoutOnly ? String(result.stdout || '') : output;
  };
  save();
  try {
    assertSourceIdentities(root, expected);
    if (verifyArtifacts) {
      assertUnchanged(receipt.sourceHashes, sourceStamp(root));
    } else {
      receipt.sourceHashes = sourceStamp(root);
      emit('PASS source identities; behavior readiness is the release lead handoff, not a text check.');
      const version = stage('build-sbf version', 'cargo-build-sbf', ['--version']);
      assertToolchain(version);
      receipt.buildSbfVersionOutput = version.trim();
      stage('cargo version', 'cargo', ['--version']);
      stage('install pinned platform tools', 'cargo-build-sbf', ['--install-only', '--tools-version', TOOLCHAIN.platformTools]);
      const alias = ensureWindowsRustcAlias({ home: platformHome, platform });
      receipt.platformPreparation = { platform, version: TOOLCHAIN.platformTools, rustcAlias: alias };
      if (alias) {
        const output = stage('Windows rustc alias version', alias.path, ['--version']);
        if (!/\brustc \d+\.\d+/.test(output)) throw new Error('Windows rustc alias did not report a compiler version');
        alias.versionOutput = output.trim();
      }
      save();
      const runDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ratchetx-g2-build-'));
      for (const p of PROGRAMS) {
        const out = path.join(runDirectory, 'raw', p.name);
        fs.mkdirSync(out, { recursive: true });
        stage(p.name + ' SBPFv3 build', 'cargo',
          ['build-sbf', '--arch', TOOLCHAIN.arch, '--tools-version', TOOLCHAIN.platformTools, '--sbf-out-dir', out, '--', '--locked'],
          path.join(root, p.workspace));
        assertUnchanged(receipt.sourceHashes, sourceStamp(root));
        const compilers = resolvePlatformCompilers({ home: platformHome, platform });
        const compilerEvidence = { version: TOOLCHAIN.platformTools, directory: compilers.directory };
        for (const name of ['rustc', 'clang']) {
          const output = stage(p.name + ' pinned ' + name + ' version', compilers[name], ['--version']);
          if (!(name === 'rustc' ? /\brustc \d+\.\d+/ : /\bclang version \d+\.\d+/).test(output)) {
            throw new Error('pinned ' + name + ' did not report a compiler version');
          }
          compilerEvidence[name] = { path: compilers[name], versionOutput: output.trim(),
            sha256: sha256(fs.readFileSync(compilers[name])) };
        }
        if (alias && compilerEvidence.rustc.sha256 !== alias.sha256) {
          throw new Error('Windows rustc changed after alias preparation');
        }
        if (receipt.platformCompilers && JSON.stringify(receipt.platformCompilers) !== JSON.stringify(compilerEvidence)) {
          throw new Error('pinned platform compiler versions changed between program builds');
        }
        receipt.platformCompilers = compilerEvidence;
        save();
        const artifact = { programId: p.id, ...pinArtifact(path.join(out, p.filename), p.filename, cacheRoot) };
        receipt.artifacts[p.name] = artifact;
        stage(p.name + ' strict artifact verification', process.execPath,
          [path.join(root, 'tools/verify-artifact.mjs'), artifact.path, p.id, artifact.sha256, String(artifact.size)],
          root, artifactEnvironment(receipt.artifacts));
        emit(p.name + ' ' + artifact.size + ' bytes SHA256 ' + artifact.sha256 + ' ' + artifact.path);
      }
    }
    assertUnchanged(receipt.sourceHashes, sourceStamp(root));
    const env = artifactEnvironment(receipt.artifacts);
    // Read the exact recorded pair before any vector or transaction consumer.
    for (const p of PROGRAMS) {
      const artifact = receipt.artifacts[p.name];
      assertCachedArtifact(p, artifact, cacheRoot);
      stage(p.name + (verifyArtifacts ? ' reused artifact readback' : ' built artifact readback'), process.execPath,
        [path.join(root, 'tools/verify-artifact.mjs'), artifact.path, p.id, artifact.sha256, String(artifact.size)], root, env);
    }
    assertUnchanged(receipt.sourceHashes, sourceStamp(root));
    receipt.buildStatus = 'BUILT';
    if (buildOnly) {
      receipt.status = 'BUILT';
      receipt.evidenceTier = 'SBPFv3 artifact pair verified; vectors and exact-SBF not run; no deployment';
      receipt.finishedAt = new Date().toISOString();
      save();
      emit('BUILT G2 artifact pair. Regenerate vectors from source + these artifacts, then use --verify-artifacts. Receipt: ' + receiptPath);
      return receipt;
    }
    // Both modes only CHECK reviewed vectors. Identity-only repin is not a
    // source-derived generator and must not silently rewrite release evidence.
    assertVectorArtifact(root, receipt.artifacts.timepin);
    emit('PASS committed vectors pin the freshly built Timepin artifact.');
    stage('Timepin vector check', process.execPath,
      [path.join(root, 'tools/repin-timepin-vectors.mjs'), '--check'], root, env);
    for (const p of PROGRAMS) {
      const cwd = path.join(root, p.workspace, 'svm-tests');
      const metadata = JSON.parse(stage(p.name + ' SVM target inventory', 'cargo',
        ['metadata', '--locked', '--no-deps', '--format-version', '1'], cwd, env, null, true));
      const targets = discoverSvmTargets(metadata, cwd, p);
      for (const target of targets) {
        assertUnchanged(receipt.sourceHashes, sourceStamp(root));
        for (const program of PROGRAMS) assertCachedArtifact(program, receipt.artifacts[program.name], cacheRoot);
        stage(p.name + ' exact-SBF ' + target, 'cargo',
          ['test', '--locked', '--test', target, '--', '--format', 'pretty', '--show-output', '--test-threads', '1'],
          cwd, env, { program: p.name, programId: p.id, target, requiredTargets: REQUIRED_SVM_TARGETS[p.name], discoveredTargets: targets });
      }
    }
    const npmCommand = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'npm';
    const npmArgs = process.platform === 'win32' ? ['/d', '/s', '/c', 'npm test'] : ['test'];
    if (!ci) stage('JS release gate', npmCommand, npmArgs, root, env);
    assertUnchanged(receipt.sourceHashes, sourceStamp(root));
    // Re-read cached bytes after every consumer; do not certify a changed cache.
    for (const p of PROGRAMS) {
      const artifact = receipt.artifacts[p.name];
      assertCachedArtifact(p, artifact, cacheRoot);
      stage(p.name + ' final artifact readback', process.execPath,
        [path.join(root, 'tools/verify-artifact.mjs'), artifact.path, p.id, artifact.sha256, String(artifact.size)], root, env);
    }
    assertUnchanged(receipt.sourceHashes, sourceStamp(root));
    receipt.status = 'PASS';
    receipt.evidenceTier = 'exact-SBF (LiteSVM)' + (ci ? '; JS gate runs separately in CI' : ' and JS gates') + '; no deployment or live-oracle acceptance';
    receipt.finishedAt = new Date().toISOString();
    save();
    emit('PASS G2 local candidate. Receipt: ' + receiptPath + '. Nothing deployed.');
    return receipt;
  } catch (error) {
    receipt.status = 'FAIL';
    receipt.failure = error.message;
    receipt.finishedAt = new Date().toISOString();
    save();
    emit('FAIL G2 candidate: ' + error.message);
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log('After the source-ready handoff: node tools/g2-build-artifacts.mjs <--build|--build-only|--verify-artifacts|--ci> --timepin-id <canonical-id> --core-id <canonical-id>');
  } else if (args.length !== 5 || !['--build', '--build-only', '--verify-artifacts', '--ci'].includes(args[0]) || args[1] !== '--timepin-id' || args[3] !== '--core-id') {
    console.error('Expected <--build|--build-only|--verify-artifacts|--ci> --timepin-id <canonical-id> --core-id <canonical-id>; use --help.');
    process.exitCode = 2;
  } else {
    try { runBuild({ ci: args[0] === '--ci', buildOnly: args[0] === '--build-only', verifyArtifacts: args[0] === '--verify-artifacts', expected: { timepin: args[2], core: args[4] } }); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
