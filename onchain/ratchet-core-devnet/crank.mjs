#!/usr/bin/env node
// RatchetX Core v1 — the open runner, DEVNET FAUCET FLAVOUR (program CnKAJ…, same rules).
// Identical to onchain/ratchet-core/client/crank.mjs except that it imports the devnet
// core.mjs beside it and defaults to the devnet RPC. The mainnet runner is the original. Anyone with an RPC and a funded keypair
// can run it; the program needs no particular runner, only that someone runs
// one. It never holds a player's key, never reveals (only the salt holder can),
// and every action it takes is one the program lets a stranger take:
//
//   checkpoint  keep each feed's clock warm while a shot is open, and capture
//               the first sponsored Pyth update at/after expiry
//   settle      pin the crossing into the shot (equality voids and refunds)
//   void        refund a shot that got no valid price inside the 120 s window
//   forfeit     a settled shot nobody revealed within an hour becomes a MISS
//   close       (with --close) return shot rent to the player once it is final
//
// Usage:
//   node crank.mjs --rpc https://api.devnet.solana.com --keypair <devnet id.json> [--once] [--interval 5] [--close] [--dry]
//
// The keypair only pays fees and rent for clocks (about 0.015 SOL once per
// feed). Run several from different machines: duplicates are harmless — a
// second checkpoint of the same update is a no-op, a second settle fails on
// state and costs one fee.
import fs from 'node:fs';
import { Connection, Keypair, Transaction } from '@solana/web3.js';
import { planActions, instructionsFor, readShots, readClocks, readPushes, FEEDS, STATE_NAME } from './core.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true] : []).filter(Boolean));
const rpc = args.rpc || process.env.RATCHET_RPC || 'https://api.devnet.solana.com';
const keypairPath = args.keypair || process.env.RATCHET_CRANK_KEYPAIR;
const once = args.once === true;
const dry = args.dry === true;
const close = args.close === true;
const interval = Math.max(2, Number(args.interval) || 5);
if (!keypairPath && !dry) { console.error('need --keypair FILE (fee payer) or --dry'); process.exit(2); }
const connection = new Connection(rpc, 'confirmed');
const cranker = keypairPath ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, 'utf8')))) : Keypair.generate();
const log = (...a) => console.log(new Date().toISOString(), ...a);

async function chainNow() {
  const slot = await connection.getSlot('confirmed');
  const t = await connection.getBlockTime(slot);
  return t ?? Math.floor(Date.now() / 1000);
}

async function send(ixs, label) {
  if (dry) { log('DRY', label); return null; }
  const tx = new Transaction().add(...ixs);
  tx.feePayer = cranker.publicKey;
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash;
  tx.sign(cranker);
  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
  log('OK', label, sig);
  return sig;
}

async function tick() {
  const [shots, now] = await Promise.all([readShots(connection), chainNow()]);
  const open = shots.filter(s => s.state <= 2);
  const indices = [...new Set(open.map(s => s.feedIndex))];
  const [clocks, pushes] = indices.length ? await Promise.all([readClocks(connection, indices), readPushes(connection, indices)]) : [new Map(), new Map()];
  const actions = planActions({ shots, clocks, pushes, now, close });
  log(`shots=${shots.length} open=${open.length} actions=${actions.length}` + (open.length ? ' ' + open.map(s => `${FEEDS[s.feedIndex].symbol}:${STATE_NAME[s.state]}@${s.expiryTs}`).join(' ') : ''));
  for (const a of actions) {
    const label = `${a.kind} ${a.feedIndex !== undefined ? FEEDS[a.feedIndex].symbol : ''} ${a.shot ? a.shot.toBase58() : ''}`.trim();
    try { await send(instructionsFor(a, cranker.publicKey), label); }
    catch (e) { log('FAIL', label, String(e.message || e).split('\n')[0]); }
  }
}

log(`ratchet-core crank ${cranker.publicKey.toBase58()} rpc=${rpc} once=${once} dry=${dry} close=${close}`);
for (;;) {
  try { await tick(); } catch (e) { log('ERROR', String(e.message || e).split('\n')[0]); }
  if (once) break;
  await new Promise(r => setTimeout(r, interval * 1000));
}
