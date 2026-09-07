// Permissionlessly finish an already-open v2 Shot after its onchain deadline,
// materialize its durable receipt, and return Shot rent to the recorded player.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  PROGRAM_ID,
  STATE,
  closeShotIx,
  completionReceiptPda,
  parseCompletionReceipt,
  parseShot,
  timeoutIx,
  writeCompletionReceiptIx,
} from './client-v2.mjs';

const shot = new PublicKey(process.argv[2] || '8bBrKwMYLWLfycKhWZStwvQrVkwHJgFqfct4horoLxwx');
const rpc = process.env.RATCHET_DEVNET_RPC || 'https://api.devnet.solana.com';
const keypairPath = process.env.RATCHET_DEVNET_KEYPAIR || join(homedir(), '.config', 'solana', 'id.json');
const actor = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keypairPath, 'utf8'))));
const connection = new Connection(rpc, 'confirmed');
const [receipt] = completionReceiptPda(shot);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function send(ix) {
  const tx = new Transaction().add(ix);
  tx.feePayer = actor.publicKey;
  const latest = await connection.getLatestBlockhash('processed');
  tx.recentBlockhash = latest.blockhash;
  return sendAndConfirmTransaction(connection, tx, [actor], {
    commitment: 'confirmed', preflightCommitment: 'processed', maxRetries: 8,
  });
}
async function readShot() {
  const account = await connection.getAccountInfo(shot, 'confirmed');
  if (!account) return null;
  if (!account.owner.equals(PROGRAM_ID)) throw new Error('Shot owner mismatch');
  return parseShot(account.data);
}
async function chainNow() {
  const slot = await connection.getSlot('processed');
  const time = await connection.getBlockTime(slot);
  if (!Number.isSafeInteger(time)) throw new Error('devnet block time unavailable');
  return BigInt(time);
}

const signatures = {};
let state = await readShot();
if (!state) throw new Error('Shot is already closed or missing');
if (state.state === STATE.OPEN) {
  while (await chainNow() < state.deadlineTs) await pause(1_000);
  for (;;) {
    try {
      signatures.timeout = await send(timeoutIx({ actor: actor.publicKey, shot }));
      break;
    } catch (error) {
      if (!String(error).includes('0x1782')) throw error;
      await pause(1_000);
    }
  }
  state = await readShot();
}
if (state.state === STATE.CAPTURED)
  throw new Error('Captured Shot needs the player reveal or permissionless forfeit after its reveal window');

let receiptAccount = await connection.getAccountInfo(receipt, 'confirmed');
if (!receiptAccount) {
  signatures.receipt = await send(writeCompletionReceiptIx({ payer: actor.publicKey, shot }));
  receiptAccount = await connection.getAccountInfo(receipt, 'confirmed');
}
if (!receiptAccount) throw new Error('CompletionReceipt missing');
const receiptState = parseCompletionReceipt(receiptAccount.data);
signatures.close = await send(closeShotIx({
  actor: actor.publicKey, shot, player: state.player,
}));
if (await readShot()) throw new Error('Shot still exists after close');

console.log(JSON.stringify({
  ok: true,
  cluster: 'devnet',
  programId: PROGRAM_ID.toBase58(),
  shot: shot.toBase58(),
  receipt: receipt.toBase58(),
  player: state.player.toBase58(),
  terminalState: state.stateName,
  receiptDisposition: receiptState.disposition,
  receiptWorker: receiptState.worker.toBase58(),
  resultHash: receiptState.resultHash,
  signatures,
  shotClosed: true,
  receiptDurable: true,
}, null, 2));
