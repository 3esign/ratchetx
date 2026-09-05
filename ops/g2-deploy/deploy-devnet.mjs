#!/usr/bin/env node
// The devnet deployment, as a command that refuses rather than a runbook that
// somebody follows from memory.
//
//   node ops/g2-deploy/deploy-devnet.mjs --cache-root <dir> --payer <keypair.json>
//   node ops/g2-deploy/deploy-devnet.mjs ... --execute
//
// DRY RUN IS THE DEFAULT. Without --execute it resolves everything, prints the
// plan and the exact commands, and deploys nothing.
//
// IT MUST RUN WHERE THE SOLANA CLI AND THE NETWORK ARE. Measured 2026-09-05:
// the Cowork device VM has no network at all (fetch failed to
// api.devnet.solana.com) and the cloud container's egress allowlist refuses the
// same host with 403. So this is run by whoever holds the build host.
//
// Everything that DECIDES is in ./plan.mjs and is tested without a network.
// This file resolves facts and executes; it decides nothing.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { findArtifacts, PROGRAMS } from './preflight.mjs';
import { planDeployment, deploymentIsReal, DEVNET_GENESIS } from './plan.mjs';
import { sol } from './rent.mjs';

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const next = process.argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
};

const solana = (args, { timeout = 600_000 } = {}) =>
  spawnSync('solana', args, { encoding: 'utf8', timeout });

// Derives a public key from a keypair file WITHOUT the secret ever being
// printed, logged, or returned. solana-keygen pubkey reads the file and emits
// only the public half; if the CLI is absent this returns null rather than
// reading key bytes into this process to do the arithmetic itself.
function pubkeyOf(keypairPath) {
  if (!fs.existsSync(keypairPath)) return null;
  const r = spawnSync('solana-keygen', ['pubkey', keypairPath], { encoding: 'utf8', timeout: 30_000 });
  return r.status === 0 ? r.stdout.trim() : null;
}

// The program keypairs live beside their build output and are gitignored. They
// are named here rather than searched for: a tool that goes looking for keys
// eventually finds the wrong one.
export const PROGRAM_KEYPAIRS = {
  timepin: 'onchain/rcx-timepin-v2/target/deploy/rcx_timepin_v2-keypair.json',
  core: 'onchain/ratchet-core-g2/target/deploy/ratchet_core_g2-keypair.json',
};

export async function main() {
  const cacheRoot = arg('cache-root');
  const payerPath = arg('payer');
  const execute = arg('execute') === true;
  const rpc = arg('rpc', 'https://api.devnet.solana.com');
  if (!cacheRoot) throw new Error('--cache-root <dir> is required');
  if (!payerPath) throw new Error('--payer <keypair.json> is required; the fee payer is never implicit');

  if (solana(['--version']).status !== 0) {
    throw new Error('the solana CLI is not on PATH. This command must run on the build host: writing a '
      + 'megabyte-sized program is on the order of a thousand transactions, and reimplementing that here '
      + 'would be a worse version of a tool that already exists.');
  }

  const genesis = solana(['genesis-hash', '--url', rpc]).stdout.trim();
  const payer = pubkeyOf(payerPath);
  const balanceOut = payer ? solana(['balance', payer, '--url', rpc]).stdout.trim() : '';
  const payerLamports = /^([\d.]+)\s*SOL/.test(balanceOut)
    ? Math.round(parseFloat(RegExp.$1) * 1e9) : undefined;

  const found = findArtifacts(cacheRoot);
  const artifacts = found.map(a => ({
    name: a.name,
    bytes: a.bytes,
    path: a.path,
    expectedProgramId: a.id,
    keypairProgramId: pubkeyOf(PROGRAM_KEYPAIRS[a.name]),
  }));

  const plan = planDeployment({ cluster: genesis, artifacts, payerLamports });

  console.log(`cluster genesis: ${genesis}${genesis === DEVNET_GENESIS ? ' (devnet)' : ''}`);
  console.log(`payer: ${payer || '(unresolved)'} holding ${payerLamports === undefined ? '(unread)' : sol(payerLamports) + ' SOL'}`);
  for (const s of plan.steps) {
    console.log(`  ${s.name.padEnd(8)} ${String(s.bytes).padStart(9)} bytes -> ${s.programId}`
      + `  needs ${sol(s.requiredAtThisStep)} SOL available at its turn`);
  }
  console.log(`total required: ${sol(plan.required)} SOL (rent peak ${sol(plan.peak)} plus a fee allowance)`);

  if (!plan.ok) {
    for (const r of plan.refusals) console.error(`REFUSED: ${r}`);
    process.exitCode = 1;
    return plan;
  }

  for (const s of plan.steps) {
    const artifact = artifacts.find(a => a.name === s.name);
    const cmd = ['program', 'deploy', artifact.path,
      '--program-id', PROGRAM_KEYPAIRS[s.name],
      '--keypair', payerPath,
      '--url', rpc,
      '--max-len', String(s.maxLen)];
    console.log(`\n${execute ? 'RUNNING' : 'WOULD RUN'}: solana ${cmd.join(' ')}`);
    if (!execute) continue;

    const r = solana(cmd, { timeout: 1_800_000 });
    process.stdout.write(r.stdout || '');
    if (r.status !== 0) {
      console.error(r.stderr || '');
      console.error(`DEPLOY FAILED for ${s.name}. A funded buffer may be stranded; recover it with `
        + `"solana program close --buffers --keypair ${payerPath} --url ${rpc}" before retrying, or the `
        + 'next attempt starts poorer than this one did.');
      process.exitCode = 1;
      return plan;
    }

    // A CLI exit of zero is not a deployed program. See plan.mjs.
    const show = solana(['program', 'show', s.programId, '--url', rpc]);
    const account = show.status === 0
      ? { exists: true,
          executable: /Executable:\s*Yes/i.test(show.stdout) || /ProgramData Address/i.test(show.stdout),
          owner: 'BPFLoaderUpgradeab1e11111111111111111111111' }
      : { exists: false };
    const real = deploymentIsReal({ programId: s.programId, account });
    if (!real.real) {
      for (const p of real.problems) console.error(`NOT DEPLOYED: ${p}`);
      process.exitCode = 1;
      return plan;
    }
    console.log(`  ${s.name} is live and executable at ${s.programId}`);
  }
  return plan;
}

export const isCliEntrypoint = (moduleUrl, argv1, toFileUrl = pathToFileURL) => {
  if (typeof argv1 !== 'string' || argv1 === '') return false;
  try { return moduleUrl === toFileUrl(argv1).href; } catch { return false; }
};

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  main().catch(e => { console.error(String(e.message || e)); process.exit(1); });
}
