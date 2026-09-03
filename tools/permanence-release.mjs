#!/usr/bin/env node
// Read-only release manifest gate. This file deliberately has no Solana client,
// signer, key loader, transaction builder, network request, or execute path.
//
//   node tools/permanence-release.mjs --dry-run
//   node tools/permanence-release.mjs --dry-run releases/my-release.json
//
// A later tool may consume the same manifest, but this version only proves that
// the identities, local program bytes, and exact movement of one action are
// explicit. These are release expectations, never gameplay or user limits.

import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCHEMA = 'ratchetx.permanence-release';
export const SCHEMA_VERSION = 1;
export const RCX_MINT = 'FQb2EyaLZ9TWBemYmQ9zWtXcEwLiSXtz7j619ThQpump';
export const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
export const PYTH_RECEIVER_PROGRAM = 'rec2HHDDnjLfj4kE7VyEtFA1HPGQLK33259532cRyHp';
export const PYTH_PUSH_ORACLE_PROGRAM = 'pyt2F414BA6dPttK6RddPZUdHfapoBN24GL5wbrPCou';

export const CANONICAL_FEEDS = Object.freeze({
  SOL: 'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d',
  BTC: 'e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
  ETH: 'ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
  BONK: '72b021217ca3fe68922a19aaf990109cb9d84e9ad004b4d2025ad6f529314419',
  PUMP: '7a01fca212788bba7c5bf8c9efd576a8a722f070d2c17596ff7bb609b8d5c3b9',
  JUP: '0a0408d619e9380abad35060f9192039ed5042fa6f82301d0e48bb52be830996',
  WIF: '4ca4beeca86f0d164160323817a4e42b10010a724c2217c6ee41b54cd4cc61fc',
});

const CLUSTER_GENESIS = Object.freeze({
  devnet: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
  'mainnet-beta': '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
});
const SOURCE_REPOSITORY = 'https://github.com/3esign/ratchetx';
const MAX_U64 = 18_446_744_073_709_551_615n;
const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ALLOWED_OPERATION_KINDS = new Set([
  'verify_artifact',
  'deploy_program',
  'upgrade_program',
  'initialize_program',
]);

const fail = message => { throw new Error(message); };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function exactKeys(value, required, optional, label) {
  if (!record(value)) fail(label + ' must be an object');
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(label + '.' + key + ' is not allowed by schema v' + SCHEMA_VERSION);
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) fail(label + '.' + key + ' is required');
  }
}

function scanForForbiddenMaterial(value, path = 'manifest') {
  if (typeof value === 'string') {
    if (value !== value.trim()) fail(path + ' must not have leading or trailing whitespace');
    if (/[\u0000-\u001f\u007f]/u.test(value)) fail(path + ' contains a control character');
    if (/[$][{]|process\.env|[$]env:|%[A-Z_][A-Z0-9_]*%/i.test(value))
      fail(path + ' contains an environment or secret interpolation');
    if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/i.test(value))
      fail(path + ' contains private key material');
    if (/\b(?:supabase|service[_ -]?role|api[_ -]?key|bearer[_ -]?token)\b/i.test(value))
      fail(path + ' contains a forbidden service or credential string');
    if (/ratchetx\.xyz\/api(?:\/|\?|$)/i.test(value))
      fail(path + ' contains a Ratchet service endpoint; release manifests are chain/artifact only');
    if (/(?:revoke|revocation|renounce|remove|set.?none).{0,40}(?:authority|upgrade|mint|freeze)|(?:authority|upgrade|mint|freeze).{0,40}(?:revoke|revocation|renounce)|refreeze|set.?authority|make.{0,20}immutable/i.test(value))
      fail('authority revocation or refreeze is forbidden in permanence-release v1');
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => scanForForbiddenMaterial(entry, path + '[' + index + ']'));
    return;
  }
  if (!record(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    const compact = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
    if (/^(?:apikey|privatekey|secret|secretkey|keypair|keypairpath|mnemonic|seedphrase|password|bearer|accesstoken|authtoken|serviceaccount|servicekey|servicerole|signer|walletpath|supabaseurl|supabasekey)$/i.test(compact))
      fail(path + '.' + key + ' is forbidden: manifests never carry credentials, signers, or key paths');
    if (/(?:revoke|revocation|renounce).*(?:authority|upgrade|mint|freeze)|(?:authority|upgrade|mint|freeze).*(?:revoke|revocation|renounce)|^(?:freezeauthority|mintauthority|upgradeauthority|refreeze)$/i.test(compact))
      fail('authority revocation or refreeze is forbidden in permanence-release v1');
    scanForForbiddenMaterial(entry, path + '.' + key);
  }
}

function cleanSlug(value, label, max = 80) {
  if (typeof value !== 'string' || value.length > max || !/^[a-z0-9][a-z0-9._-]*$/.test(value))
    fail(label + ' must be a lowercase, clean identifier of at most ' + max + ' characters');
  return value;
}

function base58Bytes(value, label) {
  if (typeof value !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]+$/.test(value))
    fail(label + ' must be a base58 value');
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let number = 0n;
  for (const char of value) number = number * 58n + BigInt(alphabet.indexOf(char));
  let hex = number === 0n ? '' : number.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  const significant = hex ? Buffer.from(hex, 'hex') : Buffer.alloc(0);
  let leadingZeroes = 0;
  while (leadingZeroes < value.length && value[leadingZeroes] === '1') leadingZeroes++;
  return Buffer.concat([Buffer.alloc(leadingZeroes), significant]);
}

function publicKey(value, label) {
  if (base58Bytes(value, label).length !== 32)
    fail(label + ' must decode to exactly 32 bytes');
  return value;
}

function lowercaseHex(value, bytes, label) {
  const shape = new RegExp('^[0-9a-f]{' + (bytes * 2) + '}$');
  if (typeof value !== 'string' || !shape.test(value))
    fail(label + ' must be exactly ' + (bytes * 2) + ' lowercase hexadecimal characters');
  if (/^0+$/.test(value)) fail(label + ' must not be all zeroes');
  return value;
}

function integer(value, label, max = 10_000) {
  if (!Number.isSafeInteger(value) || value < 0 || value > max)
    fail(label + ' must be an integer from 0 to ' + max);
  return value;
}

function atomic(value, label) {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(value))
    fail(label + ' must be an unsigned decimal string');
  const parsed = BigInt(value);
  if (parsed > MAX_U64) fail(label + ' exceeds u64');
  return parsed;
}

function inside(parent, child) {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..' + sep) && rel !== '..' && !isAbsolute(rel));
}

async function checkArtifact(repoRoot, artifactPath, expectedHash, label) {
  if (typeof artifactPath !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._/-]*\.so$/.test(artifactPath) ||
      artifactPath.includes('\\') ||
      artifactPath.split('/').some(part => part === '.' || part === '..')) {
    fail(label + '.path must be a repository-relative .so path without traversal');
  }
  const root = await realpath(repoRoot);
  const candidate = resolve(root, artifactPath);
  if (!inside(root, candidate)) fail(label + '.path leaves the repository');
  const info = await lstat(candidate).catch(() => null);
  if (!info || !info.isFile() || info.isSymbolicLink())
    fail(label + '.path must name an existing regular, non-symlink file');
  if (info.size < 4 || info.size > MAX_ARTIFACT_BYTES)
    fail(label + '.path has an invalid artifact size');
  const resolved = await realpath(candidate);
  if (!inside(root, resolved)) fail(label + '.path resolves outside the repository');
  const bytes = await readFile(resolved);
  if (!bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])))
    fail(label + '.path is not an ELF program artifact');
  const actualHash = createHash('sha256').update(bytes).digest('hex');
  if (actualHash !== expectedHash)
    fail(label + ' hash mismatch: expected ' + expectedHash + ', got ' + actualHash);
  return { path: artifactPath, sha256: actualHash, bytes: info.size, verified: true };
}

function stableJson(value) {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  if (record(value)) {
    return '{' + Object.keys(value).sort().map(key =>
      JSON.stringify(key) + ':' + stableJson(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

export async function validateManifest(manifest, { repoRoot = REPO_ROOT } = {}) {
  scanForForbiddenMaterial(manifest);
  exactKeys(manifest,
    ['schema', 'schemaVersion', 'releaseId', 'cluster', 'source', 'token', 'oracle',
      'migration', 'programs', 'action'],
    [], 'manifest');
  if (manifest.schema !== SCHEMA) fail('manifest.schema must be ' + SCHEMA);
  if (manifest.schemaVersion !== SCHEMA_VERSION)
    fail('manifest.schemaVersion must be ' + SCHEMA_VERSION);
  cleanSlug(manifest.releaseId, 'manifest.releaseId');

  exactKeys(manifest.cluster, ['name', 'genesisHash'], [], 'manifest.cluster');
  const expectedGenesis = CLUSTER_GENESIS[manifest.cluster.name];
  if (!expectedGenesis)
    fail('manifest.cluster.name must be devnet or mainnet-beta');
  if (manifest.cluster.genesisHash !== expectedGenesis)
    fail('manifest.cluster.genesisHash does not identify ' + manifest.cluster.name);

  exactKeys(manifest.source, ['repository', 'commit'], [], 'manifest.source');
  if (manifest.source.repository !== SOURCE_REPOSITORY)
    fail('manifest.source.repository must be ' + SOURCE_REPOSITORY);
  lowercaseHex(manifest.source.commit, 20, 'manifest.source.commit');

  exactKeys(manifest.migration,
    ['legacyImport', 'canonicalStateAfterImport'], [], 'manifest.migration');
  if (manifest.migration.legacyImport !== 'one-time-snapshot')
    fail('manifest.migration.legacyImport must be one-time-snapshot');
  if (manifest.migration.canonicalStateAfterImport !== 'solana-only')
    fail('manifest.migration.canonicalStateAfterImport must be solana-only');

  exactKeys(manifest.token, ['mint', 'programId', 'decimals'], [], 'manifest.token');
  publicKey(manifest.token.mint, 'manifest.token.mint');
  publicKey(manifest.token.programId, 'manifest.token.programId');
  if (manifest.token.mint !== RCX_MINT)
    fail('RCX mint must be exactly ' + RCX_MINT);
  if (manifest.token.programId !== TOKEN_2022_PROGRAM)
    fail('RCX token program must be Token-2022 ' + TOKEN_2022_PROGRAM);
  if (manifest.token.decimals !== 6) fail('RCX decimals must be exactly 6');

  exactKeys(manifest.oracle,
    ['receiverProgramId', 'pushOracleProgramId', 'shard', 'feeds'], [], 'manifest.oracle');
  publicKey(manifest.oracle.receiverProgramId, 'manifest.oracle.receiverProgramId');
  publicKey(manifest.oracle.pushOracleProgramId, 'manifest.oracle.pushOracleProgramId');
  if (manifest.oracle.receiverProgramId !== PYTH_RECEIVER_PROGRAM)
    fail('Pyth receiver program must be exactly ' + PYTH_RECEIVER_PROGRAM);
  if (manifest.oracle.pushOracleProgramId !== PYTH_PUSH_ORACLE_PROGRAM)
    fail('Pyth push-oracle program must be exactly ' + PYTH_PUSH_ORACLE_PROGRAM);
  if (manifest.oracle.shard !== 0) fail('Pyth sponsored push shard must be exactly 0');
  if (!Array.isArray(manifest.oracle.feeds))
    fail('manifest.oracle.feeds must be an array');
  const feeds = new Map();
  for (let index = 0; index < manifest.oracle.feeds.length; index++) {
    const feed = manifest.oracle.feeds[index];
    const label = 'manifest.oracle.feeds[' + index + ']';
    exactKeys(feed, ['symbol', 'id'], [], label);
    if (typeof feed.symbol !== 'string' || !/^[A-Z0-9]{2,10}$/.test(feed.symbol))
      fail(label + '.symbol must be an uppercase asset symbol');
    lowercaseHex(feed.id, 32, label + '.id');
    if (!Object.hasOwn(CANONICAL_FEEDS, feed.symbol))
      fail(label + '.symbol is not in the canonical API-keyless feed set');
    if (feed.id !== CANONICAL_FEEDS[feed.symbol])
      fail(label + '.id does not match canonical ' + feed.symbol);
    if (feeds.has(feed.symbol)) fail('duplicate Pyth feed symbol ' + feed.symbol);
    if ([...feeds.values()].includes(feed.id)) fail('duplicate Pyth feed id ' + feed.id);
    feeds.set(feed.symbol, feed.id);
  }
  const missingFeeds = Object.keys(CANONICAL_FEEDS).filter(symbol => !feeds.has(symbol));
  if (missingFeeds.length)
    fail('manifest.oracle.feeds is missing canonical feeds: ' + missingFeeds.join(', '));

  if (!Array.isArray(manifest.programs) || manifest.programs.length === 0 ||
      manifest.programs.length > 8)
    fail('manifest.programs must contain 1 to 8 program artifacts');
  const programs = new Map();
  const artifactChecks = [];
  const reservedIds = new Set([
    RCX_MINT, TOKEN_2022_PROGRAM, PYTH_RECEIVER_PROGRAM, PYTH_PUSH_ORACLE_PROGRAM,
    '11111111111111111111111111111111',
  ]);
  for (let index = 0; index < manifest.programs.length; index++) {
    const program = manifest.programs[index];
    const label = 'manifest.programs[' + index + ']';
    exactKeys(program, ['name', 'programId', 'artifact'], [], label);
    cleanSlug(program.name, label + '.name', 48);
    publicKey(program.programId, label + '.programId');
    if (reservedIds.has(program.programId))
      fail(label + '.programId is a reserved non-release identity');
    if (programs.has(program.name)) fail('duplicate program name ' + program.name);
    for (const existing of programs.values()) {
      if (existing.programId === program.programId)
        fail('duplicate program id ' + program.programId);
    }
    exactKeys(program.artifact, ['sha256'], ['path'], label + '.artifact');
    lowercaseHex(program.artifact.sha256, 32, label + '.artifact.sha256');
    const checked = program.artifact.path
      ? await checkArtifact(repoRoot, program.artifact.path, program.artifact.sha256,
          label + '.artifact')
      : { path: null, sha256: program.artifact.sha256, bytes: null, verified: false };
    programs.set(program.name, program);
    artifactChecks.push({ name: program.name, programId: program.programId, ...checked });
  }

  exactKeys(manifest.action, ['kind', 'program', 'expected'], [], 'manifest.action');
  if (!ALLOWED_OPERATION_KINDS.has(manifest.action.kind))
    fail('manifest.action.kind is not supported by dry-run schema v' + SCHEMA_VERSION);
  if (!programs.has(manifest.action.program))
    fail('manifest.action.program does not name a declared program');
  exactKeys(manifest.action.expected,
    ['transactions', 'networkFeeLamports', 'rentLamports', 'solTransferLamports',
      'rcxDebitAtomic', 'rcxCreditAtomic'], [], 'manifest.action.expected');
  const action = {
    kind: manifest.action.kind,
    program: manifest.action.program,
    expected: {
      transactions: integer(
        manifest.action.expected.transactions, 'manifest.action.expected.transactions'),
      networkFee: atomic(
        manifest.action.expected.networkFeeLamports,
        'manifest.action.expected.networkFeeLamports'),
      rent: atomic(
        manifest.action.expected.rentLamports, 'manifest.action.expected.rentLamports'),
      solTransfer: atomic(
        manifest.action.expected.solTransferLamports,
        'manifest.action.expected.solTransferLamports'),
      rcxDebit: atomic(
        manifest.action.expected.rcxDebitAtomic,
        'manifest.action.expected.rcxDebitAtomic'),
      rcxCredit: atomic(
        manifest.action.expected.rcxCreditAtomic,
        'manifest.action.expected.rcxCreditAtomic'),
    },
  };
  const expected = action.expected;
  if (action.kind === 'verify_artifact') {
    if (expected.transactions !== 0 || expected.networkFee !== 0n ||
        expected.rent !== 0n || expected.solTransfer !== 0n ||
        expected.rcxDebit !== 0n || expected.rcxCredit !== 0n)
      fail('manifest.action verify_artifact must declare exactly zero movement and fees');
    const artifact = artifactChecks.find(entry => entry.name === action.program);
    if (!artifact || !artifact.verified)
      fail('manifest.action verify_artifact requires a local artifact.path');
  } else if (expected.transactions === 0) {
    fail('manifest.action ' + action.kind + ' must declare at least one expected transaction');
  }

  const manifestSha256 = createHash('sha256').update(stableJson(manifest)).digest('hex');
  return { manifest, feeds, programs, artifactChecks, action, manifestSha256 };
}

export function renderPlan(validation) {
  const { manifest, artifactChecks, action, manifestSha256 } = validation;
  const lines = [
    'RATCHETX PERMANENCE RELEASE - DRY RUN ONLY',
    'schema      : ' + manifest.schema + '/v' + manifest.schemaVersion,
    'release     : ' + manifest.releaseId,
    'cluster     : ' + manifest.cluster.name,
    'genesis     : ' + manifest.cluster.genesisHash,
    'source      : ' + manifest.source.repository + '@' + manifest.source.commit,
    'migration   : one-time-snapshot -> solana-only',
    'manifest sha: ' + manifestSha256,
    'rcx         : ' + manifest.token.mint,
    'token owner : ' + manifest.token.programId + ' (Token-2022, ' + manifest.token.decimals + ' decimals)',
    'pyth        : receiver=' + manifest.oracle.receiverProgramId +
      ' push=' + manifest.oracle.pushOracleProgramId + ' shard=0',
    'feeds       : ' + Object.keys(CANONICAL_FEEDS).sort()
      .map(symbol => symbol + '=' + CANONICAL_FEEDS[symbol]).join(','),
    '',
    'ARTIFACTS',
  ];
  for (const artifact of [...artifactChecks].sort((a, b) => a.name.localeCompare(b.name))) {
    lines.push('  ' + artifact.name + ' program=' + artifact.programId);
    lines.push('    sha256=' + artifact.sha256);
    lines.push(artifact.verified
      ? '    local=' + artifact.path + ' VERIFIED bytes=' + artifact.bytes
      : '    local=NOT PROVIDED (hash pin only)');
  }
  const expected = action.expected;
  lines.push(
    '',
    'EXACT DECLARED SINGLE ACTION',
    '  kind              = ' + action.kind,
    '  program           = ' + action.program,
    '  transactions      = ' + expected.transactions,
    '  network fee       = ' + expected.networkFee + ' lamports',
    '  account rent      = ' + expected.rent + ' lamports',
    '  SOL transfer      = ' + expected.solTransfer + ' lamports',
    '  RCX debit         = ' + expected.rcxDebit + ' atoms',
    '  RCX credit        = ' + expected.rcxCredit + ' atoms',
    '',
    'These are exact release expectations, not product, pilot, or user limits.',
    'SAFETY: validation only; no key was read, nothing was signed or sent.',
    'EXECUTION: REFUSED BY THIS VERSION.',
    'AUTHORITY REVOCATION OR REFREEZE: REFUSED BY THIS VERSION.',
  );
  return lines.join('\n') + '\n';
}

function parseArgs(argv) {
  if (argv.some(arg => /^--execute(?:=|$)/.test(arg)))
    fail('EXECUTION REFUSED: permanence-release v1 supports --dry-run only');
  if (argv.some(arg => /--.*(?:revoke|revocation|immutable|authority|refreeze|freeze)/i.test(arg)))
    fail('AUTHORITY REVOCATION OR REFREEZE REFUSED: it is outside permanence-release v1');
  let dryRun = false;
  let manifestPath = null;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--dry-run') { dryRun = true; continue; }
    if (arg === '--manifest') {
      if (!argv[index + 1] || argv[index + 1].startsWith('--'))
        fail('--manifest requires a path');
      if (manifestPath) fail('only one manifest may be supplied');
      manifestPath = argv[++index];
      continue;
    }
    if (arg.startsWith('--')) fail('unknown option ' + arg);
    if (manifestPath) fail('only one manifest may be supplied');
    manifestPath = arg;
  }
  if (!dryRun) fail('read-only guard requires --dry-run');
  return { manifestPath: manifestPath || 'releases/permanence-manifest.example.json' };
}

async function loadManifest(manifestPath) {
  const releasesRoot = resolve(REPO_ROOT, 'releases');
  const candidate = isAbsolute(manifestPath) ? resolve(manifestPath) : resolve(REPO_ROOT, manifestPath);
  if (!inside(releasesRoot, candidate) ||
      !/^permanence-manifest[a-z0-9._-]*\.json$/i.test(basename(candidate)))
    fail('manifest path must be a permanence-manifest*.json file inside releases/');
  const info = await lstat(candidate).catch(() => null);
  if (!info || !info.isFile() || info.isSymbolicLink())
    fail('manifest path must name an existing regular, non-symlink file');
  if (info.size === 0 || info.size > MAX_MANIFEST_BYTES)
    fail('manifest must be from 1 to ' + MAX_MANIFEST_BYTES + ' bytes');
  const realReleasesRoot = await realpath(releasesRoot);
  const realCandidate = await realpath(candidate);
  if (!inside(realReleasesRoot, realCandidate))
    fail('manifest path resolves outside releases/');
  const raw = await readFile(realCandidate, 'utf8');
  try { return JSON.parse(raw); }
  catch (error) { fail('manifest is not valid JSON: ' + error.message); }
}

export async function main(argv = process.argv.slice(2)) {
  const parsed = parseArgs(argv);
  const manifest = await loadManifest(parsed.manifestPath);
  const validation = await validateManifest(manifest);
  process.stdout.write(renderPlan(validation));
}

const invoked = process.argv[1] &&
  resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (invoked) {
  main().catch(error => {
    process.stderr.write('REFUSED: ' + error.message + '\n');
    process.exitCode = 1;
  });
}
