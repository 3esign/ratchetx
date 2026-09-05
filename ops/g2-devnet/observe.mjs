#!/usr/bin/env node
// The Pyth observer, IO half.
//
// Everything that DECIDES is in ./observer.mjs and ops/g2-crank/pyth.mjs, both
// tested without a network. This file reads an account, hands the bytes to the
// decoder, hands the decision to the sender, and stops. It is deliberately the
// smallest file in the chain because it is the only one no test here can reach:
// this session has no network on either machine it can run on.
//
//   node ops/g2-devnet/observe.mjs --rpc <devnet> --price <pyth account> --needs <file.json>
//   node ops/g2-devnet/observe.mjs ... --send --keypair <path>
//
// DRY RUN IS THE DEFAULT. Without --send it decodes, decides, prints what it
// would submit and why, and sends nothing.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { decodePriceUpdate } from '../g2-crank/pyth.mjs';
import { observerTick, nextPollMs } from './observer.mjs';

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const next = process.argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

// The Needs being watched come from a file the caller writes, not from a scan.
// getProgramAccounts filters over a layout no deployed program had confirmed is
// exactly what ops/g2-crank/crank.mjs refuses to guess at, and this file is not
// the place to start guessing.
export function readNeeds(path) {
  if (!path) throw new Error('--needs <file.json> is required: the Needs to watch are named, not discovered');
  const parsed = JSON.parse(fs.readFileSync(path, 'utf8'));
  const needs = Array.isArray(parsed) ? parsed : parsed.needs;
  if (!Array.isArray(needs)) throw new Error(`${path} does not contain a Need array`);
  for (const n of needs) {
    for (const field of ['key', 'targetTs', 'captureDeadlineTs', 'maxPostTargetLagSeconds']) {
      if (n[field] === undefined) throw new Error(`a Need in ${path} is missing ${field}`);
    }
  }
  return needs;
}

export async function observeOnce({ connection, web3, priceAccount, needs, now, sent, log = console.log }) {
  let print = null;
  const info = await connection.getAccountInfo(new web3.PublicKey(priceAccount), 'confirmed');
  if (!info) {
    // NOT a null print silently. An unreadable price account and a price account
    // holding nothing admissible look identical downstream, and only one of them
    // means the observer is working.
    log(`the price account ${priceAccount} could not be read - this is not "no admissible price", it is no price at all`);
  } else {
    print = decodePriceUpdate(info.data);
  }
  const tick = observerTick({ needs, print, now, sent });
  for (const n of tick.notes) log(`  ${n.need} [${n.phase}] ${n.why}`);
  return { tick, print };
}

export async function main({ connectionFactory, web3, sendOne, loadSigner } = {}) {
  const rpc = arg('rpc');
  const priceAccount = arg('price');
  const needsPath = arg('needs');
  const send = arg('send') === true;
  const keypair = arg('keypair');
  if (!rpc) throw new Error('--rpc <url> is required; there is no default endpoint');
  if (!priceAccount) throw new Error('--price <account> is required');
  if (send && !keypair) throw new Error('--send requires --keypair; the fee payer is never implicit');

  const connection = await connectionFactory(rpc);
  const needs = readNeeds(needsPath);
  const signer = send ? loadSigner(web3, keypair) : null;
  const sent = new Set();

  console.log(`watching ${needs.length} Need(s) against ${priceAccount}`);
  console.log(send ? 'MODE: SEND' : 'MODE: DRY RUN - nothing will be sent');

  for (;;) {
    const now = Math.floor(Date.now() / 1000);
    const { tick } = await observeOnce({ connection, web3, priceAccount, needs, now, sent });

    for (const action of tick.actions) {
      console.log(`${send ? 'SUBMIT' : 'WOULD SUBMIT'} ${action.instruction} for ${action.need}: ${action.why}`);
      if (!send) continue;
      // Marked BEFORE the await, not after. A second tick can start while this
      // one is still confirming, and the fingerprint is the only thing standing
      // between that and paying for the same capture twice.
      sent.add(action.fingerprint);
      const result = await sendOne({ /* the caller supplies the built instruction */ ...action, signer });
      if (!result || !result.sent) {
        // Un-mark, so a refusal that was not the chain's fault can be retried on
        // the next tick rather than being silently dropped for the whole run.
        sent.delete(action.fingerprint);
        console.log(`  not sent: ${result && result.reason}`);
      }
    }

    if (tick.done) { console.log('every Need has passed its capture deadline; nothing left to watch'); return tick; }
    await sleep(nextPollMs(needs, now));
  }
}

export const isCliEntrypoint = (moduleUrl, argv1, toFileUrl = pathToFileURL) => {
  if (typeof argv1 !== 'string' || argv1 === '') return false;
  try { return moduleUrl === toFileUrl(argv1).href; } catch { return false; }
};

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  const web3 = await import('@solana/web3.js');
  const { sendOne, loadSigner } = await import('../g2-send/send.mjs');
  main({ web3, sendOne, loadSigner, connectionFactory: async url => new web3.Connection(url, 'confirmed') })
    .catch(e => { console.error(String(e.message || e)); process.exit(1); });
}
