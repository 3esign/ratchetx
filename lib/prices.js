// ============================================================
//  lib/prices.js — real settlement prices.
//
//  SOURCE ORDER
//    1. Pyth ON-CHAIN  (lib/onchain_px.js) — sponsored PriceUpdateV2 accounts
//       on Solana mainnet, matching the identity our settlement program
//       validates. This is the canonical primary.
//    2. Pyth Hermes    — optional authenticated display failover.
//    3. Coinbase spot  — last resort, and never silent: see `degraded`.
//
//  A shot is SEALED with the entry price and SETTLED with the price at (or
//  after) expiry — same source both times. Moving the primary on-chain does
//  not bend that promise; it makes it checkable, because anyone can read the
//  same account at the same slot and get the same number.
// ============================================================
const { onchainPrices } = require('./onchain_px.js');
const msgOf = e => String((e && e.message) || e).slice(0, 90);
// The Pyth Core cutover was announced for 18 Aug 2026 and actually EXECUTED on
// 26 Aug 2026, 16:00 UTC (OP-PIP-131) -- see docs/PYTH_TRANSITION_2026-08.md.
// The earlier date is kept deliberately: it is the conservative one, and after
// either date the rule is the same, do not keep probing an authenticated
// endpoint keylessly.
const HERMES_AUTH_CUTOVER = Date.now() >= Date.UTC(2026, 7, 18, 0, 0, 0);

const PYTH_KEY = process.env.PYTH_API_KEY || '';
const HERMES = process.env.PYTH_HERMES_URL || 'https://pyth.dourolabs.app/hermes';
const FEEDS = {
  SOL: 'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d',
  BTC: 'e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
  ETH: 'ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
  // optional feeds - if an id is wrong or the feed is down, its targets
  // simply disappear from the menu instead of settling on garbage
  BONK: '72b021217ca3fe68922a19aaf990109cb9d84e9ad004b4d2025ad6f529314419',
  // the house's own token — the game lives on pump.fun, so of course
  // you can call PUMP itself. Deep external market; no player moves it.
  PUMP: '7a01fca212788bba7c5bf8c9efd576a8a722f070d2c17596ff7bb609b8d5c3b9',
  JUP: '0a0408d619e9380abad35060f9192039ed5042fa6f82301d0e48bb52be830996',
  WIF: '4ca4beeca86f0d164160323817a4e42b10010a724c2217c6ee41b54cd4cc61fc',
};
const CORE = ['SOL', 'BTC', 'ETH'];

async function pyth() {
  const q = Object.values(FEEDS).map(id => 'ids[]=' + id).join('&');
  const headers = PYTH_KEY ? { Authorization: `Bearer ${PYTH_KEY}` } : undefined;
  const r = await fetch(`${HERMES}/v2/updates/price/latest?${q}`,
    { headers, signal: AbortSignal.timeout(4000) });
  if (!r.ok) throw new Error('pyth ' + r.status + (r.status === 401 || r.status === 403
    ? ' — authenticated Hermes route is not configured' : ''));
  const j = await r.json();
  const out = {};
  for (const p of j.parsed || []) {
    const sym = Object.keys(FEEDS).find(k => FEEDS[k] === p.id);
    if (sym) out[sym] = Number(p.price.price) * 10 ** Number(p.price.expo);
  }
  for (const c of CORE) if (!out[c]) throw new Error('pyth incomplete');
  return { src: 'pyth', ...out };
}
async function coinbase() {
  const one = async s => {
    try {
      const r = await fetch(`https://api.coinbase.com/v2/prices/${s}-USD/spot`, { signal: AbortSignal.timeout(4000) });
      const j = await r.json();
      const n = Number(j.data.amount);
      return Number.isFinite(n) && n > 0 ? n : null;
    } catch { return null; }
  };
  // Coinbase's JUP-USD symbol is not the Jupiter token represented by the
  // Pyth JUP feed. Comparing them produced multi-million-bps "divergence"
  // and could show the wrong JUP value on the display-only fallback route.
  // Omit ambiguous symbols instead of publishing a confidently wrong cross.
  const syms = Object.keys(FEEDS).filter(s => s !== 'JUP');
  const vals = await Promise.all(syms.map(one));
  const out = { src: 'coinbase' };
  syms.forEach((s, i) => { if (vals[i]) out[s] = vals[i]; });
  for (const c of CORE) if (!out[c]) throw new Error('coinbase incomplete');
  return out;
}
// A 2s cache per instance. Every API request used to hit Hermes directly, and
// the client polls every 6 seconds — so ~10 upstream calls per minute PER OPEN
// TAB. The public tier is 10 requests per 10 seconds, meaning about six people
// reading the page at once would have started getting 429s. Prices move less
// than nothing in two seconds, the source is unchanged, and the seal/settle
// promise is untouched: it is still Pyth, just not asked twice in the same
// breath. This is what keeps the game standing on the day traffic arrives.
const memo = globalThis.__ratchet_px || (globalThis.__ratchet_px = { t: 0, v: null, p: null });
// Matched to the client's own 6s poll: at most one upstream read per poll
// cycle per instance. The sponsored feeds heartbeat at 60s and only move
// early on a 0.5% deviation, so a 6s cache adds nothing a player can feel —
// and it avoids redundant provider work. Vercel runs many instances,
// each with its own cache, so upstream load scales with instances, not tabs.
const PRICE_TTL_MS = 6000;

async function getPrices() {
  if (memo.v && Date.now() - memo.t < PRICE_TTL_MS) return memo.v;
  if (memo.p) return memo.p;                       // collapse a burst into one call
  memo.p = fetchPrices().finally(() => { memo.p = null; });
  const v = await memo.p;
  memo.t = Date.now(); memo.v = v;
  return v;
}

async function fetchPrices() {
  const why = [];

  // 1. the oracle where it actually lives
  try { return await onchainPrices(); }
  catch (e) { why.push('onchain: ' + msgOf(e)); }

  // 2. Hermes, if we are paying for it
  if (PYTH_KEY || !HERMES_AUTH_CUTOVER) {
    try {
      const p = await pyth();
      p.degraded = why.join(' | ').slice(0, 140);   // on Pyth, but not on-chain
      return p;
    } catch (e) { why.push('hermes: ' + msgOf(e)); }
  } else {
    why.push('hermes: authenticated route not configured');
  }

  // 3. Falling back is better than failing, but it must never be invisible:
  // the page and the proof line have to say which oracle actually priced the
  // shot, because "same source at seal and settle" is a promise.
  const cb = await coinbase();
  cb.degraded = why.join(' | ').slice(0, 140);
  return cb;
}

module.exports = { getPrices, coinbase };
