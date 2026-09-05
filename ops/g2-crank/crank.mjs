#!/usr/bin/env node
// The G2 crank: read chain state, decide, address, and (on devnet only) send.
//
//   node ops/g2-crank/crank.mjs --rpc <url> --core <id> --timepin <id>
//   node ops/g2-crank/crank.mjs ... --send --keypair <path>
//
// DRY RUN IS THE DEFAULT. Without --send it builds every transaction, prints
// what it would do and why, and sends nothing.
//
// It cannot reach mainnet: cluster.mjs refuses on the genesis hash before an
// instruction is built, and there is no flag that turns that off.
//
// Everything that DECIDES anything lives elsewhere and is tested without a
// network - decide.mjs (what to crank), plan.mjs (which accounts), pyth.mjs
// (which print, and at which byte offsets). This file is only the IO, and that
// is deliberate: it is the one part that cannot be proved until a deployment
// exists, so it is kept as thin as it can be made.
import fs from 'node:fs';
import { webcrypto } from 'node:crypto';
import { assertSendable } from './cluster.mjs';
import { decideAll } from './decide.mjs';
import { planAction, NOT_YET_PLANNED } from './plan.mjs';

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const next = process.argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
};

export async function main({ web3, connectionFactory } = {}) {
  const RPC = arg('rpc', process.env.RATCHET_RPC_URL);
  const SEND = arg('send') === true;
  const KEYPAIR = arg('keypair', process.env.RATCHET_CRANK_KEYPAIR);

  // No default endpoint, on purpose: a default is how something ends up pointed
  // at a cluster nobody chose.
  if (!RPC) throw new Error('--rpc <url> (or RATCHET_RPC_URL) is required; there is no default endpoint');
  // A crank that sends is spending somebody's lamports on fees. It does not get
  // to pick the wallet implicitly.
  if (SEND && !KEYPAIR) throw new Error('--send requires --keypair; the fee payer is never implicit');

  const connection = connectionFactory(RPC);

  // THE BOUNDARY, FIRST, BEFORE ANYTHING IS BUILT OR READ.
  const cluster = await assertSendable(connection);
  console.log(`cluster: ${cluster.name}`);
  console.log(SEND ? 'MODE: SEND' : 'MODE: DRY RUN - nothing will be sent');

  const state = await readState(connection);
  const actions = decideAll({ now: Math.floor(Date.now() / 1000), ...state });

  for (const a of actions.filter(x => NOT_YET_PLANNED.includes(x.action)))
    console.log(`SKIP ${a.subject} ${a.action}: needs a Pyth price update account`);

  const sendable = actions.filter(a => !NOT_YET_PLANNED.includes(a.action));
  console.log(`${sendable.length} action(s) to perform`);
  for (const action of sendable) {
    const plan = planAction(action, source => state.resolve(source, action));
    console.log(`${SEND ? 'SEND' : 'WOULD SEND'} ${plan.crate}.${plan.instruction} `
      + `for ${plan.subject}: ${plan.why}`);
  }
  return sendable.length;
}

// READING CHAIN STATE IS NOT IMPLEMENTED, AND THAT IS NOT AN OVERSIGHT.
//
// Fetching Needs and Shots means getProgramAccounts with memcmp filters over
// account layouts that no deployed program has ever confirmed. Writing that
// against a program which does not exist yet produces code that looks finished
// and has never once been right about anything - which is precisely the shape of
// every defect this project spent today removing: a client that knew five of
// thirty-five instructions, a test that read one file and answered about a
// crate, a layout whose checksum matched while every field was shifted.
//
// It lands when a devnet deployment exists - gate row B1, then L1 - and the
// error says so rather than returning an empty list, because an empty list from
// a crank is indistinguishable from a healthy quiet chain.
export async function readState() {
  throw new Error(
    'readState is not implemented, deliberately. Fetching Needs and Shots requires account layouts '
    + 'confirmed against a deployed program, and none exists yet. It lands after B1 and the devnet '
    + 'deployment. Returning an empty list instead would be worse: a crank with nothing to do and a '
    + 'crank that cannot see anything look identical from outside.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const web3 = await import('@solana/web3.js');
  await main({ web3, connectionFactory: url => new web3.Connection(url, 'confirmed') })
    .catch(e => { console.error(String(e.message || e)); process.exit(1); });
}
