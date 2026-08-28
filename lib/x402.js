'use strict';
// ============================================================
//  x402 arena entry — machines pay the CURRENT DAILY CHAMPION.
//
//  The arena requires a wallet that has touched $RCX (ARENA.md §0).
//  With X402_ENABLED=1, an agent wallet that has NOT touched RCX gets a
//  second door: an HTTP 402 quote in the x402 shape. The toll is a USDC
//  transfer paid DIRECTLY to the wallet currently on top of the daily
//  podium — the player who is beating the game today.
//
//  Read that again, because it is the whole design: the recipient is a
//  player, resolved from public state at quote time. No key of ours
//  signs anything, no address of ours appears anywhere, nothing is
//  custodied, and 0% goes to the team — the same 0% as everywhere else
//  in this system. The server only VERIFIES the transfer on-chain,
//  exactly the way the reload verifier works, and marks the signature
//  spent so a payment cannot be replayed.
//
//  Everything here is flag-gated (X402_ENABLED) and read late, so the
//  code can ship dark and be armed by configuration, and tests can
//  toggle it per call.
// ============================================================

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const MAX_AGE_SECONDS = 600;   // a quote is good for ten minutes of chain time

const enabled = () => process.env.X402_ENABLED === '1';
function entryAmountAtomic() {
  const n = Math.floor(Number(process.env.X402_ENTRY_USDC_ATOMIC || 1_000_000));
  return Number.isFinite(n) && n > 0 ? n : 1_000_000;   // default: 1 USDC
}

// The current champion, straight from the public podium. No champion yet
// (fresh day, empty board) means no quote — the old refusal stands.
async function championWallet(getJSONStrict) {
  const pod = await getJSONStrict('g:podium');
  const e = pod && Array.isArray(pod.list) && pod.list[0];
  const w = e && (e.w || e);
  return typeof w === 'string' && w.length > 0 ? w : null;
}

function quote({ payTo, amountAtomic, reason }) {
  return {
    ok: false,
    x402Version: 1,
    protocolStatus: 'manual-transfer prototype; not compatible with standard x402 v2 clients',
    error: reason || 'payment required',
    accepts: [{
      scheme: 'exact',
      network: 'solana',
      resource: 'ratchet://arena/agent-register',
      description: 'Arena entry for a wallet that has not touched $RCX. The toll is paid '
        + 'DIRECTLY to the current daily champion — the player beating the game right now — '
        + 'never to the team. Send the USDC transfer, then retry this request with the '
        + 'transaction signature in the X-PAYMENT header.',
      mimeType: 'application/json',
      payTo,
      maxAmountRequired: String(amountAtomic),
      asset: USDC_MINT,
      maxTimeoutSeconds: MAX_AGE_SECONDS,
      extra: { decimals: 6, payToIs: 'current daily champion, resolved from public state at quote time' },
    }],
  };
}

// X-PAYMENT: a raw base58 signature, "solana-tx:<sig>", or base64 JSON
// carrying { signature } — we meet clients where they are.
function parsePaymentHeader(h) {
  const s = String(h || '').trim();
  if (/^[1-9A-HJ-NP-Za-km-z]{60,100}$/.test(s)) return s;
  if (s.startsWith('solana-tx:')) {
    const sig = s.slice('solana-tx:'.length).trim();
    return /^[1-9A-HJ-NP-Za-km-z]{60,100}$/.test(sig) ? sig : null;
  }
  try {
    const j = JSON.parse(Buffer.from(s, 'base64').toString('utf8'));
    const sig = j && (j.signature || j.tx || (j.payload && j.payload.signature));
    return typeof sig === 'string' && /^[1-9A-HJ-NP-Za-km-z]{60,100}$/.test(sig) ? sig : null;
  } catch { return null; }
}

// How much USDC did this transaction actually deliver to payTo? Read the
// token-balance deltas, not the instruction list — deltas are what the
// chain settled, whatever path the transfer took.
function usdcDeltaTo(tx, payTo) {
  const pre = (tx.meta && tx.meta.preTokenBalances) || [];
  const post = (tx.meta && tx.meta.postTokenBalances) || [];
  const preBy = new Map();
  for (const b of pre) {
    if (b.owner === payTo && b.mint === USDC_MINT) preBy.set(b.accountIndex, BigInt(b.uiTokenAmount.amount));
  }
  let delta = 0n;
  for (const b of post) {
    if (b.owner === payTo && b.mint === USDC_MINT) {
      delta += BigInt(b.uiTokenAmount.amount) - (preBy.get(b.accountIndex) || 0n);
    }
  }
  return delta;
}

async function verifyPayment({ sig, payTo, amountAtomic }) {
  const { getTx } = require('./burn.js');
  const { setnxJSON } = require('./kv.js');
  const tx = await getTx(sig);
  if (!tx) return { ok: false, reason: 'transaction not found on-chain yet — wait for confirmation and retry' };
  if (tx.meta && tx.meta.err) return { ok: false, reason: 'that transaction failed on-chain' };
  const age = Math.floor(Date.now() / 1000) - Number(tx.blockTime || 0);
  if (!tx.blockTime || age > MAX_AGE_SECONDS) return { ok: false, reason: `payment is older than ${MAX_AGE_SECONDS} seconds — quotes name the current champion, pay and retry promptly` };
  const delta = usdcDeltaTo(tx, payTo);
  if (delta < BigInt(amountAtomic)) return { ok: false, reason: `that transaction delivers ${delta} USDC units to the current champion; the toll is ${amountAtomic}` };
  // Replay gate. The tiny window between verify and claim can, at worst,
  // let one payment cover one duplicate registration attempt by the same
  // payer — never a second spend of anyone's funds.
  const fresh = await setnxJSON('x402:sig:' + sig, { payTo, amount: amountAtomic, t: Date.now() });
  if (!fresh) return { ok: false, reason: 'that payment signature was already used' };
  return { ok: true, sig };
}

// The one entry point game.js calls when qualification fails.
// Returns: null                  → x402 not available; caller falls back to the old refusal
//          'responded'           → a 402 (quote or verify failure) was already sent
//          { granted, sig, ... } → payment verified; caller proceeds and records it
async function entryGate(req, res) {
  if (!enabled()) return null;
  const { getJSONStrict } = require('./kv.js');
  const payTo = await championWallet(getJSONStrict);
  if (!payTo) return null;
  const amountAtomic = entryAmountAtomic();
  const header = req.headers && (req.headers['x-payment'] || req.headers['X-PAYMENT']);
  if (!header) { res.status(402).json(quote({ payTo, amountAtomic })); return 'responded'; }
  const sig = parsePaymentHeader(header);
  if (!sig) { res.status(402).json(quote({ payTo, amountAtomic, reason: 'unreadable X-PAYMENT header — send the transaction signature' })); return 'responded'; }
  const v = await verifyPayment({ sig, payTo, amountAtomic });
  if (!v.ok) { res.status(402).json(quote({ payTo, amountAtomic, reason: v.reason })); return 'responded'; }
  return { granted: true, sig, payTo, amountAtomic };
}

// entryAmountAtomic is exported because /api/game?action=board advertises the
// toll to agents. A board that fell back to the default while the deployment
// had set a different one would be quoting a price nobody charges.
module.exports = { entryGate, quote, parsePaymentHeader, usdcDeltaTo, verifyPayment,
  championWallet, entryAmountAtomic, enabled, USDC_MINT };
