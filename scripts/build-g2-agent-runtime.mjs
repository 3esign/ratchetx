#!/usr/bin/env node
// Build the exact public source closure; never enumerate ops, keys, env or live state.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = 'skills/ratchetx-g2/scripts/g2-session.mjs';
const VENDOR = 'vendor/solana-web3-1.98.4.min.js';
const EXPECTED_VENDOR = '09cdbea951b2ed0e11bcbe3aeb1ee9f035f9fb51ed212aca645475ae82688cc3';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = (ok, message) => { if (!ok) throw new Error(message); };
const allowed = name => /^(lib\/g2\/[a-z0-9-]+\.(?:mjs|json)|onchain\/ratchet-(?:core-g2|timepin-v2)\/client\/[a-z0-9_-]+\.mjs|skills\/ratchetx(?:-g2)?\/scripts\/[a-z0-9-]+\.mjs|vendor\/solana-web3-1\.98\.4\.min\.js)$/.test(name);
function publicRead(root, name) {
  fail(allowed(name) && !/(^|\/)(?:\.env|secrets|ops|data|[^/]*keypair)/i.test(name), 'Not an allowed public runtime source: ' + name);
  const target = path.resolve(root, ...name.split('/'));
  fail(target.startsWith(root + path.sep), 'Runtime source escaped the project');
  const stat = fs.lstatSync(target); fail(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 2_000_000, 'Unsafe runtime source: ' + name);
  const data = fs.readFileSync(target);
  return name === VENDOR ? data : Buffer.from(data.toString('utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n'));
}
function imports(source) {
  const values = [];
  const re = /(?:import|export)\s+(?:[^;'"\n]+?\s+from\s*)?['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const match of source.matchAll(re)) values.push(match[1] || match[2]);
  return values;
}
function licensing(root) {
  // The prebuilt browser SDK already includes its dependencies. Their installed
  // license texts are public package metadata; nothing is installed or executed.
  const packages = ['@solana/web3.js', '@noble/curves', '@noble/hashes', '@solana/buffer-layout', '@solana/codecs-numbers',
    '@solana/codecs-core', '@solana/errors', 'bn.js', 'borsh', 'bs58', 'base-x', 'buffer', 'base64-js', 'ieee754',
    'fast-stable-stringify', 'superstruct', 'rpc-websockets', 'eventemitter3', 'uuid', '@babel/runtime', 'jayson'];
  let out = 'RatchetX G2 local runtime\nUses the existing Solana web3.js 1.98.4 browser distribution, SHA-256 ' + EXPECTED_VENDOR + '.\n\n';
  for (const name of packages) {
    const directory = path.join(root, 'node_modules', ...name.split('/'));
    const manifest = path.join(directory, 'package.json');
    if (!fs.existsSync(manifest)) continue;
    const data = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    const license = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENSE-MIT', 'COPYING'].map(file => path.join(directory, file)).find(file => fs.existsSync(file));
    if (!license) continue;
    out += '\n==== ' + name + ' ' + data.version + ' ====\n' + fs.readFileSync(license, 'utf8').replace(/\r\n/g, '\n') + '\n';
  }
  fail(out.includes('==== @solana/web3.js 1.98.4 ===='), 'The pinned SDK license is required');
  return Buffer.from(out);
}
export function buildRuntime(root = ROOT) {
  root = path.resolve(root); const entries = new Map();
  function add(name) {
    name = path.posix.normalize(name); if (entries.has(name)) return;
    const data = publicRead(root, name); entries.set(name, data);
    if (!name.endsWith('.mjs')) return;
    for (const spec of imports(data.toString('utf8'))) {
      if (spec.startsWith('node:')) continue;
      fail(spec.startsWith('.'), 'Unpinned package import in ' + name + ': ' + spec);
      add(path.posix.join(path.posix.dirname(name), spec));
    }
  }
  add(ENTRY); add('lib/g2/devnet-config.json'); add(VENDOR);
  fail(entries.has('lib/g2/agent-session.mjs'), 'The local G2 runner must be present');
  fail(sha(entries.get(VENDOR)) === EXPECTED_VENDOR, 'Existing Solana vendor integrity changed');
  const config = JSON.parse(entries.get('lib/g2/devnet-config.json'));
  fail(config.clusterGenesis === 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG' && config.scope === 'DEVNET_TEST_CREDITS_ONLY', 'Only the devnet test-credit generation can be packaged');
  entries.set('THIRD_PARTY_LICENSES.txt', licensing(root));
  const files = [...entries].sort(([a], [b]) => a.localeCompare(b)).map(([name, data]) => ({ path: name, sha256: sha(data), bytes: data.length, base64: data.toString('base64') }));
  const value = { schema: 1, scope: 'DEVNET_AGENT_RUNTIME', entry: ENTRY, node: '>=20.11',
    generation: { clusterGenesis: config.clusterGenesis, core: config.programs.core, timepin: config.programs.timepin, economyHash: config.economyHash, rulesetHash: config.rulesetHash },
    dependencies: { '@solana/web3.js': { version: '1.98.4', sha256: EXPECTED_VENDOR, format: 'existing browser IIFE; Node stdlib loader' } }, files };
  const archive = gzipSync(Buffer.from(JSON.stringify(value)), { level: 9 });
  const release = { schema: 1, url: 'https://ratchetx.xyz/releases/g2-agent-runtime.json.gz', sha256: sha(archive), bytes: archive.length, entry: ENTRY };
  const manifest = { ...release, scope: value.scope, node: value.node, generation: value.generation, dependencies: value.dependencies,
    sourceBytes: files.reduce((sum, row) => sum + row.bytes, 0), files: files.map(({ base64: _omitted, ...publicRow }) => publicRow) };
  return { archive, release, manifest };
}
function writeAtomic(file, bytes) {
  const tmp = file + '.build-tmp';
  try { fs.writeFileSync(tmp, bytes, { flag: 'wx' }); fs.renameSync(tmp, file); }
  catch (error) { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); throw error; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const built = buildRuntime();
  fs.mkdirSync(path.join(ROOT, 'releases'), { recursive: true });
  writeAtomic(path.join(ROOT, 'releases/g2-agent-runtime.json.gz'), built.archive);
  writeAtomic(path.join(ROOT, 'releases/g2-agent-runtime.manifest.json'), JSON.stringify(built.manifest, null, 2) + '\n');
  const installer = path.join(ROOT, 'skills/ratchetx-g2/scripts/install.mjs');
  const source = fs.readFileSync(installer, 'utf8');
  fail(/^const RELEASE = \{[^\n]+\};$/m.test(source), 'Installer release pin marker missing');
  writeAtomic(installer, source.replace(/^const RELEASE = \{[^\n]+\};$/m, 'const RELEASE = ' + JSON.stringify(built.release) + ';'));
  const installerDigest = sha(fs.readFileSync(installer));
  const skill = path.join(ROOT, 'skills/ratchetx-g2/SKILL.md');
  if (fs.existsSync(skill)) {
    const content = fs.readFileSync(skill, 'utf8');
    fail(/runtime-sha256: "[^"]+"/.test(content), 'Skill runtime pin marker missing');
    writeAtomic(skill, content.replace(/runtime-sha256: "[^"]+"/, 'runtime-sha256: "' + built.release.sha256 + '"')
      .replace(/installer-sha256: "[^"]+"/, 'installer-sha256: "' + installerDigest + '"'));
  }
  // THE MIRROR, AND IT IS NOT OPTIONAL. skills/ratchetx is the path the site
  // tells a Bankr user to install from, and until 2026-09-10 nothing kept its
  // pins in step with skills/ratchetx-g2. The consequence is quiet and total: an
  // agent fetches the mirror's installer, that installer names the OLD archive,
  // verifies it against the OLD hash, succeeds, and runs a client built for
  // programs that no longer exist. A hash pin protects you from a corrupted
  // download; nothing protects you from a faithful copy of the wrong thing
  // except writing both at once, here.
  const mirrorInstaller = path.join(ROOT, 'skills/ratchetx/scripts/install.mjs');
  if (fs.existsSync(mirrorInstaller)) {
    const source = fs.readFileSync(mirrorInstaller, 'utf8');
    fail(/^const RELEASE = \{[^\n]+\};$/m.test(source), 'Mirror installer release pin marker missing');
    writeAtomic(mirrorInstaller, source.replace(/^const RELEASE = \{[^\n]+\};$/m, 'const RELEASE = ' + JSON.stringify(built.release) + ';'));
    const mirrorSkill = path.join(ROOT, 'skills/ratchetx/SKILL.md');
    if (fs.existsSync(mirrorSkill)) {
      const content = fs.readFileSync(mirrorSkill, 'utf8');
      fail(/runtime-sha256: "[^"]+"/.test(content), 'Mirror skill runtime pin marker missing');
      writeAtomic(mirrorSkill, content.replace(/runtime-sha256: "[^"]+"/, 'runtime-sha256: "' + built.release.sha256 + '"')
        .replace(/installer-sha256: "[^"]+"/, 'installer-sha256: "' + sha(fs.readFileSync(mirrorInstaller)) + '"'));
    }
  }
  process.stdout.write(JSON.stringify({ ok: true, code: 'RUNTIME_BUILT', ...built.release, sourceBytes: built.manifest.sourceBytes, files: built.manifest.files.map(row => row.path) }) + '\n');
}
