// A devnet PLAYER, not a runner: keeps shots flowing so an open runner on some
// other machine has work. Every cycle it tops up credits from the devnet faucet
// if needed, seals one 5-minute SOL shot, and reveals any of its own shots that
// a runner has settled (only the salt holder can reveal). It never settles,
// voids or forfeits — that is the runner's job, and the point of the drill is
// that a stranger's runner does it.
//   node shooter.mjs --rpc <url> --keypair <devnet id.json> [--every 6] [--hours 24]
import fs from 'node:fs';
import { Connection, Keypair, Transaction, ComputeBudgetProgram } from '@solana/web3.js';
import nacl from 'tweetnacl';
import * as C from './core.mjs';
import { deriveSalt } from './salt.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true] : []).filter(Boolean));
const rpc = args.rpc || 'https://api.devnet.solana.com';
if (!args.keypair) { console.error('need --keypair'); process.exit(2); }
const everyMin = Math.max(6, Number(args.every) || 6);
const hours = Number(args.hours) || 24;
const w = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(args.keypair, 'utf8'))));
const conn = new Connection(rpc, 'confirmed');
const log = (...a) => console.log(new Date().toISOString(), ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const nowS = () => Math.floor(Date.now() / 1000);
const err = e => { const m = String(e.message || e).match(/Error Code: (\w+)/); return m ? m[1] : String(e.message || e).split('\n')[0].slice(0, 140); };
const SALTS = 'devnet_shooter_salts.json';   // LEGACY: salts sealed before derivation; read, never written
const salts = fs.existsSync(SALTS) ? JSON.parse(fs.readFileSync(SALTS, 'utf8')) : {};
const saveSalts = () => fs.writeFileSync(SALTS, JSON.stringify(salts));

async function send(ixs) {
  const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }), ...ixs);
  tx.feePayer = w.publicKey;
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash; tx.sign(w);
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
  return sig;
}
// The salt is derived from this wallet's own signature over a canonical,
// domain-separated message, so it is reproducible on any machine from the
// wallet alone. Nothing to store, nothing to lose: the nonce is public on
// chain, so a reveal survives losing this box entirely.
const signMessage = async bytes => nacl.sign.detached(bytes, w.secretKey);
const saltFor = nonce => deriveSalt({ signMessage, programId: C.PROGRAM_ID.toBase58(), wallet: w.publicKey.toBase58(), nonce });
const randSalt = () => [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');

async function revealSettled() {
  const shots = (await C.readShots(conn)).filter(s => s.player.equals(w.publicKey) && s.state === C.STATE.SETTLED);
  for (const s of shots) {
    // legacy file first (shots sealed before derivation), then derive
    const salt = salts[String(s.nonce)] || await saltFor(s.nonce);
    try { await send([C.revealIx({ revealer: w.publicKey, shot: s.pubkey, player: w.publicKey, side: 'YES', pBps: 0, salt })]); const r = C.parseShot((await conn.getAccountInfo(s.pubkey)).data); log(`revealed ${s.pubkey.toBase58().slice(0, 8)}… ${r.hit ? 'HIT' : 'MISS'} · xp +${r.xpAwarded}`); delete salts[String(s.nonce)]; saveSalts(); }
    catch (e) { log('reveal failed', err(e)); }
  }
}

async function topUp() {
  const led = await C.readLedger(conn, w.publicKey);
  if (led && Number(led.credits) >= 100) return led;
  if (!(await conn.getAccountInfo(C.DEVNET_MINT_PDA))) await send([C.devnetInitMintIx({ payer: w.publicKey })]);
  await send([C.devnetFaucetIx({ recipient: w.publicKey, amount: 1_000_000_000 })]);
  const seats = await C.payableSeats(conn).catch(() => []);
  await send([C.reloadIx({ player: w.publicKey, amount: 1_000_000_000, seats })]);
  const l2 = await C.readLedger(conn, w.publicKey); log(`reloaded · credits ${l2.credits}`); return l2;
}

async function sealOne() {
  // wait for a fresh print (the program refuses stale entries: InvalidSealPrice)
  for (let i = 0; i < 60; i++) { const p = C.parsePriceUpdate((await conn.getAccountInfo(C.pushAccount(0))).data); if (nowS() - Number(p.publishTime) <= 25) break; await sleep(2000); }
  const nonce = Date.now() % 1e9, salt = await saltFor(nonce);
  const commit = C.commitHash({ wallet: w.publicKey, nonce, side: 'YES', pBps: 0, salt });
  await send([C.sealIx({ player: w.publicKey, nonce, commit, feedIndex: 0, minutes: 5, stake: 100 })]);
  const s = C.parseShot((await conn.getAccountInfo(C.shotPda(w.publicKey, nonce))).data);
  log(`sealed SOL up 5 min · entry ${(Number(s.entryE12) / 1e12).toFixed(2)} · expires ${new Date(Number(s.expiryTs) * 1000).toISOString().slice(11, 19)}Z · shot ${C.shotPda(w.publicKey, nonce).toBase58()}`);
}

log(`shooter ${w.publicKey.toBase58()} · ${rpc} · program ${C.PROGRAM_ID.toBase58()} · one shot every ${everyMin} min for ${hours} h`);
log('this process never settles anything — watch the runner on the other machine do it');
const until = Date.now() + hours * 3600e3;
while (Date.now() < until) {
  try {
    await revealSettled();
    const led = await topUp();
    if (Number(led.open) >= 2) log(`ledger open=${led.open} (chambers full at rank 0) — skipping this seal; is the runner settling?`);
    else await sealOne();
    const l = await C.readLedger(conn, w.publicKey);
    log(`ledger · credits ${l.credits} · xp ${l.xp} · shots ${l.shots} · hits ${l.hits} · voids ${l.voids} · forfeits ${l.forfeits} · open ${l.open}`);
  } catch (e) { log('cycle error', err(e)); }
  await sleep(everyMin * 60e3);
}
await revealSettled();
log('done');
