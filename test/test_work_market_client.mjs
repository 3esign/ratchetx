import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM,
  COMPLETION_RECEIPT_ACCOUNT_SIZE,
  PROGRAM_ID,
  RCX_MINT,
  SCHEMA_VERSION,
  TOKEN_2022_PROGRAM,
  VOUCHER_ACCOUNT_SIZE,
  accountDiscriminator,
  claimRcxVoucherIx,
  closeVoucherIx,
  completionReceiptPda,
  fundRcxVoucherIx,
  parseCompletionReceipt,
  parseVoucher,
  rcxTokenAddress,
  refundRcxVoucherIx,
  vaultPda,
  voucherPda,
} from '../onchain/ratchet-work-market/client/client-v1.mjs';

const vector = JSON.parse(readFileSync(new URL(
  '../onchain/ratchet-work-market/vectors/abi-v1.json', import.meta.url,
)));
const contract = JSON.parse(readFileSync(new URL(
  '../onchain/ratchet-work-market/abi-v1.json', import.meta.url,
)));
const actor = new PublicKey(Buffer.alloc(32, 6));
const worker = new PublicKey(Buffer.alloc(32, 7));
const sponsorToken = rcxTokenAddress(vector.sponsor);
const workerToken = rcxTokenAddress(worker);
const pdaArgs = {
  completionProgram: vector.completionProgram,
  subject: vector.subject,
  workKind: vector.workKind,
  sponsor: vector.sponsor,
  nonce: BigInt(vector.nonce),
};

assert.equal(PROGRAM_ID.toBase58(), vector.programId);
assert.equal(contract.programId, vector.programId);
assert.equal(contract.status, 'candidate-not-deployed');
assert.equal(contract.schemaVersion, SCHEMA_VERSION);
assert.equal(contract.accounts.Voucher.size, VOUCHER_ACCOUNT_SIZE);
assert.equal(contract.accounts.CompletionReceipt.size, COMPLETION_RECEIPT_ACCOUNT_SIZE);
assert.equal(RCX_MINT.toBase58(), 'FQb2EyaLZ9TWBemYmQ9zWtXcEwLiSXtz7j619ThQpump');
assert.equal(TOKEN_2022_PROGRAM.toBase58(), 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
assert.equal(ASSOCIATED_TOKEN_PROGRAM.toBase58(), 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
assert.equal(sponsorToken.toBase58(), 'CbVLtSB29upKrjCZtbLRZxdQpMmgZfFB192zbUEz8H8F');

const [voucher, voucherBump] = voucherPda(pdaArgs);
const [vault, vaultBump] = vaultPda(voucher);
const [receipt, receiptBump] = completionReceiptPda(pdaArgs);
assert.equal(voucher.toBase58(), vector.voucher);
assert.equal(voucherBump, vector.voucherBump);
assert.equal(vault.toBase58(), vector.vault);
assert.equal(vaultBump, vector.vaultBump);
assert.equal(receipt.toBase58(), vector.receipt);
assert.equal(receiptBump, vector.receiptBump);

const fund = fundRcxVoucherIx({ ...pdaArgs, amount: BigInt(vector.amount) });
assert.equal(fund.data.toString('hex'), vector.fundDataHex);
assert.deepEqual(fund.keys.map(key => [key.isSigner, key.isWritable]), [
  [true, true], [false, false], [false, false], [false, true], [false, true],
  [false, true], [false, true], [false, false], [false, false],
]);
assert.deepEqual(fund.keys.map(key => key.pubkey.toBase58()), [
  vector.sponsor, vector.subject, vector.completionProgram, vector.voucher, vector.vault,
  RCX_MINT.toBase58(), sponsorToken.toBase58(), TOKEN_2022_PROGRAM.toBase58(),
  SystemProgram.programId.toBase58(),
]);

const claim = claimRcxVoucherIx({ actor, worker, ...pdaArgs });
assert.equal(claim.data.toString('hex'), vector.claimDataHex);
assert.deepEqual(claim.keys.map(key => [key.isSigner, key.isWritable]), [
  [true, false], [false, true], [false, true], [false, false], [false, false],
  [false, true], [false, false], [false, true], [false, false],
]);
assert.deepEqual(claim.keys.map(key => key.pubkey.toBase58()), [
  actor.toBase58(), vector.voucher, vector.vault, RCX_MINT.toBase58(), worker.toBase58(),
  workerToken.toBase58(), vector.receipt, vector.sponsor, TOKEN_2022_PROGRAM.toBase58(),
]);

const refund = refundRcxVoucherIx({ actor, ...pdaArgs });
assert.equal(refund.data.toString('hex'), vector.refundDataHex);
assert.deepEqual(refund.keys.map(key => [key.isSigner, key.isWritable]), [
  [true, false], [false, true], [false, true], [false, false], [false, false],
  [false, true], [false, true], [false, false],
]);
assert.deepEqual(refund.keys.map(key => key.pubkey.toBase58()), [
  actor.toBase58(), vector.voucher, vector.vault, RCX_MINT.toBase58(), vector.receipt,
  vector.sponsor, sponsorToken.toBase58(), TOKEN_2022_PROGRAM.toBase58(),
]);

const close = closeVoucherIx({ actor, ...pdaArgs });
assert.equal(close.data.toString('hex'), vector.closeDataHex);
assert.deepEqual(close.keys.map(key => [key.isSigner, key.isWritable]), [
  [true, false], [false, true], [false, true],
]);

const builtInstructions = new Map([
  ['fund_rcx_voucher', fund], ['claim_rcx_voucher', claim],
  ['refund_rcx_voucher', refund], ['close_voucher', close],
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

const classicToken = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
for (const instruction of [fund, claim, refund, close]) {
  assert.ok(!instruction.keys.some(key => key.pubkey.toBase58() === classicToken));
}

function voucherFixture() {
  const data = Buffer.alloc(VOUCHER_ACCOUNT_SIZE);
  let offset = 0;
  const put = bytes => { Buffer.from(bytes).copy(data, offset); offset += bytes.length; };
  const putU8 = value => { data.writeUInt8(value, offset); offset += 1; };
  const putU16 = value => { data.writeUInt16LE(value, offset); offset += 2; };
  const putU64 = value => { data.writeBigUInt64LE(BigInt(value), offset); offset += 8; };
  const putI64 = value => { data.writeBigInt64LE(BigInt(value), offset); offset += 8; };
  put(accountDiscriminator('Voucher'));
  putU16(SCHEMA_VERSION); putU8(vector.voucherBump); putU8(0); putU8(vector.workKind);
  put(new PublicKey(vector.completionProgram).toBuffer());
  put(new PublicKey(vector.subject).toBuffer());
  put(new PublicKey(vector.sponsor).toBuffer());
  putU64(vector.nonce); putU64(vector.amount); putU64(0); putU64(123); putI64(456);
  put(new PublicKey(vector.receipt).toBuffer());
  put(Buffer.alloc(32)); put(Buffer.alloc(32, 8));
  assert.equal(offset, data.length);
  return data;
}

function receiptFixture() {
  const data = Buffer.alloc(COMPLETION_RECEIPT_ACCOUNT_SIZE);
  let offset = 0;
  const put = bytes => { Buffer.from(bytes).copy(data, offset); offset += bytes.length; };
  const putU8 = value => { data.writeUInt8(value, offset); offset += 1; };
  put(accountDiscriminator('CompletionReceipt'));
  data.writeUInt16LE(SCHEMA_VERSION, offset); offset += 2;
  putU8(vector.receiptBump); putU8(1); putU8(vector.workKind);
  put(new PublicKey(vector.subject).toBuffer()); put(worker.toBuffer()); put(Buffer.alloc(32, 9));
  data.writeBigUInt64LE(321n, offset); offset += 8;
  data.writeBigInt64LE(654n, offset); offset += 8;
  assert.equal(offset, data.length);
  return data;
}

const parsedVoucher = parseVoucher(voucherFixture());
assert.equal(parsedVoucher.completionProgram.toBase58(), vector.completionProgram);
assert.equal(parsedVoucher.subject.toBase58(), vector.subject);
assert.equal(parsedVoucher.sponsor.toBase58(), vector.sponsor);
assert.equal(parsedVoucher.fundedAmount, BigInt(vector.amount));
assert.equal(parsedVoucher.resultHash, Buffer.alloc(32, 8).toString('hex'));
const parsedReceipt = parseCompletionReceipt(receiptFixture());
assert.equal(parsedReceipt.worker.toBase58(), worker.toBase58());
assert.equal(parsedReceipt.resultHash, Buffer.alloc(32, 9).toString('hex'));

assert.throws(() => fundRcxVoucherIx({ ...pdaArgs, amount: 0 }), /nonzero/);
assert.throws(() => fundRcxVoucherIx({ ...pdaArgs, workKind: 0, amount: 1 }), /workKind/);
assert.throws(() => voucherPda({ ...pdaArgs, nonce: -1 }), /u64/);
assert.throws(() => parseVoucher(Buffer.alloc(VOUCHER_ACCOUNT_SIZE)), /not a Voucher/);
assert.throws(() => parseVoucher(Buffer.alloc(VOUCHER_ACCOUNT_SIZE - 1)), /245 bytes/);
assert.throws(() => parseCompletionReceipt(Buffer.alloc(COMPLETION_RECEIPT_ACCOUNT_SIZE)), /not a CompletionReceipt/);
assert.throws(() => parseCompletionReceipt(Buffer.alloc(COMPLETION_RECEIPT_ACCOUNT_SIZE + 1)), /125 bytes/);

const printer = readFileSync(new URL(
  '../onchain/ratchet-work-market/programs/ratchet-work-market/examples/print_abi_vectors.rs',
  import.meta.url,
), 'utf8');
assert.match(printer, /instruction::FundRcxVoucher/);
assert.match(printer, /InstructionData/);

console.log('WORK MARKET static client PASS: Rust vectors, Token-2022 ATA, PDAs, ABI and parser guards');
