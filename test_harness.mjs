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
const realBurn = require('./lib/burn.js');   // capture the REAL module before stubbing
let PX = { src: 'stub', SOL: 100, BTC: 60000, ETH: 2000, BONK: 0.000002, WIF: 0.1, JUP: 0.2, PUMP: 0.005 };
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
ok(Object.keys(r.body.targets).length === 9, 'nine targets served (4 evergreen + 5 rotating)');
ok(r.body.targets.PUMP30 && r.body.targets.PUMP30.feed === 'PUMP', 'the house token is on the board');
ok(!('RCX15' in r.body.targets) && !('RCX_THR' in r.body.targets), 'no RCX-priced targets');
ok(r.body.stats.potD === 0, 'daily pot initialised');
ok(getMem('g:warden:open')?.length === 1, 'warden line sealed once');

// 2 ---- state?wallet=garbage must not mint records
r = await call('GET', { query: { action: 'state', wallet: '<script>alert(1)</script>' } });
ok(r.body.ok && r.body.player === null && !getMem('u:<script>alert(1)</script>'), 'garbage wallet ignored, no KV record');
r = await call('GET', { query: { action: 'state', wallet: 'So11111111111111111111111111111111111111112' } });
ok(r.body.player !== null && !getMem('u:So11111111111111111111111111111111111111112'), 'fresh wallet served but NOT persisted');

// 2b ---- ONE CURRENCY: a fresh wallet is granted once, and there is no paper balance
r = await call('GET', { query: { action: 'state', wallet: 'So11111111111111111111111111111111111111112' } });
ok(r.body.player && r.body.player.cr === 5000 && !r.body.player.bal, 'fresh wallet granted 5,000 credits, no paper balance');

// 3 ---- demo fires a shot; ladder must stay empty; feed must stay empty
r = await call('POST', { body: { action: 'shot', auth: { wallet: 'demo-abc123' }, target: 'SOL5', side: 'YES', stake: 500 } });
ok(r.body.ok && r.body.shot.src === 'cr', 'demo shot sealed from the one credit balance');
let st = getMem('g:stats');
ok(Math.abs(st.burned - 350) < 1e-9 && Math.abs(st.potD - 75) < 1e-9 && Math.abs(st.pot - 75) < 1e-9, 'stake split 70/15/15');
ok((getMem('g:feed') || []).length === 0, 'demo seal absent from public feed');

// force-settle the demo shot as a HIT
const crAtSeal = getMem('u:demo-abc123').cr;
let p = getMem('u:demo-abc123');
p.open[0].exp = Date.now() - 1000; p.open[0].entry = 90; setMem('u:demo-abc123', p);
r = await call('GET', { query: { action: 'state', wallet: 'demo-abc123' } });
// 22, not 20: the stake curve is now continuous sqrt(stake/100), so the 500 preset
// pays x2.24 instead of the old flat x2. Disclosed in the changelog.
ok(r.body.player.hits === 1 && r.body.player.xp === 22, 'demo shot settled as hit');
// being right must pay: 500 staked, 1.7x back = 850 credits returned
ok(r.body.player.cr === crAtSeal + 850, 'a hit returns 1.7x the stake in credits');
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
setMem(`u:${RW}`, { ...pr, open: [{ id: 'x3', kind: 'dir', feed: 'GONE', side: 'YES', entry: 1, exp: Date.now() - 25 * 3600e3, stake: 100, xp: 10, label: 'dead feed', src: 'cr' }] });
const crBefore2 = getMem(`u:${RW}`).cr;
r = await call('GET', { query: { action: 'state', wallet: RW } });
pr = getMem(`u:${RW}`);
ok(pr.open.length === 0 && pr.cr === crBefore2 + 100 && pr.closed[0].res === 'void', 'dead-feed shot auto-voided with refund');

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
{ // STAGE 1a: the rollover folded a balance root into the log
  const chunkR = getMem('g:log:c:0') || [];
  const rootEv = [...chunkR].reverse().find(e => e.ev.k === 'root');
  ok(rootEv && rootEv.ev.day === '2020-01-01' && /^[0-9a-f]{64}$/.test(rootEv.ev.root) && rootEv.ev.players >= 2, 'balance root appended at daily rollover');
  ok(getMem('g:lastRoot')?.root === rootEv?.ev.root, 'lastRoot mirror matches the log');
}

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
delete PX.SOL;
st = getMem('g:stats'); const shotsB4 = st.shots;
r = await call('POST', { body: { action: 'shot', auth: { wallet: 'demo-abc123' }, target: 'SOL5', side: 'YES', stake: 100 } });
ok(!r.body.ok && r.status === 409, 'offline feed refused');
ok(getMem('g:stats').shots === shotsB4, 'no stats mutation on refusal');
PX.SOL = 100;

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

// 11c ---- the Black Box: full-log retention + snapshot + tamper detection
{
  const { verifyChain } = require('./lib/log.js');
  const head = getMem('g:log:head');
  const c0 = getMem('g:log:c:0') || [];
  ok(head && c0.length === head.i, 'black box: full log retained (chunk covers every entry)');
  const v = verifyChain(c0, head);
  ok(v.ok && v.count === head.i, 'black box: chain replays from genesis to head');
  // plant a mutant: rewrite one past event — the verifier MUST catch it
  const tampered = JSON.parse(JSON.stringify(c0));
  if (tampered[1]) tampered[1].ev = { k: 'forged', w: 'attacker' };
  const vt = verifyChain(tampered, head);
  ok(!vt.ok && vt.brokenAt === 2, 'black box: tampered entry #2 detected exactly');
  // snapshot endpoint serves the soul
  const snapshot = require('./api/snapshot.js');
  r = await new Promise(resolve => {
    const res = { _s: 200, headers: {}, setHeader(k, v2) { this.headers[k] = v2; },
      status(c) { this._s = c; return this; },
      json(o) { resolve({ status: this._s, body: o }); },
      end(s2) { resolve({ status: this._s, body: JSON.parse(s2) }); } };
    snapshot({ method: 'GET', headers: {}, query: {} }, res);
  });
  ok(r.body.ok && r.body.logComplete && r.body.sha256?.length === 64, 'black box: snapshot exports with hash, log complete');
  ok(Object.keys(r.body.state.players).length >= 2, 'black box: snapshot contains the players');
  ok(verifyChain(r.body.state.log, r.body.state.logHead).ok, 'black box: snapshot log verifies end-to-end');
}

// 12 ---- decideBurn: THE CHAMPION'S CUT (pure, real implementation)
{
  const INC = '1nc1nerator11111111111111111111111111111111';
  const mkTx = deltas => {
    const pre = [], post = [];
    for (const [owner, [a, b]] of Object.entries(deltas)) {
      pre.push({ mint: 'M', owner, uiTokenAmount: { uiAmount: a } });
      post.push({ mint: 'M', owner, uiTokenAmount: { uiAmount: b } });
    }
    return { blockTime: Math.floor(Date.now() / 1000), meta: { err: null, preTokenBalances: pre, postTokenBalances: post } };
  };
  const D = realBurn.decideBurn;
  const base = { wallet: 'P', mint: 'M', minAmount: 1, podium: ['A', 'B', 'C'], podiumPct: 0.30 };
  let d = D(mkTx({ P: [10000, 0] }), base);
  ok(d.ok && d.amount === 10000 && d.burned === 10000 && d.champPaid === 0, 'champ: pure burn still credits 1:1');
  d = D(mkTx({ P: [10000, 0], A: [0, 1500], B: [0, 900], C: [0, 600] }), base);
  ok(d.ok && d.amount === 10000 && d.burned === 7000 && d.champPaid === 3000, 'champ: 70/30 reload verifies in full');
  d = D(mkTx({ P: [10000, 0], [INC]: [0, 7000], A: [0, 3000] }), { ...base, podium: ['A'] });
  ok(d.ok && d.burned === 7000 && d.champPaid === 3000, 'champ: incinerator route with a podium leg');
  d = D(mkTx({ P: [10000, 0], X: [0, 3000] }), base);
  ok(!d.ok && /outside the published podium/.test(d.reason), 'champ: stranger recipient refuses the reload');
  d = D(mkTx({ P: [10000, 3000], A: [0, 7000] }), { ...base, podium: ['A'] });
  ok(!d.ok, 'champ: legs above the 30% cut refused');
  d = D(mkTx({ P: [10000, 1500], B: [0, 900], C: [0, 600] }), base);
  ok(d.ok && d.amount === 8500 && d.burned === 7000 && d.champPaid === 1500, 'champ: self-on-podium nets fairly');
  d = D(mkTx({ P: [10000, 0] }), { ...base, podium: [] });
  ok(d.ok && d.amount === 10000, 'champ: empty podium = pure burn, unchanged');
}

// 11a ---- THE BOARD: deterministic hourly mix, new kinds, grace window
{
  const r1 = await call('GET', { query: { action: 'state' }, ip: '3.3.3.3' });
  const r2 = await call('GET', { query: { action: 'state' }, ip: '3.3.3.3' });
  ok(JSON.stringify(Object.keys(r1.body.targets)) === JSON.stringify(Object.keys(r2.body.targets)), 'board: deterministic within the hour');
  const kinds = Object.values(r1.body.targets).map(t2 => t2.kind);
  ok(kinds.includes('race') && kinds.includes('thrDown') && kinds.includes('range'), 'board: RACE + DUMP + BOX present');
  ok(r1.body.targets.SOL5 && r1.body.targets.BTC60 && r1.body.targets.ETH24, 'board: evergreen anchors present');
  ok(typeof r1.body.boardFlip === 'number' && r1.body.boardFlip > Date.now(), 'board: flip time published');
  const prevHour = Math.floor(Date.now() / 3600e3) - 1;
  const q = await call('POST', { body: { action: 'shot', auth: { wallet: 'demo-grace' }, target: `H${prevHour}R`, side: 'YES', stake: 100 }, ip: '3.3.3.4' });
  ok(q.body.ok, 'board: previous-hour key still seals (grace window)');
}

// 11a2 ---- new kinds settle correctly (KV surgery, deterministic prices)
{
  const D0 = getMem('u:demo-abc123');
  const hitsB4 = D0.hits, balB4 = D0.bal;
  setMem('u:demo-abc123', { ...D0, open: [
    { id:'k1', kind:'race', feed:'SOL', feed2:'BTC', side:'YES', entry:90, entry2:60000, exp: Date.now()-1000, stake:100, xp:20, label:'race', src:'bal' },
    { id:'k2', kind:'range', feed:'SOL', pct:0.02, side:'NO', entry:100, exp: Date.now()-1000, stake:100, xp:18, label:'box', src:'bal' },
    { id:'k3', kind:'thrDown', feed:'SOL', thresh:99, side:'NO', entry:100, exp: Date.now()-1000, stake:100, xp:16, label:'dump', src:'bal' },
  ]});
  await call('GET', { query: { action: 'state', wallet: 'demo-abc123' }, ip: '3.3.3.5' });
  const D1 = getMem('u:demo-abc123');
  // race: SOL +11.1% vs BTC 0% -> YES hit; box: 0% inside -> NO hit; dump: 100 !< 99 -> NO hit
  ok(D1.hits === hitsB4 + 3, 'kinds: race YES, box NO, dump NO all settle as hits');
  const hist = getMem('hist:demo-abc123') || [];
  ok(hist.length >= 3 && hist[0].res && hist.some(e => e.label === 'race'), 'history: settled shots recorded per player');
  ok(hist.every(e => 'entry' in e && 'stake' in e), 'history: entries carry stake + prices');
}

// 11a3 ---- COMMIT-REVEAL: seals never leak a side; settles reveal + verify
{
  const cryptoNode = await import('node:crypto');
  const sha = s => cryptoNode.createHash('sha256').update(s).digest('hex');
  const q = await call('POST', { body: { action: 'shot', auth: { wallet: 'demo-sealed' }, target: 'SOL5', side: 'YES', stake: 100 }, ip: '4.4.4.1' });
  ok(q.body.ok && q.body.shot.side === 'YES' && q.body.shot.commit && q.body.shot.salt, 'seal: owner response carries side + commit + salt');
  const chunk = getMem('g:log:c:0') || [];
  const sealEv = [...chunk].reverse().find(e => e.ev.k === 'seal' && e.ev.id === q.body.shot.id);
  ok(sealEv && !('side' in sealEv.ev) && sealEv.ev.commit === q.body.shot.commit, 'seal: log entry has commit, NO side');
  ok(sha(`YES|${q.body.shot.salt}`) === q.body.shot.commit, 'seal: commit = sha256(side|salt)');
  // spectator view must not see the side
  let rv = await call('GET', { query: { action: 'state', wallet: 'demo-sealed' }, ip: '4.4.4.2' });
  const openShot = rv.body.player.open.find(o => o.id === q.body.shot.id);
  ok(openShot && !('side' in openShot) && !('salt' in openShot) && openShot.commit, 'seal: spectator state strips side + salt, keeps commit');
  // force-settle: reveal lands in the log and verifies against the commit
  const pd = getMem('u:demo-sealed');
  pd.open[0].exp = Date.now() - 1000; pd.open[0].entry = 90; setMem('u:demo-sealed', pd);
  await call('GET', { query: { action: 'state', wallet: 'demo-sealed' }, ip: '4.4.4.3' });
  const chunk2 = getMem('g:log:c:0') || [];
  const settleEv = [...chunk2].reverse().find(e => e.ev.k === 'settle' && e.ev.id === q.body.shot.id);
  ok(settleEv && settleEv.ev.side === 'YES' && sha(`${settleEv.ev.side}|${settleEv.ev.salt}`) === settleEv.ev.commit, 'reveal: settle entry verifies against the seal commit');
}

// 11a4 ---- snapshot strips sealed sides
{
  const q = await call('POST', { body: { action: 'shot', auth: { wallet: 'demo-snapseal' }, target: 'SOL5', side: 'NO', stake: 100 }, ip: '4.4.4.4' });
  const snapshot = require('./api/snapshot.js');
  if (globalThis.__ratchet_snap) { globalThis.__ratchet_snap.t = 0; globalThis.__ratchet_snap.body = null; }  // bust the memo cache (mutate — the module holds the reference)
  const r2 = await new Promise(resolve => {
    const res = { headers: {}, setHeader() {}, status(c) { this._s = c; return this; },
      json(o) { resolve(JSON.parse(JSON.stringify(o))); }, end(s2) { resolve(JSON.parse(s2)); } };
    snapshot({ method: 'GET', headers: {}, query: {} }, res);
  });
  const pl = r2.state.players['demo-snapseal'];
  const op = pl && (pl.open || []).find(o => o.id === q.body.shot.id);
  ok(op && !('side' in op) && !('salt' in op), 'snapshot: open shots exported without side/salt');
}

// 11b ---- soft-staking: demo refused; yield math sane via state shape
r = await call('POST', { body: { action: 'stake', auth: { wallet: 'demo-abc123' }, on: true } });
ok(!r.body.ok && r.status === 400, 'stake: demo wallet refused (mint unset in test env also refuses)');

// 12a ---- holder-rule window math (pure)
{
  const cw = game.champWindowSum;
  const today0 = new Date().toISOString().slice(0, 10);
  ok(cw({ [today0]: 300 }, Date.now(), 7) === 300, 'holder window counts today');
  ok(cw({ '2000-01-01': 999, [today0]: 1 }, Date.now(), 7) === 1, 'holder window drops ancient days');
  ok(cw(null, Date.now(), 7) === 0, 'holder window null-safe');
}

// 12b ---- state exposes the champion cut
r = await call('GET', { query: { action: 'state' } });
ok(r.body.champ && r.body.champ.pct === 0.30 && Array.isArray(r.body.champ.podium), 'state exposes champ cut + podium');

// 13 ---- proof endpoint runs (no mint armed in test env)
const proof = require('./api/proof.js');
r = await new Promise(resolve => {
  proof({ method: 'GET', headers: {}, query: {} },
    { _status: 200, status(c) { this._status = c; return this; }, json(o) { resolve({ status: this._status, body: o }); } });
});
ok(r.body.ok && r.body.checks.some(c => c.id === 'pots'), 'proof answers with pots line');
ok(r.body.checks.some(c => c.id === 'champs' && /peer-to-peer/.test(c.label)), 'proof carries the champions line');
ok(r.body.checks.some(c => c.id === 'credits' && /never minted/.test(c.detail)), 'credits line carries no-faucet wording');

console.log(fails ? `\n${fails} FAILURES` : '\nALL PASS');
process.exit(fails ? 1 : 0);

// 2c ---- CUSTOM STAKES: any whole amount in range, scored on the same sqrt curve
r = await call('POST', { body: { action: 'shot', auth: { wallet: 'demo-stk1' }, target: 'SOL5', side: 'YES', stake: 1000 } });
const xp1000 = r.body.ok && r.body.shot.xp;
r = await call('POST', { body: { action: 'shot', auth: { wallet: 'demo-stk2' }, target: 'SOL5', side: 'YES', stake: 100 } });
const xp100 = r.body.ok && r.body.shot.xp;
ok(!!xp1000 && !!xp100 && Math.abs(xp1000 / xp100 - Math.sqrt(10)) < 0.12, 'custom stake XP follows sqrt(stake/100)');
r = await call('POST', { body: { action: 'shot', auth: { wallet: 'demo-stk3' }, target: 'SOL5', side: 'YES', stake: 2501 } });
ok(!r.body.ok && /between/.test(r.body.reason || ''), 'stake above the cap refused');
r = await call('POST', { body: { action: 'shot', auth: { wallet: 'demo-stk4' }, target: 'SOL5', side: 'YES', stake: 250.5 } });
ok(!r.body.ok, 'fractional stake refused');
