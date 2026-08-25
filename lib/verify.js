// ============================================================
//  lib/verify.js - wallet-signature auth, zero dependencies.
//  Scheme: SIWS with session token
// ============================================================
const crypto = require('node:crypto');
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function b58decode(s) {
  let n = 0n;
  for (const c of s) {
    const v = B58.indexOf(c);
    if (v < 0) throw new Error('bad base58');
    n = n * 58n + BigInt(v);
  }
  let body = Buffer.alloc(0);
  if (n > 0n) {
    let hex = n.toString(16);
    if (hex.length & 1) hex = '0' + hex;
    body = Buffer.from(hex, 'hex');
  }
  let zeroes = 0;
  while (zeroes < s.length && s[zeroes] === '1') zeroes++;
  return Buffer.concat([Buffer.alloc(zeroes), body]);
}

/** True iff the string is shaped like a Solana pubkey (cheap, pre-decode). */
function isWalletShaped(w) {
  return typeof w === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(w);
}

async function verifyAuth(auth) {
  if (!auth) return { ok: false, reason: 'missing auth' };
  const { wallet, token } = auth;
  if (!wallet || !token) return { ok: false, reason: 'missing session' };
  if (!isWalletShaped(String(wallet))) return { ok: false, reason: 'bad wallet' };
  const { getJSON } = require('./kv.js');
  const sess = await getJSON('sess:' + token);
  if (!sess || sess.wallet !== wallet) return { ok: false, reason: 'session expired - reconnect wallet' };
  return { ok: true };
}

function verifySIWS(wallet, nonce, sig) {
  try {
    if (!wallet || !nonce || !sig) return false;
    if (!isWalletShaped(String(wallet))) return false;
    const pub = b58decode(String(wallet));
    if (pub.length !== 32) return false;
    const key = crypto.createPublicKey({
      key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), pub]),
      format: 'der', type: 'spki',
    });
    const msg = Buffer.from(`RATCHET | ${wallet} | ${nonce}`, 'utf8');
    return crypto.verify(null, msg, key, Buffer.from(sig, 'base64'));
  } catch { return false; }
}

function isDemo(w) {
  return typeof w === 'string' && w.startsWith('demo-') && w.length < 24 && /^demo-[a-z0-9]{1,18}$/.test(w);
}

module.exports = { verifyAuth, verifySIWS, isDemo, isWalletShaped, b58decode };
