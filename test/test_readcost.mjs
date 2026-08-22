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
const BUDGET = 5;   // headroom over the current 3

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
