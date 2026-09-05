#!/usr/bin/env node
// Devnet deploy preflight: what the deployment needs, measured before anybody
// starts one.
//
//   node ops/g2-deploy/preflight.mjs --cache-root _to_delete/public-build-handoff
//   node ops/g2-deploy/preflight.mjs --cache-root ... --rpc <devnet url> --payer <pubkey>
//
// Read-only. It measures files and, if given an RPC, reads one balance. It
// cannot deploy, cannot sign, and takes no keypair path - the fee payer is named
// by PUBLIC KEY here or not at all.
//
// It refuses mainnet outright, on the genesis hash, the same way the crank does.
import fs from 'node:fs';
import path from 'node:path';
import { deploymentCost, sol, LAMPORTS_PER_SOL } from './rent.mjs';

export const PROGRAMS = [
  { name: 'timepin', file: 'rcx_timepin_v2.so', id: 'C8wwxUGmoKAV22MaY3oW2Q6QeDbmB9dbNdbohsRjJkYp' },
  { name: 'core', file: 'ratchet_core_g2.so', id: 'ANVGVtDrECeyQkS56UZ9ZiWCUxk2JWEVNJioFW8JEwbL' },
];

// The cache is content-addressed: <root>/<sha256>/<file>. Finding the artifact
// means walking one level, and a MISSING artifact is an answer, not a zero.
export function findArtifacts(cacheRoot, programs = PROGRAMS) {
  const found = [];
  let dirs;
  try { dirs = fs.readdirSync(cacheRoot, { withFileTypes: true }).filter(d => d.isDirectory()); }
  catch { throw new Error(`cannot read the artifact cache at ${cacheRoot}`); }
  for (const p of programs) {
    const hits = dirs
      .map(d => path.join(cacheRoot, d.name, p.file))
      .filter(f => { try { return fs.statSync(f).isFile(); } catch { return false; } });
    if (hits.length === 0) found.push({ ...p, path: null, bytes: null, missing: true });
    else if (hits.length > 1) throw new Error(`${p.file} appears ${hits.length} times under ${cacheRoot}; `
      + 'a content-addressed cache with two copies of one program is ambiguous and must not be deployed from');
    else found.push({ ...p, path: hits[0], bytes: fs.statSync(hits[0]).size, missing: false });
  }
  return found;
}

export function budget(artifacts, { maxLenMultiplier = 2 } = {}) {
  const rows = artifacts.filter(a => !a.missing).map(a => ({
    ...a,
    exact: deploymentCost(a.bytes),
    headroom: deploymentCost(a.bytes, { maxLen: a.bytes * maxLenMultiplier }),
  }));
  const sum = (rows_, pick) => rows_.reduce((t, r) => t + pick(r), 0);
  return {
    rows,
    missing: artifacts.filter(a => a.missing).map(a => a.name),
    // Deploying one at a time means the peak is the largest single peak plus the
    // permanent cost of everything already deployed - which is cheaper than the
    // naive sum and is how it will actually be done.
    exact: {
      permanent: sum(rows, r => r.exact.permanent),
      peakSequential: peakSequential(rows, 'exact'),
      peakTogether: sum(rows, r => r.exact.peak),
    },
    headroom: {
      permanent: sum(rows, r => r.headroom.permanent),
      peakSequential: peakSequential(rows, 'headroom'),
      peakTogether: sum(rows, r => r.headroom.peak),
    },
  };
}

function peakSequential(rows, which) {
  let worst = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const already = rows.slice(0, i).reduce((t, r) => t + r[which].permanent, 0);
    worst = Math.max(worst, already + rows[i][which].peak);
  }
  return worst;
}

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const next = process.argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
};

export async function main({ connectionFactory } = {}) {
  const cacheRoot = arg('cache-root');
  if (!cacheRoot) throw new Error('--cache-root <dir> is required; there is no default artifact location');
  const artifacts = findArtifacts(cacheRoot);
  const b = budget(artifacts);

  console.log(`artifact cache: ${cacheRoot}`);
  for (const a of artifacts) {
    if (a.missing) { console.log(`  ${a.name.padEnd(8)} MISSING - ${a.file} is not in this cache`); continue; }
    console.log(`  ${a.name.padEnd(8)} ${String(a.bytes).padStart(9)} bytes  ${a.id}`);
  }
  if (b.missing.length) console.log(`\nNOT DEPLOYABLE: missing ${b.missing.join(', ')}`);

  console.log('\ncost, exact fit (--max-len equal to the program):');
  console.log(`  permanent            ${sol(b.exact.permanent)} SOL`);
  console.log(`  peak, one at a time  ${sol(b.exact.peakSequential)} SOL`);
  console.log('\ncost, one upgrade of headroom (--max-len twice the program):');
  console.log(`  permanent            ${sol(b.headroom.permanent)} SOL`);
  console.log(`  peak, one at a time  ${sol(b.headroom.peakSequential)} SOL`);
  console.log('\nThe buffer account is reclaimed when the deploy consumes it, so the peak is what the');
  console.log('payer must HOLD and the permanent figure is what stays locked in rent afterwards.');
  console.log('Pass --max-len explicitly at deploy time. The CLI default depends on its version, and');
  console.log('an exact fit means the first upgrade that grows the binary cannot be deployed in place.');

  const rpc = arg('rpc');
  const payer = arg('payer');
  if (!rpc) { console.log('\nno --rpc given, so no balance was read'); return b; }
  if (!connectionFactory) throw new Error('--rpc needs a connection factory; run this as a CLI');
  const { assertSendable } = await import('../g2-crank/cluster.mjs');
  const connection = connectionFactory(rpc);
  const cluster = await assertSendable(connection);
  console.log(`\ncluster: ${cluster.name}`);
  if (!payer) { console.log('no --payer <pubkey> given, so no balance was read'); return b; }
  const web3 = await import('@solana/web3.js');
  const lamports = await connection.getBalance(new web3.PublicKey(payer));
  const need = b.headroom.peakSequential;
  console.log(`payer ${payer}`);
  console.log(`  holds  ${sol(lamports)} SOL`);
  console.log(`  needs  ${sol(need)} SOL for the headroom plan`);
  console.log(lamports >= need
    ? '  SUFFICIENT'
    : `  SHORT BY ${sol(need - lamports)} SOL - a deploy started now fails part-way`);
  return { ...b, payerLamports: lamports };
}

import { pathToFileURL } from 'node:url';
export const isCliEntrypoint = (moduleUrl, argv1, toFileUrl = pathToFileURL) => {
  if (typeof argv1 !== 'string' || argv1 === '') return false;
  try { return moduleUrl === toFileUrl(argv1).href; } catch { return false; }
};

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  main({ connectionFactory: async url => {
    const web3 = await import('@solana/web3.js');
    return new web3.Connection(url, 'confirmed');
  } }).catch(e => { console.error(String(e.message || e)); process.exit(1); });
}
