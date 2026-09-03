#!/usr/bin/env node
// RatchetX Core chain-only inspector. It reads finalized Solana accounts
// directly and emits machine-readable JSON. It has no signer, keypair,
// transaction path, application API or Supabase dependency.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Connection, PublicKey } from '@solana/web3.js';
import {
  PROGRAM_ID,
  STATE_NAME,
  readAllShotsWithContext,
  readLedgerWithContext,
  readPlayerShots,
  readPodiumWithContext,
  readProgramDeployment,
} from './core.mjs';

export const DEFAULT_DEVNET_RPC = 'https://api.devnet.solana.com';
export const FINALIZED = 'finalized';
export const DEVNET_NOTICE = 'DEVNET \u2014 NOT LIVE CREDITS';

// The cluster used to be announced from the absence of a flag: no --rpc meant
// the banner said DEVNET, whatever the endpoint actually served. An inspector
// whose most prominent line is an assumption is not an inspector. The genesis
// hash is the chain's own answer to "which chain am I", and it costs one call.
export const GENESIS = {
  '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d': 'mainnet-beta',
  EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG: 'devnet',
  '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY': 'testnet',
};
export const noticeFor = cluster =>
  cluster === 'mainnet-beta' ? 'MAINNET-BETA \u2014 LIVE'
  : cluster === 'devnet' ? DEVNET_NOTICE
  : cluster === 'testnet' ? 'TESTNET \u2014 NOT LIVE CREDITS'
  : 'UNKNOWN CLUSTER \u2014 THE GENESIS HASH MATCHES NO KNOWN NETWORK';

/** Ask the chain which chain it is. Never throws the inspection away over it:
 *  an endpoint that will not answer getGenesisHash still gives a usable report,
 *  it just cannot be allowed to claim a cluster it did not prove. */
export async function readCluster(connection) {
  try {
    const genesisHash = await connection.getGenesisHash();
    return { genesisHash, cluster: GENESIS[genesisHash] ?? 'unknown' };
  } catch (error) {
    return { genesisHash: null, cluster: 'unknown', error: String(error && error.message || error).slice(0, 120) };
  }
}

export async function inspectCore(connection, { player = null, commitment = FINALIZED, notice = null, discoverShots = true } = {}) {
  const playerKey = player ? (player instanceof PublicKey ? player : new PublicKey(player)) : null;
  const [identity, deployment, podiumRead] = await Promise.all([
    readCluster(connection),
    readProgramDeployment(connection, commitment),
    readPodiumWithContext(connection, commitment),
  ]);
  const [ledgerRead, shotRead] = playerKey
    ? await Promise.all([
      readLedgerWithContext(connection, playerKey, commitment),
      readPlayerShots(connection, playerKey, commitment),
    ])
    : [null, null];

  // With no wallet the inspector used to stop at the podium, which meant the
  // one thing it could not do was the thing the gate asks for: reconstruct the
  // state from a program id and a public RPC and nothing else. Shots are
  // discoverable by discriminator and size, so discover them.
  const allShots = discoverShots ? await readAllShotsWithContext(connection, commitment) : null;

  return {
    notice: notice ?? noticeFor(identity.cluster),
    cluster: identity.cluster,
    genesisHash: identity.genesisHash,
    readOnly: true,
    commitment,
    contextSlots: {
      deployment: deployment.contextSlot,
      podium: podiumRead.contextSlot,
      ledger: ledgerRead?.contextSlot ?? null,
      shots: shotRead?.contextSlot ?? null,
      allShots: allShots?.contextSlot ?? null,
    },
    program: {
      id: deployment.programId,
      expectedId: PROGRAM_ID,
      loader: deployment.loader,
      executable: deployment.executable,
      programData: deployment.programData,
      deployedSlot: deployment.deployedSlot,
      upgradeAuthority: deployment.upgradeAuthority,
      immutable: deployment.immutable,
    },
    podium: podiumRead.podium,
    shots: allShots ? allShots.shots.map(shot => ({ ...shot, stateName: STATE_NAME[shot.state] ?? `Unknown(${shot.state})` })) : null,
    shotCount: allShots ? allShots.shots.length : null,
    player: playerKey ? {
      address: playerKey,
      ledger: ledgerRead.ledger,
      shots: shotRead.shots.map(shot => ({ ...shot, stateName: STATE_NAME[shot.state] ?? `Unknown(${shot.state})` })),
    } : null,
  };
}

export function inspectionJson(value) {
  return JSON.stringify(value, (_key, item) => {
    if (typeof item === 'bigint') return item.toString(10);
    if (item instanceof PublicKey) return item.toBase58();
    return item;
  }, 2);
}

/** The part of a report that two honest endpoints must agree on. Slots and the
 *  banner are deliberately excluded: two endpoints read at different moments, so
 *  differing slots are lag, not disagreement. Everything else -- the deployment,
 *  the authority, the podium, every discovered shot -- is a claim about the same
 *  finalized chain, and if two independent endpoints disagree about it then one
 *  of them is wrong and the inspection is worthless until you know which.
 *
 *  Arrays are sorted by their own serialisation because RPCs return program
 *  accounts in whatever order they please, and an inspector that reported a
 *  disagreement over ordering would be crying wolf. */
export function canonicalContent(report) {
  // Sorting an array means serialising its elements, and a plain JSON.stringify
  // throws on the BigInts these reports are full of -- nonces, slots, credits.
  // Sort by the same representation the report itself is written in.
  const keyOf = value => inspectionJson(value);
  const stable = value => {
    if (Array.isArray(value)) return value.map(stable).map(keyOf).sort().map(JSON.parse);
    if (value && typeof value === 'object' && !(value instanceof PublicKey)) {
      const out = {};
      for (const key of Object.keys(value).sort()) out[key] = stable(value[key]);
      return out;
    }
    return value;
  };
  const { notice, contextSlots, ...content } = report;
  return inspectionJson(stable(content));
}

/** Two endpoints, one chain. Returns what agreed, what did not, and the slots
 *  each side was reading at, so lag can be told apart from contradiction. */
export function reconcileReports(a, b) {
  const agree = canonicalContent(a) === canonicalContent(b);
  const differing = [];
  if (!agree) {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (key === 'notice' || key === 'contextSlots') continue;
      if (canonicalContent({ [key]: a[key] }) !== canonicalContent({ [key]: b[key] })) differing.push(key);
    }
  }
  return {
    agree,
    differing,
    slots: { first: a.contextSlots, second: b.contextSlots },
    sameCluster: a.cluster === b.cluster && a.genesisHash === b.genesisHash,
  };
}

function usage() {
  return [
    'RatchetX Core read-only chain inspector',
    '',
    'Usage:',
    '  node onchain/ratchet-core/client/inspect.mjs [--player <wallet>] [--rpc <url>] [--rpc2 <url>]',
    '',
    `Default RPC: ${DEFAULT_DEVNET_RPC}`,
    `Commitment:  ${FINALIZED}`,
    'No signer or keypair is accepted.',
    '',
    '--rpc2 reads the same state through a second independent endpoint and',
    'compares it. Differing slots are reported as lag; differing CONTENT exits',
    'non-zero, because two endpoints disagreeing about a finalized chain means',
    'the inspection cannot be trusted until you know which one is wrong.',
    'The cluster is read from the chain (getGenesisHash), never assumed.',
  ].join('\n');
}

function parseArgs(argv) {
  let rpc = DEFAULT_DEVNET_RPC;
  let rpc2 = null;
  let player = null;
  let customRpc = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') return { help: true };
    if (arg === '--rpc') {
      if (!argv[i + 1]) throw new TypeError('--rpc requires a URL');
      rpc = argv[++i]; customRpc = true; continue;
    }
    if (arg === '--rpc2') {
      if (!argv[i + 1]) throw new TypeError('--rpc2 requires a URL');
      rpc2 = argv[++i]; continue;
    }
    if (arg === '--player') {
      if (!argv[i + 1]) throw new TypeError('--player requires a wallet public key');
      player = new PublicKey(argv[++i]); continue;
    }
    throw new TypeError(`unknown argument: ${arg}`);
  }
  return { help: false, rpc, rpc2, player, customRpc };
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) { console.log(usage()); return; }
  console.error('RatchetX Core chain-only inspector (nothing signed or sent)');
  const connection = new Connection(options.rpc, { commitment: FINALIZED });
  const report = await inspectCore(connection, { player: options.player, commitment: FINALIZED });
  console.error(report.notice);
  if (!options.rpc2) { console.log(inspectionJson(report)); return; }

  const second = await inspectCore(new Connection(options.rpc2, { commitment: FINALIZED }),
    { player: options.player, commitment: FINALIZED });
  const agreement = reconcileReports(report, second);
  console.log(inspectionJson({ ...report, agreement }));
  if (!agreement.sameCluster) {
    console.error('The two endpoints are not on the same chain. Nothing here should be trusted.');
    process.exitCode = 1;
    return;
  }
  if (!agreement.agree) {
    console.error(`Endpoints disagree about: ${agreement.differing.join(', ')}. `
      + 'If their slots differ this may be lag; read again before believing either.');
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main().catch(error => {
    console.error(`Inspector failed closed: ${error.message}`);
    process.exitCode = 1;
  });
}
