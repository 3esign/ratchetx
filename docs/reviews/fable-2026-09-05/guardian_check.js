// Independent check of Sol 09:28Z: is the guardian set that signed the PAS1 accumulator VAAs still the
// CURRENT one on Solana mainnet, and is the sponsored Pyth price account still being written?
// Read-only against public Solana + Pythnet RPC and Wormholescan. No key, no transaction.
'use strict';
const SOL_RPC = ['https://api.mainnet-beta.solana.com', 'https://solana-rpc.publicnode.com'];
const WORMHOLE_CORE = 'worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth';
const EMITTER = 'e101faedac5851e32b9b23b5f9411a8c2bac4aae3ed4dd7b811dd1a72ea4aa71';
const SPONSORED = { SOL: '7AviUf9nL62mcxNbQGKm4nKDQnPjswo6c5MX4D57HmyE', BTC: 'APgzQGGdv2qCgBkX6aHVkrGePtBVDDg68GiqaM7rmtf5' };
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


const out = { started: new Date().toISOString() };
let ep = 0;
async function rpc(method, params) {
  for (let n = 0; n < SOL_RPC.length; n++) {
    const i = (ep + n) % SOL_RPC.length;
    try {
      const r = await fetch(SOL_RPC[i], { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(20000) });
      const j = await r.json(); if (j.error) throw new Error(JSON.stringify(j.error).slice(0, 150));
      ep = i; return j.result;
    } catch (e) { if (n === SOL_RPC.length - 1) throw e; }
  }
}
(async () => {
  // 1. Wormhole core bridge config -> current guardian_set_index
  const bridge = findProgramAddress([Buffer.from('Bridge')], WORMHOLE_CORE).address;
  const b = await rpc('getAccountInfo', [bridge, { encoding: 'base64' }]);
  if (b && b.value) {
    const d = Buffer.from(b.value.data[0], 'base64');
    out.bridge = { pda: bridge, owner: b.value.owner, bytes: d.length, guardianSetIndex: d.readUInt32LE(0),
      head: d.subarray(0, 24).toString('hex') };
  } else out.bridge = { pda: bridge, missing: true };
  // 2. the guardian set account for that index: how many keys does it hold?
  if (out.bridge && out.bridge.guardianSetIndex !== undefined) {
    for (const idx of [out.bridge.guardianSetIndex, 7]) {
      const be = Buffer.alloc(4); be.writeUInt32BE(idx);
      const gs = findProgramAddress([Buffer.from('GuardianSet'), be], WORMHOLE_CORE).address;
      const g = await rpc('getAccountInfo', [gs, { encoding: 'base64' }]);
      out['guardianSet_' + idx] = g && g.value
        ? (() => { const d = Buffer.from(g.value.data[0], 'base64');
            return { pda: gs, bytes: d.length, index: d.readUInt32LE(0), keyCount: d.readUInt32LE(4),
              expirationTime: d.length >= 8 + d.readUInt32LE(4) * 20 + 4 ? d.readUInt32LE(8 + d.readUInt32LE(4) * 20) : null }; })()
        : { pda: gs, missing: true };
    }
  }
  // 3. the VAA the accumulator is emitting right now: which guardian set index and how many signatures?
  const r = await fetch(`https://api.wormholescan.io/api/v1/vaas/26/${EMITTER}?pageSize=1`, { signal: AbortSignal.timeout(25000) });
  const j = await r.json();
  if (j.data && j.data[0]) {
    const v = Buffer.from(j.data[0].vaa, 'base64');
    out.currentVaa = { sequence: j.data[0].sequence, timestamp: j.data[0].timestamp, version: v[0],
      guardianSetIndex: v.readUInt32BE(1), signatureCount: v[5], bytes: v.length };
  }
  // 4. is the sponsored Pyth price account still being written, and by whom?
  out.sponsored = {};
  for (const [name, pk] of Object.entries(SPONSORED)) {
    const a = await rpc('getAccountInfo', [pk, { encoding: 'base64' }]);
    if (!a || !a.value) { out.sponsored[name] = 'missing'; continue; }
    const d = Buffer.from(a.value.data[0], 'base64');
    let o = 8; const writeAuthority = d.subarray(o, o + 32).toString('hex'); o += 32;
    const level = d[o]; o += 1; if (level === 0) o += 1;
    o += 32; // feed id
    o += 8 + 8 + 4; // price, conf, expo
    const pub = Number(d.readBigInt64LE(o)); o += 8;
    const prev = Number(d.readBigInt64LE(o)); o += 8;
    o += 16; const postedSlot = Number(d.readBigUInt64LE(o));
    out.sponsored[name] = { owner: a.value.owner, bytes: d.length, verificationLevel: level,
      publishTime: pub, prevPublishTime: prev, postedSlot, ageSeconds: Math.floor(Date.now() / 1000) - pub };
  }
  out.solanaSlot = await rpc('getSlot', []);
  out.finished = new Date().toISOString();
  require('fs').writeFileSync(process.argv[2] || 'guardian_check.out.json', JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1).slice(0, 3000));
})().catch(e => console.log('FATAL ' + e.message));
