#!/usr/bin/env node
// Read-only proof that the live Pythnet AccumulatorState ring exposes every
// Merkle leaf needed to reconstruct a guardian-signed accumulator root.
import { PublicKey, SystemProgram } from '@solana/web3.js';
import { keccak_256 } from '@noble/hashes/sha3';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const {
  parseAccumulatorUpdateData,
  parsePriceFeedMessage,
} = require('../../../.scratch/replay-devnet/node_modules/@pythnetwork/price-service-sdk');

const RPC = process.argv[2] || 'https://pythnet.rpcpool.com';
const EMITTER = 'e101faedac5851e32b9b23b5f9411a8c2bac4aae3ed4dd7b811dd1a72ea4aa71';
const FEEDS = new Set([
  'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d',
  'e62df6c8b4a85fe1a67bf1c7a63eaa995f240c96b917f7a9b73af1f5d9e05b43',
  'ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
]);

async function rpc(method, params) {
  const response = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(60_000),
  });
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

function hash160(...parts) {
  return Buffer.from(keccak_256(Buffer.concat(parts))).subarray(0, 20);
}

function merkleTree(messages) {
  let width = 1;
  while (width < messages.length) width *= 2;
  const nodes = new Array(width * 2);
  const nullHash = hash160(Buffer.from([2]));
  for (let i = 0; i < width; i++) {
    nodes[width + i] = i < messages.length
      ? hash160(Buffer.from([0]), messages[i])
      : nullHash;
  }
  for (let i = width - 1; i > 0; i--) {
    const left = nodes[i * 2];
    const right = nodes[i * 2 + 1];
    nodes[i] = Buffer.compare(left, right) <= 0
      ? hash160(Buffer.from([1]), left, right)
      : hash160(Buffer.from([1]), right, left);
  }
  return { root: nodes[1], nodes, width };
}

function merklePath(tree, leafIndex) {
  let index = tree.width + leafIndex;
  const path = [];
  while (index > 1) {
    path.push(tree.nodes[index ^ 1]);
    index = Math.floor(index / 2);
  }
  return path;
}

function u16be(value) {
  const out = Buffer.alloc(2);
  out.writeUInt16BE(value);
  return out;
}

function accumulatorUpdateData(vaa, message, proof) {
  if (vaa.length > 65_535 || message.length > 65_535 || proof.length > 255) {
    throw new Error('wire length exceeds Pyth v1 prefix');
  }
  return Buffer.concat([
    Buffer.from('PNAU'),
    Buffer.from([1, 0, 0, 0]), // major, minor, empty trailing Vec, WormholeMerkle variant
    u16be(vaa.length),
    vaa,
    Buffer.from([1]), // one MerklePriceUpdate
    u16be(message.length),
    message,
    Buffer.from([proof.length]),
    ...proof,
  ]);
}

function parseAccumulator(data) {
  if (data.length < 20 || data.subarray(0, 4).toString('ascii') !== 'PAS1') return null;
  const slot = Number(data.readBigUInt64LE(4));
  const ringSize = data.readUInt32LE(12);
  const count = data.readUInt32LE(16);
  const messages = [];
  let offset = 20;
  for (let i = 0; i < count; i++) {
    if (offset + 4 > data.length) throw new Error('truncated raw_messages length');
    const length = data.readUInt32LE(offset);
    offset += 4;
    if (offset + length > data.length) throw new Error('truncated raw_message');
    messages.push(data.subarray(offset, offset + length));
    offset += length;
  }
  return { slot, ringSize, count, messages, trailingBytes: data.length - offset };
}

function parseVaa(base64) {
  const vaa = Buffer.from(base64, 'base64');
  const signatures = vaa[5];
  const bodyOffset = 6 + signatures * 66;
  const payloadOffset = bodyOffset + 4 + 4 + 2 + 32 + 8 + 1;
  const payload = vaa.subarray(payloadOffset);
  if (payload.length < 37 || payload.subarray(0, 4).toString('ascii') !== 'AUWV') return null;
  return {
    vaa,
    signatures,
    slot: Number(payload.readBigUInt64BE(5)),
    ringSize: payload.readUInt32BE(13),
    root: payload.subarray(17, 37),
  };
}

function accumulatorAddress(slot, ringSize) {
  const index = slot % ringSize;
  const seed = Buffer.alloc(4);
  seed.writeUInt32BE(index);
  const [address] = PublicKey.findProgramAddressSync(
    [Buffer.from('AccumulatorState'), seed],
    SystemProgram.programId,
  );
  return { index, address };
}

const listResponse = await fetch(
  `https://api.wormholescan.io/api/v1/vaas/26/${EMITTER}?pageSize=100&page=0`,
  { signal: AbortSignal.timeout(60_000) },
);
const list = await listResponse.json();
const roots = (list.data || [])
  .map((row) => ({ sequence: row.sequence, ...parseVaa(row.vaa) }))
  .filter((row) => Number.isSafeInteger(row.slot) && row.ringSize > 0);
if (!roots.length) throw new Error('no accumulator VAAs returned');

const unique = [];
const seen = new Set();
for (const root of roots) {
  const { index, address } = accumulatorAddress(root.slot, root.ringSize);
  const key = address.toBase58();
  if (!seen.has(key)) {
    unique.push({ ...root, index, address: key });
    seen.add(key);
  }
}

let match = null;
for (let start = 0; start < unique.length && !match; start += 100) {
  const batch = unique.slice(start, start + 100);
  const result = await rpc('getMultipleAccounts', [
    batch.map((row) => row.address),
    { encoding: 'base64', commitment: 'confirmed' },
  ]);
  for (let i = 0; i < batch.length; i++) {
    const account = result.value[i];
    if (!account) continue;
    const parsed = parseAccumulator(Buffer.from(account.data[0], 'base64'));
    if (!parsed || parsed.slot !== batch[i].slot) continue;
    const tree = merkleTree(parsed.messages);
    if (!tree.root.equals(batch[i].root)) continue;
    const requestedFeeds = parsed.messages
      .map((message, leafIndex) => ({ message, leafIndex }))
      .filter(({ message }) => message.length >= 33 && message[0] === 0)
      .map(({ message, leafIndex }) => ({ leafIndex, feedId: message.subarray(1, 33).toString('hex') }))
      .filter((row) => FEEDS.has(row.feedId));
    const reconstructed = requestedFeeds.map(({ leafIndex, feedId }) => {
      const proof = merklePath(tree, leafIndex);
      const update = accumulatorUpdateData(batch[i].vaa, parsed.messages[leafIndex], proof);
      const official = parseAccumulatorUpdateData(update);
      const price = parsePriceFeedMessage(official.updates[0].message);
      return {
        leafIndex,
        feedId,
        messageLength: parsed.messages[leafIndex].length,
        proofDepth: proof.length,
        proofHex: proof.map((hash) => hash.toString('hex')),
        accumulatorUpdateLength: update.length,
        accumulatorUpdateBase64: update.toString('base64'),
        officialParser: {
          vaaMatches: official.vaa.equals(batch[i].vaa),
          updates: official.updates.length,
          proofDepth: official.updates[0].proof.length,
          feedId: price.feedId.toString('hex'),
          publishTime: price.publishTime.toString(10),
          prevPublishTime: price.prevPublishTime.toString(10),
        },
      };
    });
    match = {
      rpc: RPC,
      contextSlot: result.context.slot,
      sequence: batch[i].sequence,
      pythnetSlot: parsed.slot,
      ringSize: parsed.ringSize,
      ringIndex: batch[i].index,
      account: batch[i].address,
      owner: account.owner,
      dataLength: Buffer.from(account.data[0], 'base64').length,
      rawMessages: parsed.count,
      trailingBytes: parsed.trailingBytes,
      signedRoot: batch[i].root.toString('hex'),
      computedRoot: tree.root.toString('hex'),
      requestedFeeds,
      reconstructed,
    };
  }
}

const report = { checkedVaas: roots.length, checkedAccounts: unique.length, match };
const outIndex = process.argv.indexOf('--out-dir');
if (match && outIndex >= 0) {
  const outDir = process.argv[outIndex + 1];
  if (!outDir) throw new Error('--out-dir requires a path');
  mkdirSync(outDir, { recursive: true });
  const first = match.reconstructed[0];
  writeFileSync(join(outDir, 'price-update.pnau'), Buffer.from(first.accumulatorUpdateBase64, 'base64'));
  writeFileSync(join(outDir, 'receipt.json'), `${JSON.stringify(report, null, 2)}\n`);
}
console.log(JSON.stringify(report, null, 2));
if (!match) process.exitCode = 1;
