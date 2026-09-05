import assert from 'node:assert/strict';
import { PublicKey } from '@solana/web3.js';
import { createHash } from 'node:crypto';
import {
  ADAPTER_PYTH_MIN_CAPTURE_V2, ADAPTER_PYTH_PUSH_V2, TIMEPIN_SCHEMA_V2, VERIFICATION_FULL,
  OFFICIAL_PYTH_RECEIVER_PROGRAM, OFFICIAL_PYTH_PUSH_ORACLE_PROGRAM,
  deriveReceiverConfigPda, derivePushSourcePda,
  captureNeed, createWorkPage, reserveWork, createNeed,
  WORK_KIND_FIRST_CAPTURE, WORK_KIND_TERMINALIZE
} from '../onchain/rcx-timepin/model-v2.mjs';

function sha256(data) { return createHash('sha256').update(data).digest(); }
function discriminator(kind, name) { return sha256(Buffer.from(kind + ':' + name)).subarray(0, 8); }
const PRICE_UPDATE_V2_DISCRIMINATOR = discriminator('account', 'PriceUpdateV2');

function receiverConfigData(wormhole) {
  const out = Buffer.alloc(370);
  sha256(Buffer.from('account:Config')).subarray(0, 8).copy(out, 0);
  Buffer.alloc(32, 11).copy(out, 8);
  let offset = 40;
  out[offset] = 0; offset += 1;
  Buffer.from(wormhole).copy(out, offset); offset += 32;
  out.writeUInt32LE(0, offset); offset += 4;
  out.writeBigUInt64LE(0n, offset); offset += 8;
  out[offset] = 1;
  return out;
}

const BPF_UPGRADEABLE_LOADER_PROGRAM = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111').toBytes();
const WORMHOLE = Buffer.alloc(32, 9);
const RECEIVER_PROGRAMDATA = Buffer.alloc(32, 10);
const WORMHOLE_PROGRAMDATA = Buffer.alloc(32, 11);
const CONFIG_DATA = receiverConfigData(WORMHOLE);
const CONFIG_HASH = createHash('sha256').update(CONFIG_DATA).digest();

const loaderProgramAccountData = (programdata) => {
  const out = Buffer.alloc(36);
  out.writeUInt32LE(2, 0);
  out.set(programdata, 4);
  return out;
};
const loaderProgramdataAccountData = (slot) => {
  const out = Buffer.alloc(45);
  out.writeUInt32LE(3, 0);
  out.writeBigUInt64LE(slot, 4);
  return out;
};

const GENERATION = {
  receiverProgram: OFFICIAL_PYTH_RECEIVER_PROGRAM,
  receiverProgramExecutable: true,
  receiverProgramOwner: BPF_UPGRADEABLE_LOADER_PROGRAM,
  receiverProgramAccountData: loaderProgramAccountData(RECEIVER_PROGRAMDATA),
  receiverProgramdata: RECEIVER_PROGRAMDATA,
  receiverProgramdataOwner: BPF_UPGRADEABLE_LOADER_PROGRAM,
  receiverProgramdataExecutable: false,
  receiverProgramdataAccountData: loaderProgramdataAccountData(900n),
  receiverConfigKey: deriveReceiverConfigPda().address,
  receiverConfigOwner: OFFICIAL_PYTH_RECEIVER_PROGRAM,
  receiverConfigExecutable: false,
  receiverConfigData: CONFIG_DATA,
  wormholeProgram: WORMHOLE,
  wormholeProgramExecutable: true,
  wormholeProgramOwner: BPF_UPGRADEABLE_LOADER_PROGRAM,
  wormholeProgramAccountData: loaderProgramAccountData(WORMHOLE_PROGRAMDATA),
  wormholeProgramdata: WORMHOLE_PROGRAMDATA,
  wormholeProgramdataOwner: BPF_UPGRADEABLE_LOADER_PROGRAM,
  wormholeProgramdataExecutable: false,
  wormholeProgramdataAccountData: loaderProgramdataAccountData(901n),
};

const PROGRAM_ID = Buffer.alloc(32, 1);
const ACTOR_A = Buffer.alloc(32, 2);
const ACTOR_B = Buffer.alloc(32, 3);
const TARGET = 1_800_001_200n;
const OPENED = TARGET - 60n;

const LIVE_SPEC = {
  schema: TIMEPIN_SCHEMA_V2,
  adapter: ADAPTER_PYTH_MIN_CAPTURE_V2,
  receiverProgram: OFFICIAL_PYTH_RECEIVER_PROGRAM,
  pushOracleProgram: OFFICIAL_PYTH_PUSH_ORACLE_PROGRAM,
  feedId: Buffer.alloc(32, 7),
  shardId: 0,
  requiredVerification: VERIFICATION_FULL,
  targetGridSeconds: 60,
  minOpenLeadSeconds: 31,
  maxTargetAheadSeconds: 3600,
  maxPreTargetGapSeconds: 0,
  maxPostTargetLagSeconds: 59,
  captureGraceSeconds: 60,
  maxFutureSkewSeconds: 30,
  minExponent: -12,
  maxExponent: -2,
  maxConfidenceBps: 100,
  receiverProgramdataSlot: 900n,
  wormholeProgramdataSlot: 901n,
  receiverConfigHash: CONFIG_HASH,
  wormholeProgram: WORMHOLE,
  registeredSlot: 1000n
};

const MESSAGE_A = {
  feedId: LIVE_SPEC.feedId,
  price: 12_345_678n,
  conf: 12_345n,
  exponent: -6,
  publishTime: TARGET,
  prevPublishTime: TARGET - 60n,
  emaPrice: 12_345_678n,
  emaConf: 12_345n,
  postedSlot: 1010n,
};

const MESSAGE_B = { ...MESSAGE_A, price: 12_345_679n, conf: 12_346n };

function source(message = MESSAGE_A) {
  const buf = Buffer.alloc(134);
  PRICE_UPDATE_V2_DISCRIMINATOR.copy(buf, 0); // discriminator
  buf.set(derivePushSourcePda(LIVE_SPEC).address, 8); // writeAuthority = sourceAccount.key!
  buf[40] = VERIFICATION_FULL;
  buf.set(message.feedId, 41);
  buf.writeBigInt64LE(message.price, 73);
  buf.writeBigUInt64LE(message.conf, 81);
  buf.writeInt32LE(message.exponent, 89);
  buf.writeBigInt64LE(message.publishTime, 93);
  buf.writeBigInt64LE(message.prevPublishTime, 101);
  buf.writeBigInt64LE(message.emaPrice, 109);
  buf.writeBigUInt64LE(message.emaConf, 117);
  buf.writeBigUInt64LE(message.postedSlot, 125);
  return {
    key: derivePushSourcePda(LIVE_SPEC).address,
    owner: LIVE_SPEC.receiverProgram,
    executable: false,
    data: buf
  };
}

const context = () => ({ unixTimestamp: TARGET, slot: 1100n, generation: GENERATION });
const fresh = () => {
  let need = createNeed(LIVE_SPEC, TARGET, OPENED, PROGRAM_ID);
  let page = createWorkPage(PROGRAM_ID, need.address);
  page = reserveWork(page, need, WORK_KIND_FIRST_CAPTURE, 0, PROGRAM_ID).page;
  page = reserveWork(page, need, WORK_KIND_TERMINALIZE, 1, PROGRAM_ID).page;
  return { need, page };
}

const MSG_T = MESSAGE_A;
const MSG_LATE = { ...MESSAGE_A, publishTime: TARGET + 1n, price: 12_345_679n };
const MSG_T_B = MESSAGE_B;

// 1. minimum selection (later print must not win)
let { need, page } = fresh();
let first = captureNeed(LIVE_SPEC, need, source(MSG_T), context(), ACTOR_A, PROGRAM_ID, page);
let conflict = captureNeed(LIVE_SPEC, first.need, source(MSG_LATE), { ...context(), candidateA: first.candidate }, ACTOR_B, PROGRAM_ID, first.workPage);
assert.equal(conflict.code, 'NOT_BETTER_THAN_CURRENT', 'minimum selection (later print must not win)');

// 2. replacement (an earlier admissible print must displace a later one)
({ need, page } = fresh());
first = captureNeed(LIVE_SPEC, need, source(MSG_LATE), context(), ACTOR_B, PROGRAM_ID, page);
conflict = captureNeed(LIVE_SPEC, first.need, source(MSG_T), { ...context(), candidateA: first.candidate }, ACTOR_A, PROGRAM_ID, first.workPage);
assert.equal(conflict.code, 'REPLACED', 'replacement (an earlier admissible print must displace a later one)');

// 3. duplicate (same message hash twice is not ambiguity)
({ need, page } = fresh());
first = captureNeed(LIVE_SPEC, need, source(MSG_T), context(), ACTOR_A, PROGRAM_ID, page);
conflict = captureNeed(LIVE_SPEC, first.need, source(MSG_T), { ...context(), candidateA: first.candidate }, ACTOR_B, PROGRAM_ID, first.workPage);
assert.equal(conflict.code, 'DUPLICATE', 'duplicate (same message hash twice is not ambiguity)');

// 4. genuine ambiguity (two distinct prints with the same publish_time - the only case that may be ambiguous)
({ need, page } = fresh());
first = captureNeed(LIVE_SPEC, need, source(MSG_T), context(), ACTOR_A, PROGRAM_ID, page);
conflict = captureNeed(LIVE_SPEC, first.need, source(MSG_T_B), { ...context(), candidateA: first.candidate }, ACTOR_B, PROGRAM_ID, first.workPage);
assert.equal(conflict.code, 'AMBIGUOUS', 'genuine ambiguity (two distinct prints with the same publish_time)');
console.log('MIN-CAPTURE logic: 4 checks passed');
