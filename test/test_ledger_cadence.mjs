// Proves the ledger collector offline, on REAL mainnet bytes.
//
// The fixture below is not synthetic and not a fabricated account: it is the
// 104 bytes surrounding the Pyth feed id inside mainnet transaction
// 61VDdY932pPJbTi8..., slot 444510280, blockTime 1788608448, a genuine
// sponsored write to 7AviUf9nL62mcxNbQGKm4nKDQnPjswo6c5MX4D57HmyE. It was read
// with getTransaction encoding=base64 through a keyless public RPC on
// 2026-09-05 and the values it decodes to were cross-checked, before this file
// existed, against the same feed's live account decoded by the model's
// decodePriceUpdateV2. Two independent paths, one answer.
//
// That matters because AGENT_ONBOARD.md forbids citing an exact-SBF test whose
// price account was fabricated with set_account. This is the opposite shape: a
// host-tier test standing on bytes a validator actually accepted.
//
// Evidence tier: host for the decoder; the fixture itself is mainnet.

import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  findFeedId, decodePriceFeedMessage, extractWrites, toPrintRow, walk,
} from '../onchain/rcx-timepin-v2/scripts/ledger-cadence.mjs';
import { summarize } from '../onchain/rcx-timepin-v2/scripts/cadence-sampler.mjs';

let checks = 0;
const check = (fn, label) => { fn(); checks += 1; };

const SOL_FEED_ID = Buffer.from(
  'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d', 'hex');

// 4 bytes of the enclosing instruction, then feed id, then the message, then the
// first bytes of what follows it in the real transaction.
const FIXTURE = Buffer.from(
  '00000000' +
  'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d' +
  '0000000261b15411' +   // price   i64 BE = 10228945937
  '0000000000106269' +   // conf    u64 BE = 1073769
  'fffffff8' +           // expo    i32 BE = -8
  '000000006a9bffbf' +   // publish i64 BE = 1788608447
  '000000006a9bffbe' +   // prev    i64 BE = 1788608446
  '00000002629b8e8a' +   // ema price
  '00000000000ecf27' +   // ema conf
  '0c0000005d2319c4d076d14e5ea0c740', 'hex');

const FIXTURE_BLOCK_TIME = 1788608448;

check(() => {
  const hits = findFeedId(FIXTURE, SOL_FEED_ID);
  assert.deepEqual(hits, [4], 'the feed id sits four bytes in');
  assert.deepEqual(findFeedId(FIXTURE, Buffer.alloc(32, 7)), [], 'a feed that is not there is not found');
}, 'findFeedId');

check(() => {
  const m = decodePriceFeedMessage(FIXTURE, 4);
  assert.equal(m.price, 10228945937n, 'price, big-endian i64');
  assert.equal(m.conf, 1073769n, 'conf');
  assert.equal(m.exponent, -8, 'exponent');
  assert.equal(m.publishTime, 1788608447n, 'publish_time');
  assert.equal(m.prevPublishTime, 1788608446n, 'prev_publish_time');
  assert.equal(m.publishTime - m.prevPublishTime, 1n,
    'publish - prev = 1, the shape measured across 235 consecutive writes');
  assert.equal(Number(m.price) * 10 ** m.exponent, 102.28945937, 'SOL at $102.29');
  assert.equal(decodePriceFeedMessage(FIXTURE, FIXTURE.length - 10), null,
    'a truncated message decodes to nothing rather than to garbage');
}, 'decodePriceFeedMessage against mainnet bytes');

check(() => {
  // The endianness is the whole risk here: the same bytes read little-endian
  // give a publish time in the year 5 billion, and a decoder that silently did
  // that would produce a plausible-looking lag table made of nonsense.
  const wrong = FIXTURE.readBigInt64LE(4 + 32 + 20);
  assert.notEqual(wrong, 1788608447n, 'little-endian is a different number');
  assert.ok(Math.abs(Number(wrong)) > 1e18,
    'and an obviously impossible one — a timestamp 145 billion years wide of the block');
}, 'big-endian is not an accident');

check(() => {
  const found = extractWrites(FIXTURE, SOL_FEED_ID, { blockTime: FIXTURE_BLOCK_TIME });
  assert.equal(found.length, 1, 'one message in this transaction');
  assert.equal(found[0].publishTime, 1788608447n);
  assert.equal(FIXTURE_BLOCK_TIME - Number(found[0].publishTime), 1,
    'it landed one second after it was published');
}, 'extractWrites accepts a real write');

check(() => {
  // A read-only transaction mentions the price ACCOUNT, never the feed id, which
  // is why the feed id is the write filter. But a coincidental 32-byte match must
  // still not become a data point, so both guards are tested by defeating them.
  assert.equal(
    extractWrites(FIXTURE, SOL_FEED_ID, { blockTime: FIXTURE_BLOCK_TIME + 3600 }).length, 0,
    'a publish time an hour from the block that carried it is rejected');
  const badExponent = Buffer.from(FIXTURE);
  badExponent.writeInt32BE(99, 4 + 32 + 16);
  assert.equal(extractWrites(badExponent, SOL_FEED_ID, { blockTime: FIXTURE_BLOCK_TIME }).length, 0,
    'an impossible exponent is rejected');
  const inverted = Buffer.from(FIXTURE);
  inverted.writeBigInt64BE(1788608999n, 4 + 32 + 28);
  assert.equal(extractWrites(inverted, SOL_FEED_ID, { blockTime: FIXTURE_BLOCK_TIME }).length, 0,
    'prev_publish_time after publish_time is rejected');
  const noise = Buffer.concat([Buffer.alloc(64, 3), SOL_FEED_ID, Buffer.alloc(68, 0xff)]);
  assert.equal(extractWrites(noise, SOL_FEED_ID, { blockTime: FIXTURE_BLOCK_TIME }).length, 0,
    'the feed id inside noise is not a message');
}, 'extractWrites refuses everything that is not a write');

check(() => {
  // The design claim: two collectors, one reducer. A row this file produces must
  // be reducible by cadence-sampler.mjs summarize, or the hit-rate tables from
  // the two methods are not comparable and the whole point is lost.
  const rows = [];
  for (let i = 0; i < 40; i += 1) {
    const publish = 1788608000 + i * 5;
    rows.push(JSON.stringify(toPrintRow({
      symbol: 'SOL', feedId: SOL_FEED_ID.toString('hex'), sourceAddress: 'FIXTURE',
      signature: `sig${i}`, slot: 444510000 + i * 15, blockTime: publish + 1,
      msg: { publishTime: BigInt(publish), prevPublishTime: BigInt(publish - 1),
        price: 10228945937n, conf: 1073769n, exponent: -8 },
    })));
  }
  const s = summarize([JSON.stringify({ kind: 'header', intervalMs: 0 }), ...rows]);
  assert.equal(s.feeds.SOL.observations, 40, 'the shared reducer read every row');
  assert.equal(s.feeds.SOL.publishGapSeconds.max, 5, 'and saw the 5 s cadence');
  assert.equal(s.pollIntervalMs, 0,
    'a method with no blind spot declares interval 0 instead of pretending to poll');
}, 'ledger rows reduce through the same summarize as polled rows');

// --- walk(), against a fake RPC ------------------------------------------------

const fakeRpc = ({ pages, rateLimitOnce = false }) => {
  let limited = !rateLimitOnce;
  const calls = { getSignaturesForAddress: 0, getTransaction: 0, rateLimited: 0 };
  const impl = async (_url, init) => {
    const req = JSON.parse(init.body);
    if (!limited) {
      limited = true; calls.rateLimited += 1;
      return { json: async () => ({ error: { message: 'Rate limit exceeded. Please request a personal token' } }) };
    }
    if (req.method === 'getSignaturesForAddress') {
      calls.getSignaturesForAddress += 1;
      const before = req.params[1].before;
      const idx = before ? pages.findIndex(p => p[p.length - 1].signature === before) + 1 : 0;
      return { json: async () => ({ result: pages[idx] ?? [] }) };
    }
    calls.getTransaction += 1;
    const sig = req.params[0];
    const all = pages.flat();
    const row = all.find(s => s.signature === sig);
    const raw = Buffer.concat([Buffer.alloc(8, 1), FIXTURE]);
    const bt = row.blockTime;
    const tx = Buffer.from(raw);
    tx.writeBigInt64BE(BigInt(bt - 1), 8 + 4 + 32 + 20);
    tx.writeBigInt64BE(BigInt(bt - 2), 8 + 4 + 32 + 28);
    return { json: async () => ({ result: { slot: row.slot, blockTime: bt, transaction: [tx.toString('base64')], meta: { err: null } } }) };
  };
  return { impl, calls };
};

{
  const now = Math.floor(Date.now() / 1000);
  const mk = (n, from) => Array.from({ length: n }, (_, i) => ({
    signature: `S${from + i}`, blockTime: now - (from + i) * 5, slot: 400000 - (from + i),
  }));
  const pages = [mk(3, 0), mk(3, 3)];
  const { impl, calls } = fakeRpc({ pages, rateLimitOnce: true });
  const out = join(tmpdir(), `rcx-ledger-test-${process.pid}.ndjson`);
  const result = await walk({
    address: '7AviUf9nL62mcxNbQGKm4nKDQnPjswo6c5MX4D57HmyE',
    feedId: SOL_FEED_ID.toString('hex'), symbol: 'SOL',
    hours: 0.005, delayMs: 0, out, fetchImpl: impl, log: () => {},
  });
  const lines = readFileSync(out, 'utf8').trim().split('\n').map(l => JSON.parse(l));
  try { rmSync(out); } catch { /* best effort */ }

  check(() => {
    assert.equal(calls.rateLimited, 1, 'the fake RPC rate-limited once');
    assert.ok(result.signatures >= 3, 'and walk kept going anyway');
    assert.ok(result.writes >= 3, 'recovering the writes it was rate-limited out of');
  }, 'a rate limit backs off instead of losing the measurement');

  check(() => {
    assert.equal(lines[0].kind, 'header', 'the file opens with a header');
    assert.equal(lines[0].method, 'walk-ledger', 'which names the method');
    assert.equal(lines[0].intervalMs, 0, 'and declares no polling blind spot');
    assert.equal(lines[lines.length - 1].kind, 'footer', 'and closes with a footer');
    const prints = lines.filter(l => l.kind === 'print');
    assert.ok(prints.length >= 3, 'prints in between');
    for (const p of prints) {
      assert.equal(p.observedAt, p.publishTime + 1,
        'observedAt is when the write LANDED, not when anyone looked');
      assert.equal(p.publishTime - p.prevPublishTime, 1);
    }
    const s = summarize(lines.map(l => JSON.stringify(l)));
    assert.ok(s.feeds.SOL.observations >= 3, 'the shared reducer reads the walked file too');
  }, 'the walked file is a valid, reducible NDJSON measurement');
}

console.log(`ledger cadence: ${checks} checks passed (host tier; fixture bytes are mainnet)`);
