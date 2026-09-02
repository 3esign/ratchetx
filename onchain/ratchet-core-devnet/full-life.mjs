// The whole shot life on devnet, one wallet, no server, against the devnet
// faucet flavour of the core (separate program id, same rules). Proves every
// path a shot can take on a live cluster:
//   faucet → reload → seal A + seal B → checkpoint (warm the clock)
//   → wait for expiry → capture the FIRST Pyth print past expiry → settle A
//   → reveal A (HIT/MISS, XP, credits)  |  B is left alone → deadline → void B
//   → close both (rent back to the player)
//   node full-life.mjs --rpc <url> --keypair <devnet id.json> [--minutes 5]
import fs from 'node:fs';
import { Connection, Keypair, Transaction, ComputeBudgetProgram } from '@solana/web3.js';
import * as C from './core.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true] : []).filter(Boolean));
const rpc = args.rpc || 'https://api.devnet.solana.com';
if (!args.keypair) { console.error('need --keypair'); process.exit(2); }
const minutes = Number(args.minutes) || 5;
if (!C.HORIZONS.some(([m]) => m === minutes)) { console.error(`--minutes must be one of ${C.HORIZONS.map(h => h[0]).join(', ')}`); process.exit(2); }
const w = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(args.keypair, 'utf8'))));
const conn = new Connection(rpc, { commitment: 'confirmed', httpAgent: false });
const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const nowS = () => Math.floor(Date.now() / 1000);
let pass = 0, fail = 0;
const ok = m => { pass++; log('✓ ' + m); };
const bad = m => { fail++; log('✗ ' + m); };
const err = e => { const m = String(e.message || e).match(/Error Code: (\w+)/); return m ? m[1] : String(e.message || e).split('\n')[0].slice(0, 160); };
const px = e12 => (Number(e12) / 1e12).toFixed(2);

async function send(ixs, label, tries = 2) {
  for (let t = 1; ; t++) {
    try {
      const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }), ...ixs);
      tx.feePayer = w.publicKey;
      const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
      tx.recentBlockhash = blockhash; tx.sign(w);
      const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
      await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
      return sig;
    } catch (e) {
      // a program refusal is final; only network/blockhash trouble is retried
      if (/Error Code:|custom program error/.test(String(e.message || e)) || t >= tries) throw e;
      log(`  ${label}: ${err(e)} — retrying`); await sleep(1500);
    }
  }
}
const randSalt = () => [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
const readShot = async (nonce) => { const a = await conn.getAccountInfo(C.shotPda(w.publicKey, nonce)); return a ? C.parseShot(a.data) : null; };
const readPush = async () => C.parsePriceUpdate((await conn.getAccountInfo(C.pushAccount(0))).data);

log(`full-life · ${rpc}\nprogram ${C.PROGRAM_ID.toBase58()}\nwallet  ${w.publicKey.toBase58()}\nmint    ${C.RCX_MINT.toBase58()} (devnet faucet)\nhorizon ${minutes} min · settle window ${C.SETTLE_DEADLINE_SECS} s\n`);

// 0. mint exists?
try { const mi = await conn.getAccountInfo(C.DEVNET_MINT_PDA); if (!mi) { await send([C.devnetInitMintIx({ payer: w.publicKey })], 'init_mint'); ok('devnet mint created'); } else ok('devnet mint already exists'); }
catch (e) { bad('init_mint failed: ' + err(e)); process.exit(1); }

// 1. faucet 200 tokens (6 decimals) → reload → 200 credits (two stakes of 100)
let creditsBefore = 0;
try {
  await send([C.devnetFaucetIx({ recipient: w.publicKey, amount: 200_000_000 })], 'faucet');
  const seats = await C.payableSeats(conn).catch(() => []);
  await send([C.reloadIx({ player: w.publicKey, amount: 200_000_000, seats })], 'reload');
  const led = await C.readLedger(conn, w.publicKey);
  creditsBefore = Number(led.credits);
  ok(`faucet + reload · credits now ${led.credits} (200 tokens → 200 credits) · burned so far ${led.burned}`);
} catch (e) { bad('faucet/reload failed: ' + err(e)); }

// 2. seal two shots (SOL up): A settles, B is abandoned to the deadline.
// The program refuses a seal on a print older than max_seal_age (45 s for
// 5 min), so wait for a fresh devnet print first — InvalidSealPrice otherwise.
{
  const until = nowS() + 150; let age = Infinity;
  while (nowS() < until) { try { const p = await readPush(); age = nowS() - Number(p.publishTime); if (age <= 25) break; } catch {} await sleep(2000); }
  log(age <= 25 ? `  fresh SOL print (${age}s old) — sealing` : `  ⚠ devnet SOL print is ${age}s old; sealing anyway (the program may refuse: InvalidSealPrice)`);
}
const base = Date.now() % 1e9;
const A = { nonce: base, salt: randSalt() }, B = { nonce: base + 1, salt: randSalt() };
let expiry = 0, sealedA = false, sealedB = false;
for (const [name, s] of [['A', A], ['B', B]]) {
  try {
    const commit = C.commitHash({ wallet: w.publicKey, nonce: s.nonce, side: 'YES', pBps: 0, salt: s.salt });
    await send([C.sealIx({ player: w.publicKey, nonce: s.nonce, commit, feedIndex: 0, minutes, stake: 100 })], 'seal ' + name);
    const shot = await readShot(s.nonce);
    if (name === 'A') { expiry = Number(shot.expiryTs); sealedA = true; } else sealedB = true;
    ok(`seal ${name} · SOL up ${minutes} min · entry ${px(shot.entryE12)} · stake 100 · expires ${new Date(Number(shot.expiryTs) * 1000).toISOString().slice(11, 19)} UTC`);
  } catch (e) { bad(`seal ${name} failed: ` + err(e)); }
}
try { const led = await C.readLedger(conn, w.publicKey); if (Number(led.credits) === creditsBefore - 100 * (sealedA + sealedB)) ok(`stakes escrowed · credits ${led.credits} · open ${led.open}`); else bad(`credits ${led.credits} do not reflect the stakes (expected ${creditsBefore - 100 * (sealedA + sealedB)})`); } catch (e) { bad('ledger read: ' + err(e)); }

// 3. warm the clock now, so its latest observation is before expiry
if (sealedA) {
  try { await send([C.checkpointIx({ cranker: w.publicKey, feedIndex: 0 })], 'warm checkpoint'); const cl = C.parseClock((await conn.getAccountInfo(C.clockPda(0))).data); ok(`clock warmed · ${cl.observations.length} observation(s) · latest publish ${cl.latestPublishTime} (< expiry ${expiry})`); }
  catch (e) { bad('warm checkpoint failed: ' + err(e)); }

  // 4. wait for expiry, then capture the first Pyth print at/after it
  const waitS = Math.max(0, expiry - nowS());
  log(`  waiting ${waitS}s for expiry …`);
  await sleep(waitS * 1000 + 1500);
  let captured = null;
  const giveUp = expiry + C.SETTLE_DEADLINE_SECS - 12;
  while (nowS() < giveUp) {
    let p; try { p = await readPush(); } catch (e) { await sleep(2000); continue; }
    if (Number(p.publishTime) >= expiry) {
      try {
        await send([C.checkpointIx({ cranker: w.publicKey, feedIndex: 0 })], 'crossing checkpoint');
        const cl = C.parseClock((await conn.getAccountInfo(C.clockPda(0))).data);
        captured = C.crossing(cl, expiry);
        if (captured) { ok(`crossing captured · publish ${captured.publishTime} (expiry ${expiry}, +${Number(captured.publishTime) - expiry}s) · price ${px(captured.priceE12)} · ${nowS() - expiry}s after expiry`); break; }
        log(`  checkpoint landed but no crossing yet (clock latest ${cl.latestPublishTime}) — polling on`);
      } catch (e) { log(`  checkpoint: ${err(e)} — polling on`); }
    }
    await sleep(2000);
  }
  if (!captured) bad(`no Pyth print landed within ${C.SETTLE_DEADLINE_SECS - 12}s of expiry — the devnet feed was quiet; A will void at the deadline like B (rerun for the settle path)`);

  // 5. settle A, reveal A
  if (captured) {
    try {
      await send([C.settleIx({ cranker: w.publicKey, shot: C.shotPda(w.publicKey, A.nonce), player: w.publicKey, feedIndex: 0 })], 'settle A');
      const shot = await readShot(A.nonce);
      ok(`settle A · state ${C.STATE_NAME[shot.state]} · entry ${px(shot.entryE12)} → exit ${px(shot.exitE12)} · exit publish ${shot.exitPublishTime}`);
      if (shot.state === C.STATE.SETTLED) {
        await send([C.revealIx({ revealer: w.publicKey, shot: C.shotPda(w.publicKey, A.nonce), player: w.publicKey, side: 'YES', pBps: 0, salt: A.salt })], 'reveal A');
        const s2 = await readShot(A.nonce);
        const led = await C.readLedger(conn, w.publicKey);
        ok(`reveal A · ${s2.hit ? 'HIT (+170 credits)' : 'MISS (stake lost)'} · xp awarded ${s2.xpAwarded} · ledger credits ${led.credits} · xp ${led.xp} · streak ${led.streak} · hits ${led.hits}/${led.shots}`);
      } else if (shot.state === C.STATE.VOIDED) ok('A settled to VOID (exit == entry) · stake refunded — a valid outcome');
    } catch (e) { bad('settle/reveal A: ' + err(e)); }
  }
}

// 6. B: nobody settles it → after the strict window it can only void
if (sealedB) {
  const deadline = expiry + C.SETTLE_DEADLINE_SECS + 3;
  const waitS = Math.max(0, deadline - nowS());
  log(`  waiting ${waitS}s for B's settle window to close …`);
  await sleep(waitS * 1000);
  try {
    await send([C.settleIx({ cranker: w.publicKey, shot: C.shotPda(w.publicKey, B.nonce), player: w.publicKey, feedIndex: 0 })], 'late settle B');
    bad('settle B was ACCEPTED after the deadline — the window is not enforced');
  } catch (e) { if (/SettlementDeadlinePassed/.test(err(e))) ok('late settle B refused: SettlementDeadlinePassed — the 120 s window holds on-chain'); else bad('late settle B refused for the wrong reason: ' + err(e)); }
  try {
    const before = await C.readLedger(conn, w.publicKey);
    await send([C.voidShotIx({ cranker: w.publicKey, shot: C.shotPda(w.publicKey, B.nonce), player: w.publicKey })], 'void B');
    const shot = await readShot(B.nonce); const led = await C.readLedger(conn, w.publicKey);
    if (shot.state === C.STATE.VOIDED && Number(led.credits) === Number(before.credits) + 100) ok(`void B · reason ${C.VOID_REASON[shot.voidReason]} · stake refunded · credits ${led.credits} · voids ${led.voids}`);
    else bad(`void B · state ${C.STATE_NAME[shot.state]} · credits ${before.credits} → ${led.credits} (expected +100)`);
  } catch (e) { bad('void B: ' + err(e)); }
  // A too, if the feed never printed
  if (sealedA) { const a = await readShot(A.nonce); if (a && a.state === C.STATE.SEALED) { try { await send([C.voidShotIx({ cranker: w.publicKey, shot: C.shotPda(w.publicKey, A.nonce), player: w.publicKey })], 'void A'); log('  A voided at the deadline (feed printed nothing in the window)'); } catch (e) { bad('void A: ' + err(e)); } } }
}

// 7. close: rent goes back to the player, from anyone's signature
for (const [name, s] of [['A', A], ['B', B]]) {
  const shot = await readShot(s.nonce); if (!shot) continue;
  if (![C.STATE.REVEALED, C.STATE.VOIDED, C.STATE.FORFEITED].includes(shot.state)) { log(`  ${name} still ${C.STATE_NAME[shot.state]} — not closable`); continue; }
  try {
    const lamports = (await conn.getAccountInfo(C.shotPda(w.publicKey, s.nonce))).lamports;
    await send([C.closeShotIx({ cranker: w.publicKey, shot: C.shotPda(w.publicKey, s.nonce), player: w.publicKey })], 'close ' + name);
    if (!(await readShot(s.nonce))) ok(`close ${name} · account gone · ${(lamports / 1e9).toFixed(4)} SOL rent back to the player`); else bad(`close ${name} ran but the account still exists`);
  } catch (e) { bad(`close ${name}: ` + err(e)); }
}

const led = await C.readLedger(conn, w.publicKey).catch(() => null);
log(`\n${pass} passed · ${fail} failed` + (led ? ` · ledger: credits ${led.credits} · xp ${led.xp} · shots ${led.shots} · hits ${led.hits} · voids ${led.voids} · open ${led.open}` : ''));
log(fail === 0 ? 'Every path a shot can take ran on a live cluster: seal, checkpoint, settle, reveal, deadline refusal, void, close — one wallet, no server.' : 'Some step did not land — the report above says which; rerunning is safe.');
process.exitCode = fail ? 1 : 0;
