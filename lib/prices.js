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
//  STOCKS are different in one way only. Pyth publishes no sponsored push
//  account for an equity feed, so source 1 — which reads those accounts — can
//  never carry one. The five Equity.Index feeds are fetched from the same
//  keyless Hermes the on-chain crank posts from and merged onto a healthy
//  on-chain read, under the same age and confidence guards source 1 applies.
//  They are Pyth's continuous 24/7 index marks, not an exchange print, and the
//  UI must say so. A stock feed that fails any guard simply drops off the menu.
//
//  A shot is SEALED with the entry price and SETTLED with the price at (or
//  after) expiry — same source both times. Moving the primary on-chain does
//  not bend that promise; it makes it checkable, because anyone can read the
//  same account at the same slot and get the same number.
// ============================================================
const { onchainPrices, MAX_AGE_S, MAX_CONF_BPS } = require('./onchain_px.js');
const msgOf = e => String((e && e.message) || e).slice(0, 90);
// Hermes needs a key. Every host, every feed, no exceptions.
//
// This used to gate on the HOST: the theory was that only the legacy
// hermes.pyth.network became authenticated at the Aug 2026 Core cutover
// (OP-PIP-131) and that pyth.dourolabs.app stayed keyless. Measured 2026-09-02,
// server-side, that is false -- both hosts answer 401 on
// /v2/updates/price/latest, for SOL exactly as for TSLA. Pyth's own upgrade
// page: "every Hermes user needs a Pyth API Key". The mirror was never a
// keyless alternative; it is the upgraded host.
//
// What misled us is that /v2/price_feeds, the METADATA path, is still open --
// so a feed-id check against that host succeeded and read as proof the host was
// keyless. It was proof about a different endpoint.
//
// So: no key, no Hermes. Skipping it costs nothing and saves a round trip per
// price read that could only ever have returned 401, and the reason travels in
// `degraded` instead of an HTTP status nobody sees. On-chain push reads are
// unaffected and still need no key -- that is the whole crypto path.
const PYTH_KEY = process.env.PYTH_API_KEY || '';
const HERMES = process.env.PYTH_HERMES_URL || 'https://pyth.dourolabs.app/hermes';
const NO_HERMES_KEY = 'no PYTH_API_KEY: Hermes has required one on every host since the 2026-08-26 Pyth Core upgrade';

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
  // Stocks. Every id below is the Equity.INDEX variant -- Pyth's continuous
  // 24/7 mark -- deliberately, not the market-hours Equity.US variant that
  // exists under the same ticker. The index feed is what lets a shot sealed at
  // 03:00 settle at 03:05 on a real published price instead of a stale close.
  TSLA: 'e6da44bff5b8b06897a3739dd331b440d6662595bb862e37046892c568ae3fc0',
  NVDA: 'a470c4ac46f44b547b2cba52338f311fb642b79375ce5f0cfd5cb5b99227b852',
  PLTR: '52c7c6b70032b7151c8d0febf684f14318e1e13315976e171267639955400bb9',
  COIN: '49387483ff50427bf0ff5928082b0cf16331421067c59f4c582a07aa117db1ac',
  HOOD: '4a4f96283d157d08b7b8aa596363f7978587d4fa59a77dcb90f84af7d870a630',
};
const EQUITY = new Set(['TSLA', 'NVDA', 'PLTR', 'COIN', 'HOOD']);
const CORE = ['SOL', 'BTC', 'ETH'];

// A Hermes print is only usable if it is current and tight. onchain_px applies
// exactly these two bounds to the accounts it reads; equities arrive by a
// different road and must clear the same bar before they can settle anything.
// Crypto's existing Hermes path is deliberately left as it was: adding a new
// way for SOL to fail is a behaviour change, not a stocks feature.
function freshEnough(entry, nowS) {
  const t = Number(entry && entry.price && entry.price.publish_time);
  if (!Number.isFinite(t)) return false;
  const age = nowS - t;
  if (age > MAX_AGE_S || age < -5) return false;          // stale, or a skewed clock
  const px = Number(entry.price.price), conf = Number(entry.price.conf);
  if (!Number.isFinite(px) || px <= 0) return false;
  if (!Number.isFinite(conf) || conf < 0) return false;
  return (conf / px) * 10000 <= MAX_CONF_BPS;
}

async function pyth() {
  const q = Object.values(FEEDS).map(id => 'ids[]=' + id).join('&');
  const headers = PYTH_KEY ? { Authorization: `Bearer ${PYTH_KEY}` } : undefined;
  const r = await fetch(`${HERMES}/v2/updates/price/latest?${q}`,
    { headers, signal: AbortSignal.timeout(4000) });
  if (!r.ok) throw new Error('pyth ' + r.status + (r.status === 401 || r.status === 403
    ? ' — authenticated Hermes route is not configured' : ''));
  const j = await r.json();
  const out = {};
  const nowS = Math.floor(Date.now() / 1000);
  for (const p of j.parsed || []) {
    const sym = Object.keys(FEEDS).find(k => FEEDS[k] === p.id);
    if (!sym) continue;
    if (EQUITY.has(sym) && !freshEnough(p, nowS)) continue;   // drops the target, settles nothing
    out[sym] = Number(p.price.price) * 10 ** Number(p.price.expo);
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

// Source 1 reads sponsored push accounts, and stocks have none. Rather than
// leave the board crypto-only whenever the primary is healthy, ask Hermes for
// the five equity feeds and merge them in. This never throws: if the stocks are
// unreachable or stale, crypto is returned exactly as source 1 produced it and
// the stock targets are absent for that poll.
// A stock reaches the board only through Hermes, so a single gated host is a
// single point of failure for the whole asset class. Checked 2026-09-02: the
// keyless mirror answers `unauthorized` to a browser request, which is almost
// certainly an origin block rather than a key requirement -- server-side reads
// send no Origin and the crypto fallback route has used this same host and path
// in production throughout. Almost certainly is not a basis for settling money,
// so try the mirror, then the canonical host, and report which one answered.
const EQUITY_HOSTS = [...new Set([HERMES, 'https://hermes.pyth.network'])];

async function equityFrom(host, ids, headers) {
  const r = await fetch(`${host}/v2/updates/price/latest?${ids}`,
    { headers, signal: AbortSignal.timeout(3000) });
  if (!r.ok) throw new Error(`${r.status}`);
  const j = await r.json();
  if (!Array.isArray(j.parsed)) throw new Error('no parsed prices');
  return j.parsed;
}

async function withEquities(base) {
  // Stocks reach the board ONLY through Hermes -- no equity feed is pushed on
  // Solana by anyone, so there is no account to read instead. Without a key
  // there is no stock board, and saying that is more useful than two 401s.
  if (!PYTH_KEY) { base.equityOff = NO_HERMES_KEY; return base; }
  const ids = [...EQUITY].map(s => 'ids[]=' + FEEDS[s]).join('&');
  const headers = PYTH_KEY ? { Authorization: `Bearer ${PYTH_KEY}` } : undefined;
  const why = [];
  for (const host of EQUITY_HOSTS) {
    let parsed;
    try { parsed = await equityFrom(host, ids, headers); }
    catch (e) { why.push(host.replace(/^https?:\/\//, '') + ': ' + msgOf(e)); continue; }
    const nowS = Math.floor(Date.now() / 1000);
    let got = 0, stale = 0;
    for (const p of parsed) {
      const sym = [...EQUITY].find(k => FEEDS[k] === p.id);
      if (!sym) continue;
      if (!freshEnough(p, nowS)) { stale++; continue; }
      base[sym] = Number(p.price.price) * 10 ** Number(p.price.expo);
      got++;
    }
    if (got) { base.equitySrc = host; return base; }
    why.push(host.replace(/^https?:\/\//, '') + `: ${stale} print(s) failed the age and confidence guards`);
  }
  // Never thrown, never silent. Crypto is returned exactly as the primary
  // produced it, the stock targets are absent for this poll, and the reason
  // travels with the payload so it is visible on the live board rather than
  // guessed at from an empty menu.
  base.equityOff = why.join(' | ').slice(0, 160);
  return base;
}

async function fetchPrices() {
  const why = [];

  // 1. the oracle where it actually lives
  try { return await withEquities(await onchainPrices()); }
  catch (e) { why.push('onchain: ' + msgOf(e)); }

  // 2. Hermes — only worth asking if we hold a key; without one it is a 401.
  if (PYTH_KEY) {
    try {
      const p = await pyth();
      p.degraded = why.join(' | ').slice(0, 140);   // on Pyth, but not on-chain
      return p;
    } catch (e) { why.push('hermes: ' + msgOf(e)); }
  } else {
    why.push('hermes: ' + NO_HERMES_KEY);
  }

  // 3. Falling back is better than failing, but it must never be invisible:
  // the page and the proof line have to say which oracle actually priced the
  // shot, because "same source at seal and settle" is a promise.
  const cb = await coinbase();
  cb.degraded = why.join(' | ').slice(0, 140);
  return cb;
}

module.exports = { getPrices, coinbase, FEEDS, EQUITY };
