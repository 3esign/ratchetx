import { createHash } from 'node:crypto';
import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from '@solana/web3.js';

export const PROGRAM_ID = new PublicKey('2TV2zagBZaDXXYjduLrRbiDGGsR8jXNqYAuLDE4j4tyR');
export const PYTH_RECEIVER = new PublicKey('rec2HHDDnjLfj4kE7VyEtFA1HPGQLK33259532cRyHp');
export const PYTH_PUSH_ORACLE = new PublicKey('pyt2F414BA6dPttK6RddPZUdHfapoBN24GL5wbrPCou');
export const RULESET_HASH = '78b15cfe2ac9f4c69f60d42a65b544f143ea9a253efbde2f890a26549a15b3f0';
export const SCHEMA_VERSION = 2;
export const COMPLETION_SCHEMA_VERSION = 1;
export const ADAPTER_ID = 1;
export const WORK_KIND = 1;
export const SHOT_ACCOUNT_SIZE = 470;
export const COMPLETION_RECEIPT_ACCOUNT_SIZE = 125;

export const FEEDS = [
  { index: 0, symbol: 'SOL', feedId: 'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d', maxEntryAgeSecs: 30, maxWaitSecs: 300 },
  { index: 1, symbol: 'TSLAX', feedId: '47a156470288850a440df3a6ce85a55917b813a19bb5b31128a33a986566a362', maxEntryAgeSecs: 120, maxWaitSecs: 7200 },
  { index: 2, symbol: 'NVDAX', feedId: '4244d07890e4610f46bbde67de8f43a4bf8b569eebe904f136b469f148503b7f', maxEntryAgeSecs: 120, maxWaitSecs: 7200 },
  { index: 3, symbol: 'SPYX', feedId: '2817b78438c769357182c04346fddaad1178c82f4048828fe0997c3c64624e14', maxEntryAgeSecs: 120, maxWaitSecs: 7200 },
  { index: 4, symbol: 'AAPLX', feedId: '978e6cc68a119ce066aa830017318563a9ed04ec3a0a6439010fc11296a58675', maxEntryAgeSecs: 120, maxWaitSecs: 7200 },
  { index: 5, symbol: 'MSTRX', feedId: '53f95ba4e23ed15ea56083e2ee9a5eec48055d6f59033d4bb95f1ca2a2349c28', maxEntryAgeSecs: 120, maxWaitSecs: 7200 },
  { index: 6, symbol: 'CRCLX', feedId: 'c13184461c0c80d98ffcd89be627c2220b94a96c7c67f0c4b16bc12fd3b17758', maxEntryAgeSecs: 120, maxWaitSecs: 7200 },
];

export const STATE = Object.freeze({
  OPEN: 0,
  CAPTURED: 1,
  REVEALED: 2,
  VOID_EQUAL: 3,
  VOID_MISSED_SUCCESSOR: 4,
  VOID_SOURCE_REVISION: 5,
  VOID_SOURCE_CHAIN: 6,
  VOID_SCALE_CHANGE: 7,
  VOID_TIMEOUT: 8,
  FORFEITED: 9,
});
export const STATE_NAME = Object.freeze(Object.fromEntries(
  Object.entries(STATE).map(([name, value]) => [value, name]),
));
export const RECEIPT_DISPOSITION = Object.freeze({ PAYABLE: 1, NONPAYABLE: 2 });

const sha256 = (...parts) => {
  const hash = createHash('sha256');
  for (const part of parts) hash.update(part);
  return hash.digest();
};
export const ixDiscriminator = name => sha256(Buffer.from(`global:${name}`)).subarray(0, 8);
export const accountDiscriminator = name => sha256(Buffer.from(`account:${name}`)).subarray(0, 8);
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
const bytes32 = (value, label = 'bytes32') => {
  if (typeof value === 'string' && !/^[0-9a-f]{64}$/.test(value))
    throw new RangeError(`${label} must be 64 lower-case hex characters`);
  const out = Buffer.from(value instanceof Uint8Array ? value : Buffer.from(value, 'hex'));
  if (out.length !== 32) throw new RangeError(`${label} must be 32 bytes`);
  return out;
};
const pk = value => value instanceof PublicKey ? value : new PublicKey(value);
const feed = index => FEEDS[integer(index, 0, FEEDS.length - 1, 'feedIndex')];
const sideByte = side => {
  if (side === 1 || side === 'UP') return 1;
  if (side === 0 || side === 'DOWN') return 0;
  throw new RangeError('side must be DOWN=0 or UP=1');
};
const meta = (pubkey, isSigner = false, isWritable = false) => ({
  pubkey: pk(pubkey), isSigner, isWritable,
});
const ix = (name, keys, ...args) => new TransactionInstruction({
  programId: PROGRAM_ID,
  keys,
  data: Buffer.concat([ixDiscriminator(name), ...args]),
});

export const shotPda = (player, nonce) => PublicKey.findProgramAddressSync(
  [Buffer.from('shot'), pk(player).toBuffer(), u64(nonce)],
  PROGRAM_ID,
);
export const completionReceiptPda = subject => PublicKey.findProgramAddressSync(
  [Buffer.from('completion'), pk(subject).toBuffer(), u8(WORK_KIND)],
  PROGRAM_ID,
);
export const pushAccount = feedIndex => PublicKey.findProgramAddressSync(
  [u16(0), Buffer.from(feed(feedIndex).feedId, 'hex')],
  PYTH_PUSH_ORACLE,
)[0];

export function commitHash({ player, nonce, side, pBps, salt }) {
  const normalizedSide = sideByte(side);
  const normalizedPBps = integer(pBps, 0, 10_000, 'pBps');
  return sha256(
    Buffer.from('RATCHET_NEXT_PRINT_COMMIT_V2'),
    pk(player).toBuffer(),
    u64(nonce),
    u8(normalizedSide),
    u16(normalizedPBps),
    bytes32(salt, 'salt'),
  );
}

export function openShotIx({ player, nonce, commit, feedIndex }) {
  const [shot] = shotPda(player, nonce);
  const [completionReceipt] = completionReceiptPda(shot);
  return ix('open_shot', [
    meta(player, true, true),
    meta(shot, false, true),
    meta(pushAccount(feedIndex)),
    meta(completionReceipt),
    meta(SystemProgram.programId),
  ], u64(nonce), bytes32(commit, 'commit'), u8(feedIndex));
}
export const observeIx = ({ actor, shot, feedIndex }) => ix('observe', [
  meta(actor, true, true),
  meta(shot, false, true),
  meta(pushAccount(feedIndex)),
]);
export const timeoutIx = ({ actor, shot }) => ix('timeout', [
  meta(actor, true),
  meta(shot, false, true),
]);
export function revealIx({ player, shot, side, pBps, salt }) {
  return ix('reveal', [
    meta(player, true),
    meta(shot, false, true),
  ], u8(sideByte(side)), u16(integer(pBps, 0, 10_000, 'pBps')), bytes32(salt, 'salt'));
}
export const forfeitIx = ({ actor, shot }) => ix('forfeit', [
  meta(actor, true),
  meta(shot, false, true),
]);
export function writeCompletionReceiptIx({ payer, shot }) {
  const [completionReceipt] = completionReceiptPda(shot);
  return ix('write_completion_receipt', [
    meta(payer, true, true),
    meta(shot),
    meta(completionReceipt, false, true),
    meta(SystemProgram.programId),
  ]);
}
export function closeShotIx({ actor, shot, player }) {
  const [completionReceipt] = completionReceiptPda(shot);
  return ix('close_shot', [
    meta(actor, true),
    meta(shot, false, true),
    meta(player, false, true),
    meta(completionReceipt),
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
  take(length) { const out = this.data.subarray(this.offset, this.offset + length); this.offset += length; return out; }
  u8() { return this.data.readUInt8(this.offset++); }
  i8() { return this.data.readInt8(this.offset++); }
  u16() { const out = this.data.readUInt16LE(this.offset); this.offset += 2; return out; }
  i32() { const out = this.data.readInt32LE(this.offset); this.offset += 4; return out; }
  u64() { const out = this.data.readBigUInt64LE(this.offset); this.offset += 8; return out; }
  i64() { const out = this.data.readBigInt64LE(this.offset); this.offset += 8; return out; }
  key() { return new PublicKey(this.take(32)); }
  hex32() { return this.take(32).toString('hex'); }
}
const evidence = reader => ({
  sourceAccount: reader.key(),
  messageHash: reader.hex32(),
  price: reader.i64(),
  conf: reader.u64(),
  exponent: reader.i32(),
  publishTime: reader.i64(),
  prevPublishTime: reader.i64(),
  postedSlot: reader.u64(),
});

export function parseShot(data) {
  const reader = new Reader(data, SHOT_ACCOUNT_SIZE, 'NextPrintShot');
  const out = {
    schemaVersion: reader.u16(),
    bump: reader.u8(),
    state: reader.u8(),
    adapterId: reader.u16(),
    rulesetHash: reader.hex32(),
    player: reader.key(),
    nonce: reader.u64(),
    commit: reader.hex32(),
    feedIndex: reader.u8(),
    feedId: reader.hex32(),
    openedTs: reader.i64(),
    deadlineTs: reader.i64(),
    entry: evidence(reader),
    exit: evidence(reader),
    outcome: reader.i8(),
    completionState: reader.u8(),
    completionDisposition: reader.u8(),
    completionWorker: reader.key(),
    completionResultHash: reader.hex32(),
    completionSlot: reader.u64(),
    completionTs: reader.i64(),
    side: reader.u8(),
    pBps: reader.u16(),
    hit: reader.u8(),
  };
  if (reader.offset !== SHOT_ACCOUNT_SIZE) throw new RangeError('NextPrintShot layout drift');
  if (out.schemaVersion !== SCHEMA_VERSION) throw new TypeError('unsupported NextPrintShot schema');
  if (out.adapterId !== ADAPTER_ID || out.rulesetHash !== RULESET_HASH)
    throw new TypeError('unsupported NextPrintShot ruleset');
  out.stateName = STATE_NAME[out.state] ?? 'UNKNOWN';
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
  if (reader.offset !== COMPLETION_RECEIPT_ACCOUNT_SIZE)
    throw new RangeError('CompletionReceipt layout drift');
  if (out.schemaVersion !== COMPLETION_SCHEMA_VERSION || out.workKind !== WORK_KIND)
    throw new TypeError('unsupported CompletionReceipt contract');
  if (!Object.values(RECEIPT_DISPOSITION).includes(out.disposition))
    throw new TypeError('invalid CompletionReceipt disposition');
  return out;
}
