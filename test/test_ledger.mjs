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
globalThis.fetch = async (url) => {
  const u = String(url);
  const body = u.includes('kalshi') ? { markets: [
      { ticker:'KXBTC-A', title:'Will Bitcoin be above $95,000?', yes_bid:48, yes_ask:52, close_time:new Date(soon).toISOString() },
      { ticker:'KXBTC-B', title:'Will Bitcoin be above $95,000?', yes_bid:94, yes_ask:96, close_time:new Date(soon).toISOString() },
      { ticker:'KXFED-C', title:'Will the Fed cut in September?', yes_bid:48, yes_ask:52, close_time:new Date(soon).toISOString() },
      { ticker:'KXBTC-D', title:'Will Bitcoin be above $95,000?', yes_bid:48, yes_ask:52, close_time:new Date(NOW + 40*24*3600e3).toISOString() },
    ] }
    : [
      { conditionId:'0xaa', question:'Will Ethereum close above $3,200 today?', outcomePrices:'["0.55","0.45"]', endDate:new Date(soon).toISOString() },
      { conditionId:'0xbb', question:'Will Ethereum touch $3,200 today?',       outcomePrices:'["0.55","0.45"]', endDate:new Date(soon).toISOString() },
      { conditionId:'0xcc', question:'Will Ethereum close above $3,200 today?', outcomePrices:'["0.02","0.98"]', endDate:new Date(soon).toISOString() },
    ];
  return { ok:true, json: async () => body };
};

const k = await L.fromKalshi(NOW);
ok(k.obs.length === 1 && k.obs[0].id === 'KXBTC-A', `kalshi keeps only the in-band, readable, in-horizon market (${k.obs.length})`);
ok(k.obs[0].feed === 'BTC' && k.obs[0].strike === 95000 && k.obs[0].dir === 'above', 'kalshi observation carries feed, strike, direction');
ok(Math.abs(k.obs[0].p - 0.5) < 1e-9, 'kalshi implied probability is the mid of bid/ask in cents');
ok(k.drops['outside-band'] === 1 && k.drops['outside-horizon'] === 1 && k.drops['asset-not-covered'] === 1,
   `every kalshi exclusion is counted (${JSON.stringify(k.drops)})`);

const pm = await L.fromPolymarket(NOW);
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
px.priceCrossing = orig;

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
srv.close();

console.log(`\n${pass} passed, ${failn} failed`);
process.exit(failn ? 1 : 0);
