import { createHash } from 'node:crypto';
import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from '@solana/web3.js';

export const PROGRAM_ID = new PublicKey('EdwrtcJ254e5BDSHbY6oZosdjPBrXLMZc9PzkmR9GBVD');
export const RCX_MINT = new PublicKey('FQb2EyaLZ9TWBemYmQ9zWtXcEwLiSXtz7j619ThQpump');
export const TOKEN_2022_PROGRAM = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
export const ASSOCIATED_TOKEN_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
export const SCHEMA_VERSION = 1;
export const RCX_DECIMALS = 6;
export const VOUCHER_ACCOUNT_SIZE = 245;
export const COMPLETION_RECEIPT_ACCOUNT_SIZE = 125;

export const VOUCHER_STATE = Object.freeze({
  FUNDED: 0,
  PAID: 1,
  REFUNDED: 2,
});
export const RECEIPT_DISPOSITION = Object.freeze({
  PAYABLE: 1,
  NONPAYABLE: 2,
});

const sha256 = (...parts) => {
  const hash = createHash('sha256');
  for (const part of parts) hash.update(part);
  return hash.digest();
};
export const ixDiscriminator = name => sha256(Buffer.from(`global:${name}`)).subarray(0, 8);
export const accountDiscriminator = name => sha256(Buffer.from(`account:${name}`)).subarray(0, 8);
const pk = value => value instanceof PublicKey ? value : new PublicKey(value);
const integer = (value, min, max, label) => {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max)
    throw new RangeError(`${label} out of range`);
  return number;
};
const unsigned = (value, max, label) => {
  const number = BigInt(value);
  if (number < 0n || number > max) throw new RangeError(`${label} out of range`);
  return number;
};
const u8 = value => Buffer.from([integer(value, 0, 255, 'u8')]);
const u16 = value => {
  const out = Buffer.alloc(2);
  out.writeUInt16LE(integer(value, 0, 65_535, 'u16'));
  return out;
};
const u64 = value => {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(unsigned(value, (1n << 64n) - 1n, 'u64'));
  return out;
};
const meta = (pubkey, isSigner = false, isWritable = false) => ({
  pubkey: pk(pubkey), isSigner, isWritable,
});
const ix = (name, keys, ...args) => new TransactionInstruction({
  programId: PROGRAM_ID,
  keys,
  data: Buffer.concat([ixDiscriminator(name), ...args]),
});

export const rcxTokenAddress = owner => PublicKey.findProgramAddressSync(
  [pk(owner).toBuffer(), TOKEN_2022_PROGRAM.toBuffer(), RCX_MINT.toBuffer()],
  ASSOCIATED_TOKEN_PROGRAM,
)[0];

export const voucherPda = ({
  completionProgram,
  subject,
  workKind,
  sponsor,
  nonce,
}) => PublicKey.findProgramAddressSync([
  Buffer.from('voucher'),
  u16(SCHEMA_VERSION),
  pk(completionProgram).toBuffer(),
  pk(subject).toBuffer(),
  u8(workKind),
  pk(sponsor).toBuffer(),
  u64(nonce),
], PROGRAM_ID);

export const vaultPda = voucher => PublicKey.findProgramAddressSync(
  [Buffer.from('vault'), pk(voucher).toBuffer()],
  PROGRAM_ID,
);

export const completionReceiptPda = ({ completionProgram, subject, workKind }) =>
  PublicKey.findProgramAddressSync([
    Buffer.from('completion'),
    pk(subject).toBuffer(),
    u8(workKind),
  ], pk(completionProgram));

export function fundRcxVoucherIx({
  sponsor,
  subject,
  completionProgram,
  nonce,
  workKind,
  amount,
  sponsorToken = rcxTokenAddress(sponsor),
}) {
  integer(workKind, 1, 255, 'workKind');
  if (unsigned(amount, (1n << 64n) - 1n, 'amount') === 0n) throw new RangeError('amount must be nonzero');
  const [voucher] = voucherPda({ completionProgram, subject, workKind, sponsor, nonce });
  const [vault] = vaultPda(voucher);
  return ix('fund_rcx_voucher', [
    meta(sponsor, true, true),
    meta(subject),
    meta(completionProgram),
    meta(voucher, false, true),
    meta(vault, false, true),
    meta(RCX_MINT, false, true),
    meta(sponsorToken, false, true),
    meta(TOKEN_2022_PROGRAM),
    meta(SystemProgram.programId),
  ], u64(nonce), u8(workKind), u64(amount));
}

export function claimRcxVoucherIx({
  actor,
  sponsor,
  worker,
  subject,
  completionProgram,
  nonce,
  workKind,
  workerToken = rcxTokenAddress(worker),
}) {
  const [voucher] = voucherPda({ completionProgram, subject, workKind, sponsor, nonce });
  const [vault] = vaultPda(voucher);
  const [completionReceipt] = completionReceiptPda({ completionProgram, subject, workKind });
  return ix('claim_rcx_voucher', [
    meta(actor, true),
    meta(voucher, false, true),
    meta(vault, false, true),
    meta(RCX_MINT),
    meta(worker),
    meta(workerToken, false, true),
    meta(completionReceipt),
    meta(sponsor, false, true),
    meta(TOKEN_2022_PROGRAM),
  ]);
}

export function refundRcxVoucherIx({
  actor,
  sponsor,
  subject,
  completionProgram,
  nonce,
  workKind,
  sponsorToken = rcxTokenAddress(sponsor),
}) {
  const [voucher] = voucherPda({ completionProgram, subject, workKind, sponsor, nonce });
  const [vault] = vaultPda(voucher);
  const [completionReceipt] = completionReceiptPda({ completionProgram, subject, workKind });
  return ix('refund_rcx_voucher', [
    meta(actor, true),
    meta(voucher, false, true),
    meta(vault, false, true),
    meta(RCX_MINT),
    meta(completionReceipt),
    meta(sponsor, false, true),
    meta(sponsorToken, false, true),
    meta(TOKEN_2022_PROGRAM),
  ]);
}

export function closeVoucherIx({
  actor,
  sponsor,
  subject,
  completionProgram,
  nonce,
  workKind,
}) {
  const [voucher] = voucherPda({ completionProgram, subject, workKind, sponsor, nonce });
  return ix('close_voucher', [
    meta(actor, true),
    meta(voucher, false, true),
    meta(sponsor, false, true),
  ]);
}

class Reader {
  constructor(data, size, accountName) {
    this.data = Buffer.from(data);
    if (this.data.length !== size)
      throw new RangeError(`${accountName} account must be ${size} bytes`);
    if (!this.data.subarray(0, 8).equals(accountDiscriminator(accountName)))
      throw new TypeError(`not a ${accountName} account`);
    this.offset = 8;
  }
  take(length) {
    const out = this.data.subarray(this.offset, this.offset + length);
    this.offset += length;
    return out;
  }
  u8() { return this.data.readUInt8(this.offset++); }
  u16() {
    const out = this.data.readUInt16LE(this.offset);
    this.offset += 2;
    return out;
  }
  u64() {
    const out = this.data.readBigUInt64LE(this.offset);
    this.offset += 8;
    return out;
  }
  i64() {
    const out = this.data.readBigInt64LE(this.offset);
    this.offset += 8;
    return out;
  }
  key() { return new PublicKey(this.take(32)); }
  hex32() { return this.take(32).toString('hex'); }
}

export function parseVoucher(data) {
  const reader = new Reader(data, VOUCHER_ACCOUNT_SIZE, 'Voucher');
  const out = {
    schemaVersion: reader.u16(),
    bump: reader.u8(),
    state: reader.u8(),
    workKind: reader.u8(),
    completionProgram: reader.key(),
    subject: reader.key(),
    sponsor: reader.key(),
    nonce: reader.u64(),
    fundedAmount: reader.u64(),
    settledAmount: reader.u64(),
    fundedSlot: reader.u64(),
    fundedTs: reader.i64(),
    completionReceipt: reader.key(),
    beneficiary: reader.key(),
    resultHash: reader.hex32(),
  };
  if (out.schemaVersion !== SCHEMA_VERSION) throw new TypeError('unsupported Voucher schema');
  if (!Object.values(VOUCHER_STATE).includes(out.state)) throw new TypeError('invalid Voucher state');
  if (out.workKind === 0) throw new TypeError('invalid Voucher work kind');
  return out;
}

export function parseCompletionReceipt(data) {
  const reader = new Reader(data, COMPLETION_RECEIPT_ACCOUNT_SIZE, 'CompletionReceipt');
  const out = {
    schemaVersion: reader.u16(),
    bump: reader.u8(),
    disposition: reader.u8(),
    workKind: reader.u8(),
    subject: reader.key(),
    worker: reader.key(),
    resultHash: reader.hex32(),
    completedSlot: reader.u64(),
    completedTs: reader.i64(),
  };
  if (out.schemaVersion !== SCHEMA_VERSION) throw new TypeError('unsupported CompletionReceipt schema');
  if (!Object.values(RECEIPT_DISPOSITION).includes(out.disposition))
    throw new TypeError('invalid CompletionReceipt disposition');
  if (out.workKind === 0) throw new TypeError('invalid CompletionReceipt work kind');
  return out;
}
