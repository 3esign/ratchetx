// ============================================================
//  lib/prices.js — real settlement prices, no API key anywhere.
//  Primary: Pyth Hermes (the oracle every Solana perp uses).
//  Fallback: Coinbase public spot. Both are keyless GETs.
//  A shot is SEALED with the entry price and SETTLED with the
//  price at (or after) expiry — same source both times.
// ============================================================
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
  const r = await fetch(`https://hermes.pyth.network/v2/updates/price/latest?${q}`, { signal: AbortSignal.timeout(4000) });
  if (!r.ok) throw new Error('pyth ' + r.status);
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
  const syms = Object.keys(FEEDS);
  const vals = await Promise.all(syms.map(one));
  const out = { src: 'coinbase' };
  syms.forEach((s, i) => { if (vals[i]) out[s] = vals[i]; });
  for (const c of CORE) if (!out[c]) throw new Error('coinbase incomplete');
  return out;
}
async function getPrices() {
  try { return await pyth(); } catch { return await coinbase(); }
}
module.exports = { getPrices };
