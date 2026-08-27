// The Coinflip Ledger: parsing, the difficulty band, scoring, and the
// refusals. External venues are stubbed — the point of these assertions is
// that the ledger drops what it cannot read instead of guessing at it.
import http from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let pass = 0, failn = 0;
const ok = (c, l) => { if (c) { pass++; console.log('PASS  ' + l); } else { failn++; console.log('FAIL  ' + l); } };

const L = require('../lib/ledger.js');

// ---- 1. parsing is strict on purpose
ok(L.ASSET_OF('Will Bitcoin close above $95,000?') === 'BTC', 'reads BTC from a title');
ok(L.ASSET_OF('Will Solana be over $180 today?') === 'SOL', 'reads SOL from a title');
ok(L.ASSET_OF('Will the Fed cut rates?') === null, 'a non-crypto question has no asset');
ok(L.strikeOf('above $95,000') === 95000, 'parses a comma-grouped strike');
ok(L.strikeOf('above $95k') === 95000, 'parses a k-suffixed strike');
ok(L.strikeOf('sometime soon') === null, 'no strike means no strike');
ok(L.dirOf('close above $95k') === 'above' && L.dirOf('dip below $80k') === 'below', 'reads direction');
ok(L.dirOf('Will BTC touch $95k?') === null, 'an ambiguous direction is refused, not assumed');

ok(L.parseMarket('Will Bitcoin be above $95,000 on Friday?').feed === 'BTC', 'full parse succeeds');
ok(L.parseMarket('Will BTC touch $95k?').drop === 'ambiguous-direction', 'ambiguous title is dropped with a reason');
ok(L.parseMarket('Will DOGE be above $1?').drop === 'asset-not-covered', 'uncovered asset dropped with a reason');
ok(L.parseMarket('Will Bitcoin go up?').drop === 'no-strike', 'strikeless title dropped with a reason');

// ---- 2. the band is the whole control
ok(L.inBand(0.5) && L.inBand(0.35) && L.inBand(0.65), 'the band includes its edges');
ok(!L.inBand(0.34) && !L.inBand(0.9) && !L.inBand(0.05), 'near-certainties are excluded — that is the point');

// ---- 3. scoring
const sc = L.emptyScore();
L.addScore(sc, 0.6, 1);           // (0.6-1)^2 = 0.16
L.addScore(sc, 0.4, 0);           // (0.4-0)^2 = 0.16
const sm = L.summarise(sc);
ok(sm.n === 2 && sm.brier === 0.16, `brier = 0.16 (got ${sm && sm.brier})`);
ok(sm.brierIndex === 60, `brierIndex = round((1-sqrt(0.16))*100) = 60 (got ${sm && sm.brierIndex})`);
ok(sm.hitRate === 50, 'hit rate reported alongside');
ok(sm.bins[6].n === 1 && sm.bins[6].hits === 1 && sm.bins[4].n === 1 && sm.bins[4].hits === 0, 'reliability bins populate');
ok(L.summarise(L.emptyScore()) === null, 'an empty venue summarises to null, never to a flattering default');

// ---- 4. venue adapters: fixtures in, honest drops out
const realFetch = globalThis.fetch;
const NOW = Date.now();
const soon = NOW + 3600e3;
let lastKalshiUrl = '', lastPolyUrl = '';
globalThis.fetch = async (url) => {
  const u = String(url);
  let body;
  if (u.includes('kalshi')) {
    lastKalshiUrl = u;
    const series = (u.match(/series_ticker=([A-Z0-9]+)/) || [])[1];
    if (series === 'KXBTC') body = { markets: [
      // A LADDER: one event, five rungs. Only the rung nearest a coin flip may
      // survive, and it must survive on its own two-sided book.
      { ticker:'KXBTC-A', event_ticker:'KXBTC-26AUG27', strike_type:'greater_or_equal', floor_strike:95000,
        yes_bid_dollars:0.48, yes_ask_dollars:0.52, close_time:new Date(soon).toISOString() },
      { ticker:'KXBTC-A2', event_ticker:'KXBTC-26AUG27', strike_type:'greater_or_equal', floor_strike:96000,
        yes_bid_dollars:0.38, yes_ask_dollars:0.42, close_time:new Date(soon).toISOString() },
      { ticker:'KXBTC-A3', event_ticker:'KXBTC-26AUG27', strike_type:'greater_or_equal', floor_strike:97000,
        yes_bid_dollars:0.36, yes_ask_dollars:0.40, close_time:new Date(soon).toISOString() },
      // out of band entirely
      { ticker:'KXBTC-C', event_ticker:'KXBTC-OTHER', strike_type:'greater', floor_strike:95000,
        yes_bid_dollars:0.94, yes_ask_dollars:0.96, close_time:new Date(soon).toISOString() },
      // a RANGE bucket — two thresholds, and now resolvable
      { ticker:'KXBTC-E', event_ticker:'KXBTC-BETWEEN', strike_type:'between', floor_strike:90000, cap_strike:95000,
        yes_bid_dollars:0.48, yes_ask_dollars:0.52, close_time:new Date(soon).toISOString() },
      // a shape we still refuse, because we cannot read it
      { ticker:'KXBTC-X', event_ticker:'KXBTC-FUNC', strike_type:'functional',
        yes_bid_dollars:0.48, yes_ask_dollars:0.52, close_time:new Date(soon).toISOString() },
      // a malformed range is refused rather than guessed at
      { ticker:'KXBTC-BAD', event_ticker:'KXBTC-BADRANGE', strike_type:'between', floor_strike:95000, cap_strike:90000,
        yes_bid_dollars:0.48, yes_ask_dollars:0.52, close_time:new Date(soon).toISOString() },
      // NO LIVE BOOK — this is the shape that produced twelve identical 0.395s
      { ticker:'KXBTC-F', event_ticker:'KXBTC-NOBOOK', strike_type:'greater', floor_strike:95000,
        yes_bid_dollars:0, yes_ask_dollars:0, last_price_dollars:0.395, close_time:new Date(soon).toISOString() },
      // a book so wide the mid is not a belief
      { ticker:'KXBTC-W', event_ticker:'KXBTC-WIDE', strike_type:'greater', floor_strike:95000,
        yes_bid_dollars:0.25, yes_ask_dollars:0.62, close_time:new Date(soon).toISOString() },
    ] };
    else if (series === 'KXETHD') body = { markets: [
      { ticker:'KXETHD-B', strike_type:'less', cap_strike:3200,
        yes_bid_dollars:0.44, yes_ask_dollars:0.46, close_time:new Date(soon).toISOString() },
    ] };
    else body = { markets: [] };
  } else {
    lastPolyUrl = u;
    body = [
      { conditionId:'0xaa', question:'Will Ethereum close above $3,200 today?', outcomePrices:'["0.55","0.45"]', endDate:new Date(soon).toISOString() },
      { conditionId:'0xbb', question:'Will Ethereum touch $3,200 today?',       outcomePrices:'["0.55","0.45"]', endDate:new Date(soon).toISOString() },
      { conditionId:'0xcc', question:'Will Ethereum close above $3,200 today?', outcomePrices:'["0.02","0.98"]', endDate:new Date(soon).toISOString() },
    ];
  }
  return { ok:true, json: async () => body };
};

const k = await L.fromKalshi(NOW);
ok(/series_ticker=/.test(lastKalshiUrl) && /mve_filter=exclude/.test(lastKalshiUrl),
   'kalshi is asked for the crypto series by name, not for every open market');
ok(/min_close_ts=\d+/.test(lastKalshiUrl) && /max_close_ts=\d+/.test(lastKalshiUrl),
   'kalshi horizon is filtered server-side, not by discarding a full page');
ok(k.obs.length === 5, `kalshi returns each in-band rung before collapsing (${k.obs.length})`);
const rng = k.obs.find(o => o.id === 'KXBTC-E');
ok(rng && rng.dir === 'between' && rng.strike === 90000 && rng.strike2 === 95000,
   'a range bucket is read as two thresholds, not thrown away');
ok(k.drops['bad-range'] === 1, 'a malformed range is refused rather than guessed at');
ok(k.drops['strike-type-functional'] === 1, 'a shape we genuinely cannot read is still refused, by name');
ok(k.drops['no-two-sided-book'] === 1,
   'a market with no live bid/ask is refused — a last-traded print is not a crowd belief');
ok(k.drops['spread-too-wide'] === 1, 'and a mid from an absurdly wide book is refused too');
const collapsed = L.collapseLadders(k.obs);
ok(collapsed.kept.length === 3 && collapsed.dropped === 2,
   `the ladder collapses to one observation per event (${collapsed.kept.length} kept, ${collapsed.dropped} dropped)`);
const rung = collapsed.kept.find(o => o.event === 'KXBTC-26AUG27');
ok(rung && rung.id === 'KXBTC-A' && Math.abs(rung.p - 0.5) < 1e-9,
   'and the rung kept is the one closest to a coin flip, not the first seen');
const kb = k.obs.find(o => o.id === 'KXBTC-A'), ke = k.obs.find(o => o.id === 'KXETHD-B');
ok(kb && kb.feed === 'BTC' && kb.strike === 95000 && kb.dir === 'above' && kb.src === 'fields',
   'greater_or_equal reads the FLOOR strike out of the fields');
ok(ke && ke.feed === 'ETH' && ke.strike === 3200 && ke.dir === 'below' && ke.src === 'fields',
   'less reads the CAP strike out of the fields');
ok(kb.feed === 'BTC' && !/bitcoin/i.test(JSON.stringify(kb)), 'the ASSET comes from the series, never guessed from a title');
ok(Math.abs(kb.p - 0.5) < 1e-9, 'kalshi price is the dollar-denominated mid, not cents');
ok(k.drops['outside-band'] === 1 && !k.drops['strike-type-between'],
   `kalshi exclusions are counted and named, and 'between' is no longer among them (${JSON.stringify(k.drops)})`);
ok(Object.keys(k.drops).some(x => x.startsWith('series-empty:')), 'an empty series is named, not silently skipped');

const pm = await L.fromPolymarket(NOW);
ok(/end_date_min=/.test(lastPolyUrl) && /end_date_max=/.test(lastPolyUrl),
   'polymarket horizon is filtered server-side too');
ok(pm.obs.length === 1 && pm.obs[0].id === '0xaa', `polymarket keeps only the readable in-band market (${pm.obs.length})`);
ok(pm.obs[0].p === 0.55 && pm.obs[0].feed === 'ETH', 'polymarket implied probability read from outcomePrices');
ok(pm.drops['ambiguous-direction'] === 1 && pm.drops['outside-band'] === 1, 'every polymarket exclusion is counted');

globalThis.fetch = async () => { throw new Error('venue down'); };
const dead = await L.fromKalshi(NOW);
ok(dead.obs.length === 0 && /venue down/.test(dead.error || ''), 'a venue outage surfaces as an error, not as a zero score');

// ---- 5. resolution refuses to guess
const px = require('../lib/pxlog.js');
const orig = px.priceCrossing;
px.priceCrossing = async () => ({ wait: true });
ok((await L.outcomeOf({ feed:'BTC', exp:NOW, strike:95000, dir:'above' }, NOW)).status === 'wait',
   'an unexpired observation waits');
px.priceCrossing = async () => ({ expired:true, reason:'no-observed-update-in-window', indicative:{ price:99999 } });
const v = await L.outcomeOf({ feed:'BTC', exp:NOW, strike:95000, dir:'above' }, NOW);
ok(v.status === 'void' && v.reason === 'no-observed-update-in-window',
   'an unsettleable observation VOIDS — the indicative price is refused');
px.priceCrossing = async () => ({ price: 96000, publishTime: NOW });
const hit = await L.outcomeOf({ feed:'BTC', exp:NOW, strike:95000, dir:'above' }, NOW);
ok(hit.status === 'ok' && hit.hit === 1, 'above-strike resolves YES');
const miss = await L.outcomeOf({ feed:'BTC', exp:NOW, strike:97000, dir:'above' }, NOW);
ok(miss.status === 'ok' && miss.hit === 0, 'below-strike resolves NO');
const below = await L.outcomeOf({ feed:'BTC', exp:NOW, strike:97000, dir:'below' }, NOW);
ok(below.status === 'ok' && below.hit === 1, 'a below-question resolves on its own terms');
const inRange = await L.outcomeOf({ feed:'BTC', exp:NOW, strike:95000, strike2:97000, dir:'between' }, NOW);
ok(inRange.status === 'ok' && inRange.hit === 1, 'a price inside the range resolves YES');
const outRange = await L.outcomeOf({ feed:'BTC', exp:NOW, strike:90000, strike2:94000, dir:'between' }, NOW);
ok(outRange.status === 'ok' && outRange.hit === 0, 'a price outside the range resolves NO');
// Inclusivity used to decide this case: an exact boundary print counted as a hit.
// The referee band supersedes it. A strike the settling print lands exactly on is the
// most ambiguous case there is, so it now voids — the same answer the on-chain program
// gives an exact tie, and for the same reason.
const edge = await L.outcomeOf({ feed:'BTC', exp:NOW, strike:96000, strike2:99000, dir:'between' }, NOW);
ok(edge.status === 'void' && edge.reason === 'inside-referee-band',
  'a print landing exactly on a bound voids rather than resolving it by convention');
px.priceCrossing = orig;

// ---- the referee band: we do not score what our own referee cannot separate
// Kalshi settles on a 60-price average of CF Benchmarks' RTI; Polymarket's Up/Down
// series on a Chainlink 60s TWAP; this ledger on a single Pyth print. Inside the
// interval a 60-second average could have landed in, the verdict belongs to the
// choice of oracle rather than to the forecast.
{
  const origPath = px.pathFor;
  const iv = async (price, confBps, path) => {
    px.pathFor = async () => path;
    return L.refereeInterval('BTC', 1_000_000, { price, confBps });
  };

  const flat = await iv(80_000, 2, [[1, 80_000], [2, 80_000]]);
  ok(Math.abs(flat.lo - 79_984) < 0.01 && Math.abs(flat.hi - 80_016) < 0.01,
    'a flat minute leaves only Pyth confidence: 2bps of 80k is +/-16');

  const moved = await iv(80_000, 2, [[1, 79_900], [2, 80_120]]);
  ok(moved.lo === 79_900 && moved.hi === 80_120,
    'a minute that moved widens the interval to the realised range');

  const noPath = await iv(80_000, 5, null);
  ok(Math.abs(noPath.lo - 79_960) < 0.01 && Math.abs(noPath.hi - 80_040) < 0.01,
    'no samples is not a licence to narrow: confidence alone stands');

  const noConf = await iv(80_000, undefined, [[1, 80_000]]);
  ok(noConf.lo === 80_000 && noConf.hi === 80_000,
    'a missing confidence contributes nothing rather than a guessed default');

  px.pathFor = async () => [[1, 79_990], [2, 80_010]];
  px.priceCrossing = async () => ({ price: 80_005, confBps: 2, publishTime: NOW });
  const inside = await L.outcomeOf({ feed:'BTC', exp:NOW, strike:80_000, dir:'above' }, NOW);
  ok(inside.status === 'void' && inside.reason === 'inside-referee-band',
    'a strike inside the interval is voided, never scored as a hit');

  const outside = await L.outcomeOf({ feed:'BTC', exp:NOW, strike:79_000, dir:'above' }, NOW);
  ok(outside.status === 'ok' && outside.hit === 1,
    'a strike clear of the interval still scores normally');

  const between = await L.outcomeOf({ feed:'BTC', exp:NOW, strike:70_000, strike2:80_000, dir:'between' }, NOW);
  ok(between.status === 'void' && between.reason === 'inside-referee-band',
    'a range is ambiguous if EITHER of its ends sits inside the interval');

  px.pathFor = origPath;
  px.priceCrossing = orig;
}

// ---- 6. the endpoint speaks its own limits
globalThis.fetch = realFetch;
const ledger = require('../api/ledger.js');
const srv = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const fake = { method:'GET', query:Object.fromEntries(u.searchParams), headers:{}, socket:{} };
  const out = { _s:200, status(c){this._s=c;return this;},
    json(o){ res.writeHead(this._s,{'content-type':'application/json'}); res.end(JSON.stringify(o)); },
    setHeader(){}, end(t){ res.end(t); } };
  await ledger(fake, out);
});
await new Promise(r => srv.listen(8319, r));
const board = await (await fetch('http://127.0.0.1:8319/')).json();
ok(board.ok === true, 'ledger endpoint responds');
ok(board.band.lo === 0.35 && board.band.hi === 0.65, 'the board publishes its band');
ok(/NOT asked identical questions/.test(board.caveat || ''), 'the board publishes the comparability caveat itself');
ok(/first recorded sample published at or after expiry/.test(board.groundTruth || ''), 'the board publishes the settlement predicate');
ok(Array.isArray(board.rows) && board.rows.length === 4, 'four rows: two venues, our crowd, our players');
ok(board.rows.every(r => 'brier' in r && 'n' in r), 'every row carries its sample size next to its score');
ok(board.rows.some(r => r.id === 'rx_crowd' && r.why), 'an unscored row says WHY rather than being omitted');
ok('excluded' in board && /counted here rather than dropped silently/.test(board.excludedNote || ''), 'exclusions are part of the published board');
ok(/github.com\/3esign\/ratchetx/.test(board.reproduce || ''), 'the board links the code that produced it');
console.log(`\n${pass} passed, ${failn} failed`);
// Windows/libuv asserts (src\win\async.c, UV_HANDLE_CLOSING) if the process
// tears down while a handle is still closing, which fails the run AFTER every
// assertion has already passed. Drain the server, then let the loop end on its
// own instead of calling process.exit() mid-close.
process.exitCode = failn ? 1 : 0;
srv.closeAllConnections?.();
await new Promise(r => srv.close(() => r()));
setTimeout(() => process.exit(process.exitCode || 0), 3000).unref();

