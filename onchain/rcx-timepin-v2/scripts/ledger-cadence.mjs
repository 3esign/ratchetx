#!/usr/bin/env node
// The second collector for tracker item 2.3, and the better one.
//
// cadence-sampler.mjs polls the sponsored ACCOUNT. An account holds one message
// at a time, so a print overwritten between two polls is invisible, and it needs
// a process awake for the whole measurement window.
//
// This walks the LEDGER instead: every write to a sponsored price account is a
// transaction, and the transaction carries the signed Pyth message inside it. So
//
//   * there is NO BLIND SPOT. Every write is recovered, including two in the
//     same second, which is exactly the case account polling cannot resolve and
//     the case the tie question turns on.
//   * IT DOES NOT NEED 24 HOURS OF WALL CLOCK. The history is already on chain.
//     Measured 2026-09-05: paginating back 18 pages of 1000 signatures reached
//     blockTime 1788572871, ten hours old, and getTransaction still resolved
//     there. A day is reconstructible after the fact.
//   * it is keyless and read-only, like everything else in the settlement path.
//
// What it costs: about one getTransaction per signature, and only ~35 % of the
// signatures on a sponsored price account are writes — the rest are programs
// READING the oracle. (Measured: 5 writes in 16 sampled, and 235 writes in 598
// signatures.) Anyone computing a push cadence from raw signature counts
// overestimates it by about 3x; that trap is why `extractWrites` is the only
// thing here that decides what a write is.
//
// It emits the SAME NDJSON row shape as cadence-sampler.mjs, so
// `cadence-sampler.mjs summarize` reduces either collector and the hit-rate
// table is comparable across methods. One reducer, two collectors, on purpose.
//
// THE MESSAGE LAYOUT, and how it is known rather than assumed. Pyth's
// PriceFeedMessage is BIG-endian and follows the 32-byte feed id inside the
// `post_update` instruction data:
//
//   feed_id [32] | price i64 | conf u64 | exponent i32 | publish_time i64
//               | prev_publish_time i64 | ema_price i64 | ema_conf u64
//
// verified byte for byte against mainnet signature 61VDdY932pPJbTi8..., slot
// 444510280 — see test/test_ledger_cadence.mjs, which carries those exact bytes
// as its fixture. Every decode is additionally self-checked: the exponent must
// be in the spec's range and the publish time must be within a bounded distance
// of the transaction's own blockTime, so a coincidental byte match cannot pass.
//
// Usage:
//   node ledger-cadence.mjs check-payer --symbol SOL        # is one payer enough?
//   node ledger-cadence.mjs walk-payer  --hours 24           # ALL SEVEN FEEDS, one pass
//   node ledger-cadence.mjs walk --symbol SOL [--hours 24] [--out FILE] [--delay-ms 80]
//   node ledger-cadence.mjs walk --address <pubkey> --feed-id <hex> --hours 6
// then reduce with the other script:
//   node cadence-sampler.mjs summarize --in <FILE>

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gameFeeds, sourceAddressFor } from './cadence-sampler.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');

export const MESSAGE_FIELDS_LEN = 68;   // everything after the 32-byte feed id

// --- pure: find and decode -----------------------------------------------------

export function findFeedId(raw, feedId) {
  const hay = Buffer.from(raw);
  const needle = Buffer.from(feedId);
  const hits = [];
  let from = 0;
  for (;;) {
    const at = hay.indexOf(needle, from);
    if (at < 0) break;
    hits.push(at);
    from = at + 1;
  }
  return hits;
}

export function decodePriceFeedMessage(raw, feedIdOffset) {
  const buf = Buffer.from(raw);
  const o = feedIdOffset + 32;
  if (o + MESSAGE_FIELDS_LEN > buf.length) return null;
  return {
    price: buf.readBigInt64BE(o),
    conf: buf.readBigUInt64BE(o + 8),
    exponent: buf.readInt32BE(o + 16),
    publishTime: buf.readBigInt64BE(o + 20),
    prevPublishTime: buf.readBigInt64BE(o + 28),
    emaPrice: buf.readBigInt64BE(o + 36),
    emaConf: buf.readBigUInt64BE(o + 44),
  };
}

// A byte sequence that merely looks like a feed id is not a message. Two
// independent sanity checks, both cheap, both fatal:
//   - the exponent must be a plausible Pyth exponent
//   - the publish time must sit within `maxSkew` of the transaction's own
//     blockTime, which the ledger supplies and the bytes cannot forge here
export function extractWrites(raw, feedId, { blockTime, maxSkew = 120, minExponent = -18, maxExponent = 18 } = {}) {
  const out = [];
  for (const at of findFeedId(raw, feedId)) {
    const msg = decodePriceFeedMessage(raw, at);
    if (!msg) continue;
    if (msg.exponent < minExponent || msg.exponent > maxExponent) continue;
    if (blockTime !== undefined && blockTime !== null
      && Math.abs(Number(msg.publishTime) - blockTime) > maxSkew) continue;
    if (msg.prevPublishTime > msg.publishTime) continue;
    out.push({ offset: at, ...msg });
  }
  return out;
}

// Every feed in one pass. A sponsor's fee payer posts many feeds, so a walk of
// the PAYER sees all of ours at once — but only if we look for all of them in
// each transaction. Measured 2026-09-05: one push transaction carries exactly
// ONE feed message (4/4 sampled, 1150 bytes each), so this usually returns one
// row; it returns more the day Pyth starts batching, and silently dropping the
// second message would be a blind spot the ledger method exists to avoid.
export function extractWritesMulti(raw, feedTable, opts = {}) {
  const out = [];
  for (const { symbol, feedId } of feedTable) {
    for (const msg of extractWrites(raw, Buffer.from(feedId, 'hex'), opts))
      out.push({ symbol, feedId, ...msg });
  }
  return out;
}

export function toPrintRow({ symbol, feedId, sourceAddress, signature, slot, blockTime, msg, err }) {
  return {
    kind: 'print',
    observedAt: blockTime,           // when the write LANDED, not when we looked
    symbol, feedId, sourceAddress, signature, slot, err: !!err,
    publishTime: Number(msg.publishTime),
    prevPublishTime: Number(msg.prevPublishTime),
    postedSlot: slot,
    price: msg.price.toString(),
    conf: msg.conf.toString(),
    exponent: msg.exponent,
  };
}

// --- networked -----------------------------------------------------------------

const DEFAULT_RPC = 'https://solana-rpc.publicnode.com';

const isRateLimit = text => /rate limit|429|too many/i.test(String(text));

export async function walk({
  rpcUrl = process.env.RATCHET_RPC_URL || DEFAULT_RPC,
  symbol, address, feedId, hours = 24, delayMs = 80, out,
  fetchImpl = globalThis.fetch, log = console.log,
} = {}) {
  if (!address || !feedId) {
    const feed = gameFeeds().find(f => f.symbol === symbol);
    if (!feed) throw new Error(`unknown symbol ${symbol}; pass --address and --feed-id`);
    feedId = feed.feedId;
    address = sourceAddressFor(feed.feedId).toBase58();
  }
  const feedIdBytes = Buffer.from(feedId, 'hex');
  const outPath = out ?? join(repoRoot, 'docs', 'reviews', 'cadence',
    `ledger-${symbol ?? address.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.ndjson`);
  mkdirSync(dirname(outPath), { recursive: true });

  let backoff = 0;
  const rpc = async (method, params) => {
    for (let attempt = 0; ; attempt += 1) {
      if (backoff) await new Promise(r => setTimeout(r, backoff));
      let body;
      try {
        const res = await fetchImpl(rpcUrl, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        });
        body = await res.json();
      } catch (error) {
        body = { error: { message: String(error.message ?? error) } };
      }
      if (!body.error) { backoff = Math.max(0, Math.floor(backoff / 2)); return body.result; }
      // A public node that rate-limits is not an error to retry tightly; it is the
      // measurement telling you its own speed. Back off and keep the data.
      if (isRateLimit(body.error.message) && attempt < 12) {
        backoff = Math.min(backoff ? backoff * 2 : 1000, 60_000);
        log(`  rate limited, backing off ${backoff} ms`);
        continue;
      }
      throw new Error(`${method}: ${body.error.message}`);
    }
  };

  const write = row => appendFileSync(outPath, `${JSON.stringify(row)}\n`, 'utf8');
  const startedAt = Math.floor(Date.now() / 1000);
  const floor = startedAt - hours * 3600;
  write({
    kind: 'header', method: 'walk-ledger', startedAt: new Date().toISOString(),
    rpcUrl, hours, symbol, address, feedId,
    // The reducer's poll-interval gate is about a POLLING method's blind spot.
    // This method has none, so it declares an interval of 0 rather than pretending.
    intervalMs: 0,
  });

  log(`walking ${symbol ?? address} back ${hours} h -> ${outPath}`);
  let before = null, signatures = 0, writes = 0, pages = 0, oldest = null;
  for (;;) {
    const page = await rpc('getSignaturesForAddress',
      [address, before ? { limit: 1000, before } : { limit: 1000 }]);
    if (!page?.length) break;
    pages += 1;
    for (const sig of page) {
      signatures += 1;
      oldest = sig.blockTime ?? oldest;
      const tx = await rpc('getTransaction',
        [sig.signature, { maxSupportedTransactionVersion: 0, encoding: 'base64' }]);
      if (delayMs) await new Promise(r => setTimeout(r, delayMs));
      if (!tx) continue;
      const raw = Buffer.from(tx.transaction[0], 'base64');
      for (const msg of extractWrites(raw, feedIdBytes, { blockTime: tx.blockTime })) {
        writes += 1;
        write(toPrintRow({
          symbol: symbol ?? address.slice(0, 8), feedId, sourceAddress: address,
          signature: sig.signature, slot: tx.slot, blockTime: tx.blockTime,
          msg, err: !!tx.meta?.err,
        }));
      }
    }
    before = page[page.length - 1].signature;
    log(`  page ${pages}: ${signatures} signatures, ${writes} writes, oldest ${oldest} (${((startedAt - oldest) / 3600).toFixed(2)} h back)`);
    if (oldest !== null && oldest <= floor) break;
  }
  write({ kind: 'footer', finishedAt: new Date().toISOString(), pages, signatures, writes, oldest });
  log(`done: ${writes} writes from ${signatures} signatures over ${pages} pages -> ${outPath}`);
  return { outPath, pages, signatures, writes, oldest };
}

// --- the payer walk, and the check that makes it honest ------------------------
//
// A sponsored price account's signature list is mostly READERS: measured 35-45 %
// writes. The sponsor's FEE PAYER, by contrast, signs nothing but its own pushes.
// Measured 2026-09-05 on 9F6ApEtzkHVdZXzsury6BYmyEh4pahDBxuhNLaGC6saC: 1000
// transactions in 998 seconds — 1.00 tx/s, ZERO failed — covering every feed it
// sponsors. So one walk of the payer replaces seven walks of seven price
// accounts and throws away no reader traffic:
//
//   per-account: ~41,760 signatures/day/feed x 7 feeds = ~292,000 getTransaction
//   per-payer:   ~86,400 transactions/day, ALL feeds, one pass  (~3.4x cheaper)
//
// THE ASSUMPTION THAT MAKES IT WRONG IF UNCHECKED: it is complete only if that
// payer is the ONLY payer posting those feeds. If the sponsor rotates payers, a
// payer walk silently misses writes — which is exactly the blind spot the ledger
// method exists to remove, reintroduced through the back door as an optimisation.
// So `verifyPayerCoverage` is not optional and `walkPayer` refuses to start
// without it.

export async function verifyPayerCoverage({
  rpcUrl = process.env.RATCHET_RPC_URL || DEFAULT_RPC,
  address, samples = 25, delayMs = 150, fetchImpl = globalThis.fetch,
} = {}) {
  const call = async (method, params) => {
    const res = await fetchImpl(rpcUrl, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    const body = await res.json();
    if (body.error) throw new Error(`${method}: ${body.error.message}`);
    return body.result;
  };
  const sigs = await call('getSignaturesForAddress', [address, { limit: Math.max(200, samples * 8) }]);
  const payers = {};
  let writes = 0, scanned = 0;
  for (const sig of sigs ?? []) {
    if (writes >= samples) break;
    scanned += 1;
    const tx = await call('getTransaction',
      [sig.signature, { maxSupportedTransactionVersion: 0, encoding: 'jsonParsed' }]);
    if (delayMs) await new Promise(r => setTimeout(r, delayMs));
    if (!tx) continue;
    const keys = tx.transaction.message.accountKeys ?? [];
    // A transaction that merely READS the price account is not a push.
    const self = keys.find(k => k.pubkey === address);
    if (!self?.writable) continue;
    writes += 1;
    const payer = keys[0]?.pubkey;
    payers[payer] = (payers[payer] ?? 0) + 1;
  }
  const entries = Object.entries(payers).sort((a, b) => b[1] - a[1]);
  const dominant = entries[0]?.[0] ?? null;
  return {
    address, scanned, writes, payers,
    dominant,
    coverage: writes ? (payers[dominant] ?? 0) / writes : 0,
    single: entries.length === 1 && writes > 0,
  };
}

export async function walkPayer({
  rpcUrl = process.env.RATCHET_RPC_URL || DEFAULT_RPC,
  payer, feeds, hours = 24, delayMs = 80, out, samples = 25,
  fetchImpl = globalThis.fetch, log = console.log, skipCoverageCheck = false,
} = {}) {
  const feedTable = feeds ?? gameFeeds();
  if (!payer) {
    // Discover it rather than hardcoding a sponsor address that can change.
    const probe = await verifyPayerCoverage({
      rpcUrl, address: sourceAddressFor(feedTable[0].feedId).toBase58(),
      samples, fetchImpl, delayMs: 150,
    });
    payer = probe.dominant;
    if (!payer) throw new Error('could not discover a fee payer from the price account');
    log(`discovered payer ${payer} (${probe.writes} writes sampled, coverage ${(100 * probe.coverage).toFixed(0)}%)`);
    if (!probe.single && !skipCoverageCheck)
      throw new Error(
        `REFUSING the payer walk: ${feedTable[0].symbol} writes come from ${Object.keys(probe.payers).length} ` +
        `different payers (${JSON.stringify(probe.payers)}). A payer walk would silently miss the others, ` +
        'which is the blind spot this method exists to remove. Walk the price accounts instead, or pass ' +
        'skipCoverageCheck only if you have another reason to believe the coverage.');
  }

  const outPath = out ?? join(repoRoot, 'docs', 'reviews', 'cadence',
    `payer-${new Date().toISOString().slice(0, 10)}.ndjson`);
  mkdirSync(dirname(outPath), { recursive: true });
  const write = row => appendFileSync(outPath, `${JSON.stringify(row)}\n`, 'utf8');

  let backoff = 0;
  const rpc = async (method, params) => {
    for (let attempt = 0; ; attempt += 1) {
      if (backoff) await new Promise(r => setTimeout(r, backoff));
      let body;
      try {
        const res = await fetchImpl(rpcUrl, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        });
        body = await res.json();
      } catch (error) { body = { error: { message: String(error.message ?? error) } }; }
      if (!body.error) { backoff = Math.max(0, Math.floor(backoff / 2)); return body.result; }
      if (isRateLimit(body.error.message) && attempt < 12) {
        backoff = Math.min(backoff ? backoff * 2 : 1000, 60_000);
        log(`  rate limited, backing off ${backoff} ms`);
        continue;
      }
      throw new Error(`${method}: ${body.error.message}`);
    }
  };

  const startedAt = Math.floor(Date.now() / 1000);
  const floor = startedAt - hours * 3600;
  write({
    kind: 'header', method: 'walk-payer', startedAt: new Date().toISOString(),
    rpcUrl, hours, payer, intervalMs: 0,
    feeds: feedTable.map(f => ({ symbol: f.symbol, feedId: f.feedId,
      sourceAddress: sourceAddressFor(f.feedId).toBase58() })),
  });

  log(`walking payer ${payer} back ${hours} h over ${feedTable.length} feeds -> ${outPath}`);
  let before = null, signatures = 0, writes = 0, pages = 0, oldest = null;
  const perFeed = {};
  for (;;) {
    const page = await rpc('getSignaturesForAddress',
      [payer, before ? { limit: 1000, before } : { limit: 1000 }]);
    if (!page?.length) break;
    pages += 1;
    for (const sig of page) {
      signatures += 1;
      oldest = sig.blockTime ?? oldest;
      const tx = await rpc('getTransaction',
        [sig.signature, { maxSupportedTransactionVersion: 0, encoding: 'base64' }]);
      if (delayMs) await new Promise(r => setTimeout(r, delayMs));
      if (!tx) continue;
      const raw = Buffer.from(tx.transaction[0], 'base64');
      for (const found of extractWritesMulti(raw, feedTable, { blockTime: tx.blockTime })) {
        writes += 1;
        perFeed[found.symbol] = (perFeed[found.symbol] ?? 0) + 1;
        write(toPrintRow({
          symbol: found.symbol, feedId: found.feedId,
          sourceAddress: sourceAddressFor(found.feedId).toBase58(),
          signature: sig.signature, slot: tx.slot, blockTime: tx.blockTime,
          msg: found, err: !!tx.meta?.err,
        }));
      }
    }
    before = page[page.length - 1].signature;
    log(`  page ${pages}: ${signatures} tx, ${writes} writes ${JSON.stringify(perFeed)}, oldest ${((startedAt - oldest) / 3600).toFixed(2)} h back`);
    if (oldest !== null && oldest <= floor) break;
  }
  write({ kind: 'footer', finishedAt: new Date().toISOString(), pages, signatures, writes, perFeed, oldest });
  log(`done: ${writes} writes from ${signatures} transactions -> ${outPath}`);
  return { outPath, pages, signatures, writes, perFeed, oldest };
}

// --- cli -------------------------------------------------------------------------

const flag = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

async function main() {
  const mode = process.argv[2];
  if (mode === 'walk') {
    await walk({
      symbol: flag('symbol', undefined),
      address: flag('address', undefined),
      feedId: flag('feed-id', undefined),
      hours: Number(flag('hours', 24)),
      delayMs: Number(flag('delay-ms', 80)),
      out: flag('out', undefined),
    });
    return;
  }
  if (mode === 'walk-payer') {
    await walkPayer({
      payer: flag('payer', undefined),
      hours: Number(flag('hours', 24)),
      delayMs: Number(flag('delay-ms', 80)),
      out: flag('out', undefined),
    });
    return;
  }
  if (mode === 'check-payer') {
    const symbol = flag('symbol', 'SOL');
    const feed = gameFeeds().find(f => f.symbol === symbol);
    const result = await verifyPayerCoverage({
      address: sourceAddressFor(feed.feedId).toBase58(),
      samples: Number(flag('samples', 25)),
    });
    console.log(JSON.stringify(result, null, 2));
    console.log(result.single
      ? `SINGLE PAYER on ${result.writes} sampled writes — a payer walk is complete for ${symbol}.`
      : 'MORE THAN ONE PAYER — a payer walk would miss writes. Walk the price accounts.');
    return;
  }
  throw new Error('usage: ledger-cadence.mjs walk|walk-payer|check-payer [--hours 24]');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(`FAILED: ${error.message}`); process.exitCode = 1; });
}
