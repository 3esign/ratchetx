'use strict';

const crypto = require('node:crypto');
const { b58decode, isWalletShaped } = require('./verify.js');

const DOMAIN = 'ratchetx.xyz';
const NETWORK = 'solana:mainnet';
const VERSION = 'ranked-shot-v1';
const VERIFIED_RANKED = Symbol('ratchetx.verified-ranked-shot');

function normalize(input, now = Date.now()) {
  const wallet = String(input.wallet || '');
  const target = String(input.target || '');
  const side = String(input.side || '').toUpperCase();
  const p = Number(input.p);
  const stake = Math.floor(input.stake == null ? 500 : Number(input.stake));
  const nonce = String(input.nonce || '').toLowerCase();
  const expiresAt = Number(input.expiresAt);
  if (!isWalletShaped(wallet) || b58decode(wallet).length !== 32) throw new Error('Invalid Solana wallet');
  if (!/^[A-Za-z0-9:_-]{3,96}$/.test(target)) throw new Error('Invalid target');
  if (side !== 'YES' && side !== 'NO') throw new Error('side must be YES or NO');
  if (!Number.isFinite(p) || p < 0.01 || p > 0.99) throw new Error('p must be between 0.01 and 0.99');
  if (!Number.isSafeInteger(stake) || stake < 100 || stake > 10000000) throw new Error('stake is out of range');
  if (!/^[a-f0-9]{32}$/.test(nonce)) throw new Error('Invalid nonce');
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + 120000) throw new Error('Invalid or expired signing window');
  return { domain:DOMAIN, network:NETWORK, version:VERSION, action:'ranked_shot',
    wallet, target, side, p:Number(p.toFixed(2)), stake, nonce, expiresAt };
}

function payloadFor(input, now = Date.now()) {
  return JSON.stringify(normalize(input, now));
}

function verifyPayload(payload, signature, wallet, now = Date.now()) {
  if (typeof payload !== 'string' || payload.length > 1024) throw new Error('Invalid payload');
  if (typeof signature !== 'string' || signature.length > 128) throw new Error('Invalid signature');
  let parsed;
  try { parsed = JSON.parse(payload); } catch { throw new Error('Invalid payload JSON'); }
  const canonical = normalize(parsed, now);
  if (canonical.wallet !== wallet) throw new Error('Wallet mismatch');
  if (JSON.stringify(canonical) !== payload) throw new Error('Payload is not canonical');
  const pub = b58decode(wallet);
  const key = crypto.createPublicKey({
    key:Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), pub]),
    format:'der', type:'spki',
  });
  if (!crypto.verify(null, Buffer.from(payload, 'utf8'), key, Buffer.from(signature, 'base64'))) {
    throw new Error('Invalid signature');
  }
  return canonical;
}

function markVerified(req, payload) {
  req[VERIFIED_RANKED] = payload;
}

function isVerifiedRequest(req, body) {
  const p = req && req[VERIFIED_RANKED];
  if (!p || !body) return false;
  return p.wallet === body.auth?.wallet && p.target === body.target && p.side === body.side
    && p.p === Number(body.p) && p.stake === Number(body.stake)
    && body.requestId === `ranked:${p.nonce}`;
}

module.exports = { DOMAIN, NETWORK, VERSION, VERIFIED_RANKED,
  normalize, payloadFor, verifyPayload, markVerified, isVerifiedRequest };
