// Gate 2 of the keyless design: WHEN is a ring slot readable? The newest ring positions still hold the
// previous lap (slot - ring_size) until the accumulator's write for this lap lands, so a crank that reads
// too eagerly gets a 10,000-slot-old message. This measures the distribution of "how many slots behind the
// head must a target be before its ring account actually holds it", which sets the crank's polling offset.
// Cheap: only the first 16 bytes of each ring account are fetched (magic | slot | ring_size).
// Read-only. No key, no chain transaction.
'use strict';
// self-contained PDA derivation (sha256 + ed25519 on-curve), validated against 5 known PDAs
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


const OUT = process.argv[2] || 'ring_staleness.out.json';
const ROUNDS = Number(process.argv[3] || 6);
const MAXBACK = Number(process.argv[4] || 24);
const RPC = process.argv[5] || 'https://pythnet.rpcpool.com';
const SYSTEM = '11111111111111111111111111111111';
const RING = 10000;
async function rpc(method, params) {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(20000) });
  const j = await r.json(); if (j.error) throw new Error(JSON.stringify(j.error).slice(0, 160)); return j.result;
}
const pdaFor = slot => { const b = Buffer.alloc(4); b.writeUInt32BE(slot % RING); return findProgramAddress([Buffer.from('AccumulatorState'), b], SYSTEM).address; };
async function ringSlot(slot) {
  const info = await rpc('getAccountInfo', [pdaFor(slot), { encoding: 'base64', dataSlice: { offset: 0, length: 16 } }]);
  if (!info || !info.value) return { missing: true };
  const d = Buffer.from(info.value.data[0], 'base64');
  if (d.subarray(0, 4).toString('latin1') !== 'PAS1') return { badMagic: true };
  return { slot: Number(d.readBigUInt64LE(4)), ring_size: d.readUInt32LE(12) };
}
(async () => {
  const out = { started: new Date().toISOString(), rpc: RPC, rounds: [], };
  for (let r = 0; r < ROUNDS; r++) {
    const head = await rpc('getSlot', []);
    const row = { head, firstFreshOffset: null, probes: [] };
    for (let k = -8; k <= MAXBACK; k++) {
      const target = head - k;
      let res; try { res = await ringSlot(target); } catch (e) { res = { error: String(e.message).slice(0, 80) }; }
      const fresh = res.slot === target;
      const lastLap = res.slot === target - RING;
      row.probes.push({ back: k, target, inAccount: res.slot ?? null, fresh, lastLap });
      if (fresh && row.firstFreshOffset === null) row.firstFreshOffset = k;
      if (fresh && k >= 0) break;
    }
    out.rounds.push(row);
    await new Promise(s => setTimeout(s, 1200));
  }
  const offs = out.rounds.map(r => r.firstFreshOffset).filter(x => x !== null);
  offs.sort((a, b) => a - b);
  out.summary = {
    rounds: out.rounds.length, resolved: offs.length,
    minSlotsBehindHead: offs[0] ?? null,
    medianSlotsBehindHead: offs.length ? offs[Math.floor(offs.length / 2)] : null,
    maxSlotsBehindHead: offs[offs.length - 1] ?? null,
    histogram: offs.reduce((m, x) => (m[x] = (m[x] || 0) + 1, m), {}),
    note: 'a crank should target head - max(this) or older; reading nearer the head returns the previous lap (slot - 10000), which the slot-in-account assertion catches',
    approxSecondsBehind: offs.length ? +(offs[offs.length - 1] * 0.4).toFixed(2) : null,
  };
  out.finished = new Date().toISOString();
  require('fs').writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log(JSON.stringify({ summary: out.summary, sample: out.rounds.slice(0, 3) }, null, 1));
})().catch(e => console.log('FATAL ' + e.message));
