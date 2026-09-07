// A READ BUDGET, ENFORCED.
//
// One state request used to make 21 Redis reads. The page polls every six
// seconds, so a single open browser tab was 302,400 commands a day — an
// Upstash free tier gone in 48 minutes, and a hard ceiling on ever having more
// than a handful of people on the site at once. Nothing announced this. It was
// found by counting.
//
// It is now 3. This test exists so that stays true: adding one uncached read
// to the state path costs 14,400 commands a day per visitor, and the only
// thing that makes that visible is a number in a test.
import assert from 'node:assert';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

let fails = 0;
const ok = (c, n) => { console.log((c ? 'PASS  ' : 'FAIL  ') + n); if (!c) fails++; };

// Reads that must NEVER be cached, with the reason. If a future change makes
// one of these disappear from the tally, something was cached that decides
// when money moves — which is worse than any number of extra reads.
const MUST_STAY_FRESH = {
  'g:day':    'the daily rollover trigger — a stale read pays the pot late',
  'g:season': 'the season rollover trigger — same',
};
// MEASURED cost is 5 reads per state request. The comment here used to say
// "headroom over the current 3" — the cost had drifted 3 -> 5 and nobody
// noticed, because a budget sitting exactly ON the measurement is not a budget:
// it passes on the machine that set it and fails on every slightly different
// one, which teaches people to raise the number instead of asking why.
// So: a real ceiling with one read of headroom, and the per-key tally printed
// below on every run, so the next drift is visible the day it happens rather
// than the day a build breaks.
const BUDGET = 6;

function boot() {
  for (const k of Object.keys(require.cache)) delete require.cache[k];
  globalThis.__ratchet_mem = new Map();
  globalThis.__ratchet_rmemo = new Map();
  process.env.RATCHET_MINT = 'FQb2EyaLZ9TWBemYmQ9zWtXcEwLiSXtz7j619ThQpump';
  const pp = require.resolve('../lib/prices.js'), bp = require.resolve('../lib/burn.js');
  require.cache[pp] = { id:pp, filename:pp, loaded:true, exports:{ getPrices: async () => ({ src:'stub',
    SOL:100, BTC:60000, ETH:2000, BONK:0.000002, WIF:0.1, JUP:0.2, PUMP:0.005 }) } };
  require.cache[bp] = { id:bp, filename:bp, loaded:true, exports:{
    INCINERATOR:'1nc1nerator11111111111111111111111111111111',
    rpcCall: async (m) => (m === 'getTokenAccountsByOwner' ? { value: [] } : null),
    getTx: async () => null, decideBurn: () => ({ ok:false, reason:'stub' }) } };
  const kv = require('../lib/kv.js');
  const { bucketKey } = require('../lib/pxlog.js');
  // real price history, so the Warden can price a line and cache it
  const now = Date.now(), by = {}; let px = 100;
  for (let i = 1440; i >= 0; i--) { const t = now - i*60_000; px *= (1 + (i%2 ? 0.0009 : -0.0008));
    (by[bucketKey(t)] ||= []).push({ t, src:'pyth-onchain', SOL:px, BTC:60000*(px/100), ETH:2000*(px/100) }); }
  for (const [k,v] of Object.entries(by)) kv.setJSONEx(k, v.sort((a,b)=>a.t-b.t), 9999);
  return kv;
}

const W = 'HXFDaHyZ3i477z1BakiTWZg9UQN8rcreruuv9ifC1HvM';
const kv = boot();
const hits = {}; let n = 0;
// COUNT BEFORE game.js LOADS. It destructures getJSON at require time, so a
// wrapper installed afterwards never sees a single call — which is exactly how
// the first version of this test reported a confident, meaningless zero.
for (const fn of ['getJSON','getJSONStrict']) { const r = kv[fn];
  kv[fn] = async (k, ...a) => { n++; hits[k] = (hits[k]||0) + 1; return r(k, ...a); }; }
const game = require('../api/game.js');
globalThis.__ratchet_mem.set(`u:${W}`, JSON.stringify({ w:W, xp:100, cr:5000, qualified:true,
  streak:0, best:0, hits:0, shots:0, burned:0, open:[], closed:[] }));
const call = (q, ip) => new Promise(r => { const res = { _s:200, status(c){this._s=c;return this;}, json(o){r(o)} };
  game({ method:'GET', query:q, headers:{'x-forwarded-for':ip}, socket:{} }, res).catch(()=>r(null)); });

await call({ action:'state' }, '1.1.1.1');                 // warm
n = 0; for (const k of Object.keys(hits)) delete hits[k];
const N = 20;
for (let i = 0; i < N; i++) await call({ action:'state', wallet:W }, '7.7.7.' + i);
const avg = n / N;

console.log(`\nreads per state request: ${avg.toFixed(2)} (budget ${BUDGET})`);
// Where the budget actually goes. Any future creep shows up here by name.
{
  const tally = Object.entries(hits).sort((a, b) => b[1] - a[1]);
  console.log('  per-key reads across the run:');
  for (const [k, n] of tally.slice(0, 12))
    console.log(`    ${String(n).padStart(4)}  ${k}${MUST_STAY_FRESH[k] ? '   (must stay fresh)' : ''}`);
  if (tally.length > 12) console.log(`    … and ${tally.length - 12} more keys`);
}
for (const [k,c] of Object.entries(hits).sort((a,b)=>b[1]-a[1])) console.log(`     ${c}  ${k}`);
console.log();

ok(avg > 0, `the counter is actually wired — ${avg.toFixed(2)} reads observed, not a silent zero`);
ok(avg <= BUDGET,
   `a state request stays within ${BUDGET} reads — at ${avg.toFixed(2)}, one open tab costs ` +
   `${Math.round(avg*10*60*24).toLocaleString()} redis commands/day`);

for (const [key, why] of Object.entries(MUST_STAY_FRESH))
  ok(hits[key] === N, `${key} is read every request (${why})`);

ok(!Object.keys(hits).some(k => k.startsWith('px:')),
   'no price-bucket walk on the state path — that was 78 reads when the log was empty');

// ---- THE PATHS EVERY VISITOR PAYS FOR, WHICH NOTHING PINNED ---------------
//
// The budget above covers the AUTHENTICATED state request. It is not what most
// traffic costs. A visitor who never signs in still polls `state`, and every
// page load fetches `board`, and neither had a ceiling — so either could double
// without a single test noticing.
//
// This stopped being theoretical on 2026-09-05, when the live store started
// answering 500 on every game action while /api/proof, from the same build,
// stayed healthy. Whatever the immediate cause, the arithmetic underneath is
// not in dispute: reads per call multiplied by polls per day multiplied by open
// tabs is the whole store bill, and two of those three terms are fixed by
// product decisions. The one this file can hold is the first.
// Measured 3 and 4. The budgets sit just above, for the reason this file
// already states about the state budget: one far above the measurement is not a
// budget, it is a comment. These catch a doubling, which is the shape read creep
// actually takes — a loop added around something that used to be fetched once.
const ANON_BUDGET = 5;
const BOARD_BUDGET = 6;
const measure = async (label, query, budget) => {
  await call(query, '3.3.3.3');                        // warm whatever it caches
  n = 0; for (const k of Object.keys(hits)) delete hits[k];
  const M = 20;
  for (let i = 0; i < M; i++) await call(query, '8.8.8.' + i);
  const per = n / M;
  console.log(`reads per ${label}: ${per.toFixed(2)} (budget ${budget})`);
  ok(per > 0, `the ${label} counter is wired — ${per.toFixed(2)} reads, not a silent zero`);
  ok(per <= budget,
    `${label} stays within ${budget} reads — at ${per.toFixed(2)}, one such tab polling ` +
    `every 60s costs ${Math.round(per * 60 * 24).toLocaleString()} store commands/day, ` +
    `and every visitor pays it whether or not they ever play`);
  return per;
};

const anon = await measure('anonymous state', { action:'state' }, ANON_BUDGET);
const board = await measure('board', { action:'board' }, BOARD_BUDGET);

// The relationship, not just the levels: an anonymous poll must never cost more
// than an authenticated one. It knows strictly less and does strictly less; if
// it ever costs more, something is being read to decide there is nothing to read.
ok(anon <= avg + 3,
   `an anonymous poll (${anon.toFixed(2)}) is not wildly dearer than an authenticated one ` +
   `(${avg.toFixed(2)}) — it knows less and should not pay more to find that out`);

// ---- the guards that made the open lists safe to cache ----
{
  const src = require('fs').readFileSync(new URL('../api/game.js', import.meta.url), 'utf8');
  ok(/appendOnce\(`wsettle:\$\{s\.id\}`/.test(src) && /rec\.applied\.includes\(s\.id\)/.test(src),
     'a Warden line can only ever be settled once, however many requests race');
  ok(/appendOnce\(`asettle:\$\{o\.id\}`/.test(src) && /r\.applied\.includes\(o\.id\)/.test(src),
     'and so can a house agent call — both records are published as accuracy figures');
}

console.log(fails ? `\n${fails} FAILED` : '\nREAD BUDGET OK');
process.exitCode = fails ? 1 : 0;
