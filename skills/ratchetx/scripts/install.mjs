#!/usr/bin/env node
// Small offline-capable installer. Only a pinned public artifact is executable.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomBytes } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Updated by scripts/build-g2-agent-runtime.mjs from the exact packaged public files.
const RELEASE = {"schema":1,"url":"https://ratchetx.xyz/releases/g2-agent-runtime.json.gz","sha256":"2d4d45761e7b58a5ecfb11e5d0180e84fd65c19746994cbe2f0975ab0d2ab8d9","bytes":315009,"entry":"skills/ratchetx-g2/scripts/g2-session.mjs"};
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = (ok, code) => { if (!ok) { const e = new Error(code); e.code = code; throw e; } };
const boundedPath = (root, name) => {
  fail(typeof name === 'string' && /^[A-Za-z0-9_.\-/]+$/.test(name) && !name.startsWith('/') &&
    !name.split('/').some(part => !part || part === '.' || part === '..'), 'UNSAFE_PACKAGE_PATH');
  const target = path.resolve(root, ...name.split('/'));
  fail(target.startsWith(path.resolve(root) + path.sep), 'UNSAFE_PACKAGE_PATH'); return target;
};
const safePublicName = name => /^(lib\/g2\/[a-z0-9-]+\.(?:mjs|json)|onchain\/ratchet-(?:core-g2|timepin-v2)\/client\/[a-z0-9_-]+\.mjs|skills\/ratchetx(?:-g2)?\/scripts\/[a-z0-9-]+\.mjs|vendor\/solana-web3-1\.98\.4\.min\.js|THIRD_PARTY_LICENSES\.txt)$/.test(name);
function ensurePrivateDirectory(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const info = fs.lstatSync(dir);
  fail(info.isDirectory() && !info.isSymbolicLink(), 'UNSAFE_INSTALL_PATH');
  if (process.platform !== 'win32') fail((info.mode & 0o077) === 0, 'UNSAFE_INSTALL_PERMISSIONS');
}
function writeNew(file, bytes) {
  const fd = fs.openSync(file, 'wx', 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
export function verifyArchive(bytes, release = RELEASE) {
  fail(release.schema === 1 && /^[a-f0-9]{64}$/.test(release.sha256), 'BUILD_REQUIRED');
  fail(bytes.length === release.bytes && sha(bytes) === release.sha256, 'PACKAGE_INTEGRITY_FAILED');
  const decoded = gunzipSync(bytes, { maxOutputLength: 8_000_000 });
  const value = JSON.parse(decoded.toString('utf8'));
  fail(value.schema === 1 && value.scope === 'DEVNET_AGENT_RUNTIME' && value.entry === release.entry &&
    Array.isArray(value.files) && value.files.length > 0 && value.files.length <= 100, 'INVALID_PACKAGE');
  const names = new Set(); let total = 0;
  for (const row of value.files) {
    fail(row && safePublicName(row.path) && !names.has(row.path) && /^[a-f0-9]{64}$/.test(row.sha256) &&
      typeof row.base64 === 'string' && Number.isSafeInteger(row.bytes) && row.bytes > 0 && row.bytes <= 2_000_000, 'INVALID_PACKAGE_FILE');
    boundedPath(os.tmpdir(), row.path); names.add(row.path);
    const data = Buffer.from(row.base64, 'base64');
    fail(data.length === row.bytes && data.toString('base64') === row.base64 && sha(data) === row.sha256, 'PACKAGE_FILE_INTEGRITY_FAILED');
    total += data.length; fail(total <= 6_000_000, 'PACKAGE_TOO_LARGE');
  }
  fail(names.has(value.entry) && names.has('vendor/solana-web3-1.98.4.min.js') && names.has('lib/g2/agent-session.mjs') &&
    value.dependencies?.['@solana/web3.js']?.version === '1.98.4', 'INCOMPLETE_PACKAGE');
  return value;
}
function verifyInstalled(root, value) {
  for (const row of value.files) {
    const target = boundedPath(root, row.path); let cursor = root;
    for (const part of row.path.split('/')) { cursor = path.join(cursor, part); fail(!fs.lstatSync(cursor).isSymbolicLink(), 'UNSAFE_INSTALL_PATH'); }
    const data = fs.readFileSync(target); fail(data.length === row.bytes && sha(data) === row.sha256, 'INSTALLED_RUNTIME_MODIFIED');
  }
}
export async function install({ archiveFile, home = process.env.RATCHET_G2_HOME || path.join(os.homedir(), '.ratchetx-g2'), dryRun = false,
  release = RELEASE, fetchImpl = fetch } = {}) {
  const [major, minor] = process.versions.node.split('.').map(Number);
  fail(major > 20 || major === 20 && minor >= 11, 'NODE_20_11_REQUIRED');
  fail(path.isAbsolute(home), 'INSTALL_HOME_MUST_BE_ABSOLUTE');
  let bytes;
  if (archiveFile) {
    const stat = fs.lstatSync(archiveFile); fail(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 4_000_000, 'UNSAFE_ARCHIVE_FILE');
    bytes = fs.readFileSync(archiveFile);
  } else {
    fail(/^https:\/\/ratchetx\.xyz\/releases\/g2-agent-runtime\.json\.gz$/.test(release.url), 'UNSAFE_PACKAGE_URL');
    const response = await fetchImpl(release.url, { redirect: 'error', signal: AbortSignal.timeout(60000) });
    fail(response.ok, 'PACKAGE_DOWNLOAD_FAILED');
    const reader = response.body.getReader(), chunks = []; let size = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; fail(size <= 4_000_000, 'PACKAGE_TOO_LARGE'); chunks.push(value); }
    bytes = Buffer.concat(chunks);
  }
  const value = verifyArchive(bytes, release);
  if (dryRun) return { ok: true, code: 'PACKAGE_VERIFIED', sha256: release.sha256, files: value.files.length, bytes: bytes.length,
    noFilesWritten: true, noIdentityCreated: true, noTransactionSent: true, reply: 'Pinned G2 runtime verified. Dry run made no changes.' };
  ensurePrivateDirectory(home);
  const runtimeRoot = path.join(home, 'runtime'); ensurePrivateDirectory(runtimeRoot);
  const version = boundedPath(runtimeRoot, release.sha256);
  const lock = path.join(runtimeRoot, '.install.lock'); let fd;
  try {
    fd = fs.openSync(lock, 'wx', 0o600); fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, release: release.sha256 }));
    if (fs.existsSync(version)) { ensurePrivateDirectory(version); verifyInstalled(version, value); }
    else {
      const stage = boundedPath(runtimeRoot, '.pending-' + randomBytes(12).toString('hex')); ensurePrivateDirectory(stage);
      for (const row of value.files) {
        const target = boundedPath(stage, row.path); fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
        writeNew(target, Buffer.from(row.base64, 'base64'));
      }
      verifyInstalled(stage, value);
      // Both resolved absolute paths are strict children of this private runtime directory.
      fail(stage.startsWith(runtimeRoot + path.sep) && version.startsWith(runtimeRoot + path.sep), 'UNSAFE_INSTALL_PATH');
      fs.renameSync(stage, version);
    }
    const launcher = path.join(home, 'run.mjs'), temporary = path.join(home, '.run-' + randomBytes(12).toString('hex') + '.tmp');
    const relativeEntry = './runtime/' + release.sha256 + '/' + release.entry;
    const source = '#!/usr/bin/env node\nimport { spawnSync } from "node:child_process";\nimport { fileURLToPath } from "node:url";\n' +
      'const entry = fileURLToPath(new URL(' + JSON.stringify(relativeEntry) + ', import.meta.url));\n' +
      'const result = spawnSync(process.execPath, [entry, ...process.argv.slice(2)], { stdio: "inherit", windowsHide: true, env: { ...process.env, RATCHET_G2_HOME: fileURLToPath(new URL(".", import.meta.url)) } });\n' +
      'process.exitCode = result.status ?? 1;\n';
    if (fs.existsSync(launcher)) fail(fs.lstatSync(launcher).isFile() && !fs.lstatSync(launcher).isSymbolicLink(), 'UNSAFE_INSTALL_PATH');
    writeNew(temporary, Buffer.from(source)); fs.renameSync(temporary, launcher);
    return { ok: true, code: 'RUNTIME_INSTALLED', sha256: release.sha256, files: value.files.length, entry: launcher,
      identityUnchanged: true, noTransactionSent: true, reply: 'RatchetX G2 runtime installed. Your existing identity and command journal were preserved. Next: run init with the player’s public Solana address, then review the public setup link.' };
  } finally { if (fd !== undefined) { fs.closeSync(fd); fs.unlinkSync(lock); } }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const options = {};
    for (let i = 2; i < process.argv.length; i++) {
      const flag = process.argv[i];
      if (flag === '--dry-run') { fail(!options.dryRun, 'INVALID_ARGUMENTS'); options.dryRun = true; }
      else if (flag === '--archive' || flag === '--home') { const name = flag === '--archive' ? 'archiveFile' : 'home'; fail(!options[name] && process.argv[i + 1], 'INVALID_ARGUMENTS'); options[name] = process.argv[++i]; }
      else fail(false, 'INVALID_ARGUMENTS');
    }
    process.stdout.write(JSON.stringify(await install(options)) + '\n');
  } catch (error) { process.stdout.write(JSON.stringify({ ok: false, code: /^[A-Z_]+$/.test(error?.code || '') ? error.code : 'INSTALL_FAILED',
    reply: 'G2 installation did not finish. Your existing agent identity was not changed. Keep the current state directory and use the verified installer again.' }) + '\n'); process.exitCode = 1; }
}
