#!/usr/bin/env node
// Both entry points use this adapter; vector-data.mjs is the only data generator.
import { readFileSync, realpathSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PublicKey } from '@solana/web3.js';
import {
  generateTimepinVectors, assertTimepinVectors, validateArtifactTuple, serializeVector,
  PROGRAM_ID, HISTORICAL_PROGRAM_ID, SBF_FILENAME, VECTOR_FILENAMES,
} from './vector-data.mjs';

export const TIMEPIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_ROOT = resolve(TIMEPIN_ROOT, '..', '..');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const stable = value => value.split(sep).join('/');
export const usage = 'node <generate-vectors.mjs|repin-timepin-vectors.mjs> [--check] [--sbf <immutable.so>] [--out <vectors-dir>] [--fixture <fixture-input.json>]\nWrite requires --sbf (alias --artifact); default output is canonical vectors/. --check never writes and can resolve the pinned tuple from tmpdir(). --to accepts only the canonical Timepin ID; --deployable does not claim deployment or runtime proof.';

export function parseVectorArgs(argv) {
  const args = {};
  const booleans = new Set(['check', 'deployable', 'help']);
  const values = new Set(['sbf', 'artifact', 'out', 'in', 'fixture', 'to']);
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (!flag.startsWith('--') || (!booleans.has(flag.slice(2)) && !values.has(flag.slice(2)))) throw new Error('unknown argument: ' + flag);
    const name = flag.slice(2);
    if (Object.hasOwn(args, name)) throw new Error('duplicate flag ' + flag);
    if (booleans.has(name)) args[name] = true;
    else {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error(flag + ' requires a value');
      args[name] = value;
    }
  }
  if (args.sbf && args.artifact) throw new Error('--sbf and --artifact are aliases; provide one');
  if (args.to && args.to !== PROGRAM_ID) throw new Error('--to must equal canonical Timepin program identity ' + PROGRAM_ID);
  if (args.help && Object.keys(args).length !== 1) throw new Error('--help must be used alone');
  if (args.in && args.out) throw new Error('--in and --out select one vector directory; provide one');
  if (args.in && !args.check) throw new Error('--in is a check-only compatibility alias; use --out to write');
  return args;
}

export function readVerifiedArtifact(path, { cacheRoot = join(tmpdir(), 'ratchetx-onchain-sbf') } = {}) {
  const lexicalPath = resolve(path);
  if (lexicalPath.split(/[\\/]+/).some(part => part.toLowerCase() === 'target')) throw new Error('artifact path contains mutable target directory');
  const realPath = realpathSync(lexicalPath);
  const realCache = realpathSync(cacheRoot);
  const realCacheParent = realpathSync(dirname(resolve(cacheRoot)));
  if (stable(relative(realCacheParent, realCache)) !== 'ratchetx-onchain-sbf') throw new Error('artifact cache must not traverse an escaping symlink');
  const bytes = readFileSync(realPath);
  const sha = sha256(bytes);
  const expectedRelative = sha + '/' + SBF_FILENAME;
  if (stable(relative(resolve(cacheRoot), lexicalPath)) !== expectedRelative
      || stable(relative(realCache, realPath)) !== expectedRelative) throw new Error('artifact must have exact immutable content-addressed cache path');
  if (bytes.length < 64 || !bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))
      || bytes[4] !== 2 || bytes[5] !== 1 || bytes.readUInt32LE(48) !== 3) throw new Error('artifact must be a complete ELF64 little-endian SBPFv3 header');
  if (!bytes.includes(new PublicKey(PROGRAM_ID).toBuffer())) throw new Error('artifact is missing canonical Timepin program ID');
  if (bytes.includes(new PublicKey(HISTORICAL_PROGRAM_ID).toBuffer())) throw new Error('artifact contains forbidden historical program ID');
  return validateArtifactTuple({ path: 'ratchetx-onchain-sbf/' + expectedRelative, size: bytes.length, sha256: sha, elfFlags: 3, sbpfVersion: 3 });
}

export function assertSourceIdentity(root = TIMEPIN_ROOT) {
  const source = readFileSync(join(root, 'programs/rcx-timepin-v2/src/lib.rs'), 'utf8');
  const declared = [...source.matchAll(/declare_id!\s*\(\s*"([^"]+)"\s*\)/g)].map(match => match[1]);
  if (declared.length !== 1 || declared[0] !== PROGRAM_ID) throw new Error('source declare_id does not match canonical Timepin identity');
  const anchor = readFileSync(join(root, 'Anchor.toml'), 'utf8');
  const anchored = [...anchor.matchAll(/^\s*rcx_timepin_v2\s*=\s*"([^"]+)"/gm)].map(match => match[1]);
  if (!anchored.length || anchored.some(id => id !== PROGRAM_ID)) throw new Error('Anchor.toml does not match canonical Timepin identity');
}

export function runVectorCommand(argv, { timepinRoot = TIMEPIN_ROOT, cwd = process.cwd(), env = process.env,
  cacheRoot = join(tmpdir(), 'ratchetx-onchain-sbf'), log = console.log } = {}) {
  const args = parseVectorArgs(argv);
  if (args.help) { log(usage); return { mode: 'help' }; }
  assertSourceIdentity(timepinRoot);
  const vectorDir = args.out || args.in ? resolve(cwd, args.out || args.in) : join(timepinRoot, 'vectors');
  const fixturePath = args.fixture ? resolve(cwd, args.fixture) : join(timepinRoot, 'vectors/fixture-input.json');
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
  let artifactPath = args.sbf || args.artifact;
  let originals;
  if (args.check) {
    originals = Object.fromEntries(VECTOR_FILENAMES.map(name => [name, readFileSync(join(vectorDir, name), 'utf8')]));
    const pinned = JSON.parse(originals['register-open-v2.json']).localSbfEvidence;
    // Exact layout is validated before joining an untrusted JSON path.
    validateArtifactTuple(pinned);
    artifactPath ??= env.RCX_TIMEPIN_V2_SO || join(cacheRoot, pinned.sha256, SBF_FILENAME);
  } else if (!artifactPath) throw new Error('--sbf <immutable-hash-addressed-path> is required for write');
  artifactPath = resolve(cwd, artifactPath);
  const artifact = readVerifiedArtifact(artifactPath, { cacheRoot });
  const output = generateTimepinVectors({ fixture, artifact });
  const next = {
    'register-open-v2.json': serializeVector(output.register),
    'lifecycle-v2.json': serializeVector(output.lifecycle),
  };
  if (args.check) {
    assertTimepinVectors({
      register: JSON.parse(originals['register-open-v2.json']), lifecycle: JSON.parse(originals['lifecycle-v2.json']),
    }, { fixture, artifact });
    for (const name of VECTOR_FILENAMES) if (originals[name] !== next[name]) throw new Error(name + ' formatting is not deterministic; regenerate vectors from source + this artifact');
  } else {
    // Finish all generation and validation before either canonical output is touched.
    mkdirSync(vectorDir, { recursive: true });
    for (const name of VECTOR_FILENAMES) writeFileSync(join(vectorDir, name), next[name], 'utf8');
  }
  const result = { mode: args.check ? 'check' : 'write', programId: PROGRAM_ID, profile: fixture.profile,
    vectorDir, artifact, runtimeEvidence: 'not included; the separate exact-SBF helper gate remains required' };
  log(JSON.stringify(result));
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { runVectorCommand(process.argv.slice(2)); }
  catch (error) { console.error('Timepin vector generation FAILED: ' + error.message); process.exitCode = 1; }
}