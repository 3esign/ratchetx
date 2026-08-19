// ============================================================
//  lib/verify.js — wallet-signature auth, zero dependencies.
//  Scheme: the wallet signs the free message
//     "RATCHET | <wallet> | <unix_ms>"
//  Ed25519 verified with node:crypto via the DER-SPKI wrapper.
//  Freshness window 2h. No JWT, no session store, nothing to leak.
//
//  HARDENED 2026-08-19: length caps before any decoding — a
//  multi-kilobyte "wallet" string would otherwise buy an O(n²)
//  base58 decode for free. Valid inputs are unaffected: a Solana
//  pubkey is 32–44 base58 chars, a signature 88 base64 chars.
// ============================================================
const crypto = require('node:crypto');
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function b58decode(s) {
  const bytes = [0];
  for (const c of s) {
    const v = B58.indexOf(c);
    if (v < 0) throw new Error('bad base58');
    let carry = v;
    for (let i = 0; i < bytes.length; i++) { const x = bytes[i] * 58 + carry; bytes[i] = x & 0xff; carry = x >> 8; }
    while (carry) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  for (const c of s) { if (c === '1') bytes.push(0); else break; }
  return Buffer.from(bytes.reverse());
}

/** True iff the string is shaped like a Solana pubkey (cheap, pre-decode). */
function isWalletShaped(w) {
  return typeof w === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(w);
}

function verifyAuth({ wallet, ts, sig }, nowMs = Date.now()) {
  try {
    if (!wallet || ts == null || !sig) return { ok: false, reason: 'missing auth' };
    if (!isWalletShaped(String(wallet))) return { ok: false, reason: 'bad wallet' };
    if (typeof sig !== 'string' || sig.length > 128) return { ok: false, reason: 'bad signature' };
    const t = +ts;
    if (!Number.isFinite(t)) return { ok: false, reason: 'invalid timestamp' };
    if (Math.abs(nowMs - t) > 2 * 3600e3) return { ok: false, reason: 'signature expired - reconnect wallet' };
    const pub = b58decode(String(wallet));
    if (pub.length !== 32) return { ok: false, reason: 'bad wallet' };
    const key = crypto.createPublicKey({
      key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), pub]),
      format: 'der', type: 'spki',
    });
    const msg = Buffer.from(`RATCHET | ${wallet} | ${t}`, 'utf8');
    const ok = crypto.verify(null, msg, key, Buffer.from(sig, 'base64'));
    return ok ? { ok: true } : { ok: false, reason: 'bad signature' };
  } catch { return { ok: false, reason: 'bad signature' }; }
}

// Demo identities: "demo-xxxx" wallets play unranked with no signature.
// Server-side that now means exactly what the UI says: demo XP never
// reaches any ladder and demo wallets are never paid from any pot.
function isDemo(w) { return typeof w === 'string' && w.startsWith('demo-') && w.length < 24 && /^demo-[a-z0-9]{1,18}$/.test(w); }

module.exports = { verifyAuth, isDemo, isWalletShaped };
