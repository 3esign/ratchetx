#!/usr/bin/env node
// Current PASS receipt -> exact local artifacts -> devnet-only CLI deployment.
// Dry run is the default. No keys or buffer recovery phrases are printed.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Connection, PublicKey } from '@solana/web3.js';
import { checkG2Artifacts } from '../../tools/check-g2-artifacts.mjs';
import { PROGRAMS } from './preflight.mjs';
import { planDeployment, deploymentIsReal, DEVNET_GENESIS } from './plan.mjs';
import { fetchRentQuotes, SIZE_OF_PROGRAM, sizeOfProgramData, sizeOfBuffer, sol } from './rent.mjs';

export const DESIGNATED_PAYER = 'wJYFx75hzP9h2ujQQ6mpJWLeYgPSUdLtuWjrw881rKz';
export const SOLANA_VERSION = '4.2.1';
export const LOADER = 'BPFLoaderUpgradeab1e11111111111111111111111';
export const PROGRAM_KEYPAIRS = Object.freeze({
  timepin: 'onchain/rcx-timepin-v2/timepin-v2-keypair.json',
  core: 'onchain/ratchet-core-g2/target/deploy/ratchet_core_g2-keypair.json',
});
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const ownerOf = account => typeof account?.owner === 'string' ? account.owner : account?.owner?.toBase58?.();
const requireFact = (ok, message) => { if (!ok) throw new Error(message); };

function options(argv) {
  const out = { rpc: 'https://api.devnet.solana.com', execute: false };
  const seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    requireFact(!seen.has(key), 'duplicate option ' + key);
    seen.add(key);
    if (key === '--execute') { out.execute = true; continue; }
    requireFact(['--cache-root', '--payer', '--rpc'].includes(key), 'unknown option ' + key);
    const value = argv[++i];
    requireFact(typeof value === 'string' && value.length > 0 && !value.startsWith('--'), key + ' requires a value');
    out[key.slice(2)] = value;
  }
  requireFact(out['cache-root'] && out.payer, '--cache-root <dir> and --payer <keypair.json> are required');
  return out;
}

export function acceptedArtifacts(report) {
  requireFact(report?.verdict === 'PASS' && report.receiptStatus === 'PASS'
    && report.runtimeEvidenceChecked === true && /^[0-9a-f]{64}$/.test(report.receiptSha256),
  'current strict checker and completed receipt must both PASS: ' + (report?.failure || 'acceptance missing'));
  requireFact(report.sourceHashes && Object.keys(report.sourceHashes).length > 0, 'accepted source binding is missing');
  requireFact(report.artifacts && Object.keys(report.artifacts).sort().join(',') === 'core,timepin',
    'accepted receipt must contain exactly the canonical pair');
  return PROGRAMS.map(program => {
    const a = report.artifacts[program.name], local = report.resolvedArtifactPaths?.[program.name];
    requireFact(a?.programId === program.id && /^[0-9a-f]{64}$/.test(a.sha256)
      && Number.isSafeInteger(a.size) && a.size > 0 && typeof local === 'string' && path.isAbsolute(local),
    program.name + ': accepted artifact tuple or resolved path is invalid');
    requireFact(path.basename(local) === program.file && path.basename(path.dirname(local)) === a.sha256,
      program.name + ': resolved artifact must retain its exact content-addressed filename');
    return { name: program.name, bytes: a.size, sha256: a.sha256, path: local, expectedProgramId: program.id };
  });
}

export function assertArtifactBytes(artifact) {
  const stat = fs.lstatSync(artifact.path);
  requireFact(stat.isFile() && !stat.isSymbolicLink(), artifact.name + ': artifact is not a regular file');
  const bytes = fs.readFileSync(artifact.path);
  requireFact(bytes.length === artifact.bytes && hash(bytes) === artifact.sha256,
    artifact.name + ': artifact bytes changed or do not match accepted hash');
  return bytes;
}

// The address comes from the actual loader Program account, and must also be
// the canonical loader PDA. ProgramData's exact ELF bytes remain independently
// inspectable through their hash; capacity and authority are checked separately.
export async function readBackDeployment(connection, artifact) {
  const key = new PublicKey(artifact.expectedProgramId);
  const program = await connection.getAccountInfo(key, 'confirmed');
  const identity = deploymentIsReal({ programId: key.toBase58(), account: program ? {
    exists: true, executable: program.executable, owner: ownerOf(program),
  } : { exists: false } });
  requireFact(identity.real, identity.problems.join('; '));
  const data = Buffer.from(program.data || []);
  requireFact(data.length === 36 && data.readUInt32LE(0) === 2, 'invalid loader Program state or length');
  const programDataKey = new PublicKey(data.subarray(4, 36));
  const [canonical] = PublicKey.findProgramAddressSync([key.toBuffer()], new PublicKey(LOADER));
  requireFact(programDataKey.equals(canonical), 'ProgramData address is not the canonical loader PDA');
  const pd = await connection.getAccountInfo(programDataKey, 'confirmed');
  requireFact(pd && ownerOf(pd) === LOADER && pd.executable === false, 'ProgramData missing or wrong owner/executable flag');
  const pdBytes = Buffer.from(pd.data || []);
  requireFact(pdBytes.length === 45 + artifact.bytes && pdBytes.readUInt32LE(0) === 3,
    'ProgramData state or exact capacity does not match accepted artifact');
  requireFact(pdBytes[12] === 1 && new PublicKey(pdBytes.subarray(13, 45)).toBase58() === DESIGNATED_PAYER,
    'ProgramData upgrade authority is not the designated payer');
  const elf = pdBytes.subarray(45);
  requireFact(hash(elf) === artifact.sha256 && elf.equals(assertArtifactBytes(artifact)),
    'deployed ELF bytes do not match accepted artifact');
  return { programId: key.toBase58(), owner: ownerOf(program), executable: program.executable,
    programDataAddress: programDataKey.toBase58(), programDataOwner: ownerOf(pd),
    slot: pdBytes.readBigUInt64LE(4).toString(), upgradeAuthority: DESIGNATED_PAYER,
    sha256: hash(elf), bytes: elf.length, exactCapacity: true };
}

export function failedBufferAddress(result) {
  // Never print raw CLI failures: they can contain a generated recovery seed.
  const text = String(result.stdout || '') + '\n' + String(result.stderr || '');
  const match = text.match(/\bBuffer(?: account)?(?: address)?\s*:\s*([1-9A-HJ-NP-Za-km-z]{32,44})\b/i);
  if (!match) return null;
  try { return new PublicKey(match[1]).toBase58() === match[1] ? match[1] : null; } catch { return null; }
}

export async function main({ argv = process.argv.slice(2), root = ROOT,
  checker = checkG2Artifacts, spawn = spawnSync,
  connectionFactory = async rpc => new Connection(rpc, 'confirmed'), log = console.log } = {}) {
  const opt = options(argv), cacheRoot = path.resolve(root, opt['cache-root']);
  const payerPath = path.resolve(root, opt.payer);
  const command = (executable, args, timeout = 30000) => spawn(executable, args, {
    cwd: root, encoding: 'utf8', timeout, maxBuffer: 16 * 1024 * 1024, windowsHide: true,
  });
  const checkedCommand = (executable, args) => {
    const r = command(executable, args);
    requireFact(!r.error && r.status === 0 && !r.signal && typeof r.stdout === 'string',
      executable + ' inspection failed; no deployment started');
    return r.stdout.trim();
  };
  const cliVersion = checkedCommand('solana', ['--version']);
  requireFact(/^solana-cli 4\.2\.1(?:\s|$)/.test(cliVersion), 'solana CLI 4.2.1 is required');
  const connection = await connectionFactory(opt.rpc);
  const assertDevnet = async () => requireFact(await connection.getGenesisHash() === DEVNET_GENESIS,
    'genesis is not DEVNET; mainnet, testnet and unknown clusters are refused');
  await assertDevnet();
  requireFact(checkedCommand('solana', ['genesis-hash', '--url', opt.rpc]) === DEVNET_GENESIS,
    'Solana CLI and RPC must both identify devnet');
  const payer = checkedCommand('solana-keygen', ['pubkey', payerPath]);
  requireFact(payer === DESIGNATED_PAYER, 'payer does not match designated devnet wallet ' + DESIGNATED_PAYER);

  const accepted = await checker({ root, cacheRoot });
  const artifacts = acceptedArtifacts(accepted);
  const binding = r => ({ receiptSha256: r.receiptSha256, sourceHashes: r.sourceHashes,
    artifacts: r.artifacts, resolvedArtifactPaths: r.resolvedArtifactPaths });
  const recheck = async () => {
    const current = await checker({ root, cacheRoot });
    acceptedArtifacts(current);
    requireFact(isDeepStrictEqual(binding(current), binding(accepted)), 'accepted receipt, source or artifact pair changed during deployment');
    artifacts.forEach(assertArtifactBytes);
  };
  for (const a of artifacts) {
    assertArtifactBytes(a);
    a.keypairPath = path.resolve(root, PROGRAM_KEYPAIRS[a.name]);
    a.keypairProgramId = checkedCommand('solana-keygen', ['pubkey', a.keypairPath]);
    // The funding model is deliberately for fresh accounts. An existing program
    // requires its own explicit upgrade/resume plan, never an accidental upgrade.
    requireFact(await connection.getAccountInfo(new PublicKey(a.expectedProgramId), 'confirmed') === null,
      a.name + ': program already exists; this fresh-deployment command will not upgrade or resume it implicitly');
  }
  const sizes = [SIZE_OF_PROGRAM, ...artifacts.flatMap(a => [sizeOfProgramData(a.bytes), sizeOfBuffer(a.bytes)])];
  const quotes = await fetchRentQuotes(connection, sizes);
  const payerLamports = await connection.getBalance(new PublicKey(payer), 'confirmed');
  const plan = planDeployment({ cluster: DEVNET_GENESIS, artifacts, payerLamports, rentForSize: size => quotes.get(size) });
  log('devnet payer: ' + payer + '; current PASS receipt: ' + accepted.receiptSha256);
  if (plan.peak !== null) log('exact-capacity RPC rent: ' + sol(plan.peak ?? 0) + ' SOL; required with fee allowance: ' + sol(plan.required ?? 0) + ' SOL');
  requireFact(plan.ok, plan.refusals.join('; '));
  const deployments = [];
  for (const step of plan.steps) {
    const a = artifacts.find(value => value.name === step.name);
    const args = ['program', 'deploy', a.path, '--program-id', a.keypairPath,
      '--keypair', payerPath, '--fee-payer', payerPath, '--upgrade-authority', payerPath,
      '--url', opt.rpc, '--commitment', 'confirmed', '--max-len', String(step.maxLen)];
    log((opt.execute ? 'RUN' : 'DRY RUN') + ': ' + JSON.stringify(['solana', ...args]));
    if (!opt.execute) continue;
    await assertDevnet();
    await recheck();
    requireFact(checkedCommand('solana-keygen', ['pubkey', payerPath]) === DESIGNATED_PAYER
      && checkedCommand('solana-keygen', ['pubkey', a.keypairPath]) === a.expectedProgramId,
    'payer or program keypair identity changed before execution');
    const r = command('solana', args, 1800000);
    if (r.error || r.status !== 0 || r.signal) {
      const bufferAddress = failedBufferAddress(r);
      log('Deployment failed for ' + a.name + '; exit=' + (r.status ?? 'none')
        + ', signal=' + (r.signal ?? 'none') + ', buffer=' + (bufferAddress || 'not identified')
        + '. Stop and inspect only this attempt for targeted recovery/resume; no buffers were closed.');
      return { ok: false, mode: 'execute', receiptSha256: accepted.receiptSha256,
        plan, deployments, failedProgram: a.name, exit: r.status ?? null, signal: r.signal ?? null, bufferAddress };
    }
    const measured = await readBackDeployment(connection, a);
    await recheck();
    deployments.push(measured);
    log(a.name + ': measured deployed ELF matches ' + measured.sha256);
  }
  await recheck();
  return { ok: true, mode: opt.execute ? 'execute' : 'dry-run', cluster: 'devnet',
    genesisHash: DEVNET_GENESIS, payer, cliVersion, receiptSha256: accepted.receiptSha256,
    sourceHashes: accepted.sourceHashes, artifacts: accepted.artifacts,
    resolvedArtifactPaths: accepted.resolvedArtifactPaths, rentQuotes: Object.fromEntries(quotes),
    plan, deployments };
}

export const isCliEntrypoint = (moduleUrl, argv1, toFileUrl = pathToFileURL) => {
  if (typeof argv1 !== 'string' || argv1 === '') return false;
  try { return moduleUrl === toFileUrl(argv1).href; } catch { return false; }
};
if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  main().then(report => {
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.ok ? 0 : 1;
  }).catch(error => { console.error(String(error.message || error)); process.exitCode = 1; });
}
