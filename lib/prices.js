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
};

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
  if (!out.SOL || !out.BTC || !out.ETH) throw new Error('pyth incomplete');
  return { src: 'pyth', ...out };
}
async function coinbase() {
  const one = async s => {
    const r = await fetch(`https://api.coinbase.com/v2/prices/${s}-USD/spot`, { signal: AbortSignal.timeout(4000) });
    const j = await r.json();
    return Number(j.data.amount);
  };
  const [SOL, BTC, ETH] = await Promise.all([one('SOL'), one('BTC'), one('ETH')]);
  return { src: 'coinbase', SOL, BTC, ETH };
}
async function getPrices() {
  try { return await pyth(); } catch { return await coinbase(); }
}
module.exports = { getPrices };
