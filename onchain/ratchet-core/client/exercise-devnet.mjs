// First contact between the core program and a real cluster. Runs on the
// machine with an RPC and a devnet fee payer; changes nothing of value.
//
//   node onchain/ratchet-core/client/exercise-devnet.mjs --rpc https://api.devnet.solana.com --keypair <devnet id.json>
//
// What it proves, in order:
//   1. the program is live and executable at its id
//   2. the sponsored SOL push account exists on this cluster (the referee)
//   3. `checkpoint` executes against it — the whole trustless referee path:
//      owner check, PDA check, Full verification, freshness, confidence, ring
//   4. `grant_delegate` / `revoke_delegate` round-trip (no credits needed)
//   5. `seal` on a wallet with no credits is REFUSED by the program
//      (InsufficientCredits) — the credit gate holds on a real cluster
// Seal → settle → reveal need credits, which on devnet need a faucet flavour
// that must not touch the mainnet bytes; that comes as a separate program id.
import fs from 'node:fs';
import { Connection, Keypair, Transaction, PublicKey } from '@solana/web3.js';
import * as C from './core.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true] : []).filter(Boolean));
const rpc = args.rpc || 'https://api.devnet.solana.com';
if (!args.keypair) { console.error('need --keypair <devnet fee payer json>'); process.exit(2); }
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(args.keypair, 'utf8'))));
const conn = new Connection(rpc, 'confirmed');
const log = (...a) => console.log(...a);
let pass = 0, fail = 0;
const ok = (m) => { pass++; log('✓ ' + m); };
const bad = (m) => { fail++; log('✗ ' + m); };

async function send(ixs, label) {
  const tx = new Transaction().add(...ixs);
  tx.feePayer = payer.publicKey;
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash; tx.sign(payer);
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
  return sig;
}
// The program's error name, pulled out of simulation logs.
const errName = (e) => { const m = String(e.message || e).match(/Error Code: (\w+)/) || String(e.message || e).match(/custom program error: (0x[0-9a-f]+)/i); return m ? m[1] : String(e.message || e).split('\n')[0].slice(0, 140); };

log(`exercise · ${rpc}\nprogram ${C.PROGRAM_ID.toBase58()}\npayer   ${payer.publicKey.toBase58()}\n`);

// 1. program live
const prog = await conn.getAccountInfo(C.PROGRAM_ID);
if (prog && prog.executable) ok(`program is live and executable (owner ${prog.owner.toBase58().slice(0, 12)}…)`);
else { bad('program account missing or not executable — deploy first'); process.exit(1); }

// 2. referee present on this cluster
const push = C.pushAccount(0);
const pushInfo = await conn.getAccountInfo(push);
let refereeOk = false;
if (!pushInfo) bad(`SOL sponsored push account ${push.toBase58()} does not exist on this cluster — checkpoint cannot be exercised here`);
else if (!pushInfo.owner.equals(C.PYTH_RECEIVER)) bad(`push account exists but owner is ${pushInfo.owner.toBase58()}, not the receiver`);
else {
  const p = C.parsePriceUpdate(pushInfo.data);
  const age = Math.floor(Date.now() / 1000) - Number(p.publishTime);
  refereeOk = true;
  ok(`SOL push account is receiver-owned · ${p.full ? 'Full' : 'PARTIAL'} · price ${(Number(p.price) * 10 ** p.exponent).toFixed(2)} · last publish ${age}s ago`);
  if (age > 120) log('  ⚠ stale on this cluster right now; checkpoint may be refused as too old (that refusal is itself correct behaviour)');
}

// 3. checkpoint — the referee path end to end
if (refereeOk) {
  try {
    const sig = await send([C.checkpointIx({ cranker: payer.publicKey, feedIndex: 0 })], 'checkpoint');
    const clockInfo = await conn.getAccountInfo(C.clockPda(0));
    const clock = clockInfo ? C.parseClock(clockInfo.data) : null;
    ok(`checkpoint(SOL) executed · sig ${sig.slice(0, 20)}… · clock now holds ${clock ? clock.observations.length : '?'} observation(s), latest publish ${clock ? clock.latestPublishTime : '?'}`);
  } catch (e) { bad(`checkpoint(SOL) failed: ${errName(e)}`); }
}

// 4. delegate grant round-trip
const delegate = Keypair.generate().publicKey;
try {
  const expiry = Math.floor(Date.now() / 1000) + 3600;
  const sig = await send([C.grantDelegateIx({ player: payer.publicKey, delegate, allowance: 1000, maxStake: 500, expiryTs: expiry })], 'grant');
  const g = C.parseGrant((await conn.getAccountInfo(C.grantPda(payer.publicKey, delegate))).data);
  ok(`grant_delegate executed · allowance ${g.allowance} · max_stake ${g.maxStake} · sig ${sig.slice(0, 20)}…`);
  await send([C.revokeDelegateIx({ player: payer.publicKey, delegate })], 'revoke');
  const gone = await conn.getAccountInfo(C.grantPda(payer.publicKey, delegate));
  if (!gone) ok('revoke_delegate executed · grant account closed, rent returned'); else bad('revoke_delegate ran but the grant account still exists');
} catch (e) { bad(`delegate round-trip failed: ${errName(e)}`); }

// 5. the credit gate: a seal with no credits must be refused by the program
if (refereeOk) {
  const salt = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
  const commit = C.commitHash({ wallet: payer.publicKey, nonce: 1, side: 'YES', pBps: 0, salt });
  try {
    await send([C.sealIx({ player: payer.publicKey, nonce: 1, commit, feedIndex: 0, minutes: 5, stake: 100 })], 'seal');
    bad('seal with ZERO credits was ACCEPTED — the credit gate is broken');
  } catch (e) {
    const name = errName(e);
    if (/InsufficientCredits/.test(name)) ok('seal with zero credits refused by the program: InsufficientCredits — the credit gate holds on-chain');
    else if (/PriceTooOld|ORACLE|TooUncertain|PartialVerification/.test(name)) log(`~ seal refused for an oracle reason (${name}) before the credit check — acceptable, retry when the devnet feed is fresh`);
    else bad(`seal refused with an unexpected error: ${name}`);
  }
}

log(`\n${pass} passed · ${fail} failed`);
log('Not exercised here: settle/reveal/forfeit/void need credits → devnet faucet flavour under a separate program id.');
process.exitCode = fail ? 1 : 0;
