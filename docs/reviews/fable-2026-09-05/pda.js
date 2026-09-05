'use strict';
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
module.exports = { findProgramAddress, b58enc, b58dec, isOnCurve };
