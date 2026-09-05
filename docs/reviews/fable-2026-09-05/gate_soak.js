// Gate soak v2 — corrected. Measures, per feed per target second, whether an ADMISSIBLE message exists
// under the ACTUAL manifest spec pins, not merely whether a bracket message exists.
//
// Fixes two defects in my first soak:
//   1. slot windows came from the Wormholescan page and REPEATED, double-counting evidence.
//      Now slots are derived from the node's own head (the gate-2 rule) and every (feed, second)
//      is counted at most once, ever, via a persistent seen-set.
//   2. it depended on @noble/hashes, which was pruned. Keccak is now inlined and self-tested at startup.
//
// Root discipline: the recomputed Keccak160 root is checked against the guardian-signed VAA root on a
// sampled subset of slots (BigInt keccak is slow); slots whose root does not match are recorded and
// their leaves are DISCARDED, never smoothed. Unsampled slots still assert slot-in-account == target.
'use strict';
const fs = require('fs');
const INSP = 'C:\\Svemir\\data\\tmp\\insp';
const JSONL = INSP + '\\gate_soak.jsonl';
const STATUS = INSP + '\\gate_soak_status.json';
const SLOTS = Number(process.argv[2] || 40);
const HOURS = Number(process.argv[3] || 6);
const PAUSE_MS = Number(process.argv[4] || 60000);
const VERIFY_EVERY = Number(process.argv[5] || 8);      // verify the root on every Nth slot
const RPC = 'https://pythnet.rpcpool.com';
const EMITTER = 'e101faedac5851e32b9b23b5f9411a8c2bac4aae3ed4dd7b811dd1a72ea4aa71';
const SYSTEM = '11111111111111111111111111111111';
const RING = 10000;
const FEEDS = {
  SOL: 'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d',
  BTC: 'e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
  ETH: 'ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
  BONK: '72b021217ca3fe68922a19aaf990109cb9d84e9ad004b4d2025ad6f529314419',
  WIF: '4ca4beeca86f0d164160323817a4e42b10010a724c2217c6ee41b54cd4cc61fc',
  JUP: '0a0408d619e9380abad35060f9192039ed5042fa6f82301d0e48bb52be830996',
  PUMP: '7a01fca212788bba7c5bf8c9efd576a8a722f070d2c17596ff7bb609b8d5c3b9',
};
const SPEC = { maxPreTargetGap: 1, maxPostTargetLag: 30, maxConfidenceBps: 200, minExponent: -12, maxExponent: 2 };
// Keccak-256 (original padding 0x01), BigInt lanes. No dependencies.
const M = (1n << 64n) - 1n;
const ROT = [[0,36,3,41,18],[1,44,10,45,2],[62,6,43,15,61],[28,55,25,21,56],[27,20,39,8,14]]; // ROT[x][y]
const RC = [
  0x0000000000000001n,0x0000000000008082n,0x800000000000808an,0x8000000080008000n,
  0x000000000000808bn,0x0000000080000001n,0x8000000080008081n,0x8000000000008009n,
  0x000000000000008an,0x0000000000000088n,0x0000000080008009n,0x000000008000000an,
  0x000000008000808bn,0x800000000000008bn,0x8000000000008089n,0x8000000000008003n,
  0x8000000000008002n,0x8000000000000080n,0x000000000000800an,0x800000008000000an,
  0x8000000080008081n,0x8000000000008080n,0x0000000080000001n,0x8000000080008008n];
const rotl = (x, n) => n === 0 ? x : ((x << BigInt(n)) | (x >> BigInt(64 - n))) & M;
// state indexed A[x][y]
function keccakF(A) {
  for (let round = 0; round < 24; round++) {
    const C = new Array(5), D = new Array(5);
    for (let x = 0; x < 5; x++) C[x] = A[x][0] ^ A[x][1] ^ A[x][2] ^ A[x][3] ^ A[x][4];
    for (let x = 0; x < 5; x++) D[x] = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) A[x][y] ^= D[x];
    const B = [[], [], [], [], []];
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) B[y][(2 * x + 3 * y) % 5] = rotl(A[x][y], ROT[x][y]);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) A[x][y] = B[x][y] ^ ((~B[(x + 1) % 5][y] & M) & B[(x + 2) % 5][y]);
    A[0][0] ^= RC[round];
  }
  return A;
}
function keccak256(buf) {
  const rate = 136;
  const A = Array.from({ length: 5 }, () => new Array(5).fill(0n));
  const padLen = Math.ceil((buf.length + 1) / rate) * rate;
  const p = Buffer.alloc(padLen);
  buf.copy(p); p[buf.length] = 0x01; p[padLen - 1] |= 0x80;
  for (let off = 0; off < padLen; off += rate) {
    for (let i = 0; i < rate / 8; i++) {
      const lane = p.readBigUInt64LE(off + i * 8);
      A[i % 5][(i / 5) | 0] ^= lane;
    }
    keccakF(A);
  }
  const out = Buffer.alloc(32);
  for (let i = 0; i < 4; i++) out.writeBigUInt64LE(A[i % 5][(i / 5) | 0], i * 8);
  return out;
}


// Pure-JS Solana findProgramAddress: sha256 + ed25519 on-curve check. No dependencies.
const crypto = require('crypto');
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58enc(buf) {
  let n = 0n; for (const b of buf) n = n * 256n + BigInt(b);
  let s = ''; while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  for (const b of buf) { if (b === 0) s = '1' + s; else break; }
  return s;
}
function b58dec(s) {
  let n = 0n; for (const c of s) { const i = B58.indexOf(c); if (i < 0) throw new Error('bad b58'); n = n * 58n + BigInt(i); }
  const hex = n.toString(16).padStart(64, '0');
  return Buffer.from(hex, 'hex');
}
const P = (1n << 255n) - 19n;
function pw(b, e, m) { let r = 1n; b %= m; while (e > 0n) { if (e & 1n) r = r * b % m; b = b * b % m; e >>= 1n; } return r; }
const D = (P - 121665n) * pw(121666n, P - 2n, P) % P;
const SQRTM1 = pw(2n, (P - 1n) / 4n, P);
/** Is the 32-byte compressed point on the ed25519 curve? Mirrors CompressedEdwardsY::decompress. */
function isOnCurve(buf) {
  let y = 0n; for (let i = 31; i >= 0; i--) y = (y << 8n) | BigInt(buf[i]);
  const sign = (y >> 255n) & 1n;
  y &= (1n << 255n) - 1n;
  if (y >= P) return false;
  const yy = y * y % P;
  const u = (yy - 1n + P) % P;
  const v = (D * yy + 1n) % P;
  const v3 = v * v % P * v % P;
  const v7 = v3 * v3 % P * v % P;
  let x = u * v3 % P * pw(u * v7 % P, (P - 5n) / 8n, P) % P;
  const vxx = v * x % P * x % P;
  if (vxx === u) { /* ok */ }
  else if (vxx === (P - u) % P) { x = x * SQRTM1 % P; }
  else return false;
  if (x === 0n && sign === 1n) return false;
  return true;
}
function createProgramAddress(seeds, programId) {
  const h = crypto.createHash('sha256');
  for (const s of seeds) h.update(s);
  h.update(programId);
  h.update(Buffer.from('ProgramDerivedAddress'));
  const out = h.digest();
  if (isOnCurve(out)) return null;
  return out;
}
function findProgramAddress(seeds, programIdB58) {
  const pid = b58dec(programIdB58);
  for (let bump = 255; bump >= 0; bump--) {
    const a = createProgramAddress([...seeds, Buffer.from([bump])], pid);
    if (a) return { address: b58enc(a), bump };
  }
  throw new Error('no bump found');
}


const H = (...p) => keccak256(Buffer.concat(p)).subarray(0, 20);
const LEAF = Buffer.from([0]), NODE = Buffer.from([1]), NULL = Buffer.from([2]);
const hnode = (l, r) => Buffer.compare(l, r) <= 0 ? H(NODE, l, r) : H(NODE, r, l);
// self-test the hash before trusting a single measurement
if (keccak256(Buffer.from('abc')).toString('hex') !== '4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45') {
  console.error('keccak self-test FAILED'); process.exit(3);
}
async function rpc(method, params) {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(30000) });
  const j = await r.json(); if (j.error) throw new Error(JSON.stringify(j.error).slice(0, 150)); return j.result;
}
const pdaFor = slot => { const b = Buffer.alloc(4); b.writeUInt32BE(slot % RING); return findProgramAddress([Buffer.from('AccumulatorState'), b], SYSTEM).address; };
function parsePAS1(d) {
  if (d.subarray(0, 4).toString('latin1') !== 'PAS1') return null;
  const slot = Number(d.readBigUInt64LE(4));
  let o = 16; const count = d.readUInt32LE(o); o += 4; const msgs = [];
  for (let i = 0; i < count; i++) { const len = d.readUInt32LE(o); o += 4; msgs.push(d.subarray(o, o + len)); o += len; }
  return { slot, msgs };
}
function rootOf(msgs) {
  const leaves = msgs.map(m => H(LEAF, m));
  let n = 1; while (n < leaves.length) n *= 2;
  const nul = H(NULL); const t = new Array(2 * n);
  for (let i = 0; i < n; i++) t[n + i] = i < leaves.length ? leaves[i] : nul;
  for (let i = n - 1; i >= 1; i--) t[i] = hnode(t[2 * i], t[2 * i + 1]);
  return t[1];
}
const seen = new Set();                                   // "FEED@second" counted at most once, ever
const totals = { startedAt: new Date().toISOString(), batches: 0, failedBatches: 0, slotsRead: 0, staleSlots: 0,
  rootsChecked: 0, rootMismatches: 0, feedSeconds: 0, bracketPresent: 0, admissible: 0,
  rejections: {}, worstConfidenceBps: {}, preGapHistogram: {}, deltaHistogram: {} };
(async () => {
  const until = Date.now() + HOURS * 3600e3;
  while (Date.now() < until) {
    try {
      const head = await rpc('getSlot', []);
      // roots for the sampled slots only
      const bySlot = new Map();
      const r = await fetch(`https://api.wormholescan.io/api/v1/vaas/26/${EMITTER}?pageSize=100`, { signal: AbortSignal.timeout(25000) });
      const j = await r.json();
      for (const row of (j.data || [])) {
        const v = Buffer.from(row.vaa, 'base64'); const sigs = v[5];
        const p = v.subarray(6 + sigs * 66 + 4 + 4 + 2 + 32 + 8 + 1);
        if (p.subarray(0, 4).toString('latin1') !== 'AUWV') continue;
        bySlot.set(Number(p.readBigUInt64BE(5)), p.subarray(17, 37));
      }
      const perFeed = {}; for (const f of Object.keys(FEEDS)) perFeed[f] = [];
      let read = 0, stale = 0, checked = 0, mismatched = 0;
      for (let k = SLOTS - 1; k >= 0; k--) {
        const slot = head - k;
        let info; try { info = await rpc('getAccountInfo', [pdaFor(slot), { encoding: 'base64' }]); } catch { continue; }
        if (!info || !info.value) continue;
        const p = parsePAS1(Buffer.from(info.value.data[0], 'base64'));
        if (!p) continue;
        if (p.slot !== slot) { stale++; continue; }                       // gate-2 assertion
        if (k % VERIFY_EVERY === 0 && bySlot.has(slot)) {
          checked++;
          if (!rootOf(p.msgs).equals(bySlot.get(slot))) { mismatched++; continue; }   // discard, never smooth
        }
        read++;
        for (const [name, hex] of Object.entries(FEEDS)) {
          const fid = Buffer.from(hex, 'hex');
          const m = p.msgs.find(x => x.length === 85 && x[0] === 0 && x.subarray(1, 33).equals(fid));
          if (!m) continue;
          perFeed[name].push({ price: m.readBigInt64BE(33), conf: m.readBigUInt64BE(41), expo: m.readInt32BE(49),
            pub: Number(m.readBigInt64BE(53)), prev: Number(m.readBigInt64BE(61)) });
        }
      }
      totals.slotsRead += read; totals.staleSlots += stale; totals.rootsChecked += checked; totals.rootMismatches += mismatched;
      const line = { at: new Date().toISOString(), head, slotsRead: read, stale, rootsChecked: checked, rootMismatches: mismatched, feeds: {} };
      for (const [name, list] of Object.entries(perFeed)) {
        if (!list.length) continue;
        for (const x of list) { const d = x.pub - x.prev; totals.deltaHistogram[d] = (totals.deltaHistogram[d] || 0) + 1; }
        const pubs = list.map(x => x.pub); const lo = Math.min(...pubs), hi = Math.max(...pubs);
        let newSeconds = 0, present = 0, adm = 0;
        for (let T = lo + 1; T <= hi; T++) {
          const key = name + '@' + T;
          if (seen.has(key)) continue;                                    // never count a second twice
          seen.add(key); newSeconds++;
          const m = list.find(x => x.prev < T && T <= x.pub);
          if (!m) { totals.rejections.NO_BRACKET = (totals.rejections.NO_BRACKET || 0) + 1; continue; }
          present++;
          const preGap = T - m.prev, postLag = m.pub - T;
          totals.preGapHistogram[preGap] = (totals.preGapHistogram[preGap] || 0) + 1;
          const confBps = m.price > 0n ? Number(m.conf * 10000n / m.price) : 1e9;
          totals.worstConfidenceBps[name] = Math.max(totals.worstConfidenceBps[name] || 0, confBps);
          let why = null;
          if (!(m.price > 0n)) why = 'NON_POSITIVE_PRICE';
          else if (preGap > SPEC.maxPreTargetGap) why = 'PRE_TARGET_GAP';
          else if (postLag > SPEC.maxPostTargetLag) why = 'POST_TARGET_LAG';
          else if (m.expo < SPEC.minExponent || m.expo > SPEC.maxExponent) why = 'EXPONENT';
          else if (confBps > SPEC.maxConfidenceBps) why = 'CONFIDENCE_TOO_WIDE';
          if (why) totals.rejections[why] = (totals.rejections[why] || 0) + 1; else adm++;
        }
        totals.feedSeconds += newSeconds; totals.bracketPresent += present; totals.admissible += adm;
        line.feeds[name] = { newSeconds, bracketPresent: present, admissible: adm };
      }
      totals.batches++;
      fs.appendFileSync(JSONL, JSON.stringify(line) + '\n');
    } catch (e) {
      totals.failedBatches++;
      fs.appendFileSync(JSONL, JSON.stringify({ at: new Date().toISOString(), error: String(e.message).slice(0, 200) }) + '\n');
    }
    totals.updatedAt = new Date().toISOString();
    totals.bracketGapRate = totals.feedSeconds ? (totals.feedSeconds - totals.bracketPresent) / totals.feedSeconds : null;
    totals.inadmissibleRate = totals.feedSeconds ? (totals.feedSeconds - totals.admissible) / totals.feedSeconds : null;
    totals.upper95_if_zero = totals.feedSeconds ? 3 / totals.feedSeconds : null;
    fs.writeFileSync(STATUS, JSON.stringify(totals, null, 1));
    const left = until - Date.now(); if (left <= 0) break;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(PAUSE_MS, left));
  }
})();
