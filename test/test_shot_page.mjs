// The proof page must show a settled shot in full AND never leak an open one.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const crypto = await import('node:crypto');
for (const key of ['KV_REST_API_URL','KV_REST_API_TOKEN','UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN','SUPABASE_URL','SUPABASE_SERVICE_KEY','SUPABASE_SERVICE_ROLE_KEY']) delete process.env[key];
globalThis.fetch = async () => { throw new Error('network forbidden in shot page fixtures'); };
globalThis.__ratchet_mem = new Map();

const pricesPath = require.resolve('../lib/prices.js');
require.cache[pricesPath] = { id: pricesPath, filename: pricesPath, loaded: true,
  exports: { getPrices: async () => ({ src:'stub', SOL:100 }) } };
const kv = require('../lib/kv.js');
const shot = require('../api/shot.js');
const { bucketKey } = require('../lib/pxlog.js');

let fails = 0;
const ok = (c, n) => { console.log((c?'PASS  ':'FAIL  ')+n); if(!c) fails++; };
const call = q => new Promise(r => {
  const res = { _s:200, _h:{}, setHeader(){}, status(c){this._s=c;return this;},
    end(b){ r({ status:this._s, body:b }); } };
  shot({ query:q }, res);
});

const W = 'HXFDaHyZ3i477z1BakiTWZg9UQN8rcreruuv9ifC1HvM';
const side = 'YES', salt = 'a1b2c3d4e5f6a7b8';
const commit = crypto.createHash('sha256').update(`${side}|${salt}`).digest('hex');
const v2Salt = '12'.repeat(16), v2Id = 'v2shot';
const v2Commit = crypto.createHash('sha256').update(`RATCHET|v2|${W}|${v2Id}|NO|${v2Salt}`).digest('hex');
const now = Date.UTC(2026,7,30,17,0,34), t = now - 300e3;
const stamp = value => new Date(value).toISOString().replace('T',' ').slice(0,16);
await kv.setJSON(`u:${W}`, { w:W, closed:[
  { id:'abc123', kind:'dir', feed:'SOL', side, salt, commit, res:'hit', label:'SOL higher in 5 minutes',
    stake:2500, back:4250, xp:56, entry:86.0, exitPx:87.4, t, exp:now-60e3, settledAt:now-55e3, exitAt:now-58e3 },
  { id:'oldmiss', kind:'dir', feed:'SOL', side:'NO', salt, commit, res:'miss', label:'legacy miss',
    stake:500, xp:22, entry:86, exitPx:87, t, exp:now-60e3, settledAt:now-55e3 },
  { id:'newmiss', kind:'dir', feed:'SOL', side:'NO', salt, commit, res:'miss', label:'new miss',
    stake:500, xp:1, settleXp:1, skillXp:0, entry:86, exitPx:87, t, exp:now-60e3, settledAt:now-55e3 },
  { id:v2Id, kind:'dir', feed:'SOL', side:'NO', salt:v2Salt, commit:v2Commit, commitV:2,
    res:'hit', label:'v2 bound shot', stake:500, back:850, xp:3, entry:87, exitPx:86,
    exp:now-60e3, settledAt:now-55e3, exitAt:now-58e3, settleRuleApplied:'pyth-first-observed-after-v3' },
  { id:'unknown9', kind:'dir', feed:'SOL', side, salt, commit, res:'hit', entry:86, exitPx:87,
    t:null, exp:now-60e3, settledAt:now-55e3 },
  { id:'invalid9', kind:'dir', feed:'SOL', side, salt, commit, res:'hit', entry:86, exitPx:87,
    t:'not-a-time', sealedAt:1e20, exp:now-60e3, settledAt:now-55e3 },
  { id:'retained', kind:'dir', feed:'SOL', side, salt, commit, res:'hit', entry:86, exitPx:87,
    sealedAt:t, exp:now-60e3, settledAt:now-55e3 },
  { id:'badbind', kind:'dir', feed:'SOL', side:'NO', salt:v2Salt, commit:v2Commit, commitV:2,
    res:'hit', label:'wrong shot binding', stake:500, back:850, xp:3, entry:87, exitPx:86,
    t, exp:now-60e3, settledAt:now-55e3 },
  // an OPEN shot parked in closed by mistake must still not reveal a side
  { id:'open99', kind:'dir', feed:'SOL', side:'NO', salt:'zz', commit:'x', label:'open one', t, exp:now+600e3 },
] });
await kv.setJSON(`g:log:once:seal:${W}:${v2Id}`, {i:1,t,h:'a'.repeat(64)});
await kv.setJSON(`g:log:once:seal:${W}:invalid9`, {i:2,t:'not-a-time'});
await kv.setJSON(bucketKey(t), [
  { t: t+30e3, SOL: 86.2 }, { t: t+90e3, SOL: 86.9 }, { t: now-58e3, SOL: 87.4 },
]);

let r = await call({ w:W, id:'abc123' });
ok(r.status === 200, 'a settled shot renders');
ok(/HIT/.test(r.body), 'the verdict is stated');
ok(r.body.includes(commit), 'the sealed commitment is published');
ok(r.body.includes(salt), 'the salt is published so the hash can be recomputed');
ok(/MATCHES/.test(r.body), 'and the page says the recomputation matches');
ok(/\$86\.00/.test(r.body) && /\$87\.40/.test(r.body), 'entry and exit are shown');
ok(/\+1\.63%/.test(r.body), 'the move is computed');
ok(/<svg/.test(r.body) && /class="sp"/.test(r.body), 'the oracle path is drawn from the recorded log');
ok(/og:title/.test(r.body) && /twitter:card/.test(r.body), 'it unfurls when shared');
ok(/first fully validated Pyth transition captured by RATCHET at or after expiry/.test(r.body), 'the settling sample is named without overstating capture coverage');
ok(r.body.includes(`ENTRY ${stamp(t)} UTC`), 'a legacy stored entry timestamp is preserved');
ok(r.body.includes(`/api/shot?w=${W}&amp;id=abc123`) && r.body.includes(`/api/agent?id=${W}`),
  'the page links its actual public proof and cumulative report routes');
ok(/not authenticated HTTP session replay/.test(r.body), 'public evidence links do not claim an HTTP replay test');

r = await call({ w:W, id:'oldmiss' });
ok(r.status === 200 && /<u>XP<\/u><b>0<\/b>/.test(r.body),
  'a legacy MISS does not misreport its old potential XP as awarded');
r = await call({ w:W, id:'newmiss' });
ok(r.status === 200 && /<u>XP<\/u><b>\+1<\/b>/.test(r.body),
  'a new MISS proves its fixed settlement XP');

r = await call({ w:W, id:v2Id });
ok(r.status === 200 && /MATCHES/.test(r.body), 'a live v2 wallet-and-shot-bound commitment verifies');
ok(r.body.includes(`RATCHET|v2|${W}|${v2Id}|NO|${v2Salt}`), 'the exact v2 preimage is published');
ok(r.body.includes(`SEAL RECORDED ${stamp(t)} UTC`), 'a current shot without t labels its retained seal-record timestamp');
ok(/<svg/.test(r.body), 'the current shot path uses the same retained seal timestamp');
const beforeClockChange = r.body;
const realNow = Date.now;
try {
  Date.now = () => now + 365*86400e3;
  r = await call({w:W,id:v2Id});
  ok(r.body === beforeClockChange, 'proof entry time does not move when the reader clock advances');
} finally { Date.now = realNow; }
for (const id of ['unknown9','invalid9']) {
  r = await call({w:W,id});
  ok(r.status===200 && /ENTRY TIME UNAVAILABLE/.test(r.body) && !/<svg/.test(r.body),
    `${id}: absent/invalid timestamps remain unknown rather than inventing request time`);
}
r = await call({w:W,id:'retained'});
ok(r.status===200 && r.body.includes(`ENTRY ${stamp(t)} UTC`), 'a legacy sealedAt field remains supported');
r = await call({ w:W, id:'badbind' });
ok(r.status === 200 && /COMMITMENT MISMATCH/.test(r.body), 'reusing a v2 commitment under another shot id is rejected');

r = await call({ w:W, id:'open99' });
ok(r.status === 404, 'a shot with no result is refused');
ok(!/NO<\/b>|"NO"/.test(r.body) && !r.body.includes('zz'), 'and leaks neither its side nor its salt');

r = await call({ w:'<script>', id:'abc123' });
ok(r.status === 400 && !/<script>/.test(r.body), 'a junk wallet is rejected and never echoed');
r = await call({ w:W, id:'nope' });
ok(r.status === 404, 'an unknown id 404s');
r = await call({ w:'11111111111111111111111111111111', id:'abc123' });
ok(r.status === 404 && !r.body.includes(salt), 'a valid but wrong owner cannot resolve another wallet proof');

console.log(fails ? `\n${fails} FAILURES` : '\nALL PASS');
process.exit(fails?1:0);
