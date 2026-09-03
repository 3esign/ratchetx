import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TOKEN_2022_PROGRAM,
  renderPlan,
  validateManifest,
} from '../tools/permanence-release.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TOOL = resolve(ROOT, 'tools/permanence-release.mjs');
const EXAMPLE = resolve(ROOT, 'releases/permanence-manifest.example.json');
const TOKENKEG = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const base = JSON.parse(await readFile(EXAMPLE, 'utf8'));
const copy = () => structuredClone(base);

let passed = 0;
let failed = 0;
const cases = [];
const test = (name, fn) => cases.push({ name, fn });

test('the checked-in example validates and hashes its local ELF', async () => {
  const result = await validateManifest(copy(), { repoRoot: ROOT });
  assert.equal(result.artifactChecks.length, 1);
  assert.equal(result.artifactChecks[0].verified, true);
  assert.equal(result.artifactChecks[0].sha256,
    'ca09f0a830d0b523d0f39a27bf66f47fdc18e9deb5816f4ddf99de77d4e1ef80');
});

test('the rendered plan is deterministic and prints one exact movement', async () => {
  const first = renderPlan(await validateManifest(copy(), { repoRoot: ROOT }));
  const second = renderPlan(await validateManifest(copy(), { repoRoot: ROOT }));
  assert.equal(first, second);
  assert.match(first, /DRY RUN ONLY/);
  assert.match(first, /EXACT DECLARED SINGLE ACTION/);
  assert.match(first, /RCX debit\s+= 0 atoms/);
  assert.match(first, /AUTHORITY REVOCATION OR REFREEZE: REFUSED/);
});

test('the CLI runs offline in dry-run mode', () => {
  const result = spawnSync(process.execPath, [TOOL, '--dry-run'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /local=.* VERIFIED bytes=414344/);
  assert.match(result.stdout, /EXECUTION: REFUSED BY THIS VERSION/);
});

test('classic Tokenkeg is rejected for the real RCX Token-2022 mint', async () => {
  const manifest = copy();
  manifest.token.programId = TOKENKEG;
  await assert.rejects(
    validateManifest(manifest, { repoRoot: ROOT }),
    new RegExp('Token-2022 ' + TOKEN_2022_PROGRAM));
});

test('a local artifact hash mismatch is rejected', async () => {
  const manifest = copy();
  manifest.programs[0].artifact.sha256 = 'a'.repeat(64);
  await assert.rejects(
    validateManifest(manifest, { repoRoot: ROOT }),
    /hash mismatch/);
});

test('missing exact fee and movement fields are rejected', async () => {
  const manifest = copy();
  delete manifest.action.expected.rentLamports;
  await assert.rejects(
    validateManifest(manifest, { repoRoot: ROOT }),
    /manifest\.action\.expected\.rentLamports is required/);
});

test('legacy state has one snapshot path and Solana is canonical afterwards', async () => {
  const repeated = copy();
  repeated.migration.legacyImport = 'continuous-dual-write';
  await assert.rejects(
    validateManifest(repeated, { repoRoot: ROOT }),
    /must be one-time-snapshot/);

  const nonChain = copy();
  nonChain.migration.canonicalStateAfterImport = 'server-primary';
  await assert.rejects(
    validateManifest(nonChain, { repoRoot: ROOT }),
    /must be solana-only/);
});

test('--execute is refused before any manifest is opened', () => {
  const result = spawnSync(process.execPath, [
    TOOL, '--execute', 'releases/does-not-exist.json',
  ], { cwd: ROOT, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /EXECUTION REFUSED/);
  assert.doesNotMatch(result.stderr, /does-not-exist|existing regular/);
});

test('any authority-revocation field is explicitly rejected', async () => {
  const manifest = copy();
  manifest.revokeAuthority = true;
  await assert.rejects(
    validateManifest(manifest, { repoRoot: ROOT }),
    /authority revocation or refreeze is forbidden/i);
});

test('any refreeze field is explicitly rejected', async () => {
  const manifest = copy();
  manifest.freezeAuthority = '11111111111111111111111111111111';
  await assert.rejects(
    validateManifest(manifest, { repoRoot: ROOT }),
    /authority revocation or refreeze is forbidden/i);
});

test('secret-bearing manifest fields are rejected before schema use', async () => {
  const manifest = copy();
  manifest.source.apiKey = 'do-not-read-this';
  await assert.rejects(
    validateManifest(manifest, { repoRoot: ROOT }),
    /never carry credentials/i);
});

test('non-read-only actions must declare an exact nonzero transaction count', async () => {
  const manifest = copy();
  manifest.action.kind = 'initialize_program';
  await assert.rejects(
    validateManifest(manifest, { repoRoot: ROOT }),
    /must declare at least one expected transaction/);
});

test('wrong cluster genesis and wrong Pyth feed identity are rejected', async () => {
  const wrongCluster = copy();
  wrongCluster.cluster.genesisHash = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
  await assert.rejects(
    validateManifest(wrongCluster, { repoRoot: ROOT }),
    /does not identify devnet/);

  const wrongFeed = copy();
  wrongFeed.oracle.feeds[0].id = 'b'.repeat(64);
  await assert.rejects(
    validateManifest(wrongFeed, { repoRoot: ROOT }),
    /does not match canonical SOL/);
});

test('the release guard has no network, Solana client, or transaction surface', async () => {
  const source = await readFile(TOOL, 'utf8');
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /@solana\/web3\.js/);
  assert.doesNotMatch(source, /from\s+['"]node:child_process['"]/);
  assert.doesNotMatch(source, /\b(?:sendTransaction|sendAndConfirmTransaction|signTransaction)\b/);
  assert.doesNotMatch(source, /maxCreditAtomicExposure|manifest\.caps|productExposure/);
});

for (const entry of cases) {
  try {
    await entry.fn();
    passed++;
    console.log('PASS  ' + entry.name);
  } catch (error) {
    failed++;
    console.error('FAIL  ' + entry.name);
    console.error(error && error.stack ? error.stack : error);
  }
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
