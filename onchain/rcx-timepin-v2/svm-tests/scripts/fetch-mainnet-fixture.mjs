import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PublicKey } from '@solana/web3.js';

const CLUSTER = 'mainnet-beta';
const DEFAULT_RPC = 'https://api.mainnet-beta.solana.com';
const RECEIVER = new PublicKey('rec2HHDDnjLfj4kE7VyEtFA1HPGQLK33259532cRyHp');
const PUSH = new PublicKey('pyt2F414BA6dPttK6RddPZUdHfapoBN24GL5wbrPCou');
const LOADER_V3 = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
const SOL_FEED = Buffer.from('ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d', 'hex');
const EXPECTED_PRICE = new PublicKey('7AviUf9nL62mcxNbQGKm4nKDQnPjswo6c5MX4D57HmyE');
const CONFIG_DISC = disc('account', 'Config');
const PRICE_DISC = disc('account', 'PriceUpdateV2');
const here = dirname(fileURLToPath(import.meta.url));
const outputDir = join(here, '..', 'fixtures', 'mainnet-2026-09-04');
const rpcUrl = process.env.SOLANA_READONLY_RPC || DEFAULT_RPC;
let rpcId = 0;

function hash(data) { return createHash('sha256').update(data).digest('hex'); }
function disc(kind, name) { return createHash('sha256').update(`${kind}:${name}`).digest().subarray(0, 8); }
function u16(value) { const out = Buffer.alloc(2); out.writeUInt16LE(value); return out; }
function safeRpcLabel(url) {
  const value = new URL(url);
  const publicRpc = new URL(DEFAULT_RPC);
  return value.origin === publicRpc.origin && value.pathname === publicRpc.pathname
    ? DEFAULT_RPC
    : 'custom-readonly-rpc-redacted';
}

async function rpc(method, params = []) {
  const response = await fetch(rpcUrl, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
  });
  if (!response.ok) throw new Error(`${method}: HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

function dataOf(value, name) {
  if (!value || !Array.isArray(value.data) || value.data[1] !== 'base64') {
    throw new Error(`${name}: missing base64 account data`);
  }
  return Buffer.from(value.data[0], 'base64');
}

function programLink(data, name) {
  if (data.length !== 36 || data.readUInt32LE(0) !== 2) {
    throw new Error(`${name}: not an exact Loader-v3 Program account`);
  }
  return new PublicKey(data.subarray(4, 36));
}

function programData(data, name) {
  if (data.length < 45 || data.readUInt32LE(0) !== 3) {
    throw new Error(`${name}: not Loader-v3 ProgramData`);
  }
  const authorityTag = data[12];
  if (authorityTag !== 0 && authorityTag !== 1) throw new Error(`${name}: bad authority Option`);
  return {
    slot: Number(data.readBigUInt64LE(4)),
    authority: authorityTag === 1 ? new PublicKey(data.subarray(13, 45)).toBase58() : null,
  };
}

function receiverConfig(data) {
  if (data.length !== 370 || !data.subarray(0, 8).equals(CONFIG_DISC)) {
    throw new Error('receiver-config: wrong discriminator or allocation');
  }
  let offset = 40;
  const targetTag = data[offset++];
  if (targetTag !== 0 && targetTag !== 1) throw new Error('receiver-config: bad target authority Option');
  if (targetTag === 1) offset += 32;
  const wormhole = new PublicKey(data.subarray(offset, offset + 32)); offset += 32;
  const sourceCount = data.readUInt32LE(offset); offset += 4 + sourceCount * 34;
  if (offset + 9 > data.length) throw new Error('receiver-config: truncated sources');
  return {
    wormhole, sourceCount,
    singleUpdateFeeLamports: data.readBigUInt64LE(offset).toString(),
    minimumSignatures: data[offset + 8],
  };
}

function priceUpdate(data) {
  if (data.length !== 134 || !data.subarray(0, 8).equals(PRICE_DISC)) {
    throw new Error('sol-price-update: wrong discriminator or exact length');
  }
  let o = 8;
  const writeAuthority = new PublicKey(data.subarray(o, o + 32)); o += 32;
  const verificationLevel = data[o++];
  const feedIdHex = data.subarray(o, o + 32).toString('hex'); o += 32;
  const price = data.readBigInt64LE(o); o += 8;
  const confidence = data.readBigUInt64LE(o); o += 8;
  const exponent = data.readInt32LE(o); o += 4;
  const publishTime = data.readBigInt64LE(o); o += 8;
  const prevPublishTime = data.readBigInt64LE(o); o += 8;
  const emaPrice = data.readBigInt64LE(o); o += 8;
  const emaConfidence = data.readBigUInt64LE(o); o += 8;
  const postedSlot = data.readBigUInt64LE(o);
  return {
    writeAuthority: writeAuthority.toBase58(), verificationLevel, feedIdHex,
    price: price.toString(), confidence: confidence.toString(), exponent,
    publishTime: publishTime.toString(), prevPublishTime: prevPublishTime.toString(),
    emaPrice: emaPrice.toString(), emaConfidence: emaConfidence.toString(),
    postedSlot: postedSlot.toString(), trailingPaddingByte: data[133],
  };
}

function checkAccount(value, owner, executable, name) {
  if (!value) throw new Error(`${name}: account missing`);
  if (value.owner !== owner.toBase58()) throw new Error(`${name}: owner ${value.owner}`);
  if (value.executable !== executable) throw new Error(`${name}: executable=${value.executable}`);
}

function record(pubkey, value, data, file, decoded = {}) {
  return {
    pubkey: pubkey.toBase58(), owner: value.owner, executable: value.executable,
    // JSON-RPC encodes rentEpoch as a u64 JSON number, which JavaScript cannot
    // preserve exactly. It is irrelevant to Timepin authentication, so omit it.
    lamports: value.lamports, dataLength: data.length,
    dataSha256: hash(data), dataFile: file, ...decoded,
  };
}

const configAddress = PublicKey.findProgramAddressSync([Buffer.from('config')], RECEIVER)[0];
if (configAddress.toBase58() !== 'H3R4M45f2gyqp6geVUruapzZdyxpgGZ96UnWkDM3ndye') {
  throw new Error('canonical config PDA changed');
}
const discovery = await rpc('getAccountInfo', [configAddress.toBase58(), { encoding: 'base64', commitment: 'finalized' }]);
const wormhole = receiverConfig(dataOf(discovery.value, 'receiver-config discovery')).wormhole;
const receiverPd = PublicKey.findProgramAddressSync([RECEIVER.toBuffer()], LOADER_V3)[0];
const wormholePd = PublicKey.findProgramAddressSync([wormhole.toBuffer()], LOADER_V3)[0];
const priceAddress = PublicKey.findProgramAddressSync([u16(0), SOL_FEED], PUSH)[0];
if (!priceAddress.equals(EXPECTED_PRICE)) throw new Error('canonical SOL sponsored PDA changed');

const keys = [RECEIVER, receiverPd, configAddress, wormhole, wormholePd, priceAddress];
const [genesisHash, snapshot] = await Promise.all([
  rpc('getGenesisHash'),
  rpc('getMultipleAccounts', [keys.map((key) => key.toBase58()), {
    encoding: 'base64', commitment: 'finalized', minContextSlot: discovery.context.slot,
  }]),
]);
if (!snapshot.value || snapshot.value.length !== keys.length) throw new Error('incomplete account snapshot');
const [receiverValue, receiverPdValue, configValue, wormholeValue, wormholePdValue, priceValue] = snapshot.value;
checkAccount(receiverValue, LOADER_V3, true, 'receiver-program');
checkAccount(receiverPdValue, LOADER_V3, false, 'receiver-programdata');
checkAccount(configValue, RECEIVER, false, 'receiver-config');
checkAccount(wormholeValue, LOADER_V3, true, 'wormhole-program');
checkAccount(wormholePdValue, LOADER_V3, false, 'wormhole-programdata');
checkAccount(priceValue, RECEIVER, false, 'sol-price-update');

const receiverBytes = dataOf(receiverValue, 'receiver-program');
const receiverPdBytes = dataOf(receiverPdValue, 'receiver-programdata');
const configBytes = dataOf(configValue, 'receiver-config');
const wormholeBytes = dataOf(wormholeValue, 'wormhole-program');
const wormholePdBytes = dataOf(wormholePdValue, 'wormhole-programdata');
const priceBytes = dataOf(priceValue, 'sol-price-update');
const receiverGeneration = programData(receiverPdBytes, 'receiver-programdata');
const wormholeGeneration = programData(wormholePdBytes, 'wormhole-programdata');
const finalConfig = receiverConfig(configBytes);
const price = priceUpdate(priceBytes);
if (!programLink(receiverBytes, 'receiver-program').equals(receiverPd)) throw new Error('receiver ProgramData link');
if (!programLink(wormholeBytes, 'wormhole-program').equals(wormholePd)) throw new Error('wormhole ProgramData link');
if (!finalConfig.wormhole.equals(wormhole)) throw new Error('config changed during snapshot');
if (price.feedIdHex !== SOL_FEED.toString('hex') || price.verificationLevel !== 1) {
  throw new Error('SOL PriceUpdate is not Full for the expected feed');
}
if (BigInt(price.postedSlot) <= BigInt(Math.max(receiverGeneration.slot, wormholeGeneration.slot))) {
  throw new Error('PriceUpdate is not newer than both selected generations');
}

await mkdir(outputDir, { recursive: true });
const files = [
  ['receiver-program.bin', receiverBytes], ['receiver-programdata.bin', receiverPdBytes],
  ['receiver-config.bin', configBytes], ['wormhole-program.bin', wormholeBytes],
  ['wormhole-programdata.bin', wormholePdBytes], ['sol-price-update.bin', priceBytes],
];
for (const [name, data] of files) await writeFile(join(outputDir, name), data);
const provenance = {
  schemaVersion: 1,
  fixture: 'Pyth Receiver generation plus sponsored SOL PriceUpdate',
  cluster: CLUSTER, genesisHash, commitment: 'finalized', contextSlot: snapshot.context.slot,
  fetchedAtUtc: new Date().toISOString(), rpc: safeRpcLabel(rpcUrl),
  warning: 'Public mainnet snapshot. It proves exact bytes at the recorded RPC context, not historical availability at an earlier simulated registration slot.',
  officialPrograms: { receiver: RECEIVER.toBase58(), pushOracle: PUSH.toBase58() },
  configuredWormhole: wormhole.toBase58(), shardId: 0, feedIdHex: SOL_FEED.toString('hex'),
  accounts: {
    receiverProgram: record(RECEIVER, receiverValue, receiverBytes, 'receiver-program.bin', { programData: receiverPd.toBase58() }),
    receiverProgramData: record(receiverPd, receiverPdValue, receiverPdBytes, 'receiver-programdata.bin', receiverGeneration),
    receiverConfig: record(configAddress, configValue, configBytes, 'receiver-config.bin', {
      configuredWormhole: finalConfig.wormhole.toBase58(), sourceCount: finalConfig.sourceCount,
      singleUpdateFeeLamports: finalConfig.singleUpdateFeeLamports, minimumSignatures: finalConfig.minimumSignatures,
    }),
    wormholeProgram: record(wormhole, wormholeValue, wormholeBytes, 'wormhole-program.bin', { programData: wormholePd.toBase58() }),
    wormholeProgramData: record(wormholePd, wormholePdValue, wormholePdBytes, 'wormhole-programdata.bin', wormholeGeneration),
    solPriceUpdate: record(priceAddress, priceValue, priceBytes, 'sol-price-update.bin', price),
  },
};
await writeFile(join(outputDir, 'provenance.json'), `${JSON.stringify(provenance, null, 2)}\n`);
console.log(JSON.stringify({
  outputDir, cluster: CLUSTER, contextSlot: provenance.contextSlot,
  receiverGenerationSlot: receiverGeneration.slot, wormhole: wormhole.toBase58(),
  wormholeGenerationSlot: wormholeGeneration.slot, pricePostedSlot: price.postedSlot,
  pricePublishTime: price.publishTime,
  accountHashes: Object.fromEntries(Object.entries(provenance.accounts).map(([key, value]) => [key, value.dataSha256])),
}, null, 2));
