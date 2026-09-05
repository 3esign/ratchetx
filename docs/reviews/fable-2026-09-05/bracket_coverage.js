// THE MEASUREMENT THAT DECIDES WHETHER THE STRICT BRACKET IS PLAYABLE (keyless).
// For a run of consecutive Pythnet slots, read the PAS1 ring account, verify its root against the
// guardian-signed VAA, and record every one of the 7 RatchetX feeds' leaf publish_time.
// Then, for each target second T covered by the run, ask: does a leaf exist with prev < T <= pub?
// That is adapter 1's admissibility test, evaluated against what a KEYLESS party can actually obtain.
// Read-only: getAccountInfo + Wormholescan GET. No key, no chain transaction.
'use strict';
const path = require('path');
const REPO = 'D:\\Work\\Software_Projects\\pumpmind\\ratchetx\\ratchet_phase_a_clean';
const { keccak_256 } = require(path.join(REPO, 'node_modules', '@noble', 'hashes', 'sha3.js'));
const { PublicKey } = require(path.join(REPO, 'node_modules', '@solana', 'web3.js'));
const OUT = process.argv[2] || 'bracket_coverage.out.json';
const SLOTS = Number(process.argv[3] || 30);
const RPC = 'https://pythnet.rpcpool.com';
const EMITTER = 'e101faedac5851e32b9b23b5f9411a8c2bac4aae3ed4dd7b811dd1a72ea4aa71';
const SYSTEM = new PublicKey('11111111111111111111111111111111');
const FEEDS = {
  SOL: 'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d',
  BTC: 'e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
  ETH: 'ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
  BONK: '72b021217ca3fe68922a19aaf990109cb9d84e9ad004b4d2025ad6f529314419',
  WIF: '4ca4beeca86f0d164160323817a4e42b10010a724c2217c6ee41b54cd4cc61fc',
  JUP: '0a0408d619e9380abad35060f9192039ed5042fa6f82301d0e48bb52be830996',
  PUMP: '7a01fca212788bba7c5bf8c9efd576a8a722f070d2c17596ff7bb609b8d5c3b9',
};
const H = (...p) => Buffer.from(keccak_256(Buffer.concat(p))).subarray(0, 20);
const LEAF = Buffer.from([0]), NODE = Buffer.from([1]), NULL = Buffer.from([2]);
const hnode = (l, r) => Buffer.compare(l, r) <= 0 ? H(NODE, l, r) : H(NODE, r, l);
async function rpc(method, params) {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(40000) });
  const j = await r.json(); if (j.error) throw new Error(JSON.stringify(j.error).slice(0, 200)); return j.result;
}
function rootOf(msgs) {
  const leaves = msgs.map(m => H(LEAF, m));
  let n = 1; while (n < leaves.length) n *= 2;
  const nul = H(NULL); const t = new Array(2 * n);
  for (let i = 0; i < n; i++) t[n + i] = i < leaves.length ? leaves[i] : nul;
  for (let i = n - 1; i >= 1; i--) t[i] = hnode(t[2 * i], t[2 * i + 1]);
  return t[1];
}
function parsePAS1(d) {
  const magic = d.subarray(0, 4).toString('latin1');
  const slot = Number(d.readBigUInt64LE(4)); const ring_size = d.readUInt32LE(12);
  let o = 16; const count = d.readUInt32LE(o); o += 4; const msgs = [];
  for (let i = 0; i < count; i++) { const len = d.readUInt32LE(o); o += 4; msgs.push(d.subarray(o, o + len)); o += len; }
  return { magic, slot, ring_size, msgs };
}
(async () => {
  const out = { started: new Date().toISOString(), slots: [], staleSlots: 0, rootMismatches: 0 };
  const bySlot = new Map();
  for (const page of [0, 1]) {
    const r = await fetch(`https://api.wormholescan.io/api/v1/vaas/26/${EMITTER}?pageSize=100&page=${page}`, { signal: AbortSignal.timeout(30000) });
    const j = await r.json();
    for (const row of (j.data || [])) {
      const v = Buffer.from(row.vaa, 'base64'); const sigs = v[5];
      const p = v.subarray(6 + sigs * 66 + 4 + 4 + 2 + 32 + 8 + 1);
      if (p.subarray(0, 4).toString('latin1') !== 'AUWV') continue;
      bySlot.set(Number(p.readBigUInt64BE(5)), { ring: p.readUInt32BE(13), root: p.subarray(17, 37) });
    }
  }
  const all = [...bySlot.keys()].sort((a, b) => a - b);
  const run = all.slice(0, SLOTS);                          // oldest first: those ring slots are written
  out.window = { available: all.length, using: run.length, from: run[0], to: run[run.length - 1] };
  const perFeed = Object.fromEntries(Object.keys(FEEDS).map(f => [f, []]));   // {pub, prev} seen
  for (const slot of run) {
    const ring_size = bySlot.get(slot).ring || 10000;
    const idx = Buffer.alloc(4); idx.writeUInt32BE(slot % ring_size);
    const [pda] = PublicKey.findProgramAddressSync([Buffer.from('AccumulatorState'), idx], SYSTEM);
    let info; try { info = await rpc('getAccountInfo', [pda.toBase58(), { encoding: 'base64' }]); } catch { continue; }
    if (!info || !info.value) continue;
    const p = parsePAS1(Buffer.from(info.value.data[0], 'base64'));
    if (p.magic !== 'PAS1') continue;
    if (p.slot !== slot) { out.staleSlots++; continue; }                       // ring not yet written for this lap
    if (!rootOf(p.msgs).equals(bySlot.get(slot).root)) { out.rootMismatches++; continue; }
    const rec = { slot, messages: p.msgs.length, feeds: {} };
    for (const [name, hex] of Object.entries(FEEDS)) {
      const fid = Buffer.from(hex, 'hex');
      const m = p.msgs.find(x => x.length === 85 && x[0] === 0 && x.subarray(1, 33).equals(fid));
      if (!m) { rec.feeds[name] = null; continue; }
      const pub = Number(m.readBigInt64BE(53)), prev = Number(m.readBigInt64BE(61));
      rec.feeds[name] = { pub, prev };
      perFeed[name].push({ pub, prev });
    }
    out.slots.push(rec);
  }
  // coverage: every feed present in every verified slot?
  out.presence = Object.fromEntries(Object.entries(perFeed).map(([f, v]) => [f, { seen: v.length, ofSlots: out.slots.length }]));
  // the strict-bracket question, per feed, over every target second the run covers
  out.bracket = {};
  for (const [name, list] of Object.entries(perFeed)) {
    if (!list.length) { out.bracket[name] = 'no leaves'; continue; }
    const pubs = list.map(x => x.pub);
    const lo = Math.min(...pubs), hi = Math.max(...pubs);
    let covered = 0, targets = 0, gaps = [];
    for (let T = lo + 1; T <= hi; T++) {
      targets++;
      const hit = list.some(x => x.prev < T && T <= x.pub);
      if (hit) covered++; else gaps.push(T);
    }
    out.bracket[name] = { secondsSpanned: targets, bracketAvailable: covered, missing: gaps.length,
      pct: targets ? +(100 * covered / targets).toFixed(1) : null,
      deltaHistogram: list.reduce((m, x) => { const k = x.pub - x.prev; m[k] = (m[k] || 0) + 1; return m; }, {}),
      firstMissing: gaps.slice(0, 5) };
  }
  out.finished = new Date().toISOString();
  require('fs').writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log(JSON.stringify({ window: out.window, verifiedSlots: out.slots.length, staleSlots: out.staleSlots,
    rootMismatches: out.rootMismatches, presence: out.presence, bracket: out.bracket }, null, 1));
})().catch(e => console.log('FATAL ' + e.message));
