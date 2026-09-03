#!/usr/bin/env node
// RatchetX Core v1 — the open runner. Anyone with an RPC and a funded keypair
// can run it; the program needs no particular runner, only that someone runs
// one. It never holds a player's key, never reveals (only the salt holder can),
// and every action it takes is one the program lets a stranger take:
//
//   checkpoint  keep each feed's clock warm while a shot is open, and capture
//               the first sponsored Pyth update at/after expiry
//   bind        freeze the crossing into each shot before settling a batch of
//               them, so the last settle in a queue cannot lose to a ring that
//               wrapped while it waited
//   settle      pin the crossing into the shot (equality voids and refunds)
//   void        refund a shot that got no valid price inside the 120 s window
//   forfeit     a settled shot nobody revealed within an hour becomes a MISS
//   close       (with --close) return shot rent to the player once it is final
//
// Usage:
//   node crank.mjs --rpc https://api.mainnet-beta.solana.com --keypair ~/.config/solana/id.json [--once] [--interval 5] [--close] [--dry]
//
// The keypair only pays fees and rent for clocks (about 0.015 SOL once per
// feed). Run several from different machines: duplicates are harmless — a
// second checkpoint of the same update is a no-op, a second settle fails on
// state and costs one fee.
import fs from 'node:fs';
import { Connection, Keypair, Transaction } from '@solana/web3.js';
import { planActions, instructionsFor, readShots, readClocks, readPushes, FEEDS, STATE_NAME } from './core.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true] : []).filter(Boolean));
const rpc = args.rpc || process.env.RATCHET_RPC || 'https://api.mainnet-beta.solana.com';
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

// A bind is three accounts and no economic effect, so a lot of them fit in one
// transaction. Sixteen is well inside the size limit with room for the
// signature and blockhash, and it means a hundred expiring shots are frozen in
// seven transactions rather than lost one at a time to whoever settles last.
const BIND_PER_TX = 16;

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

  // Binds go first and go together. They are idempotent, so a second runner
  // racing this one wastes a fee and nothing else; and if one batch fails the
  // rest still land, because each transaction is independent.
  const binds = actions.filter(a => a.kind === 'bind');
  for (let i = 0; i < binds.length; i += BIND_PER_TX) {
    const batch = binds.slice(i, i + BIND_PER_TX);
    const label = `bind x${batch.length} ${FEEDS[batch[0].feedIndex].symbol}`;
    try { await send(batch.flatMap(a => instructionsFor(a, cranker.publicKey)), label); }
    catch (e) {
      log('FAIL', label, String(e.message || e).split('\n')[0]);
      // One oversized or unlucky batch must not cost the whole tick. Fall back
      // to one at a time: slower, and it still freezes what it can.
      for (const a of batch) {
        const one = `bind ${a.shot.toBase58()}`;
        try { await send(instructionsFor(a, cranker.publicKey), one); }
        catch (err) { log('FAIL', one, String(err.message || err).split('\n')[0]); }
      }
    }
  }

  for (const a of actions) {
    if (a.kind === 'bind') continue;
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
