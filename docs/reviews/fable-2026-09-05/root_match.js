// THE DECISIVE EXPERIMENT (read-only): can a KEYLESS party reproduce the accumulator's signed Merkle root?
//
// Inputs, all keyless:
//   - every Pythnet oracle price account (program FsJ3A3u2vn5cTVofAjvy6y5kwABJAqYWpe4975bi2epH), read at ONE slot
//   - the guardian-signed VAA for that slot from Wormholescan (payload = magic|type|slot|ring_size|root20)
// Method (pythnet-sdk/accumulators/merkle.rs):
//   leaf  = H(0x00 || message_bytes)
//   node  = H(0x01 || min(l,r) || max(l,r))
//   null  = H(0x02)
//   H     = keccak256 truncated to 20 bytes (root in the VAA payload is 20 bytes)
//   tree padded to the next power of two with null hashes; root = tree[1]
// Message wire form (confirmed empirically from a message-buffer account, big-endian):
//   0x00 | feed_id[32] | price i64 | conf u64 | expo i32 | publish_time i64 | prev_publish_time i64 | ema_price i64 | ema_conf u64
// feed_id == the Pythnet price account pubkey (verified: H6ARHf6Y... == ef0d8b6f...b56d)
//
// A match on ANY leaf ordering proves keyless Full replay is constructible. A mismatch prints the diagnostics
// needed to find the real ordering/inclusion rule. No writes, no chain transactions.
'use strict';
const path = require('path');
const REPO = 'D:\\Work\\Software_Projects\\pumpmind\\ratchetx\\ratchet_phase_a_clean';
const { keccak_256 } = require(path.join(REPO, 'node_modules', '@noble', 'hashes', 'sha3.js'));
const OUT = process.argv[2] || 'root_match.out.json';
const RPC = 'https://pythnet.rpcpool.com';
const ORACLE = 'FsJ3A3u2vn5cTVofAjvy6y5kwABJAqYWpe4975bi2epH';
const EMITTER = 'e101faedac5851e32b9b23b5f9411a8c2bac4aae3ed4dd7b811dd1a72ea4aa71';
const H = (...parts) => Buffer.from(keccak_256(Buffer.concat(parts))).subarray(0, 20);
const LEAF = Buffer.from([0]), NODE = Buffer.from([1]), NULL = Buffer.from([2]);
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58dec(s) { let n = 0n; for (const c of s) n = n * 58n + BigInt(B58.indexOf(c)); const b = Buffer.alloc(32); const h = n.toString(16).padStart(64, '0'); return Buffer.from(h, 'hex'); }
async function rpc(method, params) {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(60000) });
  const j = await r.json(); if (j.error) throw new Error(JSON.stringify(j.error).slice(0, 250)); return j.result;
}
function merkleRoot(leafHashes) {
  let n = 1; while (n < leafHashes.length) n *= 2;
  const nullHash = H(NULL);
  const tree = new Array(2 * n);
  for (let i = 0; i < n; i++) tree[n + i] = i < leafHashes.length ? leafHashes[i] : nullHash;
  for (let i = n - 1; i >= 1; i--) {
    const l = tree[2 * i], r = tree[2 * i + 1];
    tree[i] = Buffer.compare(l, r) <= 0 ? H(NODE, l, r) : H(NODE, r, l);
  }
  return tree[1];
}
function buildMessage(feedId, a) {
  const b = Buffer.alloc(85); let o = 0;
  b[o++] = 0; feedId.copy(b, o); o += 32;
  b.writeBigInt64BE(BigInt(a.price), o); o += 8;
  b.writeBigUInt64BE(BigInt(a.conf), o); o += 8;
  b.writeInt32BE(a.expo, o); o += 4;
  b.writeBigInt64BE(BigInt(a.publish_time), o); o += 8;
  b.writeBigInt64BE(BigInt(a.prev_publish_time), o); o += 8;
  b.writeBigInt64BE(BigInt(a.ema_price), o); o += 8;
  b.writeBigUInt64BE(BigInt(a.ema_conf), o); o += 8;
  return b;
}
(async () => {
  const out = { started: new Date().toISOString() };
  // 1. atomic snapshot of every oracle account (only the first 240 bytes are needed)
  const res = await rpc('getProgramAccounts', [ORACLE, { encoding: 'base64', withContext: true, dataSlice: { offset: 0, length: 240 } }]);
  const ctxSlot = res.context.slot;
  const rows = res.value;
  out.snapshot = { slot: ctxSlot, accounts: rows.length };
  // 2. keep price accounts (magic a1b2c3d4, account type 3) and build their messages
  const feeds = [];
  for (const r of rows) {
    const d = Buffer.from(r.account.data[0], 'base64');
    if (d.length < 240) continue;
    if (d.readUInt32LE(0) !== 0xa1b2c3d4) continue;
    if (d.readUInt32LE(8) !== 3) continue;                       // 3 = price account
    feeds.push({ pk: r.pubkey, feedId: b58dec(r.pubkey),
      expo: d.readInt32LE(20),
      publish_time: Number(d.readBigInt64LE(96)),
      prev_publish_time: Number(d.readBigInt64LE(200)),
      ema_price: d.readBigInt64LE(48).toString(),
      ema_conf: d.readBigInt64LE(72).toString(),
      price: d.readBigInt64LE(208).toString(),
      conf: d.readBigUInt64LE(216).toString(),
      status: d.readUInt32LE(224),
      pub_slot: Number(d.readBigUInt64LE(232)) });
  }
  out.price_accounts = feeds.length;
  out.publish_time_spread = (() => { const t = feeds.map(f => f.publish_time).filter(x => x > 1e9).sort(); return { min: t[0], max: t[t.length - 1], distinct: new Set(t).size }; })();
  out.status_histogram = feeds.reduce((m, f) => (m[f.status] = (m[f.status] || 0) + 1, m), {});

  // 3. the signed roots around that slot, keyless. Collect a slot -> root map and align.
  const bySlot = new Map();
  for (let page = 0; page <= 4; page++) {
    const r = await fetch(`https://api.wormholescan.io/api/v1/vaas/26/${EMITTER}?pageSize=100&page=${page}`, { signal: AbortSignal.timeout(30000) });
    const j = await r.json();
    for (const row of (j.data || [])) {
      const v = Buffer.from(row.vaa, 'base64');
      const sigs = v[5]; const p = v.subarray(6 + sigs * 66 + 4 + 4 + 2 + 32 + 8 + 1);
      if (p.subarray(0, 4).toString('latin1') !== 'AUWV') continue;
      bySlot.set(Number(p.readBigUInt64BE(5)), { sequence: row.sequence, ring: p.readUInt32BE(13), root: p.subarray(17, 37).toString('hex') });
    }
  }
  const slots = [...bySlot.keys()].sort((a, b) => a - b);
  out.vaa_window = { count: slots.length, minSlot: slots[0], maxSlot: slots[slots.length - 1], snapshotSlot: ctxSlot,
    snapshotInsideWindow: ctxSlot >= slots[0] && ctxSlot <= slots[slots.length - 1] };
  // exact slot if present, else the nearest at or below
  let target = bySlot.get(ctxSlot) ? { slot: ctxSlot, ...bySlot.get(ctxSlot) } : null;
  if (!target) {
    const below = slots.filter(s => s <= ctxSlot).pop();
    if (below != null) { target = { slot: below, offsetFromSnapshot: below - ctxSlot, ...bySlot.get(below) }; }
  }
  out.signed = target || 'no accumulator VAA parsed in the window';
  // also keep the neighbours, so a +/-1 slot offset is testable
  out.signed_neighbours = [ctxSlot - 2, ctxSlot - 1, ctxSlot, ctxSlot + 1, ctxSlot + 2]
    .map(s => ({ slot: s, root: bySlot.get(s) ? bySlot.get(s).root : null }));

  // 4. candidate leaf orderings
  if (target) {
    const orders = {
      as_returned: feeds,
      by_pubkey_b58: [...feeds].sort((a, b) => a.pk < b.pk ? -1 : a.pk > b.pk ? 1 : 0),
      by_feed_id_bytes: [...feeds].sort((a, b) => Buffer.compare(a.feedId, b.feedId)),
      trading_only_as_returned: feeds.filter(f => f.status === 1),
      trading_only_by_feed_id: feeds.filter(f => f.status === 1).sort((a, b) => Buffer.compare(a.feedId, b.feedId)),
      updated_this_slot_as_returned: feeds.filter(f => f.pub_slot === ctxSlot),
      updated_this_slot_by_feed_id: feeds.filter(f => f.pub_slot === ctxSlot).sort((a, b) => Buffer.compare(a.feedId, b.feedId)),
      updated_within_1_as_returned: feeds.filter(f => Math.abs(f.pub_slot - ctxSlot) <= 1),
      updated_within_2_as_returned: feeds.filter(f => Math.abs(f.pub_slot - ctxSlot) <= 2),
      updated_le_slot_as_returned: feeds.filter(f => f.pub_slot <= ctxSlot && f.pub_slot >= ctxSlot - 5),
    };
    out.pub_slot_histogram = feeds.reduce((m, f) => { const k = f.pub_slot - ctxSlot; m[k] = (m[k] || 0) + 1; return m; }, {});
    out.attempts = {};
    for (const [name, list] of Object.entries(orders)) {
      const hashes = list.map(f => H(LEAF, buildMessage(f.feedId, f)));
      const root = merkleRoot(hashes).toString('hex');
      const hit = out.signed_neighbours.find(n => n.root === root);
      out.attempts[name] = { leaves: list.length, root, match: root === target.root, matchesNeighbourSlot: hit ? hit.slot : null };
    }
    out.match = Object.entries(out.attempts).find(([, v]) => v.match || v.matchesNeighbourSlot != null) || null;
  }
  out.finished = new Date().toISOString();
  require('fs').writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1).slice(0, 3000));
})().catch(e => { console.log('FATAL ' + e.message); });
