// Smoke test for the hardened backend. Runs the endpoint in-memory
// (no KV env -> Map backend), with the price oracle and RPC stubbed so
// nothing touches the network. Exercises: state, demo shot, settle
// hit/miss/void, demo-ladder exclusion, real-wallet ladder, stake
// source refunds, daily+weekly rollover with lock release, stale-feed
// auto-void, warden seal+settle+record, rate limiter, atomic sig gate.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// ---- stub the oracle and the chain BEFORE game.js loads them
const pricesPath = require.resolve('./lib/prices.js');
const burnPath = require.resolve('./lib/burn.js');
let PX = { src: 'stub', SOL: 100, BTC: 60000, ETH: 2000, BONK: 0.000002, WIF: 0.1, JUP: 0.2 };
require.cache[pricesPath] = { id: pricesPath, filename: pricesPath, loaded: true,
  exports: { getPrices: async () => ({ ...PX }) } };
require.cache[burnPath] = { id: burnPath, filename: burnPath, loaded: true,
  exports: { INCINERATOR: '1nc1nerator11111111111111111111111111111111',
    rpcCall: async () => null, getTx: async () => null,
    decideBurn: () => ({ ok: false, reason: 'stub' }) } };

const game = require('./api/game.js');
const mem = globalThis.__ratchet_mem;

function call(method, { query = {}, body = null, ip = '1.2.3.4' } = {}) {
  return new Promise(resolve => {
    const req = { method, query, body, headers: { 'x-forwarded-for': ip }, socket: {} };
    const res = {
      _status: 200,
      status(c) { this._status = c; return this; },
      json(o) { resolve({ status: this._status, body: o }); },
    };
    game(req, res).catch(e => resolve({ status: 599, body: { ok: false, reason: String(e) } }));
  });
}

let fails = 0;
const ok = (cond, name) => { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name); if (!cond) fails++; };
const getMem = k => (mem.has(k) ? JSON.parse(mem.get(k)) : null);
const setMem = (k, v) => mem.set(k, JSON.stringify(v));

// 1 ---- bare state
let r = await call('GET', { query: { action: 'state' } });
ok(r.status === 200 && r.body.ok && r.body.v && r.body.durable === false, 'state answers, versioned, ephemeral');
ok(Object.keys(r.body.targets).length === 8, 'eight targets served');
ok(!('RCX15' in r.body.targets) && !('RCX_THR' in r.body.targets), 'no RCX-priced targets');
ok(r.body.stats.potD === 0, 'daily pot initialised');
ok(getMem('g:warden:open')?.length === 1, 'warden line sealed once');

// 2 ---- state?wallet=garbage must not mint records
r = await call('GET', { query: { action: 'state', wallet: '<script>alert(1)</script>' } });
ok(r.body.ok && r.body.player === null && !getMem('u:<script>alert(1)</script>'), 'garbage wallet ignored, no KV record');
r = await call('GET', { query: { action: 'state', wallet: 'So11111111111111111111111111111111111111112' } });
ok(r.body.player !== null && !getMem('u:So11111111111111111111111111111111111111112'), 'fresh wallet served but NOT persisted');

// 3 ---- demo fires a shot; ladder must stay empty; feed must stay empty
r = await call('POST', { body: { action: 'shot', auth: { wallet: 'demo-abc123' }, target: 'SOL5', side: 'YES', stake: 500 } });
ok(r.body.ok && r.body.shot.src === 'bal', 'demo shot sealed from paper');
let st = getMem('g:stats');
ok(Math.abs(st.burned - 350) < 1e-9 && Math.abs(st.potD - 75) < 1e-9 && Math.abs(st.pot - 75) < 1e-9, 'stake split 70/15/15');
ok((getMem('g:feed') || []).length === 0, 'demo seal absent from public feed');

// force-settle the demo shot as a HIT
let p = getMem('u:demo-abc123');
p.open[0].exp = Date.now() - 1000; p.open[0].entry = 90; setMem('u:demo-abc123', p);
r = await call('GET', { query: { action: 'state', wallet: 'demo-abc123' } });
ok(r.body.player.hits === 1 && r.body.player.xp === 20, 'demo shot settled as hit');
const wk = Object.keys(mem).length; // touch
const seasonLb = Object.entries(mem).filter(([k]) => k.startsWith('lb'));
ok(!getMem(`lb:${r.body.season}`) && !getMem(`lbd:${r.body.day}`), 'demo XP reached NO ladder');
ok((getMem('g:feed') || []).length === 0, 'demo hit absent from public feed');

// 4 ---- real wallet (auth stub: monkey-patch verify via demo prefix not possible; write record directly)
// Simulate a real wallet's settled hit by direct KV surgery + settle path:
const RW = 'So11111111111111111111111111111111111111112';
setMem(`u:${RW}`, { w: RW, xp: 0, streak: 0, best: 0, hits: 0, shots: 0, bal: 5000, cr: 100,
  day: new Date().toISOString().slice(0, 10),
  open: [{ id: 'x1', kind: 'dir', feed: 'SOL', side: 'YES', entry: 90, exp: Date.now() - 1000, stake: 100, xp: 10, label: 't', src: 'cr' }],
  closed: [] });
r = await call('GET', { query: { action: 'state', wallet: RW } });
ok(r.body.player.hits === 1, 'real wallet hit settled');
ok((getMem(`lb:${r.body.season}`) || {})[RW] === 10 && (getMem(`lbd:${r.body.day}`) || {})[RW] === 10, 'real XP on daily AND weekly boards');
ok((getMem('g:feed') || []).some(f => f.a.includes('HIT')), 'real hit visible in feed');

// 5 ---- VOID refunds to source and reverses pot/burn
setMem(`u:${RW}`, { ...getMem(`u:${RW}`), open: [{ id: 'x2', kind: 'dir', feed: 'SOL', side: 'YES', entry: 100.000001, exp: Date.now() - 1000, stake: 100, xp: 10, label: 't', src: 'cr' }] });
const crBefore = getMem(`u:${RW}`).cr; st = getMem('g:stats');
const bBefore = st.burned, dBefore = st.potD, wBefore = st.pot;
r = await call('GET', { query: { action: 'state', wallet: RW } });
let pr = getMem(`u:${RW}`); st = getMem('g:stats');
ok(pr.cr === crBefore + 100, 'VOID refunded to credits (the source)');
ok(Math.abs(bBefore - st.burned - 70) < 1e-9 && Math.abs(dBefore - st.potD - 15) < 1e-9 && Math.abs(wBefore - st.pot - 15) < 1e-9, 'VOID reversed burn+pots');
ok(pr.shots === 1, 'VOID not counted in accuracy denominator');

// 6 ---- stale feed auto-void after 24h
setMem(`u:${RW}`, { ...pr, open: [{ id: 'x3', kind: 'dir', feed: 'GONE', side: 'YES', entry: 1, exp: Date.now() - 25 * 3600e3, stake: 100, xp: 10, label: 'dead feed', src: 'bal' }] });
const balBefore = getMem(`u:${RW}`).bal;
r = await call('GET', { query: { action: 'state', wallet: RW } });
pr = getMem(`u:${RW}`);
ok(pr.open.length === 0 && pr.bal === balBefore + 100 && pr.closed[0].res === 'void', 'dead-feed shot auto-voided with refund');

// 7 ---- daily + weekly rollover pays only real wallets, releases lock, rolls remainder
setMem('g:day', '2020-01-01');                       // force a day boundary
setMem('lbd:2020-01-01', { [RW]: 50, 'demo-zzz': 900 });
st = getMem('g:stats'); st.potD = 1000; setMem('g:stats', st);
const crB4 = getMem(`u:${RW}`).cr;
r = await call('GET', { query: { action: 'state' } });
pr = getMem(`u:${RW}`); st = getMem('g:stats');
ok(pr.cr === crB4 + 500, 'daily pot paid #1 (50%) to the real wallet');
ok(!getMem('u:demo-zzz'), 'demo wallet excluded from payout');
ok(st.potD === 500, 'unpaid daily shares rolled over');
ok(getMem('g:dayResults')?.winners?.length === 1, 'day results recorded');

setMem('g:season', 's1999w1');                       // force a season boundary
setMem('lb:s1999w1', { [RW]: 50 });
st = getMem('g:stats'); st.pot = 1000; setMem('g:stats', st);
const crB5 = getMem(`u:${RW}`).cr;
r = await call('GET', { query: { action: 'state' } });
pr = getMem(`u:${RW}`);
ok(pr.cr === crB5 + 400, 'weekly pot paid #1 (40%)');
ok(getMem('g:stats').pot === 600, 'weekly remainder rolled');

// 8 ---- warden settles into a public record
const wopen = getMem('g:warden:open');
wopen[0].exp = Date.now() - 1000; wopen[0].thresh = 1;   // SOL(100) > 1 => outcome YES
setMem('g:warden:open', wopen);
r = await call('GET', { query: { action: 'state' } });
ok(r.body.wardenRec.n === 1 && typeof r.body.wardenRec.brier === 'number', 'warden call settled into record');
ok((getMem('g:warden:hist') || []).length === 1, 'warden history recorded');

// 9 ---- feed-offline shot refused BEFORE stake is taken
delete PX.BONK;
st = getMem('g:stats'); const shotsB4 = st.shots;
r = await call('POST', { body: { action: 'shot', auth: { wallet: 'demo-abc123' }, target: 'BONK30', side: 'YES', stake: 100 } });
ok(!r.body.ok && r.status === 409, 'offline feed refused');
ok(getMem('g:stats').shots === shotsB4, 'no stats mutation on refusal');
PX.BONK = 0.000002;

// 10 ---- rate limiter
let limited = false;
for (let i = 0; i < 30; i++) {
  const q = await call('POST', { body: { action: 'shot', auth: { wallet: 'demo-abc123' }, target: 'SOL5', side: 'YES', stake: 100 }, ip: '9.9.9.9' });
  if (q.status === 429) { limited = true; break; }
}
ok(limited, 'POST rate limiter trips');

// 11 ---- atomic sig gate (setnx wins once)
const { setnxJSON } = require('./lib/kv.js');
const wins = await Promise.all([setnxJSON('sig:racetest', { a: 1 }), setnxJSON('sig:racetest', { a: 2 })]);
ok(wins.filter(Boolean).length === 1, 'setnx replay gate admits exactly one');

// 12 ---- proof endpoint runs (no mint armed in test env)
const proof = require('./api/proof.js');
r = await new Promise(resolve => {
  proof({ method: 'GET', headers: {}, query: {} },
    { _status: 200, status(c) { this._status = c; return this; }, json(o) { resolve({ status: this._status, body: o }); } });
});
ok(r.body.ok && r.body.checks.some(c => c.id === 'pots'), 'proof answers with pots line');
ok(r.body.checks.some(c => c.id === 'credits' && /never minted/.test(c.detail)), 'credits line carries no-faucet wording');

console.log(fails ? `\n${fails} FAILURES` : '\nALL PASS');
process.exit(fails ? 1 : 0);
