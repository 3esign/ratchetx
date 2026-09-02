// Real prices with one canonical invariant: no API key can change the
// economic game. Sponsored Pyth PriceUpdateV2 accounts on Solana are primary.
// Coinbase is a labeled display-only fallback; api/game.js refuses to seal
// unless the required Pyth-on-Solana crossing metadata is present.
//
// Stocks remain intentionally held. No sponsored equity account currently
// supplies the same keyless, verifiable settlement rail. Recognizing a ticker
// is useful for an honest refusal, but configuring a secret must never make a
// new economic target appear.
const { onchainPrices } = require('./onchain_px.js');
const msgOf = e => String((e && e.message) || e).slice(0, 90);
const EQUITY_OFF = 'stocks held: no API-keyless Pyth-on-Solana feed currently meets RatchetX settlement requirements';

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
const EQUITY = new Set(['TSLA', 'NVDA', 'PLTR', 'COIN', 'HOOD']);
const CORE = ['SOL', 'BTC', 'ETH'];

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
  // Equities are excluded for a stronger version of the same reason: Coinbase
  // quotes no TSLA-USD spot at all, and any symbol that did resolve would be a
  // different instrument from Pyth's 24/7 index mark. On the last-resort route
  // the stock targets simply are not offered.
  const syms = Object.keys(FEEDS).filter(s => s !== 'JUP' && !EQUITY.has(s));
  const vals = await Promise.all(syms.map(one));
  const out = { src: 'coinbase' };
  syms.forEach((s, i) => { if (vals[i]) out[s] = vals[i]; });
  for (const c of CORE) if (!out[c]) throw new Error('coinbase incomplete');
  return out;
}
// One cache per instance, matched to the client's six-second poll. It collapses
// bursts of identical reads without changing the source or seal rules.
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

function markEquitiesOff(prices) {
  prices.equityOff = EQUITY_OFF;
  return prices;
}

async function fetchPrices() {
  const why = [];

  // The oracle where the economic game says it lives.
  try { return markEquitiesOff(await onchainPrices()); }
  catch (e) { why.push('onchain: ' + msgOf(e)); }

  // A visible fallback is better than a blank page. It remains display-only:
  // the seal guard requires src=pyth-onchain plus crossing metadata.
  const cb = await coinbase();
  cb.degraded = why.join(' | ').slice(0, 140);
  return markEquitiesOff(cb);
}

module.exports = { getPrices, coinbase, FEEDS, EQUITY, EQUITY_OFF };
