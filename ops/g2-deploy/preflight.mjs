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
import { deploymentCost, sol, rentExempt, fetchRentQuotes, SIZE_OF_PROGRAM,
  sizeOfProgramData, sizeOfBuffer } from './rent.mjs';

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

export function budget(artifacts, { maxLenMultiplier = 2, rentForSize = rentExempt } = {}) {
  const rows = artifacts.filter(a => !a.missing).map(a => ({
    ...a,
    exact: deploymentCost(a.bytes, { rentForSize }),
    headroom: deploymentCost(a.bytes, { maxLen: a.bytes * maxLenMultiplier, rentForSize }),
  }));
  const sum = (rows_, pick) => rows_.reduce((t, r) => t + pick(r), 0);
  return {
    rows,
    missing: artifacts.filter(a => a.missing).map(a => a.name),
    // Fresh deployment reuses its buffer funding. Every program's final rent
    // remains locked; no additional buffer deposit is added to that total.
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

// Retained API: fresh deployments have equal rent peaks in either order.
// Keep caller order; protocol dependencies, not a fictitious saving, choose it.
export function cheapestOrder(rows, which = 'exact') {
  return {
    order: rows.map(r => r.name),
    peak: peakSequential(rows, which),
    worstPeak: peakSequential([...rows].reverse(), which),
  };
}

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const next = process.argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
};

export async function main({ connectionFactory } = {}) {
  const cacheRoot = arg('cache-root');
  if (typeof cacheRoot !== 'string') throw new Error('--cache-root <dir> is required; there is no default artifact location');
  const selectedPlan = arg('plan', 'exact');
  if (!['exact', 'headroom'].includes(selectedPlan)) throw new Error('--plan must be exact or headroom');
  const artifacts = findArtifacts(cacheRoot);
  const rpc = arg('rpc');
  const payer = arg('payer');
  let connection = null, cluster = null, rentForSize = rentExempt;
  const rentSource = rpc ? 'rpc' : 'legacy-estimate';
  if (rpc) {
    if (typeof rpc !== 'string') throw new Error('--rpc requires a URL');
    if (!connectionFactory) throw new Error('--rpc needs a connection factory; run this as a CLI');
    connection = await connectionFactory(rpc);
    const { assertSendable } = await import('../g2-crank/cluster.mjs');
    cluster = await assertSendable(connection);
    const sizes = [SIZE_OF_PROGRAM, ...artifacts.filter(a => !a.missing).flatMap(a =>
      [sizeOfBuffer(a.bytes), sizeOfProgramData(a.bytes), sizeOfProgramData(a.bytes * 2)])];
    const quotes = await fetchRentQuotes(connection, sizes);
    rentForSize = size => {
      if (!quotes.has(size)) throw new Error('missing RPC rent quote for ' + size + ' bytes');
      return quotes.get(size);
    };
  }
  const b = budget(artifacts, { rentForSize });
  const selectedRentLamports = b[selectedPlan].peakSequential;
  const report = { ...b, selectedPlan, selectedRentLamports, rentSource,
    cluster: cluster?.name ?? null, feesIncluded: false, firstDeploymentOnly: true };
  console.log('artifact cache: ' + cacheRoot);
  for (const a of artifacts) {
    console.log(a.missing ? '  ' + a.name + ' MISSING - ' + a.file
      : '  ' + a.name + ' ' + a.bytes + ' bytes ' + a.id);
  }
  console.log(rpc ? 'rent: live RPC quotes on ' + cluster.name
    : 'rent: LEGACY ESTIMATE ONLY (6960 lamports/byte); use --rpc for current cluster quotes');
  console.log('exact capacity: ' + sol(b.exact.permanent) + ' SOL rent');
  console.log('double capacity: ' + sol(b.headroom.permanent) + ' SOL rent');
  console.log('selected plan: ' + selectedPlan + ', ' + sol(selectedRentLamports) + ' SOL rent');
  console.log('First deployment reuses buffer funding before creating ProgramData; fees are additional.');
  console.log('Capacity does not decide upgrade authority. Exact capacity can be extended later while upgradeable.');
  console.log('This is a budget, not artifact acceptance or permission to deploy.');
  if (b.missing.length) {
    console.log('NOT DEPLOYABLE: missing ' + b.missing.join(', ') + '; totals above are partial');
    return report;
  }
  if (!rpc) { console.log('No RPC supplied: no payer funding verdict.'); return report; }
  if (!payer) { console.log('No --payer <pubkey> supplied: no balance was read.'); return report; }
  if (typeof payer !== 'string') throw new Error('--payer requires a public key');
  const { PublicKey } = await import('@solana/web3.js');
  const lamports = await connection.getBalance(new PublicKey(payer));
  if (!Number.isSafeInteger(lamports) || lamports < 0) throw new Error('RPC returned an invalid payer balance');
  const rentCovered = lamports >= selectedRentLamports;
  console.log('payer ' + payer + ' holds ' + sol(lamports) + ' SOL');
  console.log(rentCovered ? 'RENT COVERED for ' + selectedPlan + '; transaction fees still need funding.'
    : 'RENT SHORT BY ' + sol(selectedRentLamports - lamports) + ' SOL for ' + selectedPlan + ', before fees.');
  return { ...report, payerLamports: lamports, rentCovered };
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
