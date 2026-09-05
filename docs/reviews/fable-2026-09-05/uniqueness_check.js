// DOES THE STRICT BRACKET ACTUALLY IDENTIFY A UNIQUE MESSAGE ON MAINNET?
// Lemma 1 assumed one aggregate per (publish_time, prev_publish_time). Pythnet produces an aggregate every
// SLOT (~2.5/second), so several may share a key. If more than one distinct message satisfies
// prev < T <= pub for a target T, the strict bracket has a CHOOSER and the "no chooser" result is wrong.
// This counts them, per feed, over a window of root-verified slots. Read-only.
'use strict';
const PYTHNET = 'https://pythnet.rpcpool.com';
const EMITTER = 'e101faedac5851e32b9b23b5f9411a8c2bac4aae3ed4dd7b811dd1a72ea4aa71';
const SYSTEM = '11111111111111111111111111111111';
const RING = 10000;
const SLOTS = Number(process.argv[3] || 120);
const FEEDS = {
  SOL: 'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d',
  BTC: 'e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
  ETH: 'ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
  PUMP: '7a01fca212788bba7c5bf8c9efd576a8a722f070d2c17596ff7bb609b8d5c3b9',
};
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
async function rpc(method, params) {
  const r = await fetch(PYTHNET, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(30000) });
  const j = await r.json(); if (j.error) throw new Error(JSON.stringify(j.error).slice(0, 150)); return j.result;
}
const pdaFor = s => { const b = Buffer.alloc(4); b.writeUInt32BE(s % RING); return findProgramAddress([Buffer.from('AccumulatorState'), b], SYSTEM).address; };
function parsePAS1(d) {
  if (d.subarray(0, 4).toString('latin1') !== 'PAS1') return null;
  const slot = Number(d.readBigUInt64LE(4));
  let o = 16; const c = d.readUInt32LE(o); o += 4; const msgs = [];
  for (let i = 0; i < c; i++) { const len = d.readUInt32LE(o); o += 4; msgs.push(d.subarray(o, o + len)); o += len; }
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
(async () => {
  const out = { started: new Date().toISOString(), slots: 0, rootsChecked: 0, rootMismatches: 0 };
  const roots = new Map();
  const r = await fetch(`https://api.wormholescan.io/api/v1/vaas/26/${EMITTER}?pageSize=100`, { signal: AbortSignal.timeout(25000) });
  const j = await r.json();
  for (const row of (j.data || [])) {
    const v = Buffer.from(row.vaa, 'base64'); const s = v[5];
    const p = v.subarray(6 + s * 66 + 4 + 4 + 2 + 32 + 8 + 1);
    if (p.subarray(0, 4).toString('latin1') === 'AUWV') roots.set(Number(p.readBigUInt64BE(5)), p.subarray(17, 37));
  }
  const head = await rpc('getSlot', []);
  // per feed: key "pub|prev" -> Set of distinct message hex
  const byKey = {}; for (const f of Object.keys(FEEDS)) byKey[f] = new Map();
  for (let k = SLOTS - 1; k >= 0; k--) {
    const slot = head - k;
    let info; try { info = await rpc('getAccountInfo', [pdaFor(slot), { encoding: 'base64' }]); } catch { continue; }
    if (!info || !info.value) continue;
    const p = parsePAS1(Buffer.from(info.value.data[0], 'base64'));
    if (!p || p.slot !== slot) continue;
    if (k % 10 === 0 && roots.has(slot)) {
      out.rootsChecked++;
      if (!rootOf(p.msgs).equals(roots.get(slot))) { out.rootMismatches++; continue; }
    }
    out.slots++;
    for (const [name, hex] of Object.entries(FEEDS)) {
      const fid = Buffer.from(hex, 'hex');
      for (const m of p.msgs) {
        if (m.length !== 85 || m[0] !== 0 || !m.subarray(1, 33).equals(fid)) continue;
        const pub = Number(m.readBigInt64BE(53)), prev = Number(m.readBigInt64BE(61));
        const key = pub + '|' + prev;
        if (!byKey[name].has(key)) byKey[name].set(key, new Set());
        byKey[name].get(key).add(m.toString('hex'));
      }
    }
  }
  out.perFeed = {};
  for (const [name, map] of Object.entries(byKey)) {
    let keys = 0, dup = 0, worst = 1, bracketKeys = 0, bracketDup = 0;
    const examples = [];
    for (const [key, set] of map) {
      keys++; if (set.size > 1) { dup++; if (examples.length < 2) examples.push({ key, distinctMessages: set.size, hexes: [...set].slice(0, 2) }); }
      worst = Math.max(worst, set.size);
      const [pub, prev] = key.split('|').map(Number);
      if (pub - prev === 1) { bracketKeys++; if (set.size > 1) bracketDup++; }   // the strict-bracket messages
    }
    out.perFeed[name] = { distinctKeys: keys, keysWithMultipleMessages: dup, worstMultiplicity: worst,
      bracketKeys, bracketKeysWithMultipleMessages: bracketDup, examples };
  }
  out.VERDICT = Object.values(out.perFeed).every(f => f.bracketKeysWithMultipleMessages === 0)
    ? 'UNIQUE: every strict-bracket key maps to exactly one signed message'
    : 'NOT UNIQUE: some strict-bracket keys map to several distinct signed messages — the bracket has a chooser';
  out.finished = new Date().toISOString();
  require('fs').writeFileSync(process.argv[2] || 'uniqueness_check.out.json', JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1).slice(0, 2600));
})().catch(e => console.log('FATAL ' + e.message));
