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
  readLedgerWithContext,
  readPlayerShots,
  readPodiumWithContext,
  readProgramDeployment,
} from './core.mjs';

export const DEFAULT_DEVNET_RPC = 'https://api.devnet.solana.com';
export const FINALIZED = 'finalized';
export const DEVNET_NOTICE = 'DEVNET \u2014 NOT LIVE CREDITS';

export async function inspectCore(connection, { player = null, commitment = FINALIZED, notice = DEVNET_NOTICE } = {}) {
  const playerKey = player ? (player instanceof PublicKey ? player : new PublicKey(player)) : null;
  const [deployment, podiumRead] = await Promise.all([
    readProgramDeployment(connection, commitment),
    readPodiumWithContext(connection, commitment),
  ]);
  const [ledgerRead, shotRead] = playerKey
    ? await Promise.all([
      readLedgerWithContext(connection, playerKey, commitment),
      readPlayerShots(connection, playerKey, commitment),
    ])
    : [null, null];

  return {
    notice,
    readOnly: true,
    commitment,
    contextSlots: {
      deployment: deployment.contextSlot,
      podium: podiumRead.contextSlot,
      ledger: ledgerRead?.contextSlot ?? null,
      shots: shotRead?.contextSlot ?? null,
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

function usage() {
  return [
    'RatchetX Core read-only chain inspector',
    '',
    'Usage:',
    '  node onchain/ratchet-core/client/inspect.mjs [--player <wallet>] [--rpc <url>]',
    '',
    `Default RPC: ${DEFAULT_DEVNET_RPC}`,
    `Commitment:  ${FINALIZED}`,
    'No signer or keypair is accepted.',
  ].join('\n');
}

function parseArgs(argv) {
  let rpc = DEFAULT_DEVNET_RPC;
  let player = null;
  let customRpc = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') return { help: true };
    if (arg === '--rpc') {
      if (!argv[i + 1]) throw new TypeError('--rpc requires a URL');
      rpc = argv[++i]; customRpc = true; continue;
    }
    if (arg === '--player') {
      if (!argv[i + 1]) throw new TypeError('--player requires a wallet public key');
      player = new PublicKey(argv[++i]); continue;
    }
    throw new TypeError(`unknown argument: ${arg}`);
  }
  return { help: false, rpc, player, customRpc };
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) { console.log(usage()); return; }
  const notice = options.customRpc ? 'CUSTOM RPC \u2014 VERIFY THE CLUSTER' : DEVNET_NOTICE;
  console.error('RatchetX Core chain-only inspector (nothing signed or sent)');
  console.error(notice);
  const connection = new Connection(options.rpc, { commitment: FINALIZED });
  const report = await inspectCore(connection, { player: options.player, commitment: FINALIZED, notice });
  console.log(inspectionJson(report));
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main().catch(error => {
    console.error(`Inspector failed closed: ${error.message}`);
    process.exitCode = 1;
  });
}
