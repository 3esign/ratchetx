// Tracker item 2.3. Two jobs, and they are deliberately different in kind.
//
// 1. The arithmetic behind the GATE 2 decision. `cadence-sampler.mjs summarize`
//    is pure, so the hit-rate table it produces is checked here against
//    hand-computable fixtures — including one that reproduces the tracker's own
//    "0/25 strict bracket" result in miniature. If the reducer is wrong, every
//    number in the manifest is wrong, and nobody would find out until a
//    write-once ruleset was already on chain.
//
// 2. The gate itself: a mainnet economy manifest may not exist without a
//    measurement behind it, and `maxPostTargetLagSeconds` may not be below the
//    measured p99 first-print lag. `releases/g2-mainnet-economy.json` is
//    Semir's decision 2 and does not exist yet, so today that half is ARMED AND
//    INERT: it prints what it is waiting for and passes. The day the manifest
//    lands it starts refusing, and it refuses at the exact moment the number
//    becomes permanent.
//
// A note on why the gate is shaped as "manifest implies measurement" rather than
// "measurement must exist": a test that fails because nobody has run a 24-hour
// sampler yet would be red for a day and then get an env-var escape hatch, and
// this repository already learned what happens to those (scripts/run-tests.mjs
// lines 143-152, and the seven false greens in tools/p6-canary). A gate that
// cannot be vacuously green about the thing that matters is worth more than one
// that is loudly red about the thing that does not.
//
// Evidence tier: host.

import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  summarize, percentile, gameFeeds, sourceAddressFor, auditManifest,
} from '../onchain/rcx-timepin-v2/scripts/cadence-sampler.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const MANIFEST = join(root, 'releases', 'g2-mainnet-economy.json');
const CADENCE_DIR = join(root, 'docs', 'reviews', 'cadence');
const PROPOSAL = join(root, 'docs', 'reviews', 'fable-2026-09-05', 'g2-mainnet-economy.proposal.json');

let checks = 0;
const check = (fn, label) => { fn(); checks += 1; };

// --- fixtures ----------------------------------------------------------------
// prev = pub - 1 throughout: that is the measured mainnet shape (tracker section 1,
// "always publish - prev = 1").

const prints = (symbol, publishTimes) => publishTimes.map(pub => JSON.stringify({
  kind: 'print', observedAt: pub, symbol, feedId: 'aa'.repeat(32),
  sourceAddress: 'FIXTURE', publishTime: pub, prevPublishTime: pub - 1,
  postedSlot: 1000 + pub,
}));

// Explicit (publish, prev) pairs, for the shapes where prev != pub - 1.
const printsWithPrev = (symbol, pairs) => pairs.map(([pub, prev]) => JSON.stringify({
  kind: 'print', observedAt: pub, symbol, feedId: 'bb'.repeat(32),
  sourceAddress: 'FIXTURE', publishTime: pub, prevPublishTime: prev,
  postedSlot: 1000 + pub,
}));

const withHeader = (lines, intervalMs = 1000) =>
  [JSON.stringify({ kind: 'header', intervalMs, startedAt: '2026-09-05T00:00:00Z' }), ...lines];

const series = (start, end, step) => {
  const out = [];
  for (let t = start; t <= end; t += step) out.push(t);
  return out;
};

// --- percentile --------------------------------------------------------------

check(() => {
  // Nearest-rank, stated so two agents cannot "measure" different p99s.
  assert.equal(percentile([1, 2, 3, 4, 5], 50), 3);
  assert.equal(percentile([1, 2, 3, 4, 5], 99), 5);
  assert.equal(percentile([0, 0, 0, 0, 100], 99), 100, 'p99 of 5 samples is the max');
  assert.equal(percentile(Array.from({ length: 100 }, (_, i) => i), 99), 98);
  assert.equal(percentile([], 99), null);
}, 'percentile is nearest-rank');

// --- fixture A: prints land exactly on the grid ------------------------------

check(() => {
  const s = summarize(withHeader(prints('A', series(100, 400, 5))));
  const g = s.feeds.A.grids['60'];
  assert.deepEqual(g.targets, 5, 'targets 120,180,240,300,360');
  assert.equal(g.minCapture.hit, 5);
  assert.equal(g.minCapture.firstPrintLagSeconds.max, 0, 'a print exists at each target');
  assert.equal(g.strictBracket.hit, 5, 'prev < T <= pub holds when T is itself a publish time');
  assert.equal(g.strictBracket.hitRate, 1);
}, 'fixture A: aligned cadence, both rules hit');

// --- fixture B: the measured mainnet phase, in miniature ----------------------
//
// Publish times at phase 2 mod 5 — the exact shape Fable measured (publish mod 5
// = 2 for 270 of 300 prints). This is where the tracker's headline number comes
// from, and the reducer has to reproduce it or the headline is unverified.

check(() => {
  const s = summarize(withHeader(prints('B', series(102, 402, 5))));
  const g = s.feeds.B.grids['60'];
  assert.equal(g.targets, 5, 'targets 120,180,240,300,360');
  assert.equal(g.strictBracket.hit, 0, 'STRICT BRACKET IS 0/5 — no print has publish_time == T');
  assert.equal(g.strictBracket.hitRate, 0);
  assert.equal(g.minCapture.hit, 5, 'MIN-CAPTURE hits every target');
  assert.equal(g.minCapture.hitRate, 1);
  assert.equal(g.minCapture.firstPrintLagSeconds.p99, 2, 'and does it 2 s late, every time');
  assert.equal(g.minCapture.firstPrintLagSeconds.max, 2);
}, 'fixture B: 0/5 bracket, 5/5 min-capture — the tracker result in miniature');

// --- fixture C: an outage inside the window ----------------------------------

check(() => {
  const s = summarize(withHeader(prints('C', [...series(102, 182, 5), ...series(300, 402, 5)])));
  const g = s.feeds.C.grids['60'];
  assert.equal(g.targets, 5, 'the window is still first..last print');
  assert.equal(g.minCapture.hit, 5, 'every target still finds a later print');
  // 120 -> 122 (2), 180 -> 182 (2), 240 -> 300 (60), 300 -> 300 (0), 360 -> 362 (2)
  assert.equal(g.minCapture.firstPrintLagSeconds.max, 60, 'the outage shows up as a 60 s lag');
  assert.equal(g.minCapture.firstPrintLagSeconds.p99, 60, 'and it is what a p99 of five targets is');
  assert.ok(g.minCapture.firstPrintLagSeconds.p50 <= 2, 'the median is unmoved by one outage');
  assert.ok(s.feeds.C.publishGapSeconds.max >= 118, 'the gap itself is visible in publishGapSeconds');
}, 'fixture C: an outage moves p99 and max, not p50');

check(() => {
  // Targets outside the observed window are not counted. Counting them would
  // manufacture a void rate out of the fact that we started sampling at 10:04.
  const s = summarize(withHeader(prints('D', [1000, 1005])));
  assert.equal(s.feeds.D.grids['60'].targets, 0, 'no whole grid point inside a 5 s window');
  assert.equal(s.feeds.D.grids['60'].minCapture.hitRate, null, 'and no hit rate is invented');
}, 'no targets are invented outside the observed window');

check(() => {
  const s = summarize(withHeader([
    ...prints('E', series(102, 402, 5)),
    JSON.stringify({ kind: 'error', observedAt: 200, error: '429' }),
    'not json at all',
  ]));
  assert.equal(s.errors, 1, 'RPC errors are counted, not silently dropped');
  assert.equal(s.malformed, 1, 'and so are malformed lines');
  assert.equal(s.pollIntervalMs, 1000, 'the poll interval travels with the numbers');
  assert.match(s.limits.ties, /VACUOUS/, 'the tie caveat is carried as data, not as a comment');
  assert.match(s.limits.firstPrintLag, /UPPER BOUND/);
}, 'errors, malformed lines and method limits survive into the summary');

// --- fixture F: the intra-second repeat, where the bracket boundary lives ------
//
// Pythnet aggregates ~2.5 times a second, so the second and third print of a
// second carry prev == pub. Fable's uniqueness_check.js found 20 such keys in
// 120 root-verified slots, and Opus A's 11:04Z P1 turns on them. The strict
// bracket requires prev < T, so a print with prev == pub == T is EXCLUDED by
// construction; MIN-CAPTURE admits it at lag 0. This fixture pins that boundary,
// because a reducer that relaxed `prev < T` to `prev <= T` would silently report
// a bracket hit rate three times too high and nothing else here would notice.

check(() => {
  const s = summarize(withHeader(printsWithPrev('F', [
    [100, 99], [120, 120], [180, 180], [240, 239], [400, 399],
  ])));
  const g = s.feeds.F.grids['60'];
  assert.equal(g.targets, 5, 'targets 120,180,240,300,360');
  assert.equal(g.strictBracket.hit, 1,
    'only T=240 has a print with prev < T <= pub; the two repeats at T=120 and T=180 are excluded');
  assert.equal(g.minCapture.hit, 5, 'MIN-CAPTURE admits the repeats');
  assert.equal(g.minCapture.firstPrintLagSeconds.p50, 0, 'at lag 0, which is why it admits them');
  assert.equal(g.minCapture.firstPrintLagSeconds.max, 100, 'and carries the outage at T=300');
}, 'fixture F: prev == pub == T is outside the bracket and inside min-capture');

check(() => {
  // The tie caveat, demonstrated rather than asserted. Two distinct signed
  // messages sharing a publish_time are exactly what MIN-CAPTURE has to break a
  // tie on, and account polling collapses them into one row: the sampler only
  // ever sees whichever one was in the account when it looked. Anyone reading a
  // tie count off this method is reading a number that cannot exist in it.
  const s = summarize(withHeader([
    ...printsWithPrev('G', [[120, 119]]),
    JSON.stringify({
      kind: 'print', observedAt: 120, symbol: 'G', feedId: 'bb'.repeat(32),
      sourceAddress: 'FIXTURE', publishTime: 120, prevPublishTime: 119,
      postedSlot: 9999, price: '2', conf: '1', exponent: -8,
    }),
  ]));
  assert.equal(s.feeds.G.observations, 2, 'both rows are kept');
  assert.equal(s.feeds.G.distinctPublishTimes, 1, 'but they are ONE publish time');
  assert.ok(!Object.keys(s.feeds.G).some(k => /tie/i.test(k)),
    'and the summary reports no tie statistic, because it cannot honestly have one');
}, 'the tie caveat is demonstrated, not merely declared');

// --- the feed table ----------------------------------------------------------
//
// Pinned here rather than derived-and-trusted: a one-character typo in a feed id
// derives to a real-looking address for an account that does not exist, and the
// sampler would report a dead feed instead of a wrong one. Four of these seven
// were independently derived by Fable (g2-mainnet-economy.proposal.json), which
// is the only reason to believe the derivation and not just the code.

const EXPECTED_SOURCES = {
  SOL: '7AviUf9nL62mcxNbQGKm4nKDQnPjswo6c5MX4D57HmyE',
  BTC: 'APgzQGGdv2qCgBkX6aHVkrGePtBVDDg68GiqaM7rmtf5',
  ETH: '7odryi4WfoMFHtv2eubdMgP1pqQMmdiXSK1N2tqZ2nRH',
  BONK: '3nMpgBXnjBSDYupQQEVR7DZM65zkJCdKy1Up7nkqp99w',
  PUMP: '4KL8nVtrXmLjbbHtrDz5YCHNqmii62oHfr9bsUtx1bgi',
  JUP: 'EitcZS5LtbR4EyNhCSy56vvUHPhsifSfWFG5gwSkjNpV',
  WIF: '9Sn9FVu6WpufA8yZFSRuxYyFgpBrhc5PpTgB3mq2DcsG',
};

check(() => {
  const feeds = gameFeeds();
  assert.equal(feeds.length, 7, 'seven feeds, from lib/prices.js, not a second copy');
  for (const { symbol, feedId } of feeds) {
    assert.ok(EXPECTED_SOURCES[symbol], `${symbol} is a known feed`);
    assert.equal(sourceAddressFor(feedId).toBase58(), EXPECTED_SOURCES[symbol],
      `${symbol} derives to its sponsored push account`);
  }
}, 'the seven feeds derive to the sponsored accounts');

check(() => {
  if (!existsSync(PROPOSAL)) return;   // the file is a review artifact, not a dependency
  const proposal = JSON.parse(readFileSync(PROPOSAL, 'utf8'));
  for (const row of proposal.feeds ?? []) {
    if (!EXPECTED_SOURCES[row.symbol]) continue;
    assert.equal(row.sponsoredAccount, EXPECTED_SOURCES[row.symbol],
      `${row.symbol}: this file and Fable's independent derivation agree`);
  }
}, 'cross-check against the independently derived proposal');

// --- the gate ----------------------------------------------------------------

const latestSummary = () => {
  if (!existsSync(CADENCE_DIR)) return null;
  const files = readdirSync(CADENCE_DIR).filter(f => f.endsWith('.summary.json')).sort();
  if (!files.length) return null;
  const path = join(CADENCE_DIR, files[files.length - 1]);
  return { path, data: JSON.parse(readFileSync(path, 'utf8')) };
};

// A measurement that would pass, and a manifest that sits on it. Everything the
// gate can refuse is refused below against these, so the gate is proven red
// before it is ever trusted green.

const goodSummary = () => ({
  observedHours: 24.5,
  pollIntervalMs: 1000,
  feeds: {
    SOL: { grids: { 60: { targets: 1440, minCapture: { firstPrintLagSeconds: { p99: 7 } } } } },
    ETH: { grids: { 60: { targets: 1440, minCapture: { firstPrintLagSeconds: { p99: 53 } } } } },
  },
});
const goodManifest = () => ({
  feeds: [
    { symbol: 'SOL', targetGridSeconds: 60, maxPostTargetLagSeconds: { tag: 'M', proposed: 30 } },
    { symbol: 'ETH', targetGridSeconds: 60, maxPostTargetLagSeconds: 120 },
  ],
});

check(() => {
  const rows = auditManifest(goodManifest(), goodSummary());
  assert.equal(rows.length, 2, 'both feeds audited');
  assert.deepEqual(rows[0], {
    symbol: 'SOL', maxPostTargetLagSeconds: 30, measuredP99: 7, targets: 1440,
  }, 'the comparison is returned, not just asserted');
}, 'a measured manifest passes');

check(() => {
  // The one that matters. ETH's p99 is 53 s; a manifest that promises 30 s would
  // void every target whose print lands between 30 and 53 s late, forever.
  const m = goodManifest();
  m.feeds[1].maxPostTargetLagSeconds = 30;
  assert.throws(() => auditManifest(m, goodSummary()),
    /ETH: maxPostTargetLagSeconds 30 s is below the measured p99 first-print lag 53 s/,
    'a lag below the measured p99 is refused, by name and by number');
}, 'a lag below the measured p99 is refused');

check(() => {
  assert.throws(() => auditManifest(goodManifest(), null),
    /no cadence measurement does/, 'a manifest with no measurement at all is refused');
  assert.throws(() => auditManifest(goodManifest(), { ...goodSummary(), observedHours: 0.42 }),
    /GATE 2 asks for 24 h/, 'a 25-minute sample is not a 24-hour measurement');
  assert.throws(() => auditManifest(goodManifest(), { ...goodSummary(), pollIntervalMs: 5000 }),
    /too coarse/, 'a 5 s poll of a 5 s feed bounds nothing');
  assert.throws(() => auditManifest(goodManifest(), { ...goodSummary(), pollIntervalMs: null }),
    /too coarse/, 'and an unstated poll interval is not a pass');
}, 'the measurement itself must be adequate');

check(() => {
  const thin = goodSummary();
  thin.feeds.SOL.grids['60'].targets = 59;
  assert.throws(() => auditManifest(goodManifest(), thin),
    /59 targets measured, GATE 2 asks for at least 60/, 'GATE 2 target floor is enforced');
  const missing = goodSummary();
  delete missing.feeds.ETH;
  assert.throws(() => auditManifest(goodManifest(), missing),
    /ETH is in the manifest but not in the measurement/, 'an unmeasured feed cannot ship');
  const wrongGrid = goodManifest();
  wrongGrid.feeds[0].targetGridSeconds = 300;
  assert.throws(() => auditManifest(wrongGrid, goodSummary()),
    /no measurement at grid 300/, 'a grid nobody measured cannot ship');
  const noLag = goodSummary();
  noLag.feeds.SOL.grids['60'].minCapture.firstPrintLagSeconds.p99 = null;
  assert.throws(() => auditManifest(goodManifest(), noLag),
    /no first-print lag measured/, 'an empty measurement is not a zero measurement');
  assert.throws(() => auditManifest({ feeds: [] }, goodSummary()),
    /declares no feeds/, 'an empty manifest does not pass by having nothing to check');
  const notANumber = goodManifest();
  notANumber.feeds[0].maxPostTargetLagSeconds = { tag: 'D', note: 'to be decided' };
  assert.throws(() => auditManifest(notANumber, goodSummary()),
    /is not a number/, 'an undecided parameter is not a decided one');
}, 'every other way the gate can be cheated is refused');

// --- and now the real files ---------------------------------------------------

check(() => {
  const found = latestSummary();
  if (!existsSync(MANIFEST)) {
    console.log(`  gate ARMED AND INERT: ${MANIFEST} does not exist yet (tracker section 4, decision 2).`);
    console.log(`  measurement present: ${found ? found.path : 'none'}`);
    console.log('  the day that manifest lands, auditManifest above runs against it, and refuses any');
    console.log('  maxPostTargetLagSeconds below the measured p99 first-print lag.');
    return;
  }
  const rows = auditManifest(JSON.parse(readFileSync(MANIFEST, 'utf8')), found?.data);
  for (const r of rows)
    console.log(`  ${r.symbol.padEnd(5)} lag=${r.maxPostTargetLagSeconds}s >= measured p99 ${r.measuredP99}s over ${r.targets} targets`);
}, 'the manifest in this tree, when there is one');

console.log(`timepin cadence policy: ${checks} checks passed (host tier)`);
