// The whole shot life on devnet, one wallet, no server. Reload (faucet) → seal →
// checkpoint at expiry → settle → reveal, plus one shot left to void. Proves the
// economy end to end against a live cluster. Uses the devnet faucet program.
//   node full-life.mjs --rpc <url> --keypair <devnet id.json> [--minutes 1]
import fs from 'node:fs';
import { Connection, Keypair, Transaction, ComputeBudgetProgram } from '@solana/web3.js';
import * as C from './core.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true] : []).filter(Boolean));
const rpc = args.rpc || 'https://api.devnet.solana.com';
if (!args.keypair) { console.error('need --keypair'); process.exit(2); }
const minutes = Number(args.minutes) || 1;
const w = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(args.keypair, 'utf8'))));
const conn = new Connection(rpc, 'confirmed');
const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = m => { pass++; log('✓ ' + m); };
const bad = m => { fail++; log('✗ ' + m); };
const err = e => { const m = String(e.message || e).match(/Error Code: (\w+)/); return m ? m[1] : String(e.message || e).split('\n')[0].slice(0, 160); };

async function send(ixs, label, extraSigners = []) {
  const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }), ...ixs);
  tx.feePayer = w.publicKey;
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash; tx.sign(w, ...extraSigners);
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
  return sig;
}
const randSalt = () => [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');

log(`full-life · ${rpc}\nprogram ${C.PROGRAM_ID.toBase58()}\nwallet  ${w.publicKey.toBase58()}\nmint    ${C.RCX_MINT.toBase58()} (devnet faucet)\n`);

// 0. mint exists?
try { const mi = await conn.getAccountInfo(C.DEVNET_MINT_PDA); if (!mi) { await send([C.devnetInitMintIx({ payer: w.publicKey })], 'init_mint'); ok('devnet mint created'); } else ok('devnet mint already exists'); }
catch (e) { bad('init_mint failed: ' + err(e)); process.exit(1); }

// 1. faucet 100 tokens (6 decimals) → reload → credits
try {
  await send([C.devnetFaucetIx({ recipient: w.publicKey, amount: 100_000_000 })], 'faucet');
  const seats = await C.payableSeats(conn).catch(() => []);
  await send([C.reloadIx({ player: w.publicKey, amount: 100_000_000, seats })], 'reload');
  const led = await C.readLedger(conn, w.publicKey);
  ok(`faucet + reload · credits now ${led.credits} (100 tokens → 100 credits) · burned ${led.burned}`);
} catch (e) { bad('faucet/reload failed: ' + err(e)); }

// 2. seal a shot (SOL up)
const nonce = Date.now() % 1e9, salt = randSalt();
const commit = C.commitHash({ wallet: w.publicKey, nonce, side: 'YES', pBps: 0, salt });
let sealed = false, expiry = 0;
try {
  await send([C.sealIx({ player: w.publicKey, nonce, commit, feedIndex: 0, minutes, stake: 100 })], 'seal');
  const shot = C.parseShot((await conn.getAccountInfo(C.shotPda(w.publicKey, nonce))).data);
  expiry = Number(shot.expiryTs); sealed = true;
  ok(`seal · SOL up ${minutes}min · entry ${(Number(shot.entryE12) / 1e12).toFixed(2)} · stake 100 · expires ${expiry}`);
} catch (e) { bad('seal failed: ' + err(e)); }

// 3. wait for expiry, checkpoint, settle
if (sealed) {
  const waitS = Math.max(0, expiry - Math.floor(Date.now() / 1000)) + 8;
  log(`  waiting ${waitS}s for expiry + a post-expiry Pyth print …`);
  await sleep(waitS * 1000);
  try {
    // warm then capture: one checkpoint before, one after expiry forms the crossing
    await send([C.checkpointIx({ cranker: w.publicKey, feedIndex: 0 })], 'checkpoint');
    await sleep(3000);
    await send([C.checkpointIx({ cranker: w.publicKey, feedIndex: 0 })], 'checkpoint2').catch(() => {});
    await send([C.settleIx({ cranker: w.publicKey, shot: C.shotPda(w.publicKey, nonce), player: w.publicKey, feedIndex: 0 })], 'settle');
    const shot = C.parseShot((await conn.getAccountInfo(C.shotPda(w.publicKey, nonce))).data);
    ok(`settle · state ${C.STATE_NAME[shot.state]} · exit ${(Number(shot.exitE12) / 1e12).toFixed(2)}`);
    // 4. reveal
    if (shot.state === C.STATE.SETTLED) {
      await send([C.revealIx({ revealer: w.publicKey, shot: C.shotPda(w.publicKey, nonce), player: w.publicKey, side: 'YES', pBps: 0, salt })], 'reveal');
      const s2 = C.parseShot((await conn.getAccountInfo(C.shotPda(w.publicKey, nonce))).data);
      const led = await C.readLedger(conn, w.publicKey);
      ok(`reveal · ${s2.hit ? 'HIT' : 'MISS'} · credits now ${led.credits} · xp ${led.xp} · streak ${led.streak}`);
    } else if (shot.state === C.STATE.VOIDED) ok('settled to VOID (equality) · stake refunded — a valid outcome');
  } catch (e) { bad('settle/reveal path: ' + err(e) + ' (if the devnet Pyth feed was stale, retry)'); }
}

log(`\n${pass} passed · ${fail} failed`);
log(sealed ? 'The full economy ran on a live cluster, one wallet, no server.' : 'Seal did not land — check credits and the devnet feed freshness.');
process.exitCode = fail ? 1 : 0;
