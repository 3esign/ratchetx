import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import { completionReceiptPda as workMarketReceiptPda } from '../onchain/ratchet-work-market/client/client-v1.mjs';
import {
  ADAPTER_ID,
  COMPLETION_RECEIPT_ACCOUNT_SIZE,
  COMPLETION_SCHEMA_VERSION,
  PROGRAM_ID,
  RULESET_HASH,
  SCHEMA_VERSION,
  SHOT_ACCOUNT_SIZE,
  WORK_KIND,
  accountDiscriminator,
  closeShotIx,
  commitHash,
  completionReceiptPda,
  forfeitIx,
  observeIx,
  openShotIx,
  parseCompletionReceipt,
  parseShot,
  pushAccount,
  revealIx,
  shotPda,
  timeoutIx,
  writeCompletionReceiptIx,
} from '../onchain/ratchet-next-print-v2/client/client-v2.mjs';

const vector = JSON.parse(readFileSync(new URL(
  '../onchain/ratchet-next-print-v2/vectors/abi-v2.json', import.meta.url,
)));
const contract = JSON.parse(readFileSync(new URL(
  '../onchain/ratchet-next-print-v2/abi-v2.json', import.meta.url,
)));
const player = new PublicKey(vector.player);
const actor = new PublicKey(Buffer.alloc(32, 6));
const worker = new PublicKey(Buffer.alloc(32, 7));
const nonce = BigInt(vector.nonce);
const commit = commitHash({
  player, nonce, side: vector.side, pBps: vector.pBps, salt: vector.saltHex,
});

assert.equal(PROGRAM_ID.toBase58(), vector.programId);
assert.equal(contract.programId, vector.programId);
assert.equal(contract.status, 'devnet-candidate');
assert.equal(contract.accounts.NextPrintShot.size, SHOT_ACCOUNT_SIZE);
assert.equal(contract.accounts.CompletionReceipt.size, COMPLETION_RECEIPT_ACCOUNT_SIZE);
assert.equal(commit.toString('hex'), vector.commitHex);
const [shot, shotBump] = shotPda(player, nonce);
const [receipt, receiptBump] = completionReceiptPda(shot);
assert.equal(shot.toBase58(), vector.shot);
assert.equal(shotBump, vector.shotBump);
assert.equal(receipt.toBase58(), vector.receipt);
assert.equal(receiptBump, vector.receiptBump);
assert.equal(pushAccount(vector.feedIndex).toBase58(), vector.priceUpdate);

const [marketReceipt, marketBump] = workMarketReceiptPda({
  completionProgram: PROGRAM_ID,
  subject: shot,
  workKind: WORK_KIND,
});
assert.equal(marketReceipt.toBase58(), vector.receipt, 'Work Market and v2 must derive one receipt');
assert.equal(marketBump, vector.receiptBump);

const open = openShotIx({ player, nonce, commit, feedIndex: vector.feedIndex });
const observe = observeIx({ actor, shot, feedIndex: vector.feedIndex });
const timeout = timeoutIx({ actor, shot });
const reveal = revealIx({
  player, shot, side: vector.side, pBps: vector.pBps, salt: vector.saltHex,
});
const forfeit = forfeitIx({ actor, shot });
const writeReceipt = writeCompletionReceiptIx({ payer: actor, shot });
const close = closeShotIx({ actor, shot, player });

assert.equal(open.data.toString('hex'), vector.openDataHex);
assert.equal(observe.data.toString('hex'), vector.observeDataHex);
assert.equal(timeout.data.toString('hex'), vector.timeoutDataHex);
assert.equal(reveal.data.toString('hex'), vector.revealDataHex);
assert.equal(forfeit.data.toString('hex'), vector.forfeitDataHex);
assert.equal(writeReceipt.data.toString('hex'), vector.writeReceiptDataHex);
assert.equal(close.data.toString('hex'), vector.closeDataHex);

assert.deepEqual(open.keys.map(key => [key.isSigner, key.isWritable]), [
  [true, true], [false, true], [false, false], [false, false], [false, false],
]);
assert.deepEqual(open.keys.map(key => key.pubkey.toBase58()), [
  vector.player, vector.shot, vector.priceUpdate, vector.receipt, SystemProgram.programId.toBase58(),
]);
assert.deepEqual(observe.keys.map(key => [key.isSigner, key.isWritable]), [
  [true, true], [false, true], [false, false],
]);
assert.deepEqual(timeout.keys.map(key => [key.isSigner, key.isWritable]), [
  [true, false], [false, true],
]);
assert.deepEqual(reveal.keys.map(key => [key.isSigner, key.isWritable]), [
  [true, false], [false, true],
]);
assert.deepEqual(forfeit.keys.map(key => [key.isSigner, key.isWritable]), [
  [true, false], [false, true],
]);
assert.deepEqual(writeReceipt.keys.map(key => [key.isSigner, key.isWritable]), [
  [true, true], [false, false], [false, true], [false, false],
]);
assert.deepEqual(close.keys.map(key => [key.isSigner, key.isWritable]), [
  [true, false], [false, true], [false, true], [false, false],
]);

const builtInstructions = new Map([
  ['open_shot', open], ['observe', observe], ['timeout', timeout], ['reveal', reveal],
  ['forfeit', forfeit], ['write_completion_receipt', writeReceipt], ['close_shot', close],
]);
for (const definition of contract.instructions) {
  const built = builtInstructions.get(definition.name);
  assert.ok(built, `missing client builder for ${definition.name}`);
  assert.deepEqual(
    definition.accounts.map(account => [account.signer, account.writable]),
    built.keys.map(key => [key.isSigner, key.isWritable]),
    `${definition.name} manifest topology must match the client`,
  );
}

function writer(size, accountName) {
  const data = Buffer.alloc(size);
  let offset = 0;
  const put = bytes => { Buffer.from(bytes).copy(data, offset); offset += bytes.length; };
  const api = {
    data,
    offset: () => offset,
    put,
    u8(value) { data.writeUInt8(value, offset); offset += 1; },
    i8(value) { data.writeInt8(value, offset); offset += 1; },
    u16(value) { data.writeUInt16LE(value, offset); offset += 2; },
    i32(value) { data.writeInt32LE(value, offset); offset += 4; },
    u64(value) { data.writeBigUInt64LE(BigInt(value), offset); offset += 8; },
    i64(value) { data.writeBigInt64LE(BigInt(value), offset); offset += 8; },
    key(value) { put(new PublicKey(value).toBuffer()); },
  };
  put(accountDiscriminator(accountName));
  return api;
}

function putEvidence(out, source, marker, publish, prev) {
  out.key(source); out.put(Buffer.alloc(32, marker)); out.i64(100); out.u64(1);
  out.i32(-8); out.i64(publish); out.i64(prev); out.u64(123);
}

const shotOut = writer(SHOT_ACCOUNT_SIZE, 'NextPrintShot');
shotOut.u16(SCHEMA_VERSION); shotOut.u8(vector.shotBump); shotOut.u8(1); shotOut.u16(ADAPTER_ID);
shotOut.put(Buffer.from(RULESET_HASH, 'hex')); shotOut.key(player); shotOut.u64(nonce); shotOut.put(commit);
shotOut.u8(vector.feedIndex); shotOut.put(Buffer.from('47a156470288850a440df3a6ce85a55917b813a19bb5b31128a33a986566a362', 'hex'));
shotOut.i64(1000); shotOut.i64(8200);
putEvidence(shotOut, vector.priceUpdate, 8, 1000, 990);
putEvidence(shotOut, vector.priceUpdate, 9, 1010, 1000);
shotOut.i8(1); shotOut.u8(1); shotOut.u8(1); shotOut.key(worker); shotOut.put(Buffer.alloc(32, 10));
shotOut.u64(456); shotOut.i64(1011); shotOut.u8(2); shotOut.u16(0); shotOut.u8(2);
assert.equal(shotOut.offset(), SHOT_ACCOUNT_SIZE);
const parsedShot = parseShot(shotOut.data);
assert.equal(parsedShot.player.toBase58(), vector.player);
assert.equal(parsedShot.completionWorker.toBase58(), worker.toBase58());
assert.equal(parsedShot.completionResultHash, Buffer.alloc(32, 10).toString('hex'));

const receiptOut = writer(COMPLETION_RECEIPT_ACCOUNT_SIZE, 'CompletionReceipt');
receiptOut.u16(COMPLETION_SCHEMA_VERSION); receiptOut.u8(vector.receiptBump); receiptOut.u8(1);
receiptOut.u8(WORK_KIND); receiptOut.key(shot); receiptOut.key(worker); receiptOut.put(Buffer.alloc(32, 10));
receiptOut.u64(456); receiptOut.i64(1011);
assert.equal(receiptOut.offset(), COMPLETION_RECEIPT_ACCOUNT_SIZE);
const parsedReceipt = parseCompletionReceipt(receiptOut.data);
assert.equal(parsedReceipt.subject.toBase58(), vector.shot);
assert.equal(parsedReceipt.worker.toBase58(), worker.toBase58());

assert.throws(() => commitHash({ player, nonce, side: 2, pBps: 5000, salt: vector.saltHex }), /side/);
assert.throws(() => openShotIx({ player, nonce, commit, feedIndex: 7 }), /feedIndex/);
assert.throws(() => parseShot(Buffer.alloc(SHOT_ACCOUNT_SIZE)), /not a NextPrintShot/);
assert.throws(() => parseShot(Buffer.alloc(SHOT_ACCOUNT_SIZE - 1)), /470 bytes/);
assert.throws(() => parseCompletionReceipt(Buffer.alloc(COMPLETION_RECEIPT_ACCOUNT_SIZE)), /not a CompletionReceipt/);

console.log('NEXT PRINT v2 client PASS: Rust vectors, Work Market receipt PDA, ABI, layouts and guards');
