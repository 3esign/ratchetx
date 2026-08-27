#!/usr/bin/env node
// Drive every Ratchet Seal v2 instruction through mainnet at least once.
//
// The freeze checklist asks for one thing this file provides and nothing else
// can: a transaction signature for seal, checkpoint, settle, reveal, void_shot
// and close_shot, on mainnet-beta, before the upgrade authority is destroyed on
// 2026-09-08. An instruction never exercised before that date is a bug that can
// never be fixed.
//
//   node tools/mainnet-exercise.mjs --keypair <player.json> [--dry] [--rpc URL]
//
// --dry simulates every transaction and sends none. Run it first; it costs
// nothing and catches every account-layout mistake that would otherwise be paid
// for in real SOL.
//
// The keypair is a THROWAWAY PLAYER wallet, never the upgrade authority. The
// script refuses to run if it is handed the authority key.

import fs from 'node:fs';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import {
  Connection, Keypair, PublicKey, Transaction, TransactionInstruction,
  SystemProgram, sendAndConfirmTransaction,
} from '@solana/web3.js';

const PROGRAM_ID = new PublicKey('23k3r8AJRdX64iipwNMqPdN2vSgNmw9stGs7cJqmZEEX');
const AUTHORITY  = 'AAaU3oyrcmy6GDGxcSUEgg4uUag4pF9jwL2rThB49gks';   // never sign with this
const SETTLE_DEADLINE_SECS = 900;

// The price account is READ FROM lib/onchain_px.js, not derived here.
//
// Deriving it looked cleaner and was wrong. `[u16le(0), feed_id]` under the
// push oracle `pythWSnsw…` gives 7UVimffx…, which mainnet simulation rejects
// with BadPriceAccount at lib.rs:352 — the owner check. The deployed program
// is pinned to Pyth's UPGRADED receiver `rec2HHDD…`, and its sponsored SOL/USD
// account is 7AviUf9n…, the one the site has been reading and checkpointing all
// along. Two addresses, both real, both SOL/USD; only one the program accepts.
// So this file uses the site's map — the same account the program already
// validated on 2026-08-23 — rather than a second opinion about how to find it.
const require_ = createRequire(import.meta.url);
const { ACCOUNTS, PYTH_OWNERS } = require_('../lib/onchain_px.js');

// Anchor discriminators: sha256("global:<name>")[..8].
// The seal value is cross-checked against api/game.js, which has already
// produced accepted mainnet transactions — so the derivation is not a guess.
const DISC = {
  seal:       Buffer.from('66caaba31b9869f2', 'hex'),
  checkpoint: Buffer.from('d5c813ccf08fb8fc', 'hex'),
  settle:     Buffer.from('af2ab957908366d4', 'hex'),
  reveal:     Buffer.from('09233bbea7f94c73', 'hex'),
  void_shot:  Buffer.from('4bcd98fae536c95b', 'hex'),
  close_shot: Buffer.from('d382ac298155850f', 'hex'),
};

const args = process.argv.slice(2);
const arg  = (name, dflt = null) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const DRY  = args.includes('--dry');
const RPC  = arg('--rpc', 'https://api.mainnet-beta.solana.com');
const KP   = arg('--keypair');
const STATE_PATH = arg('--state', 'RATCHET_EXERCISE_STATE.json');
const SYMBOL = String(arg('--feed', 'SOL')).toUpperCase();

const log = [];
const say = (...m) => { const line = m.join(' '); console.log(line); log.push(line); };
const die = (m) => { say('STOP: ' + m); flush(); process.exit(1); };
const flush = () => { try { fs.writeFileSync('RATCHET_EXERCISE_REPORT.txt', log.join('\n') + '\n'); } catch {} };

const state = fs.existsSync(STATE_PATH) ? JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) : { sigs: {}, shots: {} };
// A dry run must leave no trace. It used to persist the two shots it planned,
// expiry timestamps and all, so the live run minutes later would try to seal a
// shot whose expiry had already passed and be refused with ExpiryInPast.
const saveState = () => { if (DRY) return; fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2)); };

const anchorString = (v) => {
  const b = Buffer.from(String(v), 'utf8');
  const len = Buffer.alloc(4); len.writeUInt32LE(b.length, 0);
  return Buffer.concat([len, b]);
};
const i64 = (v) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(v), 0); return b; };
const u64 = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v), 0); return b; };
const nowSec = () => Math.floor(Date.now() / 1000);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---- Shot account decode (layout mirrors `pub struct Shot`, 8-byte anchor discriminator first)
const SHOT = { expiry: 153, settled: 161, entry: 169, exit: 177, kind: 193, side: 194, hit: 195, state: 196, strict: 197, voidReason: 198 };
const STATE_NAME = { 1: 'Sealed', 2: 'Settled', 3: 'Revealed', 4: 'Voided' };
function decodeShot(data) {
  if (!data || data.length < 199) return null;
  return {
    expiry: Number(data.readBigInt64LE(SHOT.expiry)),
    settled: Number(data.readBigInt64LE(SHOT.settled)),
    entry_e12: Number(data.readBigInt64LE(SHOT.entry)),
    exit_e12: Number(data.readBigInt64LE(SHOT.exit)),
    kind: data[SHOT.kind], side: data[SHOT.side], hit: data[SHOT.hit],
    state: data[SHOT.state], stateName: STATE_NAME[data[SHOT.state]] || '?',
    strict: data[SHOT.strict], voidReason: data[SHOT.voidReason],
  };
}

async function main() {
  if (!KP) die('pass --keypair <path-to-a-throwaway-player-keypair.json>');
  const secret = JSON.parse(fs.readFileSync(KP, 'utf8'));
  const player = Keypair.fromSecretKey(Uint8Array.from(secret));
  if (player.publicKey.toBase58() === AUTHORITY)
    die('that is the program upgrade authority. It signs once, on 2026-09-08, by hand. Use a throwaway wallet here.');

  const conn = new Connection(RPC, 'confirmed');
  say('=== RATCHET Seal v2 — mainnet exercise ===');
  say(DRY ? 'MODE: dry run (simulate only, nothing is sent)' : 'MODE: LIVE — transactions will be signed and sent');
  say('rpc      ', RPC);
  say('program  ', PROGRAM_ID.toBase58());
  say('player   ', player.publicKey.toBase58());

  const bal = await conn.getBalance(player.publicKey);
  say('balance  ', (bal / 1e9).toFixed(6), 'SOL');
  if (bal < 0.01e9) {
    say('');
    say('NOT ENOUGH SOL YET. Send about 0.02 SOL to:');
    say('    ' + player.publicKey.toBase58());
    say('then run this again.');
    say('');
    say('The dry run needs it too, and that is not a quirk of this script: Solana simulates a');
    say('transaction against real chain state, and a fee payer with no lamports is an account');
    say('that does not exist — which is the "AccountNotFound" a zero balance produces.');
    say('Roughly 0.0041 SOL is shot rent that comes back on close, about 0.0013 stays behind');
    say('for the PlayerRecord, and the fees are a rounding error.');
    flush();
    return;
  }

  const mapped = ACCOUNTS[SYMBOL];
  if (!mapped) die('lib/onchain_px.js has no account mapped for ' + SYMBOL);
  const FEED_ID_HEX = mapped[1];
  const feedId = Buffer.from(FEED_ID_HEX, 'hex');
  const priceAccount = new PublicKey(arg('--price-account', mapped[0]));
  const [feedClock] = PublicKey.findProgramAddressSync([Buffer.from('clock'), feedId], PROGRAM_ID);
  const [record]    = PublicKey.findProgramAddressSync([Buffer.from('record'), player.publicKey.toBuffer()], PROGRAM_ID);
  say('feed     ', SYMBOL, FEED_ID_HEX);
  say('feed acct', priceAccount.toBase58());
  say('feedClock', feedClock.toBase58());

  const px = await conn.getAccountInfo(priceAccount);
  if (!px) die('the sponsored Pyth push account for ' + SYMBOL + ' does not exist');
  if (!PYTH_OWNERS.has(px.owner.toBase58()))
    die('price account owner ' + px.owner.toBase58() + ' is not a known Pyth program');
  const pubTime0 = readPublishTime(px.data, feedId);
  if (!pubTime0) die('could not find the requested feed id inside that price account');
  say('pyth ok  ', 'owner ' + px.owner.toBase58() + ', publish_time ' + pubTime0
      + ' (' + (nowSec() - pubTime0) + 's old)');
  if (nowSec() - pubTime0 > 55) say('  NOTE: seal rejects a price older than 60s. If this keeps growing, wait for a tick.');

  // ---- instruction builders -------------------------------------------------
  const ix = {
    checkpoint: () => new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: feedClock, isSigner: false, isWritable: true },
        { pubkey: player.publicKey, isSigner: true, isWritable: true },
        { pubkey: priceAccount, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: Buffer.concat([DISC.checkpoint, feedId]),
    }),
    seal: (shotPda, nonce, commit, shotId, expiry) => new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: shotPda, isSigner: false, isWritable: true },
        { pubkey: player.publicKey, isSigner: true, isWritable: true },
        { pubkey: priceAccount, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: Buffer.concat([DISC.seal, u64(nonce), commit, anchorString(shotId),
        anchorString(FEED_ID_HEX), i64(expiry), Buffer.from([0]), i64(0)]),
    }),
    settle: (shotPda) => new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: shotPda, isSigner: false, isWritable: true },
        { pubkey: feedClock, isSigner: false, isWritable: false },
        { pubkey: player.publicKey, isSigner: true, isWritable: false },
      ],
      data: DISC.settle,
    }),
    reveal: (shotPda, side, salt) => new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: shotPda, isSigner: false, isWritable: true },
        { pubkey: record, isSigner: false, isWritable: true },
        { pubkey: player.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: Buffer.concat([DISC.reveal, Buffer.from([side]), anchorString(salt)]),
    }),
    void_shot: (shotPda) => new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: shotPda, isSigner: false, isWritable: true },
        { pubkey: player.publicKey, isSigner: true, isWritable: false },
      ],
      data: DISC.void_shot,
    }),
    close_shot: (shotPda) => new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: shotPda, isSigner: false, isWritable: true },
        { pubkey: player.publicKey, isSigner: false, isWritable: true },
        { pubkey: player.publicKey, isSigner: true, isWritable: false },
      ],
      data: DISC.close_shot,
    }),
  };

  async function send(name, instruction) {
    if (state.sigs[name]) { say('  [' + name + '] already done:', state.sigs[name]); return state.sigs[name]; }
    const tx = new Transaction().add(instruction);
    tx.feePayer = player.publicKey;
    tx.recentBlockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;
    const sim = await conn.simulateTransaction(tx, [player]);
    if (sim.value.err) {
      say('  [' + name + '] SIMULATION FAILED', JSON.stringify(sim.value.err));
      for (const l of sim.value.logs || []) say('      ' + l);
      throw new Error(name + ' would fail');
    }
    say('  [' + name + '] simulation ok, ' + (sim.value.unitsConsumed || 0) + ' CU');
    if (DRY) return null;
    const sig = await sendAndConfirmTransaction(conn, tx, [player], { commitment: 'confirmed' });
    say('  [' + name + '] SENT ' + sig);
    state.sigs[name] = sig; saveState();
    return sig;
  }

  // ---- 1. checkpoint: give the clock a baseline before any shot exists -------
  say(''); say('[1/8] checkpoint — baseline observation');
  await send('checkpoint', ix.checkpoint());

  // ---- 2. seal two shots ----------------------------------------------------
  const stamp = Date.now().toString(36);
  const mk = (suffix, secondsAhead) => {
    const shotId = ('ex' + stamp + suffix).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 32);
    const salt = crypto.randomBytes(16).toString('hex');            // exactly 32 lowercase hex
    const nonceBuf = crypto.randomBytes(8);
    const nonce = nonceBuf.readBigUInt64LE(0);
    const commit = crypto.createHash('sha256')
      .update('RATCHET|v2|' + player.publicKey.toBase58() + '|' + shotId + '|YES|' + salt).digest();
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('shot'), player.publicKey.toBuffer(), nonceBuf], PROGRAM_ID);
    return { shotId, salt, nonce: nonce.toString(), commit: commit.toString('hex'), pda: pda.toBase58(), expiry: nowSec() + secondsAhead };
  };
  // Regenerate a planned shot whose expiry has gone stale — a leftover from an
  // earlier run, or a long pause between planning and sealing. Only ever for a
  // shot that was never actually sealed; a sealed shot is a fact on the chain
  // and is never rewritten here.
  const stale = (k, sigKey) => state.shots[k] && !state.sigs[sigKey] && state.shots[k].expiry <= nowSec() + 30;
  if (stale('A', 'seal'))   { say('  (replanning shot A — its expiry had passed)'); delete state.shots.A; }
  if (stale('B', 'seal_b')) { say('  (replanning shot B — its expiry had passed)'); delete state.shots.B; }
  if (!state.shots.A) { state.shots.A = mk('a', 300); saveState(); }   // settles
  if (!state.shots.B) { state.shots.B = mk('b',  60); saveState(); }   // voids on the deadline
  const A = state.shots.A, B = state.shots.B;
  say(''); say('[2/8] seal — two shots');
  say('  A ' + A.shotId + ' expiry ' + A.expiry + ' pda ' + A.pda + '  (settle path)');
  say('  B ' + B.shotId + ' expiry ' + B.expiry + ' pda ' + B.pda + '  (void path)');
  await send('seal', ix.seal(new PublicKey(A.pda), A.nonce, Buffer.from(A.commit, 'hex'), A.shotId, A.expiry));
  await send('seal_b', ix.seal(new PublicKey(B.pda), B.nonce, Buffer.from(B.commit, 'hex'), B.shotId, B.expiry));
  if (DRY) { say(''); say('dry run complete — every instruction up to this point simulates cleanly.'); say('The timed half (settle/reveal/void/close) needs live shots; run without --dry.'); flush(); return; }

  // ---- 3. wait past A's expiry, then checkpoint the crossing -----------------
  say(''); say('[3/8] waiting for shot A expiry (' + (A.expiry - nowSec()) + 's) then checkpointing the crossing');
  while (nowSec() <= A.expiry) await sleep(5000);
  for (let attempt = 1; attempt <= 30; attempt++) {
    const fresh = await conn.getAccountInfo(priceAccount);
    const pubTime = readPublishTime(fresh.data, feedId);
    if (pubTime >= A.expiry) { say('  pyth publish_time ' + pubTime + ' >= expiry ' + A.expiry); break; }
    await sleep(4000);
  }
  delete state.sigs.checkpoint2; // always crank a fresh one
  await send('checkpoint2', ix.checkpoint());

  // ---- 4. settle ------------------------------------------------------------
  say(''); say('[4/8] settle');
  await send('settle', ix.settle(new PublicKey(A.pda)));
  const afterSettle = decodeShot((await conn.getAccountInfo(new PublicKey(A.pda)))?.data);
  say('  shot A is now ' + afterSettle.stateName + (afterSettle.voidReason ? ' (void reason ' + afterSettle.voidReason + ')' : ''));
  say('  entry_e12 ' + afterSettle.entry_e12 + '  exit_e12 ' + afterSettle.exit_e12 + '  strict ' + afterSettle.strict);

  // ---- 5. reveal ------------------------------------------------------------
  if (afterSettle.state === 2) {
    say(''); say('[5/8] reveal');
    await send('reveal', ix.reveal(new PublicKey(A.pda), 1, A.salt));
    const afterReveal = decodeShot((await conn.getAccountInfo(new PublicKey(A.pda)))?.data);
    say('  revealed YES, hit=' + afterReveal.hit + ', state ' + afterReveal.stateName);
  } else {
    say(''); say('[5/8] reveal SKIPPED — settle voided this shot on price equality.');
    say('  Rerun to exercise reveal: delete ' + STATE_PATH + ' and start again.');
  }

  // ---- 6. close A -----------------------------------------------------------
  say(''); say('[6/8] close_shot (A)');
  await send('close_shot', ix.close_shot(new PublicKey(A.pda)));

  // ---- 7. void B ------------------------------------------------------------
  const voidAt = B.expiry + SETTLE_DEADLINE_SECS;
  say(''); say('[7/8] void_shot — waiting until ' + voidAt + ' (' + Math.max(0, voidAt - nowSec()) + 's)');
  while (nowSec() < voidAt) await sleep(10000);
  await send('void_shot', ix.void_shot(new PublicKey(B.pda)));

  // ---- 8. close B -----------------------------------------------------------
  say(''); say('[8/8] close_shot (B) — proves a voided shot is closable, not stranded');
  await send('close_shot_b', ix.close_shot(new PublicKey(B.pda)));

  say(''); say('=== signatures for docs/FREEZE.md ===');
  for (const [k, v] of Object.entries(state.sigs)) say('  ' + k.padEnd(14) + v);
  const end = await conn.getBalance(player.publicKey);
  say(''); say('balance after: ' + (end / 1e9).toFixed(6) + ' SOL (spent ' + ((bal - end) / 1e9).toFixed(6) + ')');
  flush();
}

function readPublishTime(data, feedId) {
  // PriceUpdateV2: 8 discriminator + write_authority(32) + verification_level + PriceFeedMessage.
  // VerificationLevel is `Partial { num_signatures: u8 }` (2 bytes) or `Full` (1 byte), so the
  // message begins at 41 or 42. Do not guess which: the message opens with feed_id, so the base
  // that matches the feed we asked for is the right one, provably.
  for (const base of [41, 42]) {
    if (base + 60 > data.length) continue;
    if (!data.subarray(base, base + 32).equals(feedId)) continue;
    return Number(data.readBigInt64LE(base + 32 + 8 + 8 + 4));
  }
  return 0;
}

main().catch(e => { say('FAILED: ' + (e && e.message ? e.message : String(e))); flush(); process.exit(1); });
