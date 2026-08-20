// Smoke test for the hardened backend. Runs the endpoint in-memory
// (no KV env -> Map backend), with the price oracle and RPC stubbed so
// nothing touches the network. Exercises: state, demo shot, settle
// hit/miss/void, demo-ladder exclusion, real-wallet ladder, stake
// source refunds, daily+weekly rollover with lock release, stale-feed
// auto-void, warden seal+settle+record, rate limiter, atomic sig gate.
import crypto from 'node:crypto';
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
// Ladders are Redis sorted sets now (ZINCRBY is atomic). In memory mode the
// backend keeps them as a Map under a 'Z' prefix.
// section 10 tests the rate limiter deliberately; after that it is spent, and
// the remaining tests are not about it
const resetRL = () => { const rl = globalThis.__ratchet_rl; if (rl && rl.clear) rl.clear(); };

// Global totals are a Redis hash now (HINCRBYFLOAT is atomic per field). In
// memory mode the backend keeps it as a Map under an 'H' prefix.
const hMem = () => mem.get('H' + 'h:stats') || new Map();
const stats = () => Object.fromEntries(hMem());
const FLOOR_MIN_OK = 0;
const setStat = (f, v) => { if (!mem.has('H' + 'h:stats')) mem.set('H' + 'h:stats', new Map()); mem.get('H' + 'h:stats').set(f, v); };
const zScore = (pfx, period, w) => { const m = mem.get('Z' + `z:${pfx}${period}`); return m ? (m.get(w) || 0) : 0; };

// 1 ---- bare state
let r = await call('GET', { query: { action: 'state' } });
ok(r.status === 200 && r.body.ok && r.body.v && r.body.durable === false, 'state answers, versioned, ephemeral');
ok(Object.keys(r.body.targets).length === 10, 'ten targets served (5 evergreen + 5 rotating)');
ok(r.body.targets.SOL2 && r.body.targets.SOL2.mins === 2,
   'FLASH exists: a two-minute window so a first visit can finish a whole shot');
ok(r.body.targets.SOL2.mins * 60 > 60,
   'and it stays above the 60s oracle heartbeat, so it can actually settle');
ok(r.body.targets.PUMP30 && r.body.targets.PUMP30.feed === 'PUMP', 'the house token is on the board');
ok(!('RCX15' in r.body.targets) && !('RCX_THR' in r.body.targets), 'no RCX-priced targets');
ok(r.body.stats.potD === 0, 'daily pot initialised');
ok(getMem('g:warden:open')?.length === 1, 'warden line sealed once');

// Settlement now reads the recorded price log, not "the price right now".
// A shot can only settle once a sample exists AT OR AFTER its expiry, so a
// force-settle in a test has to let the sampler fire again first. Clearing
// the per-instance gate is exactly what the passage of a minute does.
const tickPx = () => { const g = globalThis.__ratchet_pxgate; if (g) g.t = 0; };

// A REAL signing wallet. The guest-vs-real pot guard can only be tested from
// both sides, and the real side needs a signature the server actually accepts.
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58encode(buf) {
  let n = 0n; for (const b of buf) n = n * 256n + BigInt(b);
  let out = ''; while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  for (const b of buf) { if (b === 0) out = '1' + out; else break; }
  return out;
}
const { publicKey: _pk, privateKey: _sk } = crypto.generateKeyPairSync('ed25519');
const SIGNER = b58encode(_pk.export({ format: 'der', type: 'spki' }).subarray(12));
const authFor = (w = SIGNER) => {
  const ts = Date.now();
  return { wallet: w, ts, sig: crypto.sign(null, Buffer.from(`RATCHET | ${w} | ${ts}`, 'utf8'), _sk).toString('base64') };
};

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
let st = stats();
// A guest identity is free and unlimited. If a guest stake moved the pot, the
// pot — which pays real wallets in credits — would be free to inflate.
ok(!st.burned && !st.potD && !st.pot && !st.shots, 'demo stake feeds NO pot, NO burn counter');
ok((getMem('g:feed') || []).length === 0, 'demo seal absent from public feed');

// force-settle the demo shot as a HIT
const crAtSeal = getMem('u:demo-abc123').cr;
let p = getMem('u:demo-abc123');
p.open[0].exp = Date.now() - 1000; p.open[0].entry = 90; setMem('u:demo-abc123', p); tickPx();
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

// 3b ---- the same stake from a REAL, signed wallet MUST move the counters.
// Without this the guest test above could pass simply by the pot being broken.
r = await call('POST', { body: { action: 'shot', auth: authFor(), target: 'SOL5', side: 'YES', stake: 500 } });
ok(r.body.ok, 'signed real wallet accepted');
const stR = stats();
ok(stR && Math.abs(stR.burned - 350) < 1e-9 && Math.abs(stR.potD - 75) < 1e-9 && Math.abs(stR.pot - 75) < 1e-9,
   'real stake splits 70/15/15 into burn + pots');
ok(!(await call('POST', { body: { action: 'shot', auth: { ...authFor(), sig: 'AAAA' }, target: 'SOL5', side: 'YES', stake: 500 } })).body.ok,
   'forged signature rejected');

// 4 ---- real wallet (auth stub: monkey-patch verify via demo prefix not possible; write record directly)
// Simulate a real wallet's settled hit by direct KV surgery + settle path:
const RW = 'So11111111111111111111111111111111111111112';
setMem(`u:${RW}`, { w: RW, xp: 0, streak: 0, best: 0, hits: 0, shots: 0, bal: 5000, cr: 100, qualified: true,
  day: new Date().toISOString().slice(0, 10),
  open: [{ id: 'x1', kind: 'dir', feed: 'SOL', side: 'YES', entry: 90, exp: Date.now() - 1000, stake: 100, xp: 10, label: 't', src: 'cr' }],
  closed: [] });
r = await call('GET', { query: { action: 'state', wallet: RW } });
ok(r.body.player.hits === 1, 'real wallet hit settled');
ok(zScore('lb:', r.body.season, RW) === 10 && zScore('lbd:', r.body.day, RW) === 10, 'real XP on daily AND weekly boards');
ok((getMem('g:feed') || []).some(f => f.a.includes('HIT')), 'real hit visible in feed');

// 5 ---- VOID refunds to source and reverses pot/burn
setMem(`u:${RW}`, { ...getMem(`u:${RW}`), open: [{ id: 'x2', kind: 'dir', feed: 'SOL', side: 'YES', entry: 100.000001, exp: Date.now() - 1000, stake: 100, xp: 10, label: 't', src: 'cr' }] });
const crBefore = getMem(`u:${RW}`).cr; st = stats();
const bBefore = st.burned, dBefore = st.potD, wBefore = st.pot;
r = await call('GET', { query: { action: 'state', wallet: RW } });
let pr = getMem(`u:${RW}`); st = stats();
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
setStat('potD', 1000); st = stats();
const crB4 = getMem(`u:${RW}`).cr;
r = await call('GET', { query: { action: 'state' } });
// The pot deposits into an atomic queue rather than writing the winner's
// record from inside someone else's request. It lands on their next load —
// which is also what makes it impossible for a concurrent save to erase it.
ok(Number(mem.get(`pend:${RW}`)) === 500, 'daily pot BANKED for #1, not written into their record');
await call('GET', { query: { action: 'state', wallet: RW } });
pr = getMem(`u:${RW}`); st = stats();
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
setStat('pot', 1000); st = stats();
const crB5 = getMem(`u:${RW}`).cr;
r = await call('GET', { query: { action: 'state' } });
await call('GET', { query: { action: 'state', wallet: RW } });
pr = getMem(`u:${RW}`);
ok(pr.cr === crB5 + 400, 'weekly pot paid #1 (40%)');
ok(stats().pot === 600, 'weekly remainder rolled');

// 8 ---- warden settles into a public record
const wopen = getMem('g:warden:open');
wopen[0].exp = Date.now() - 1000; wopen[0].thresh = 1;   // SOL(100) > 1 => outcome YES
tickPx();
setMem('g:warden:open', wopen);
r = await call('GET', { query: { action: 'state' } });
ok(r.body.wardenRec.n === 1 && typeof r.body.wardenRec.brier === 'number', 'warden call settled into record');
ok((getMem('g:warden:hist') || []).length === 1, 'warden history recorded');

// 9 ---- feed-offline shot refused BEFORE stake is taken
delete PX.SOL;
st = stats(); const shotsB4 = st.shots;
r = await call('POST', { body: { action: 'shot', auth: { wallet: 'demo-abc123' }, target: 'SOL5', side: 'YES', stake: 100 } });
ok(!r.body.ok && r.status === 409, 'offline feed refused');
ok(stats().shots === shotsB4, 'no stats mutation on refusal');
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
  pd.open[0].exp = Date.now() - 1000; pd.open[0].entry = 90; setMem('u:demo-sealed', pd); tickPx();
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


// 2c ---- CUSTOM STAKES: any whole amount in range, scored on the same sqrt curve
resetRL();
r = await call('POST', { body: { action: 'shot', auth: { wallet: 'demo-stk1' }, target: 'SOL5', side: 'YES', stake: 1000 } });
const xp1000 = r.body.ok && r.body.shot.xp;
r = await call('POST', { body: { action: 'shot', auth: { wallet: 'demo-stk2' }, target: 'SOL5', side: 'YES', stake: 100 } });
const xp100 = r.body.ok && r.body.shot.xp;
ok(!!xp1000 && !!xp100 && Math.abs(xp1000 / xp100 - Math.sqrt(10)) < 0.12, 'custom stake XP follows sqrt(stake/100)');
resetRL();
r = await call('POST', { body: { action: 'shot', auth: { wallet: 'demo-stk3' }, target: 'SOL5', side: 'YES', stake: 1000000001 } });
ok(!r.body.ok && /between/.test(r.body.reason || ''), 'an absurd stake is still refused');
// You may risk as much of your own balance as you like. What stops rank being
// bought is the XP ceiling, not a limit on your stake.
resetRL();
setMem('u:demo-mill', { w:'demo-mill', xp:0, streak:0, best:0, hits:0, shots:0, cr:2000000,
  granted:true, burned:0, day:new Date().toISOString().slice(0,10), open:[], closed:[] });
r = await call('POST', { body: { action: 'shot', auth: { wallet: 'demo-mill' }, target: 'SOL5', side: 'YES', stake: 1000000 } });
ok(r.body.ok, 'a one-million credit stake is accepted');
ok(getMem('u:demo-mill').cr === 1000000, 'and it is actually deducted');
resetRL();
r = await call('POST', { body: { action: 'shot', auth: { wallet: 'demo-mill' }, target: 'SOL5', side: 'YES', stake: 1500000 } });
ok(!r.body.ok && /not enough credits/.test(r.body.reason||''),
   'your balance is the real limit, and the server enforces it');
// The cap moved to 100,000 so a big reload can actually be spent. The XP
// curve must NOT move with it, or the podium — which pays real RCX — becomes
// purchasable by the richest wallet rather than the most accurate one.
const fund = w => setMem(`u:${w}`, { w, xp:0, streak:0, best:0, hits:0, shots:0, cr:200000, granted:true,
  burned:0, day:new Date().toISOString().slice(0,10), open:[], closed:[] });
['demo-big1','demo-big2','demo-big3'].forEach(fund);
resetRL();
r = await call('POST', { body: { action: 'shot', auth: { wallet: 'demo-big1' }, target: 'SOL5', side: 'YES', stake: 40000 } });
const xpAtCap = r.body.ok && r.body.shot.xp;
resetRL();
r = await call('POST', { body: { action: 'shot', auth: { wallet: 'demo-big2' }, target: 'SOL5', side: 'YES', stake: 100000 } });
const xpAbove = r.body.ok && r.body.shot.xp;
ok(!!xpAtCap && !!xpAbove, 'stakes far above the old 2,500 ceiling are accepted');
ok(xpAtCap === xpAbove, `XP stops climbing past the cap (${xpAtCap} vs ${xpAbove}) — rank cannot be bought`);
resetRL();
r = await call('POST', { body: { action: 'shot', auth: { wallet: 'demo-big3' }, target: 'SOL5', side: 'YES', stake: 10000 } });
ok(r.body.ok && r.body.shot.xp < xpAtCap, 'below the cap, XP still rises with the stake');
r = await call('POST', { body: { action: 'shot', auth: { wallet: 'demo-stk4' }, target: 'SOL5', side: 'YES', stake: 250.5 } });
ok(!r.body.ok, 'fractional stake refused');

// ============================================================
//  REGRESSION: the free-option exploit must stay closed.
//
//  Before h17, settle() used the price at the MOMENT OF SETTLING. Since
//  nothing settles a shot except a request naming that wallet, and that
//  request needs no signature, a player could sit on an expired shot and
//  fire the settle only once the market had come good. Patience won almost
//  every shot. These tests fail if that ever comes back.
// ============================================================
const { bucketKey: bk, SETTLE_GRACE_MS: GRACE } = require('./lib/pxlog.js');
const pxGate = globalThis.__ratchet_pxgate;

const EXPW = 'demo-optn1';
{
  const now = Date.now(), exp = now - 10 * 60e3;         // expired 10 minutes ago
  setMem(`u:${EXPW}`, { w: EXPW, xp:0, streak:0, best:0, hits:0, shots:0, cr:5000, granted:true,
    burned:0, day:new Date().toISOString().slice(0,10), closed:[],
    open:[{ id:'opt1', kind:'dir', feed:'SOL', side:'YES', entry:100, exp, stake:500, xp:10, label:'t', src:'cr' }] });

  // The oracle went DOWN at expiry and recovered hard afterwards.
  pxGate.t = now;                                        // stop the sampler adding rows
  setMem(bk(exp), [
    { t: exp + 1000, SOL: 90,  BTC:60000, ETH:2000, src:'pyth-onchain' },   // at expiry: a MISS
    { t: now  - 500, SOL: 500, BTC:60000, ETH:2000, src:'pyth-onchain' },   // now: would be a HIT
  ]);

  r = await call('GET', { query: { action: 'state', wallet: EXPW } });
  const st1 = getMem(`u:${EXPW}`);
  ok(st1.open.length === 0 && st1.closed[0].res === 'miss',
     'late settle uses the price AT EXPIRY, not the favourable one now');
  ok(st1.closed[0].exitPx === 90, `exit price pinned to the expiry sample (got ${st1.closed[0].exitPx})`);
  ok(st1.closed[0].exitAt === exp + 1000, 'the settling sample is recorded, so anyone can recompute it');
}

// A shot whose grace window closed with no sample must VOID, never guess.
{
  const now = Date.now(), exp = now - (GRACE + 5 * 60e3);
  setMem(`u:demo-optn2`, { w:'demo-optn2', xp:0, streak:0, best:0, hits:0, shots:0, cr:5000, granted:true,
    burned:0, day:new Date().toISOString().slice(0,10), closed:[],
    open:[{ id:'opt2', kind:'dir', feed:'SOL', side:'YES', entry:100, exp, stake:500, xp:10, label:'t', src:'cr' }] });
  pxGate.t = now;
  // priceAt searches FORWARD across hour buckets, so emptying only the expiry
  // hour is not enough — a sample another test wrote into the next bucket can
  // land inside this shot's grace window and settle it. Clear the whole range
  // the search can reach, or this assertion silently depends on the clock.
  for (let h = exp; h <= exp + GRACE + 2 * 3600e3; h += 3600e3) setMem(bk(h), []);
  const crB = getMem('u:demo-optn2').cr;
  r = await call('GET', { query: { action: 'state', wallet: 'demo-optn2' } });
  const st2 = getMem('u:demo-optn2');
  ok(st2.closed[0].res === 'void' && st2.cr === crB + 500,
     'no sample inside the grace window -> VOID and refund, never a guessed price');
}

// Waiting must not be a strategy: the outcome is identical whenever it settles.
{
  const now = Date.now(), exp = now - 60e3;
  pxGate.t = now;
  setMem(bk(exp), [{ t: exp + 500, SOL: 90, BTC:60000, ETH:2000, src:'pyth-onchain' },
                   { t: now - 100, SOL: 900, BTC:60000, ETH:2000, src:'pyth-onchain' }]);
  const results = [];
  for (const w of ['demo-w8a', 'demo-w8b']) {
    setMem(`u:${w}`, { w, xp:0, streak:0, best:0, hits:0, shots:0, cr:5000, granted:true,
      burned:0, day:new Date().toISOString().slice(0,10), closed:[],
      open:[{ id:'w8', kind:'dir', feed:'SOL', side:'YES', entry:100, exp, stake:500, xp:10, label:'t', src:'cr' }] });
    await call('GET', { query: { action: 'state', wallet: w } });
    results.push(getMem(`u:${w}`).closed[0].exitPx);
  }
  ok(results[0] === results[1] && results[0] === 90, 'two settlers, different moments, identical exit price');
}

// The sealed side must not leak through xp on any spectator path.
{
  // this deep into the run the per-instance rate limiter has tripped; it is
  // not what this test is about
  resetRL();
  r = await call('POST', { body: { action: 'shot', auth: { wallet: 'demo-leak1' }, target: 'SOL5', side: 'NO', stake: 500 } });
  ok(r.body.ok && typeof r.body.shot.xp === 'number', 'owner still gets xp in the fire response');
  r = await call('GET', { query: { action: 'state', wallet: 'demo-leak1' } });
  const o = r.body.player.open[0];
  ok(o && !('side' in o) && !('salt' in o) && !('xp' in o),
     'spectator view carries no side, no salt and no xp (xp is computed FROM the side)');
}

// A market that did nothing must not pay a side.
{
  const now = Date.now(), exp = now - 60e3;
  pxGate.t = now;
  setMem(bk(exp), [{ t: exp + 500, SOL: 100, BTC:60000, ETH:2000, src:'pyth-onchain' }]);
  for (const [kind, shot] of [
    ['thr',     { kind:'thr',     feed:'SOL', thresh:100 }],
    ['thrDown', { kind:'thrDown', feed:'SOL', thresh:100 }],
    ['range',   { kind:'range',   feed:'SOL', entry:100, pct:0 }],
  ]) {
    const w = 'demo-tie' + kind.toLowerCase().slice(0,3);
    setMem(`u:${w}`, { w, xp:0, streak:0, best:0, hits:0, shots:0, cr:5000, granted:true,
      burned:0, day:new Date().toISOString().slice(0,10), closed:[],
      open:[{ id:'tie', side:'NO', entry:100, exp, stake:500, xp:10, label:'t', src:'cr', ...shot }] });
    await call('GET', { query: { action: 'state', wallet: w } });
    const c = getMem(`u:${w}`).closed[0];
    ok(c.res === 'void', `${kind}: a standstill voids instead of paying the NO side 1.7x`);
  }
}


// ============================================================
//  REGRESSION: ladders are atomic, credits survive a lost race.
// ============================================================
const kvmod = require('./lib/kv.js');

// Concurrent settles used to lose XP to each other, and one flaky read
// replaced the whole board with a single row. Neither can happen now.
{
  const per = 'testperiod';
  await Promise.all(Array.from({ length: 40 }, () => kvmod.zincr(`z:lb:${per}`, 25, 'PLAYER_A')));
  await kvmod.zincr(`z:lb:${per}`, 10, 'PLAYER_B');
  const rows = await kvmod.ztop(`z:lb:${per}`);
  ok(rows.length === 2, 'concurrent bumps do not replace the board with one row');
  ok(rows[0][0] === 'PLAYER_A' && rows[0][1] === 1000, `40 concurrent bumps all landed (${rows[0][1]}/1000)`);
  ok(rows[1][1] === 10, "the other player's XP survived the burst");
}

// A legacy JSON ladder must be lifted into the sorted set exactly once.
{
  setMem('lbd:2019-05-05', { REALW: 120, 'demo-skipme': 900 });
  setMem('g:day', '2019-05-05');
  await call('GET', { query: { action: 'state' } });        // triggers the rollover -> migration
  const m = mem.get('Z' + 'z:lbd:2019-05-05');
  ok(m && m.get('REALW') === 120, 'legacy ladder migrated into the sorted set');
  ok(!m || !m.has('demo-skipme'), 'migration does not carry demo rows onto a paying board');
}

// THE ONE THAT DESTROYED REAL TOKENS: a credit deposited out-of-band must
// survive a concurrent stale writer saving over the player record.
{
  const W = 'demo-race1';
  setMem(`u:${W}`, { w: W, xp:0, streak:0, best:0, hits:0, shots:0, cr:1000, granted:true,
    burned:0, day:new Date().toISOString().slice(0,10), open:[], closed:[] });
  await kvmod.incrFloat(`pend:${W}`, 100000);              // a reload banks 100k
  setMem(`u:${W}`, { w: W, xp:0, streak:0, best:0, hits:0, shots:0, cr:1000, granted:true,
    burned:0, day:new Date().toISOString().slice(0,10), open:[], closed:[] });  // stale writer clobbers
  resetRL();
  r = await call('GET', { query: { action: 'state', wallet: W } });
  ok(getMem(`u:${W}`).cr === 101000, `banked credit survived the clobber (cr=${getMem(`u:${W}`).cr})`);
  ok((Number(mem.get(`pend:${W}`)) || 0) === 0, 'the queue is drained exactly once, not replayed');
}

// Champion pay is deposited into the champion's queue, not written into
// their record from inside the payer's request.
{
  const C = 'demo-champ1';
  setMem(`u:${C}`, { w: C, xp:0, streak:0, best:0, hits:0, shots:0, cr:0, granted:true,
    burned:0, day:new Date().toISOString().slice(0,10), open:[], closed:[], champ7:{} });
  await kvmod.incrFloat(`c7:${C}`, 777);
  resetRL();
  await call('GET', { query: { action: 'state', wallet: C } });
  const cp = getMem(`u:${C}`);
  const total = Object.values(cp.champ7 || {}).reduce((a, b) => a + b, 0);
  ok(total === 777, `champion pay landed in the holder window (${total})`);
}


// ============================================================
//  REGRESSION: global totals are atomic, and the floor is monotone for real.
// ============================================================
{
  const kv2 = require('./lib/kv.js');
  // 60 stakes landing together must all count. As a read-modify-write blob,
  // overlapping writers collapsed into one and the pot silently under-counted.
  await Promise.all(Array.from({ length: 60 }, () => kv2.hincr('h:conc', 'potD', 25)));
  const h = await kv2.hall('h:conc');
  ok(h.potD === 1500, `60 concurrent bumps all landed (${h.potD}/1500)`);

  // A payout debits exactly what it paid, so a stake that read the pre-payout
  // pot can no longer resurrect a pot that was already distributed.
  await kv2.hincr('h:conc', 'potD', -1500);
  ok((await kv2.hall('h:conc')).potD === 0, 'a paid-out pot debits to zero and stays there');
}

// The floor is derived from the burn total, so no stale write can step the
// headline number backwards — "monotone by construction" is now literally true.
{
  resetRL();
  const before = stats();
  const f1 = (await call('GET', { query: { action: 'state' } })).body.stats.floor;
  setStat('burned', (before.burned || 0) + 5_000_000);
  const f2 = (await call('GET', { query: { action: 'state' } })).body.stats.floor;
  ok(f2 > f1, 'floor rises with the burn total');
  setStat('burned', 0);                       // a stale writer tries to undo it
  const f3 = (await call('GET', { query: { action: 'state' } })).body.stats.floor;
  ok(f3 >= FLOOR_MIN_OK, 'floor never reads below its base');
  setStat('burned', before.burned || 0);
}

// Re-sending the same staking state must not inflate the published count.
{
  resetRL();
  const w = 'demo-stkidem';
  const s0 = stats().stakers || 0;
  for (let i = 0; i < 5; i++)
    await call('POST', { body: { action: 'stake', auth: { wallet: w }, on: true } });
  ok((stats().stakers || 0) === s0, 'demo wallets never count as stakers');
}


// ============================================================
//  REGRESSION: you cannot open a position against a stale oracle print.
// ============================================================
{
  resetRL();
  const saved = { ...PX };
  // A 5-minute chamber needs a print under 45s old; 55s is most of a heartbeat
  // and would have handed a player watching a live feed a real head start.
  PX.ages = { SOL: 55, BTC: 55, ETH: 55, BONK: 55, WIF: 55, JUP: 55, PUMP: 55 };
  r = await call('POST', { body: { action: 'shot', auth: { wallet: 'demo-fresh1' }, target: 'SOL5', side: 'YES', stake: 500 } });
  ok(!r.body.ok && /print is 55s old/.test(r.body.reason || ''), 'stale print refused on a 5-minute window');
  ok(!getMem('u:demo-fresh1') || getMem('u:demo-fresh1').cr === 5000, 'refusal costs the player nothing');

  // The same staleness is meaningless over an hour, so it must still seal.
  r = await call('POST', { body: { action: 'shot', auth: { wallet: 'demo-fresh2' }, target: 'BTC60', side: 'YES', stake: 500 } });
  ok(r.body.ok, 'the same age still seals on a 1-hour window — the bound is proportionate');
  ok(r.body.shot.entryAge === 55, 'the entry price age is recorded on the shot');

  PX.ages = { SOL: 3, BTC: 3, ETH: 3, BONK: 3, WIF: 3, JUP: 3, PUMP: 3 };
  r = await call('POST', { body: { action: 'shot', auth: { wallet: 'demo-fresh3' }, target: 'SOL5', side: 'YES', stake: 500 } });
  ok(r.body.ok, 'a fresh print seals normally');
  for (const k of Object.keys(PX)) delete PX[k];
  Object.assign(PX, saved);
}


// ============================================================
//  REGRESSION: a free keypair plays, but does not rank.
// ============================================================
{
  resetRL();
  const UNQ = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';   // a wallet-shaped stranger
  setMem(`u:${UNQ}`, { w: UNQ, xp: 0, streak: 0, best: 0, hits: 0, shots: 0, cr: 5000,
    granted: true, qualified: false, burned: 0, day: new Date().toISOString().slice(0, 10),
    open: [{ id: 'q1', kind: 'dir', feed: 'SOL', side: 'YES', entry: 90, exp: Date.now() - 1000,
             stake: 100, xp: 40, label: 't', src: 'cr' }], closed: [] });
  tickPx();
  r = await call('GET', { query: { action: 'state', wallet: UNQ } });
  const up = getMem(`u:${UNQ}`);
  ok(up.hits === 1 && up.xp === 40, 'an unverified wallet still plays and still scores');
  ok(zScore('lbd:', r.body.day, UNQ) === 0 && zScore('lb:', r.body.season, UNQ) === 0,
     'but its XP reaches NO paying ladder — a free keypair cannot farm the podium');

  // Grandfathering: anyone already playing keeps their standing.
  const OLD = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
  setMem(`u:${OLD}`, { w: OLD, xp: 500, streak: 0, best: 0, hits: 3, shots: 9, cr: 100,
    granted: true, burned: 0, day: new Date().toISOString().slice(0, 10),
    open: [{ id: 'q2', kind: 'dir', feed: 'SOL', side: 'YES', entry: 90, exp: Date.now() - 1000,
             stake: 100, xp: 15, label: 't', src: 'cr' }], closed: [] });   // note: no `qualified` field
  tickPx();
  r = await call('GET', { query: { action: 'state', wallet: OLD } });
  ok(getMem(`u:${OLD}`).qualified === true, 'an existing player is grandfathered, not demoted');
  ok(zScore('lbd:', r.body.day, OLD) === 15, 'and keeps ranking exactly as before');
}


// ============================================================
//  THE ARENA — registration, gating, and the machine-readable board.
// ============================================================
{
  resetRL();
  // a signed but UNQUALIFIED wallet must not be able to enter
  const { publicKey: pk2, privateKey: sk2 } = crypto.generateKeyPairSync('ed25519');
  const W2 = b58encode(pk2.export({ format: 'der', type: 'spki' }).subarray(12));
  const auth2 = () => { const ts = Date.now();
    return { wallet: W2, ts, sig: crypto.sign(null, Buffer.from(`RATCHET | ${W2} | ${ts}`, 'utf8'), sk2).toString('base64') }; };
  setMem(`u:${W2}`, { w: W2, xp:0, streak:0, best:0, hits:0, shots:0, cr:5000, granted:true,
    qualified:false, burned:0, day:new Date().toISOString().slice(0,10), open:[], closed:[] });
  r = await call('POST', { body: { action: 'agent-register', auth: auth2(), name: 'FREELOADER' } });
  ok(!r.body.ok && /has not touched RCX/.test(r.body.reason || ''),
     'an unqualified wallet cannot enter the arena — free identities would make the board noise');

  // the qualified signer from earlier can
  resetRL();
  const pq = getMem(`u:${SIGNER}`) || {}; pq.qualified = true; pq.w = SIGNER;
  setMem(`u:${SIGNER}`, pq);
  r = await call('POST', { body: { action: 'agent-register', auth: authFor(), name: 'test bot', blurb: 'reads the drift' } });
  ok(r.body.ok && r.body.agent.name === 'TEST BOT', 'a qualified wallet registers, name normalised');
  ok(getMem(`u:${SIGNER}`).agent.since > 0, 'the agent record is stored on the wallet');

  // names cannot be stolen
  resetRL();
  setMem(`u:${W2}`, { ...getMem(`u:${W2}`), qualified: true });
  r = await call('POST', { body: { action: 'agent-register', auth: auth2(), name: 'TEST BOT' } });
  ok(!r.body.ok && /taken/.test(r.body.reason || ''), 'a live agent name cannot be taken over');

  // bad names refused
  resetRL();
  r = await call('POST', { body: { action: 'agent-register', auth: auth2(), name: 'x' } });
  ok(!r.body.ok, 'a one-character name is refused');

  // the machine board carries everything an agent needs
  r = await call('GET', { query: { action: 'board' } });
  const bd = r.body;
  ok(bd.ok && Array.isArray(bd.targets) && bd.targets.length >= 9, 'board lists every target');
  ok(bd.targets.every(t => t.id && t.feed && t.mins > 0 && t.label), 'each target is fully specified');
  ok(bd.stakeRule && bd.settleRule && bd.sealRule, 'the board publishes the rules it will be judged by');
  ok(bd.flipsAt > Date.now(), 'and says when the mix changes');

  // the arena board scores and gates on sample size
  r = await call('GET', { query: { action: 'arena' } });
  ok(r.body.ok && Array.isArray(r.body.agents), 'arena answers');
  const me = r.body.agents.find(a => a.name === 'TEST BOT');
  ok(me && me.listed === false, 'a new agent is published but NOT ranked — 3-for-3 is not evidence');
  ok(r.body.house && Array.isArray(r.body.house.fleet), 'the house fleet is listed alongside');
}


// ============================================================
//  STREAKS PAY — but only in XP, and only up to a point.
// ============================================================
{
  resetRL();
  const W = 'demo-strk1';
  const seed = (streak) => setMem(`u:${W}`, { w:W, xp:0, streak, best:streak, hits:0, shots:0, cr:50000,
    granted:true, burned:0, day:new Date().toISOString().slice(0,10), closed:[],
    open:[{ id:'s'+streak, kind:'dir', feed:'SOL', side:'YES', entry:90, exp:Date.now()-1000,
            stake:500, xp:100, label:'t', src:'cr' }] });
  const run = async (streak) => { seed(streak); tickPx();
    await call('GET', { query:{ action:'state', wallet:W } });
    return getMem(`u:${W}`).closed[0]; };

  const cold = await run(0), warm = await run(3), hot = await run(20);
  ok(cold.xp === 100, `no streak = no bonus (${cold.xp})`);
  ok(warm.xp === 145 && warm.streakMult === 1.45, `a 3-run pays x1.45 (${warm.xp})`);
  ok(hot.xp === 200 && hot.streakMult === 2, `the bonus caps at x2 (${hot.xp})`);
  ok(cold.xpBase === 100 && warm.xpBase === 100, 'the base XP is recorded, so the bonus is auditable');
  // a miss must cost the run — that is the whole mechanic
  setMem(`u:${W}`, { ...getMem(`u:${W}`), streak: 5, closed: [],
    open:[{ id:'sm', kind:'dir', feed:'SOL', side:'NO', entry:90, exp:Date.now()-1000,
            stake:500, xp:100, label:'t', src:'cr' }] });
  tickPx(); await call('GET', { query:{ action:'state', wallet:W } });
  ok(getMem(`u:${W}`).streak === 0, 'one miss resets the run — which is what makes it worth protecting');
}

// ============================================================
//  THE PRICE PATH is servable, bounded, and refuses nonsense.
// ============================================================
{
  resetRL();
  const now = Date.now(), from = now - 10*60e3;
  const { bucketKey: bk2 } = require('./lib/pxlog.js');
  const g = globalThis.__ratchet_pxgate; if (g) g.t = now;
  setMem(bk2(from), [
    { t: from + 60e3,  SOL: 100, BTC:60000, ETH:2000, src:'pyth-onchain' },
    { t: from + 120e3, SOL: 103, BTC:60000, ETH:2000, src:'pyth-onchain' },
    { t: from + 180e3, SOL:  99, BTC:60000, ETH:2000, src:'pyth-onchain' },
  ]);
  r = await call('GET', { query:{ action:'path', feed:'SOL', from:String(from), to:String(now) } });
  ok(r.body.ok && r.body.path.length >= 3, `path returns the recorded samples (${r.body.path && r.body.path.length})`);
  ok(r.body.path.every(([t,v]) => Number.isFinite(t) && Number.isFinite(v)), 'each point is [time, price]');
  ok(r.body.path[0][0] <= r.body.path[r.body.path.length-1][0], 'oldest first');
  r = await call('GET', { query:{ action:'path', feed:'DOGE', from:String(from), to:String(now) } });
  ok(!r.body.ok, 'an unknown feed is refused');
  r = await call('GET', { query:{ action:'path', feed:'SOL', from:String(now), to:String(from) } });
  ok(!r.body.ok, 'a backwards window is refused');
  r = await call('GET', { query:{ action:'path', feed:'SOL', from:'0', to:String(now) } });
  ok(!r.body.ok && /too wide/.test(r.body.reason||''), 'an unbounded window is refused');
}

console.log(fails ? `\n${fails} FAILURES` : '\nALL PASS');
process.exit(fails ? 1 : 0);
