// One real lifecycle against the official sponsored SOL Pyth account. It reads
// no Ratchet API, writes a durable completion receipt, and closes the Shot.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  RECEIPT_DISPOSITION,
  STATE,
  closeShotIx,
  commitHash,
  completionReceiptPda,
  observeIx,
  openShotIx,
  parseCompletionReceipt,
  parseShot,
  pushAccount,
  revealIx,
  shotPda,
  timeoutIx,
  writeCompletionReceiptIx,
} from './client-v2.mjs';

const RPC = process.env.RATCHET_DEVNET_RPC || 'https://api.devnet.solana.com';
const KEYPAIR = process.env.RATCHET_DEVNET_KEYPAIR || join(homedir(), '.config', 'solana', 'id.json');
const connection = new Connection(RPC, 'confirmed');
const player = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(KEYPAIR, 'utf8'))));
const nonce = BigInt(Date.now());
const side = 1;
const pBps = 5_000;
const salt = randomBytes(32);
const commit = commitHash({ player: player.publicKey, nonce, side, pBps, salt });
const [shot] = shotPda(player.publicKey, nonce);
const [receipt] = completionReceiptPda(shot);
const priceAccount = pushAccount(0);

async function send(ix, commitment = 'confirmed') {
  const tx = new Transaction().add(ix);
  tx.feePayer = player.publicKey;
  const latest = await connection.getLatestBlockhash(commitment);
  tx.recentBlockhash = latest.blockhash;
  return sendAndConfirmTransaction(connection, tx, [player], {
    commitment,
    preflightCommitment: commitment,
    maxRetries: 8,
  });
}
const readShot = async commitment => {
  const account = await connection.getAccountInfo(shot, commitment);
  return account ? parseShot(account.data) : null;
};
const readReceipt = async commitment => {
  const account = await connection.getAccountInfo(receipt, commitment);
  return account ? { owner: account.owner, value: parseCompletionReceipt(account.data) } : null;
};
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const chainNow = async () => {
  const slot = await connection.getSlot('processed');
  const blockTime = await connection.getBlockTime(slot);
  if (!Number.isSafeInteger(blockTime)) throw new Error('devnet block time unavailable');
  return BigInt(blockTime);
};
const readPriceTimes = async commitment => {
  const account = await connection.getAccountInfo(priceAccount, commitment);
  if (!account || account.data.length !== 134) throw new Error('official SOL PriceUpdateV2 missing');
  return {
    publishTime: account.data.readBigInt64LE(93),
    prevPublishTime: account.data.readBigInt64LE(101),
  };
};
async function waitForFreshEntry() {
  const started = Date.now();
  let lastNotice = 0;
  while (Date.now() - started < 10 * 60_000) {
    const price = await readPriceTimes('confirmed');
    const age = BigInt(Math.floor(Date.now() / 1000)) - price.publishTime;
    if (age >= -5n && age <= 15n) return price;
    if (Date.now() - lastNotice >= 30_000) {
      console.error(`waiting for fresh official SOL print; current age=${age}s`);
      lastNotice = Date.now();
    }
    await pause(1_000);
  }
  throw new Error('official SOL PriceUpdateV2 stayed stale for 10 minutes');
}

const signatures = {};
try {
  await waitForFreshEntry();
  signatures.open = await send(openShotIx({
    player: player.publicKey, nonce, commit, feedIndex: 0,
  }));
  let state = await readShot('processed');
  if (!state) throw new Error('Shot missing after confirmed open');

  let lastNotice = 0;
  while (state.state === STATE.OPEN && await chainNow() < state.deadlineTs) {
    const price = await readPriceTimes('processed');
    if (price.publishTime > state.entry.publishTime) {
      signatures.observe = await send(observeIx({
        actor: player.publicKey, shot, feedIndex: 0,
      }));
      state = await readShot('processed');
      continue;
    }
    if (Date.now() - lastNotice >= 30_000) {
      console.error(`shot open; waiting for direct successor after ${state.entry.publishTime}`);
      lastNotice = Date.now();
    }
    await pause(1_000);
  }
  if (state.state === STATE.OPEN) {
    for (;;) {
      const now = await chainNow();
      if (now < state.deadlineTs) {
        await pause(1_000);
        continue;
      }
      try {
        signatures.timeout = await send(timeoutIx({ actor: player.publicKey, shot }));
        state = await readShot('processed');
        break;
      } catch (error) {
        if (!String(error).includes('0x1782')) throw error;
        await pause(1_000);
      }
    }
  }
  if (!state || state.state === STATE.OPEN) throw new Error('Shot stayed OPEN after deadline');

  signatures.receipt = await send(writeCompletionReceiptIx({
    payer: player.publicKey, shot,
  }), 'confirmed');
  const receiptState = await readReceipt('confirmed');
  if (!receiptState) throw new Error('CompletionReceipt missing after confirmed write');
  if (!receiptState.owner.equals(openShotIx({ player: player.publicKey, nonce, commit, feedIndex: 0 }).programId))
    throw new Error('CompletionReceipt owner mismatch');
  if (!receiptState.value.subject.equals(shot)) throw new Error('CompletionReceipt subject mismatch');
  const payableObservation = [
    STATE.CAPTURED,
    STATE.VOID_EQUAL,
    STATE.VOID_SCALE_CHANGE,
  ].includes(state.state);
  if (payableObservation) {
    if (receiptState.value.disposition !== RECEIPT_DISPOSITION.PAYABLE)
      throw new Error('direct-successor receipt must be Payable');
    if (!receiptState.value.worker.equals(player.publicKey))
      throw new Error('observed receipt worker must be the observer');
  } else {
    if (receiptState.value.disposition !== RECEIPT_DISPOSITION.NONPAYABLE)
      throw new Error('failed or timed-out work receipt must be Nonpayable');
    if (!receiptState.value.worker.equals(PublicKey.default))
      throw new Error('nonpayable receipt worker must be default');
  }

  if (state.state === STATE.CAPTURED) {
    signatures.reveal = await send(revealIx({
      player: player.publicKey, shot, side, pBps, salt,
    }));
    state = await readShot('processed');
    if (state?.state !== STATE.REVEALED) throw new Error('reveal did not reach REVEALED');
  }

  signatures.close = await send(closeShotIx({
    actor: player.publicKey, shot, player: player.publicKey,
  }), 'confirmed');
  if (await readShot('confirmed')) throw new Error('Shot PDA still exists after close');
  if (!(await readReceipt('confirmed'))) throw new Error('durable CompletionReceipt was removed');

  console.log(JSON.stringify({
    ok: true,
    cluster: 'devnet',
    programId: receiptState.owner.toBase58(),
    player: player.publicKey.toBase58(),
    shot: shot.toBase58(),
    receipt: receipt.toBase58(),
    receiptDisposition: receiptState.value.disposition,
    receiptWorker: receiptState.value.worker.toBase58(),
    resultHash: receiptState.value.resultHash,
    terminalState: state.stateName,
    entryPublishTime: state.entry.publishTime.toString(),
    exitPublishTime: state.exit.publishTime.toString(),
    signatures,
    shotClosed: true,
    receiptDurable: true,
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    cluster: 'devnet',
    player: player.publicKey.toBase58(),
    shot: shot.toBase58(),
    receipt: receipt.toBase58(),
    signatures,
    error: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exitCode = 1;
}
