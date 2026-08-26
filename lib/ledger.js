// ============================================================
//  lib/ledger.js — THE COINFLIP LEDGER
//
//  Prediction markets are routinely reported at a Brier score near 0.09.
//  That number is true and almost meaningless: it is dominated by markets
//  that were never in doubt. Sitting at 99% on a near-certainty and being
//  right scores beautifully and demonstrates nothing.
//
//  This ledger scores only the questions that were actually hard — the ones
//  where the venue's own crowd put the implied probability in a narrow band
//  around a coin flip — and it scores every venue on that same band, with
//  the same ground truth and the same settlement rule we hold ourselves to.
//
//  GROUND TRUTH is Pyth, read off Solana, using the identical predicate that
//  settles a RatchetX shot: the first recorded sample whose publish time is
//  at or after expiry, inside a 15-minute grace window. No sample, no score —
//  the observation is dropped and counted as dropped, never guessed.
//
//  WHAT IS AND IS NOT CLAIMED. These venues are not asked identical
//  questions; their strikes and expiries never line up, and pretending
//  otherwise would be the first thing an honest critic tore apart. Each
//  venue is scored on ITS OWN questions, restricted to the same difficulty
//  band. The band is the control. It is stated on the page, in the API
//  response, and here.
//
//  Every exclusion is counted and published. A ledger that quietly drops the
//  observations it cannot parse is a marketing asset, not a measurement.
// ============================================================
const { getJSON, getJSONStrict, setJSON, delKey } = require('./kv.js');
const px = require('./pxlog.js');

// The difficulty band. Outside it, a market is not making a hard call.
const BAND_LO = 0.35;
const BAND_HI = 0.65;

// Price history is retained for four days, so an observation is only taken
// when we will still be able to resolve it. This is a real limit and it is
// published rather than hidden: the ledger is a SHORT-HORIZON instrument.
const MAX_HORIZON_MS = 72 * 3600e3;
const MIN_HORIZON_MS = 5 * 60e3;

const FEEDS = ['SOL', 'BTC', 'ETH'];          // feeds every venue quotes
const K_OPEN   = 'ldg:open';
const K_SCORE  = 'ldg:score';
const K_RECENT = 'ldg:recent';
const K_DROP   = 'ldg:dropped';
const MAX_OPEN = 400;

const VENUES = Object.freeze({
  kalshi:      'Kalshi',
  polymarket:  'Polymarket',
  rx_crowd:    'RatchetX crowd',
  rx_stated:   'RatchetX players (stated)',
});

const clamp01 = p => Math.min(0.999, Math.max(0.001, p));
const inBand  = p => p >= BAND_LO && p <= BAND_HI;

async function fetchJSON(url, ms = 8000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { signal: ac.signal, headers: { accept: 'application/json' } });
    if (!r.ok) return { error: `HTTP ${r.status}` };
    return { data: await r.json() };
  } catch (e) {
    return { error: String((e && e.message) || e).slice(0, 120) };
  } finally { clearTimeout(timer); }
}

// ── parsing ─────────────────────────────────────────────────────────────
// Deliberately strict. A title we cannot read unambiguously is dropped and
// counted, never guessed at. Guessing is how a ledger starts lying.
const ASSET_RE = /\b(bitcoin|btc|ethereum|eth|solana|sol)\b/i;
const ASSET_OF = s => {
  const m = String(s || '').match(ASSET_RE); if (!m) return null;
  const a = m[1].toLowerCase();
  return (a === 'bitcoin' || a === 'btc') ? 'BTC'
       : (a === 'ethereum' || a === 'eth') ? 'ETH'
       : 'SOL';
};
const NUM_RE = /\$\s?([0-9][0-9,]*(?:\.[0-9]+)?)\s*(k|m)?\b/i;
const strikeOf = s => {
  const m = String(s || '').match(NUM_RE); if (!m) return null;
  let v = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(v)) return null;
  if (m[2] && m[2].toLowerCase() === 'k') v *= 1e3;
  if (m[2] && m[2].toLowerCase() === 'm') v *= 1e6;
  return v > 0 ? v : null;
};
// YES must mean "at or above the strike" for the ledger to resolve it.
const dirOf = s => {
  const t = String(s || '').toLowerCase();
  if (/\b(above|over|greater|higher|more than|at least|\bup\b|>=|>)\b/.test(t)) return 'above';
  if (/\b(below|under|less than|lower|dip|down to|<=|<)\b/.test(t)) return 'below';
  return null;
};

function parseMarket(title, extra = '') {
  const s = `${title || ''} ${extra || ''}`;
  const feed = ASSET_OF(s);
  if (!feed || !FEEDS.includes(feed)) return { drop: 'asset-not-covered' };
  const strike = strikeOf(s);
  if (strike == null) return { drop: 'no-strike' };
  const dir = dirOf(s);
  if (!dir) return { drop: 'ambiguous-direction' };
  return { feed, strike, dir };
}

// ── venue adapters ──────────────────────────────────────────────────────
// Each returns { obs: [...], drops: {reason: n}, error }. Field names are
// probed rather than assumed: a venue renaming a field must reduce coverage
// and say so, never silently corrupt a score.
const pick = (o, ...keys) => { for (const k of keys) { const v = o && o[k]; if (v != null && v !== '') return v; } return null; };
const asMs = v => {
  if (v == null) return null;
  const n = typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : Date.parse(v);
  return Number.isFinite(n) ? n : null;
};

// Kalshi publishes the strike STRUCTURALLY — strike_type plus floor/cap — so
// its questions are read from fields rather than from prose. Prices come in
// dollars (0-1) on the *_dollars fields; the older cent-denominated names are
// gone, which is exactly the kind of rename the drop counters are there to
// surface instead of silently swallowing.
const K_DIR = { greater: 'above', greater_or_equal: 'above', less: 'below', less_or_equal: 'below' };

function kalshiTerms(m) {
  const st = String(pick(m, 'strike_type', 'strikeType') || '').toLowerCase();
  const dir = K_DIR[st];
  if (dir) {
    const raw = dir === 'above' ? pick(m, 'floor_strike', 'floorStrike')
                                : pick(m, 'cap_strike', 'capStrike');
    const strike = Number(raw);
    if (Number.isFinite(strike) && strike > 0) return { dir, strike };
    return { drop: 'no-strike' };
  }
  if (st) return { drop: `strike-type-${st}` };   // between / functional / custom
  return null;                                     // fall back to reading the text
}

async function fromKalshi(now) {
  const drops = {};
  const bump = r => { drops[r] = (drops[r] || 0) + 1; };
  // Filter the horizon server-side. Asking for everything and discarding 90%
  // of it wasted the page limit on markets that could never qualify.
  const lo = Math.floor((now + MIN_HORIZON_MS) / 1000);
  const hi = Math.ceil((now + MAX_HORIZON_MS) / 1000);
  const { data, error } = await fetchJSON(
    `https://external-api.kalshi.com/trade-api/v2/markets?limit=1000&status=open&min_close_ts=${lo}&max_close_ts=${hi}`);
  if (error) return { obs: [], drops, error };
  const rows = (data && (data.markets || data.data)) || [];
  const obs = [];
  for (const m of rows) {
    const close = asMs(pick(m, 'close_time', 'closeTime', 'expected_expiration_time'));
    if (close == null) { bump('no-expiry'); continue; }
    const dt = close - now;
    if (dt < MIN_HORIZON_MS || dt > MAX_HORIZON_MS) { bump('outside-horizon'); continue; }
    const bid = Number(pick(m, 'yes_bid_dollars', 'yesBidDollars'));
    const ask = Number(pick(m, 'yes_ask_dollars', 'yesAskDollars'));
    let p = (Number.isFinite(bid) && Number.isFinite(ask) && (bid > 0 || ask > 0))
      ? (bid + ask) / 2
      : Number(pick(m, 'last_price_dollars', 'lastPriceDollars'));
    if (!Number.isFinite(p) || p <= 0 || p >= 1) { bump('no-price'); continue; }
    if (!inBand(p)) { bump('outside-band'); continue; }

    const text = [pick(m, 'yes_sub_title', 'title', 'subtitle'), pick(m, 'rules_primary'),
      pick(m, 'ticker'), pick(m, 'event_ticker')].filter(Boolean).join(' ');
    const feed = ASSET_OF(text);
    if (!feed || !FEEDS.includes(feed)) { bump('asset-not-covered'); continue; }

    const structured = kalshiTerms(m);
    const terms = structured || parseMarket(text);
    if (terms.drop) { bump(terms.drop); continue; }
    obs.push({ venue: 'kalshi', id: String(pick(m, 'ticker', 'id')), p: clamp01(p),
      feed, strike: terms.strike, dir: terms.dir, exp: close, at: now,
      src: structured ? 'fields' : 'text' });
  }
  return { obs, drops, error: null };
}

async function fromPolymarket(now) {
  const drops = {};
  const bump = r => { drops[r] = (drops[r] || 0) + 1; };
  // Same lesson: without the date bounds the first page came back full of
  // long-dead markets and every single one was discarded as out-of-horizon.
  const lo = new Date(now + MIN_HORIZON_MS).toISOString();
  const hi = new Date(now + MAX_HORIZON_MS).toISOString();
  const { data, error } = await fetchJSON(
    'https://gamma-api.polymarket.com/markets?closed=false&limit=500'
    + `&end_date_min=${encodeURIComponent(lo)}&end_date_max=${encodeURIComponent(hi)}`
    + '&order=endDate&ascending=true');
  if (error) return { obs: [], drops, error };
  const rows = Array.isArray(data) ? data : ((data && data.data) || []);
  const obs = [];
  for (const m of rows) {
    const close = asMs(pick(m, 'endDate', 'end_date_iso', 'endDateIso'));
    if (close == null) { bump('no-expiry'); continue; }
    const dt = close - now;
    if (dt < MIN_HORIZON_MS || dt > MAX_HORIZON_MS) { bump('outside-horizon'); continue; }
    let prices = pick(m, 'outcomePrices', 'outcome_prices');
    if (typeof prices === 'string') { try { prices = JSON.parse(prices); } catch { prices = null; } }
    const p = Array.isArray(prices) ? Number(prices[0]) : Number(pick(m, 'lastTradePrice'));
    if (!Number.isFinite(p) || p <= 0 || p >= 1) { bump('no-price'); continue; }
    if (!inBand(p)) { bump('outside-band'); continue; }
    const parsed = parseMarket(pick(m, 'question', 'title', 'slug'), pick(m, 'description') || '');
    if (parsed.drop) { bump(parsed.drop); continue; }
    obs.push({ venue: 'polymarket', id: String(pick(m, 'conditionId', 'id', 'slug')), p: clamp01(p),
      feed: parsed.feed, strike: parsed.strike, dir: parsed.dir, exp: close, at: now, src: 'text' });
  }
  return { obs, drops, error: null };
}

// ── resolution ──────────────────────────────────────────────────────────
// The same predicate that settles a shot on this site. Nothing softer.
async function outcomeOf(o, now) {
  const r = await px.priceCrossing(o.feed, o.exp, now);
  if (!r) return { status: 'void', reason: 'no-oracle-answer' };
  if (r.wait) return { status: 'wait' };
  // An observation the oracle cannot settle is DROPPED, never estimated from
  // the nearest print. priceCrossing offers an `indicative` price for exactly
  // that temptation; the ledger refuses it, because a score built on a price
  // that failed our own settlement rule is a score we would have to defend by
  // explaining why the rule applies to players and not to us.
  if (r.expired || !Number.isFinite(r.price))
    return { status: 'void', reason: String(r.reason || 'unsettleable') };
  const yes = o.dir === 'above' ? (r.price >= o.strike) : (r.price <= o.strike);
  return { status: 'ok', hit: yes ? 1 : 0, price: r.price, publishTime: r.publishTime || null };
}

const emptyScore = () => ({ n: 0, sum: 0, hits: 0, bins: Array.from({ length: 10 }, () => ({ n: 0, hits: 0 })) });

function addScore(sc, p, hit) {
  sc.n += 1;
  sc.sum += (p - hit) ** 2;
  sc.hits += hit;
  const b = Math.min(9, Math.max(0, Math.floor(p * 10)));
  sc.bins[b].n += 1; sc.bins[b].hits += hit;
  return sc;
}

const summarise = sc => {
  if (!sc || !sc.n) return null;
  const brier = sc.sum / sc.n;
  return {
    n: sc.n, brier: Math.round(brier * 1e4) / 1e4,
    brierIndex: Math.round((1 - Math.sqrt(Math.min(1, brier))) * 100),
    hitRate: Math.round((sc.hits / sc.n) * 1000) / 10,
    bins: sc.bins,
  };
};

module.exports = {
  BAND_LO, BAND_HI, MAX_HORIZON_MS, MIN_HORIZON_MS, VENUES, FEEDS,
  K_OPEN, K_SCORE, K_RECENT, K_DROP, MAX_OPEN,
  fetchJSON, parseMarket, ASSET_OF, strikeOf, dirOf, inBand, clamp01, kalshiTerms,
  fromKalshi, fromPolymarket, outcomeOf, emptyScore, addScore, summarise,
};
