// Smoke test for the hardened backend. Runs the endpoint in-memory
// (no KV env -> Map backend), with the price oracle and RPC stubbed so
// nothing touches the network. Exercises: state, demo shot, settle
// hit/miss/void, demo-ladder exclusion, real-wallet ladder, stake
// source refunds, daily+weekly rollover with lock release, stale-feed
// auto-void, warden seal+settle+record, rate limiter, atomic sig gate.
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// The podium only exists once a token does, so the harness has to be running
// with a mint set — otherwise the whole Champion's Cut path is skipped and
// its tests pass vacuously.
process.env.RATCHET_MINT = process.env.RATCHET_MINT || 'FQb2EyaLZ9TWBemYmQ9zWtXcEwLiSXtz7j619ThQpump';

// ---- stub the oracle and the chain BEFORE game.js loads them
const pricesPath = require.resolve('../lib/prices.js');
const burnPath = require.resolve('../lib/burn.js');
const realBurn = require('../lib/burn.js');   // capture the REAL module before stubbing
const TEST_FEEDS = ['SOL','BTC','ETH','BONK','WIF','JUP','PUMP'];
let PX = { src: 'pyth-onchain', SOL: 100, BTC: 60000, ETH: 2000, BONK: 0.000002, WIF: 0.1, JUP: 0.2, PUMP: 0.005 };
require.cache[pricesPath] = { id: pricesPath, filename: pricesPath, loaded: true,
  exports: { getPrices: async () => { const t=Math.floor(Date.now()/1000); return { ...PX,
    ages:PX.ages || Object.fromEntries(TEST_FEEDS.map(f=>[f,1])),
    confs:PX.confs || Object.fromEntries(TEST_FEEDS.map(f=>[f,10])),
    pubs:PX.pubs || Object.fromEntries(TEST_FEEDS.map(f=>[f,t])),
    prevPubs:PX.prevPubs || Object.fromEntries(TEST_FEEDS.map(f=>[f,t-60])),
    slots:PX.slots || Object.fromEntries(TEST_FEEDS.map((f,i)=>[f,300000+i])),
    postedSlots:PX.postedSlots || Object.fromEntries(TEST_FEEDS.map((f,i)=>[f,299900+i])),
    emaPrices:PX.emaPrices || Object.fromEntries(TEST_FEEDS.map(f=>[f,PX[f]])),
    emaConfs:PX.emaConfs || Object.fromEntries(TEST_FEEDS.map(f=>[f,8])) }; } } };
require.cache[burnPath] = { id: burnPath, filename: burnPath, loaded: true,
  exports: { INCINERATOR: '1nc1nerator11111111111111111111111111111111',
    // getTokenAccountsByOwner answers with an EMPTY LIST for a wallet that has
    // no account — it does not fail. The stub used to return null for every
    // method, which the code now reads as "the chain was unreachable", because
    // a failed read and an empty wallet are no longer the same thing.
    //
    // RPC_DEAD flips the stub to a total outage. It has to be a flag rather
    // than a reassignment: game.js destructures rpcCall at load, so swapping
    // the module property later would never reach it.
    rpcCall: async (m) => {
      if (globalThis.__rpcDead) return undefined;                 // every endpoint failed
      return m === 'getTokenAccountsByOwner' ? { value: [] } : null;
    },
    getTx: async () => null,
    decideBurn: () => ({ ok: false, reason: 'stub' }) } };

const game = require('../api/game.js');
const mem = globalThis.__ratchet_mem;

function call(method, { query = {}, body = null, ip = '1.2.3.4' } = {}) {
  return new Promise(resolve => {
    const req = { method, query, body, headers: { 'x-forwarded-for': ip }, socket: {} };
    const res = {
      _status: 200,
      _headers: {},
      setHeader(name, value) { this._headers[String(name).toLowerCase()] = String(value); },
      status(c) { this._status = c; return this; },
      json(o) { resolve({ status: this._status, body: o, headers: this._headers }); },
    };
    game(req, res).catch(e => resolve({ status: 599, body: { ok: false, reason: String(e) } }));
  });
}

let fails = 0;
const ok = (cond, name) => { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name); if (!cond) fails++; };
const getMem = k => (mem.has(k) ? JSON.parse(mem.get(k)) : null);
// A fixture that writes BEHIND the store must invalidate what a write THROUGH
// the store would have invalidated, or it is testing the caches rather than the
// code. lib/kv.js drops both in-process memos on every write (see `rdrop`);
// mem.set reaches neither, so seeding the Warden's price history left the
// pxlog bucket memo holding the empty hour it had already read, and the Warden
// reported no measurable volatility from 200 minutes of it.
const setMem = (k, v) => {
  mem.set(k, JSON.stringify(v));
  const buckets = globalThis.__ratchet_bucketmemo; if (buckets) buckets.delete(k);
  const reads = globalThis.__ratchet_rmemo; if (reads) reads.delete(k);
};
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
// Behind the store again, so it invalidates by hand for the reason setMem does.
// The display memo in api/game.js is keyed by what it was DERIVED from, so a
// write to h:stats has to reach it through that index or the next state read
// serves a figure from before this line ran.
const dropDerived = key => {
  const deps = globalThis.__ratchet_shared_deps, display = globalThis.__ratchet_shared;
  const dependents = deps && deps.get(key);
  if (dependents && display) { for (const d of dependents) display.delete(d); deps.delete(key); }
};
const setStat = (f, v) => {
  if (!mem.has('H' + 'h:stats')) mem.set('H' + 'h:stats', new Map());
  mem.get('H' + 'h:stats').set(f, v);
  dropDerived('h:stats');
};
const zScore = (pfx, period, w) => { const m = mem.get('Z' + `z:${pfx}${period}`); return m ? (m.get(w) || 0) : 0; };

const BOARD_TEST_HOUR = Math.floor(Date.now() / 3600e3);
const TARGET5 = `H${BOARD_TEST_HOUR}Q0`;
const TARGET60 = `H${BOARD_TEST_HOUR}Q4`;
const TARGET1440 = `H${BOARD_TEST_HOUR}Q6`;
// 1 ---- bare state
let r = await call('GET', { query: { action: 'state' } });
const initialState = r;
const FLASH_FEED = r.body.targets[TARGET5].feed;
ok(r.status === 200 && r.body.ok && r.body.v && r.body.durable === false, 'state answers, versioned, ephemeral');
ok(Object.keys(r.body.targets).length === 11, 'eleven targets served (7 balanced directions + 4 market structures)');
ok(r.body.boardModel === 'v3-keyless-hourly', 'board generator version is public');
const directionals = Object.values(r.body.targets).filter(t => t.kind === 'dir');
ok(directionals.length === 7 && new Set(directionals.map(t => t.feed)).size === 7,
   'every Pyth feed gets exactly one directional window per hour');
ok(r.body.targets[TARGET5] && r.body.targets[TARGET5].mins === 5
   && /^FLASH:/.test(r.body.targets[TARGET5].label),
   'one rotating five-minute FLASH can complete during a first visit');
ok(Object.values(r.body.targets).some(t => t.feed === 'PUMP'), 'the house token is on the board');
ok(!('RCX15' in r.body.targets) && !('RCX_THR' in r.body.targets), 'no RCX-priced targets');
ok(r.body.stats.potD === 0, 'daily pot initialised');

// Display fallbacks remain visible prices, never playable questions.
PX.src = 'coinbase';
r = await call('GET', { query: { action: 'state' }, ip:'1.2.3.5' });
ok(Object.keys(r.body.targets || {}).length === 0,
  'state advertises zero playable targets on a display-only fallback');
r = await call('GET', { query: { action: 'board' }, ip:'1.2.3.6' });
ok((r.body.targets || []).length === 0,
  'machine board advertises zero playable targets on a display-only fallback');
PX.src = 'pyth-onchain';
PX.ages = Object.fromEntries(TEST_FEEDS.map(f => [f, 1]));
PX.ages[FLASH_FEED] = null;
r = await call('GET', { query: { action: 'board' }, ip:'1.2.3.7' });
ok(!(r.body.targets || []).some(t => t.feed === FLASH_FEED),
  'a null publish age removes that feed from the machine board');
delete PX.ages;
PX.confs = Object.fromEntries(TEST_FEEDS.map(f => [f, 10]));
PX.confs[FLASH_FEED] = '';
r = await call('GET', { query: { action: 'board' }, ip:'1.2.3.8' });
ok(!(r.body.targets || []).some(t => t.feed === FLASH_FEED),
  'an empty confidence value removes that feed from the machine board');
delete PX.confs;

// Mirror receipts are only creditable when every sealed term matches. This
// decoder is pure so the dangerous boundary stays testable with mirroring
// disabled in normal environments.
{
  const disc = Buffer.from('66caaba31b9869f2', 'hex');
  const nonce = Buffer.alloc(8); nonce.writeBigUInt64LE(42n);
  const commit = Buffer.alloc(32, 7);
  const anchorString = value => {
    const bytes = Buffer.from(value, 'utf8');
    const len = Buffer.alloc(4); len.writeUInt32LE(bytes.length);
    return Buffer.concat([len, bytes]);
  };
  const shotId = 'shot42';
  const feed = 'ab'.repeat(32);
  const exp = Buffer.alloc(8); exp.writeBigInt64LE(123456n);
  const threshold = Buffer.alloc(8); threshold.writeBigInt64LE(987654n);
  const data = Buffer.concat([disc, nonce, commit, anchorString(shotId), anchorString(feed), exp, Buffer.from([1]), threshold]);
  const seal = game.parseMirrorSeal(data);
  ok(seal && seal.nonce === 42n && seal.commit === '07'.repeat(32)
     && seal.shotId === shotId && seal.feed === feed && seal.expiry === 123456
     && seal.kind === 1 && seal.thresholdE12 === 987654n,
     'mirror confirmation decodes every v2 sealed term');
  const altered = Buffer.from(data); altered[altered.length - 1] ^= 1;
  ok(game.parseMirrorSeal(altered).thresholdE12 !== seal.thresholdE12,
     'mirror receipt exposes altered terms instead of checking only commitment');
}
// THE WARDEN MUST NOT SPEAK BEFORE IT CAN MEASURE.
// Its stated probability comes from volatility measured off the price log.
// With no log there is no estimate, and the correct output is silence — the
// version this replaced always had a number, and its number meant nothing.
ok(!(getMem('g:warden:open') || []).length,
   'no warden line before there is enough price history to price one');
ok(initialState.body.warden && initialState.body.warden.p === null,
   'and the line it serves says so, rather than quoting a made-up probability');
{
  const before = { ...stats() };
  const noLine = await call('POST', { body:{ action:'duel', auth:{wallet:'demo-noline1'}, side:'with', stake:500 } });
  ok(!noLine.body.ok && /no line/.test(noLine.body.reason || ''),
    `a Warden duel refuses before a measured line exists (${noLine.body.reason || 'no reason'})`);
  ok(JSON.stringify(stats()) === JSON.stringify(before), 'and that refusal moves no burn, pot or shot counter');
}

// Settlement now reads the recorded price log, not "the price right now".
// A shot can only settle once a sample exists AT OR AFTER its expiry, so a
// force-settle in a test has to let the sampler fire again first. Clearing
// the per-instance gate is exactly what the passage of a minute does.
const tickPx = () => { const g = globalThis.__ratchet_pxgate; if (g) g.t = 0; };
const seedStubPx = ts => {
  const key = require('../lib/pxlog.js').bucketKey(ts);
  const rows = getMem(key) || [];
  const pub = Math.ceil((ts + 10) / 1000);
  rows.push({ t:pub*1000, src:'pyth-onchain', SOL:PX.SOL, BTC:PX.BTC, ETH:PX.ETH,
    BONK:PX.BONK, WIF:PX.WIF, JUP:PX.JUP, PUMP:PX.PUMP,
    pt:Object.fromEntries(TEST_FEEDS.map(f=>[f,pub])), pp:Object.fromEntries(TEST_FEEDS.map(f=>[f,pub-60])),
    cf:Object.fromEntries(TEST_FEEDS.map(f=>[f,10])) });
  rows.sort((a,b)=>a.t-b.t); setMem(key, rows);
};

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
r = await call('POST', { body: { action: 'shot', auth: { wallet: 'demo-abc123' }, target: TARGET5, side: 'YES', stake: 500 } });
ok(r.body.ok && r.body.shot.src === 'cr' && r.body.shot.outcomeRule === 'strict-compare-v2',
   'demo shot seals the new strict comparison rule with the one credit balance');
let st = stats();
// A guest identity is free and unlimited. If a guest stake moved the pot, the
// pot — which pays real wallets in credits — would be free to inflate.
ok(!st.burned && !st.potD && !st.pot && !st.shots, 'demo stake feeds NO pot, NO burn counter');
ok((getMem('g:feed') || []).length === 0, 'demo seal absent from public feed');

// force-settle the demo shot as a HIT
const crAtSeal = getMem('u:demo-abc123').cr;
let p = getMem('u:demo-abc123');
p.open[0].exp = Date.now() - 1000; p.open[0].entry = PX[p.open[0].feed] * 0.9; seedStubPx(p.open[0].exp); setMem('u:demo-abc123', p); tickPx();
r = await call('GET', { query: { action: 'state', wallet: 'demo-abc123' } });
// 22 skill XP plus the fixed 1 XP awarded to every valid settlement.
ok(r.body.player.hits === 1 && r.body.player.xp === 23, 'demo hit earns settle XP plus skill XP');
// being right must pay: 500 staked, 1.7x back = 850 credits returned
ok(r.body.player.cr === crAtSeal + 850, 'a hit returns 1.7x the stake in credits');
const wk = Object.keys(mem).length; // touch
const seasonLb = Object.entries(mem).filter(([k]) => k.startsWith('lb'));
ok(!getMem(`lb:${r.body.season}`) && !getMem(`lbd:${r.body.day}`), 'demo XP reached NO ladder');
ok((getMem('g:feed') || []).length === 0, 'demo hit absent from public feed');

// 3b ---- the same stake from a REAL, signed wallet MUST move the counters.
// Without this the guest test above could pass simply by the pot being broken.
r = await call('POST', { body: { action: 'shot', auth: authFor(), target: TARGET5, side: 'YES', stake: 500 } });
ok(r.body.ok, 'signed real wallet accepted');
let stR = stats();
ok(stR.shots === 1, 'a durable real seal increments the public shot count exactly once');
ok(stR && !stR.burned && !stR.potD && !stR.pot,
   'an unresolved real stake is held but does not fund a pot it may later void against');
{
  const sp = getMem(`u:${SIGNER}`); sp.open[0].exp=Date.now()-1000; sp.open[0].entry=PX[sp.open[0].feed]*0.9;
  const interruptedPlayerSave = JSON.parse(JSON.stringify(sp));
  seedStubPx(sp.open[0].exp); setMem(`u:${SIGNER}`,sp); tickPx();
  const firstSettle = await call('GET',{query:{action:'state',wallet:SIGNER},ip:'1.2.3.55'});
  const afterFirstSettle = getMem(`u:${SIGNER}`);
  stR=stats();
  ok(stR.burned===350 && stR.potD===75 && stR.pot===75,
    'a resolved real stake atomically splits 70/15/15 into burn + pots');
  const externalAfterFirst = {
    stats:{...stR}, log:getMem('g:log:n'), feed:(getMem('g:feed')||[]).length,
    hist:(getMem(`hist:${SIGNER}`)||[]).length,
    season:zScore('lb:',firstSettle.body.season,SIGNER),
    day:zScore('lbd:',firstSettle.body.day,SIGNER),
  };
  // Simulate a process dying after external settlement effects but before the
  // updated player blob became durable. The same open shot must repair the
  // player and every cross-key side effect must remain exactly once.
  setMem(`u:${SIGNER}`, interruptedPlayerSave); tickPx();
  const retrySettle = await call('GET',{query:{action:'state',wallet:SIGNER},ip:'1.2.3.56'});
  const afterRetrySettle = getMem(`u:${SIGNER}`);
  const externalAfterRetry = {
    stats:{...stats()}, log:getMem('g:log:n'), feed:(getMem('g:feed')||[]).length,
    hist:(getMem(`hist:${SIGNER}`)||[]).length,
    season:zScore('lb:',retrySettle.body.season,SIGNER),
    day:zScore('lbd:',retrySettle.body.day,SIGNER),
  };
  const playerEconomy = q => ({xp:q.xp,hits:q.hits,shots:q.shots,streak:q.streak,
    best:q.best,cr:q.cr,open:q.open.length,closed:q.closed.length});
  ok(JSON.stringify(playerEconomy(afterRetrySettle))===JSON.stringify(playerEconomy(afterFirstSettle)),
    'lost player save is repaired to the same economic result');
  ok(JSON.stringify(externalAfterRetry)===JSON.stringify(externalAfterFirst),
    'settlement retry does not duplicate pots, payout, XP, feed, history or hash-log');
}
ok(!(await call('POST', { body: { action: 'shot', auth: { ...authFor(), sig: 'AAAA' }, target: TARGET5, side: 'YES', stake: 500 } })).body.ok,
   'forged signature rejected');

// Two simultaneous spends from one player used to load the same balance and
// both succeed; the player blob then kept one deduction while global pots kept
// both. One per-wallet update lock must make exactly one request win.
{
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const w = b58encode(publicKey.export({format:'der',type:'spki'}).subarray(12));
  const au = () => { const ts=Date.now(); return {wallet:w,ts,
    sig:crypto.sign(null,Buffer.from(`RATCHET | ${w} | ${ts}`),privateKey).toString('base64')}; };
  setMem(`u:${w}`, {w,xp:0,streak:0,best:0,hits:0,shots:0,cr:1000,granted:true,
    qualified:true,burned:0,day:new Date().toISOString().slice(0,10),open:[],closed:[]});
  const [a,b] = await Promise.all([
    call('POST',{ip:'20.0.0.1',body:{action:'shot',auth:au(),target:TARGET5,side:'YES',stake:1000}}),
    call('POST',{ip:'20.0.0.2',body:{action:'shot',auth:au(),target:TARGET5,side:'NO', stake:1000}}),
  ]);
  // THE INVARIANT is that exactly one spend lands. It used to be asserted via a
  // 409, because the per-wallet lock refused on first contention. It now waits
  // and retries, so the loser re-reads a balance of 0 and is told the truth —
  // "not enough credits" — instead of "retry", which would never have helped.
  // Assert the money, not the mechanism: a 409 here would be a WORSE product
  // and an equally passing test.
  const winners = [a,b].filter(x=>x.body.ok);
  ok(winners.length===1, 'concurrent spends from one wallet admit exactly one');
  const loser = [a,b].find(x=>!x.body.ok);
  ok(loser && typeof loser.body.reason==='string' && !/update in flight/.test(loser.body.reason),
     'and the loser is refused by the BALANCE, not by the lock');
  ok(getMem(`u:${w}`).cr===0 && getMem(`u:${w}`).open.length===1,
     'one stake deducted and one shot stored — no double-spend side effects');
}

// 4 ---- real wallet (auth stub: monkey-patch verify via demo prefix not possible; write record directly)
// Simulate a real wallet's settled hit by direct KV surgery + settle path:
const RW = 'So11111111111111111111111111111111111111112';
setMem(`u:${RW}`, { w: RW, xp: 0, streak: 0, best: 0, hits: 0, shots: 0, bal: 5000, cr: 100, qualified: true,
  day: new Date().toISOString().slice(0, 10),
  open: [{ id: 'x1', kind: 'dir', feed: 'SOL', side: 'YES', entry: 90, exp: Date.now() - 1000, stake: 100, xp: 10, label: 't', src: 'cr' }],
  closed: [] });
seedStubPx(getMem(`u:${RW}`).open[0].exp);
r = await call('GET', { query: { action: 'state', wallet: RW } });
ok(r.body.player.hits === 1, 'real wallet hit settled');
ok(zScore('lb:', r.body.season, RW) === 11 && zScore('lbd:', r.body.day, RW) === 11, 'real settle + skill XP reaches daily and weekly boards');
ok((getMem('g:feed') || []).some(f => f.a.includes('HIT')), 'real hit visible in feed');

// 5 ---- VOID refunds to source and reverses pot/burn
setMem(`u:${RW}`, { ...getMem(`u:${RW}`), open: [{ id: 'x2', kind: 'dir', feed: 'SOL', side: 'YES', entry: 100, exp: Date.now() - 1000, stake: 100, xp: 10, label: 't', src: 'cr' }] });
seedStubPx(getMem(`u:${RW}`).open[0].exp);
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
{
  const potBeforeRetry = stats().potD;
  const pendingBeforeRetry = Number(mem.get(`pend:${RW}`)) || 0;
  setMem('g:day', '2020-01-01'); // simulate a crash after payout but before pointer advance
  await call('GET', { query:{ action:'state' } });
  ok((Number(mem.get(`pend:${RW}`)) || 0) === pendingBeforeRetry,
    'daily rollover retry does not pay the winner twice');
  ok(stats().potD === potBeforeRetry,
    'daily rollover retry does not debit the pot twice');
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
//
// The Warden prices its line off volatility MEASURED from the price log, and
// declines to post one at all when it cannot measure it — so the log has to
// exist before it will speak. That refusal is deliberate (the version that
// always had a number was the version whose number meant nothing), and this
// seeds enough history for it to have something to say.
{
  const { bucketKey: wbk } = require('../lib/pxlog.js');
  const wnow = Date.now(), wby = {};
  let wpx = 100;
  for (let i = 200; i >= 0; i--) {
    const wt = wnow - i * 60_000;
    wpx *= (1 + (i % 2 ? 0.0009 : -0.0008));
    (wby[wbk(wt)] ||= []).push({ t: wt, src: 'pyth-onchain', SOL: wpx, BTC: 60000 * (wpx / 100), ETH: 3000 * (wpx / 100) });
  }
  for (const [k, v] of Object.entries(wby)) setMem(k, v.sort((a, b) => a.t - b.t));
  // Mutate rather than replace: game.js captured this object at load time and
  // holds its own reference, so reassigning the global would not reach it.
  if (globalThis.__ratchet_wcache) { globalThis.__ratchet_wcache.hour = -1; globalThis.__ratchet_wcache.v = null; }
  // Clearing ONE of the caches in front of the Warden is clearing none of them.
  // wardenTick holds its own 30s answer, and the lease throttle holds a
  // "recently attempted" stamp; by the time this section runs, earlier state
  // calls in this file have set both, so the seeded market never reached
  // wardenLine at all and the section failed on a stale empty record rather
  // than on anything it was written to measure.
  if (globalThis.__ratchet_wardentick) { globalThis.__ratchet_wardentick.t = 0; globalThis.__ratchet_wardentick.v = null; }
  if (globalThis.__ratchet_attempts) globalThis.__ratchet_attempts.delete('lease:warden');
}
tickPx();
await call('GET', { query: { action: 'state' } });          // seals this hour's line
const wopen = getMem('g:warden:open');
ok(Array.isArray(wopen) && wopen.length > 0, 'the Warden posts a line once volatility is measurable');
wopen[0].exp = Date.now() - 1000; wopen[0].thresh = 1;   // SOL(100) > 1 => outcome YES
seedStubPx(wopen[0].exp);
if (globalThis.__ratchet_wardentick) globalThis.__ratchet_wardentick.t = 0;
// and the lease throttle in front of it, for the same reason as above
if (globalThis.__ratchet_attempts) globalThis.__ratchet_attempts.delete('lease:warden');
tickPx();
setMem('g:warden:open', wopen);
r = await call('GET', { query: { action: 'state' } });
ok(r.body.wardenRec.n === 1 && typeof r.body.wardenRec.brier === 'number', 'warden call settled into record');
ok((getMem('g:warden:hist') || []).length === 1, 'warden history recorded');

// 9 ---- feed-offline shot refused BEFORE stake is taken
const offlineSaved = PX[FLASH_FEED];
delete PX[FLASH_FEED];
st = stats(); const shotsB4 = st.shots;
r = await call('POST', { body: { action: 'shot', auth: { wallet: 'demo-abc123' }, target: TARGET5, side: 'YES', stake: 100 } });
ok(!r.body.ok && r.status === 409, 'offline feed refused');
ok(stats().shots === shotsB4, 'no stats mutation on refusal');
PX[FLASH_FEED] = offlineSaved;

// 10 ---- rate limiter
let limited = false;
// The POST cap was raised 20 -> 60 per minute (96b643a) but this loop still
// stopped at 30, so the limiter could never trip and the suite went red on a
// green change. Probe safely past the current cap instead of hard-coding it.
for (let i = 0; i < 90; i++) {
  const q = await call('POST', { body: { action: 'shot', auth: { wallet: 'demo-abc123' }, target: TARGET5, side: 'YES', stake: 100 }, ip: '9.9.9.9' });
  if (q.status === 429) { limited = true; break; }
}
ok(limited, 'POST rate limiter trips');

// 11 ---- atomic sig gate (setnx wins once)
const { setnxJSON } = require('../lib/kv.js');
const wins = await Promise.all([setnxJSON('sig:racetest', { a: 1 }), setnxJSON('sig:racetest', { a: 2 })]);
ok(wins.filter(Boolean).length === 1, 'setnx replay gate admits exactly one');

// 11c ---- the Black Box: full-log retention + snapshot + tamper detection
{
  const { verifyChain } = require('../lib/log.js');
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
  mem.set('pend:queue-test', '321'); mem.set('c7:queue-test', '99'); mem.set('cs7:queue-test', '44');
  setMem('chist:queue-test', [{id:'receipt-1',kind:'received',rcx:99}]);
  const snapshot = require('../api/snapshot.js');
  r = await new Promise(resolve => {
    const res = { _s: 200, headers: {}, setHeader(k, v2) { this.headers[k] = v2; },
      status(c) { this._s = c; return this; },
      json(o) { resolve({ status: this._s, body: o }); },
      end(s2) { resolve({ status: this._s, body: JSON.parse(s2) }); } };
    snapshot({ method: 'GET', headers: {}, query: {} }, res);
  });
  ok(r.body.ok && r.body.logComplete && r.body.sha256?.length === 64, 'black box: snapshot exports with hash, log complete');
  ok(Object.keys(r.body.state.players).length >= 2, 'black box: snapshot contains the players');
  ok(r.body.state.pending['queue-test'] === 321 && r.body.state.championPending['queue-test'] === 99
     && r.body.state.championSelfPending['queue-test'] === 44,
    'black box: snapshot includes credit, incoming and self-retained queues');
  ok(r.body.state.championHists['queue-test'][0].id === 'receipt-1',
    'black box: snapshot includes readable podium/reload receipts');
  ok(Object.keys(r.body.state.sortedBoards || {}).some(k => k === 'z:lba:all')
     && (r.body.state.sortedBoards['z:lba:all'] || []).length > 0,
    'black box: snapshot includes atomic all-time XP sorted sets');
  ok('podiumFallback' in r.body.state && Array.isArray(r.body.state.podiumHistory),
    'black box: snapshot includes dynamic podium fallback and signing-grace history');
  ok(verifyChain(r.body.state.log, r.body.state.logHead).ok, 'black box: snapshot log verifies end-to-end');
  mem.delete('pend:queue-test'); mem.delete('c7:queue-test'); mem.delete('cs7:queue-test'); mem.delete('chist:queue-test');
}

// 12 ---- decideBurn: THE CHAMPION'S CUT (pure, real implementation)
{
  const INC = '1nc1nerator11111111111111111111111111111111';
  const mkTx = deltas => {
    const pre = [], post = [];
    for (const [owner, [a, b]] of Object.entries(deltas)) {
      pre.push({ mint: 'M', owner, uiTokenAmount: { amount: String(a), decimals: 0, uiAmount: a } });
      post.push({ mint: 'M', owner, uiTokenAmount: { amount: String(b), decimals: 0, uiAmount: b } });
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
  const selfTx = mkTx({ P: [10000, 1500], B: [0, 1500] });
  selfTx.transaction = { message:{ instructions:[{ parsed:{ type:'transferChecked', info:{
    authority:'P', source:'P-ATA', destination:'P-ATA', mint:'M',
    tokenAmount:{amount:'1500',decimals:0,uiAmount:1500},
  } } }] } };
  d = D(selfTx, { ...base, podium:['P','B'] });
  ok(d.ok && d.amount === 8500 && d.selfRouted === 1500,
    'champ: verified self-route is reported as retained RCX, never extra credits');
  d = D(mkTx({ P: [10000, 0] }), { ...base, podium: [] });
  ok(d.ok && d.amount === 10000, 'champ: empty podium = pure burn, unchanged');
  const unreadable = mkTx({ P: [10000, 0] });
  delete unreadable.meta.preTokenBalances[0].uiTokenAmount.amount;
  d = D(unreadable, base);
  ok(!d.ok && /unreadable token balance/.test(d.reason),
    'burn verifier refuses an unreadable balance instead of treating it as zero');

  // 12a ---- decideBurn: atomic swap-and-burn (walletDelta is 0, parsed from instructions)
  const swapTx = mkTx({ P: [10000, 10000], [INC]: [0, 7000], A: [0, 3000] });
  swapTx.transaction = {
    message: {
      accountKeys: [
        { pubkey: 'P', signer: true, writable: true },
        { pubkey: 'M', signer: false, writable: false },
        { pubkey: INC, signer: false, writable: true },
        { pubkey: 'A', signer: false, writable: true },
      ],
      instructions: [
        { parsed: { type: 'transferChecked', info: { authority: 'P', source: 'P-ATA', destination: 'INC-ATA', mint: 'M', tokenAmount: { amount: '7000', decimals: 0, uiAmount: 7000 } } } },
        { parsed: { type: 'transferChecked', info: { authority: 'P', source: 'P-ATA', destination: 'A-ATA', mint: 'M', tokenAmount: { amount: '3000', decimals: 0, uiAmount: 3000 } } } },
      ]
    }
  };
  d = D(swapTx, { ...base, wallet: 'P', podium: ['A'] });
  ok(d.ok && d.amount === 10000 && d.burned === 7000 && d.champPaid === 3000,
    'champ: atomic swap-and-burn parses transfers successfully when net delta is 0');

  const now = Date.now();
  const liveSet = { v:'live-1', t:now-1000, list:[
    {w:'A',pct:0.5},{w:'B',pct:0.3},{w:'C',pct:0.2},
  ]};
  d = D(mkTx({ P:[10000,0], A:[0,1500], B:[0,900], C:[0,600] }),
    { wallet:'P', mint:'M', podiumSets:[liveSet], podiumPct:0.30, nowMs:now });
  ok(d.ok && d.podiumVersion === 'live-1',
    'dynamic podium: one exact published snapshot is accepted');
  d = D(mkTx({ P:[10000,0], A:[0,3000] }),
    { wallet:'P', mint:'M', podiumSets:[liveSet], podiumPct:0.30, nowMs:now });
  ok(!d.ok && /does not match a podium snapshot/.test(d.reason),
    'dynamic podium: paying an allowed wallet the wrong seat share is refused');
  d = D(mkTx({ P:[10000,0], A:[0,1500], B:[0,900], C:[0,600] }),
    { wallet:'P', mint:'M', podiumSets:[{...liveSet,until:now-2000}], podiumPct:0.30, nowMs:now });
  ok(!d.ok, 'dynamic podium: an expired signing-grace snapshot is refused');

  const exactSelf = mkTx({ P:[10000,1500], B:[0,900], C:[0,600] });
  exactSelf.transaction = { message:{ instructions:[{ parsed:{ type:'transferChecked', info:{
    authority:'P', source:'P-ATA', destination:'P-ATA', mint:'M',
    tokenAmount:{amount:'1500',decimals:0,uiAmount:1500},
  } } }] } };
  d = D(exactSelf, { wallet:'P', mint:'M', podiumSets:[{v:'self-1',t:now-1000,list:[
    {w:'P',pct:0.5},{w:'B',pct:0.3},{w:'C',pct:0.2},
  ]}], podiumPct:0.30, nowMs:now });
  ok(d.ok && d.amount===8500 && d.selfRouted===1500 && d.podiumVersion==='self-1',
    'dynamic podium: exact self-retained seat is valid and never earns duplicate credits');
}

// 11a ---- THE BOARD: deterministic hourly mix, new kinds, grace window
{
  const r1 = await call('GET', { query: { action: 'state' }, ip: '3.3.3.3' });
  const r2 = await call('GET', { query: { action: 'state' }, ip: '3.3.3.3' });
  ok(JSON.stringify(Object.keys(r1.body.targets)) === JSON.stringify(Object.keys(r2.body.targets)), 'board: deterministic within the hour');
  const kinds = Object.values(r1.body.targets).map(t2 => t2.kind);
  ok(kinds.includes('race') && kinds.includes('thrDown') && kinds.includes('range'), 'board: RACE + DUMP + BOX present');
  const dirs = Object.values(r1.body.targets).filter(t2 => t2.kind === 'dir');
  ok(dirs.length === 7 && new Set(dirs.map(t2 => t2.feed)).size === 7,
    'board: all seven feeds appear once across directional windows');
  ok(r1.body.targets[TARGET5] && r1.body.targets[TARGET60] && r1.body.targets[TARGET1440],
    'board: 5-minute, 1-hour and 24-hour anchors present');
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
  const q = await call('POST', { body: { action: 'shot', auth: { wallet: 'demo-sealed' }, target: TARGET5, side: 'YES', stake: 100 }, ip: '4.4.4.1' });
  ok(q.body.ok && q.body.shot.side === 'YES' && q.body.shot.commit && q.body.shot.salt, 'seal: owner response carries side + commit + salt');
  const chunk = getMem('g:log:c:0') || [];
  const sealEv = [...chunk].reverse().find(e => e.ev.k === 'seal' && e.ev.id === q.body.shot.id);
  ok(sealEv && !('side' in sealEv.ev) && sealEv.ev.commit === q.body.shot.commit
  && sealEv.ev.outcomeRule === 'strict-compare-v2',
  'seal: log entry has commit + outcome rule, NO side');
  ok(sha(`RATCHET|v2|demo-sealed|${q.body.shot.id}|YES|${q.body.shot.salt}`) === q.body.shot.commit,
    'seal: v2 commit binds wallet + shot id + side + salt');
  // spectator view must not see the side
  let rv = await call('GET', { query: { action: 'state', wallet: 'demo-sealed' }, ip: '4.4.4.2' });
  const openShot = rv.body.player.open.find(o => o.id === q.body.shot.id);
  ok(openShot && !('side' in openShot) && !('salt' in openShot) && openShot.commit, 'seal: spectator state strips side + salt, keeps commit');
  // force-settle: reveal lands in the log and verifies against the commit
  const pd = getMem('u:demo-sealed');
  pd.open[0].exp = Date.now() - 1000; pd.open[0].entry = 90; setMem('u:demo-sealed', pd);
  // Earlier tests intentionally seeded rows from another oracle lane. Add an
  // explicit matching-source row; source pinning must not depend on sampler
  // timing or the per-instance 45-second dedupe gate.
  const sealBucket = require('../lib/pxlog.js').bucketKey(pd.open[0].exp);
  const sealRows = getMem(sealBucket) || [];
  const pub = Math.ceil(Date.now()/1000);
  sealRows.push({ t:pub*1000, src:'pyth-onchain', SOL:PX.SOL, BTC:PX.BTC, ETH:PX.ETH,
    BONK:PX.BONK, WIF:PX.WIF, JUP:PX.JUP, PUMP:PX.PUMP,
    pt:Object.fromEntries(TEST_FEEDS.map(f=>[f,pub])), pp:Object.fromEntries(TEST_FEEDS.map(f=>[f,pub-60])),
    cf:Object.fromEntries(TEST_FEEDS.map(f=>[f,10])) });
  sealRows.sort((a,b)=>a.t-b.t); setMem(sealBucket, sealRows); tickPx();
  await call('GET', { query: { action: 'state', wallet: 'demo-sealed' }, ip: '4.4.4.3' });
  const chunk2 = getMem('g:log:c:0') || [];
  const settleEv = [...chunk2].reverse().find(e => e.ev.k === 'settle' && e.ev.id === q.body.shot.id);
  ok(settleEv && settleEv.ev.side === 'YES'
    && sha(`RATCHET|v2|demo-sealed|${settleEv.ev.id}|${settleEv.ev.side}|${settleEv.ev.salt}`) === settleEv.ev.commit,
    'reveal: bound settle entry verifies against the seal commit');
}

// 11a4 ---- snapshot strips sealed sides
{
  const q = await call('POST', { body: { action: 'shot', auth: { wallet: 'demo-snapseal' }, target: TARGET5, side: 'NO', stake: 100 }, ip: '4.4.4.4' });
  const snapshot = require('../api/snapshot.js');
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
resetRL();
r = await call('POST', { body: { action: 'stake', auth: { wallet: 'demo-abc123' }, on: true } });
ok(!r.body.ok && r.status === 400, 'stake: demo wallet refused (mint unset in test env also refuses)');

// 12a ---- rolling receipt-window math (pure; never an eligibility rule)
{
  const cw = game.champWindowSum;
  const today0 = new Date().toISOString().slice(0, 10);
  ok(cw({ [today0]: 300 }, Date.now(), 7) === 300, 'holder window counts today');
  ok(cw({ '2000-01-01': 999, [today0]: 1 }, Date.now(), 7) === 1, 'holder window drops ancient days');
  ok(cw(null, Date.now(), 7) === 0, 'holder window null-safe');
}

// 12b ---- state exposes the champion cut
r = await call('GET', { query: { action: 'state' } });
ok(r.body.champ && r.body.champ.pct === 0.30 && r.body.champ.seatRule === 'live-daily-xp' && Array.isArray(r.body.champ.podium), 'state exposes the live daily champ cut + payout snapshot');
ok(Array.isArray(r.body.ladderAll), 'state exposes a public all-time XP list with no payout claim');
ok(r.body.truthPlane && r.body.truthPlane.canonicalSettlement === 'ratchet-server'
   && /pyth-price-update-v2/.test(r.body.truthPlane.oracleInput),
   'state names the canonical server settlement plane and its on-chain Pyth input');

// 13 ---- proof endpoint runs (no mint armed in test env)
const proof = require('../api/proof.js');
r = await new Promise(resolve => {
  proof({ method: 'GET', headers: {}, query: {} },
    { _status: 200, status(c) { this._status = c; return this; }, json(o) { resolve({ status: this._status, body: o }); } });
});
ok(r.body.ok && r.body.checks.some(c => c.id === 'pots'), 'proof answers with pots line');
ok(r.body.checks.some(c => c.id === 'champs' && /peer-to-peer/.test(c.label)), 'proof carries the champions line');
ok(r.body.checks.some(c => c.id === 'credits' && /play-credits also enter/.test(c.detail)),
   'credits line discloses every faucet instead of claiming none exist');
ok(r.body.truthPlane && r.body.truthPlane.canonicalSettlement === 'ratchet-server',
   'proof names the canonical settlement authority');
ok(r.body.anchorFreshness && Object.hasOwn(r.body.anchorFreshness, 'headDistance')
   && Object.hasOwn(r.body.anchorFreshness, 'ageSec'),
   'proof exposes anchor age and distance from the current log head');


// 2c ---- CUSTOM STAKES: any whole amount in range, scored on the same sqrt curve
resetRL();
r = await call('POST', { body: { action: 'shot', auth: { wallet: 'demo-stk1' }, target: TARGET5, side: 'YES', stake: 1000 } });
const xp1000 = r.body.ok && r.body.shot.xp;
r = await call('POST', { body: { action: 'shot', auth: { wallet: 'demo-stk2' }, target: TARGET5, side: 'YES', stake: 100 } });
const xp100 = r.body.ok && r.body.shot.xp;
ok(!!xp1000 && !!xp100 && Math.abs(xp1000 / xp100 - Math.sqrt(10)) < 0.12, 'custom stake XP follows sqrt(stake/100)');
resetRL();
r = await call('POST', { body: { action: 'shot', auth: { wallet: 'demo-stk3' }, target: TARGET5, side: 'YES', stake: 1000000001 } });
ok(!r.body.ok && /between/.test(r.body.reason || ''), 'an absurd stake is still refused');
// You may risk as much of your own balance as you like. What stops rank being
// bought is the XP ceiling, not a limit on your stake.
resetRL();
setMem('u:demo-mill', { w:'demo-mill', xp:0, streak:0, best:0, hits:0, shots:0, cr:2000000,
  granted:true, burned:0, day:new Date().toISOString().slice(0,10), open:[], closed:[] });
r = await call('POST', { body: { action: 'shot', auth: { wallet: 'demo-mill' }, target: TARGET5, side: 'YES', stake: 1000000 } });
ok(r.body.ok, 'a one-million credit stake is accepted');
ok(getMem('u:demo-mill').cr === 1000000, 'and it is actually deducted');
resetRL();
r = await call('POST', { body: { action: 'shot', auth: { wallet: 'demo-mill' }, target: TARGET5, side: 'YES', stake: 1500000 } });
ok(!r.body.ok && /not enough credits/.test(r.body.reason||''),
   'your balance is the real limit, and the server enforces it');
// The cap moved to 100,000 so a big reload can actually be spent. The XP
// curve must NOT move with it, or the podium — which pays real RCX — becomes
// purchasable by the richest wallet rather than the most accurate one.
const fund = w => setMem(`u:${w}`, { w, xp:0, streak:0, best:0, hits:0, shots:0, cr:200000, granted:true,
  burned:0, day:new Date().toISOString().slice(0,10), open:[], closed:[] });
['demo-big1','demo-big2','demo-big3'].forEach(fund);
resetRL();
r = await call('POST', { body: { action: 'shot', auth: { wallet: 'demo-big1' }, target: TARGET5, side: 'YES', stake: 40000 } });
const xpAtCap = r.body.ok && r.body.shot.xp;
resetRL();
r = await call('POST', { body: { action: 'shot', auth: { wallet: 'demo-big2' }, target: TARGET5, side: 'YES', stake: 100000 } });
const xpAbove = r.body.ok && r.body.shot.xp;
ok(!!xpAtCap && !!xpAbove, 'stakes far above the old 2,500 ceiling are accepted');
ok(xpAtCap === xpAbove, `XP stops climbing past the cap (${xpAtCap} vs ${xpAbove}) — rank cannot be bought`);
resetRL();
r = await call('POST', { body: { action: 'shot', auth: { wallet: 'demo-big3' }, target: TARGET5, side: 'YES', stake: 10000 } });
ok(r.body.ok && r.body.shot.xp < xpAtCap, 'below the cap, XP still rises with the stake');
r = await call('POST', { body: { action: 'shot', auth: { wallet: 'demo-stk4' }, target: TARGET5, side: 'YES', stake: 250.5 } });
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
const { bucketKey: bk, SETTLE_GRACE_MS: GRACE } = require('../lib/pxlog.js');
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
  ok(st1.xp === 1 && st1.closed[0].xp === 1,
     'a valid MISS earns exactly the fixed 1 settlement XP');
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
  r = await call('POST', { body: { action: 'shot', auth: { wallet: 'demo-leak1' }, target: TARGET5, side: 'NO', stake: 500 } });
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


// A real move smaller than the retired 4bp dead zone must now settle.
{
  const now = Date.now(), exp = now - 60e3;
  pxGate.t = now;
  setMem(bk(exp), [{ t: exp + 500, SOL: 100.03, BTC:60000, ETH:2000, src:'pyth-onchain' }]);
  const w = 'demo-nomargin';
  setMem(`u:${w}`, { w, xp:0, streak:0, best:0, hits:0, shots:0, cr:4500, granted:true,
    burned:0, day:new Date().toISOString().slice(0,10), closed:[],
    open:[{ id:'threebp', kind:'dir', feed:'SOL', side:'YES', entry:100, exp,
      outcomeRule:'strict-compare-v2',
      stake:500, xp:10, label:'SOL higher', src:'cr' }] });
  await call('GET', { query: { action:'state', wallet:w } });
  const closed = getMem(`u:${w}`).closed[0];
  ok(closed.res === 'hit', '3bp directional move settles — no economic tie margin remains');
}

// The h61 rule cannot rewrite a shot that was sealed under the old promise.
{
  const now = Date.now(), exp = now - 60e3;
  pxGate.t = now;
  setMem(bk(exp), [{ t: exp + 500, SOL: 100.03, BTC:60000, ETH:2000, src:'pyth-onchain' }]);
  const w = 'demo-legacymargin';
  setMem(`u:${w}`, { w, xp:0, streak:0, best:0, hits:0, shots:0, cr:4500, granted:true,
    burned:0, day:new Date().toISOString().slice(0,10), closed:[],
    open:[{ id:'legacythreebp', kind:'dir', feed:'SOL', side:'YES', entry:100, exp,
      stake:500, xp:10, label:'legacy SOL higher', src:'cr' }] });
  await call('GET', { query: { action:'state', wallet:w } });
  const closed = getMem(`u:${w}`).closed[0];
  ok(closed.res === 'void', 'a pre-h61 shot keeps its sealed 4bp tie rule');
}

// ============================================================
//  REGRESSION: ladders are atomic, credits survive a lost race.
// ============================================================
const kvmod = require('../lib/kv.js');

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
  await kvmod.incrFloat(`cs7:${C}`, 333);
  resetRL();
  await call('GET', { query: { action:'state', wallet:C } });
  const cp = getMem(`u:${C}`);
  const received = Object.values(cp.champ7 || {}).reduce((a,b)=>a+b,0);
  const retained = Object.values(cp.champSelf7 || {}).reduce((a,b)=>a+b,0);
  ok(received === 777 && retained === 333,
    `incoming (${received}) and self-retained (${retained}) podium value stay distinct`);
}


// ============================================================
//  REGRESSION: global totals are atomic, and the floor is monotone for real.
// ============================================================
{
  const kv2 = require('../lib/kv.js');
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

// The simulated floor is derived only from VERIFIED ON-CHAIN RCX burns. Paper
// stake accounting must not move a headline that claims to represent supply.
{
  resetRL();
  const before = stats();
  const f1 = (await call('GET', { query: { action: 'state' } })).body.stats.floor;
  setStat('realBurned', (before.realBurned || 0) + 5_000_000);
  const f2 = (await call('GET', { query: { action: 'state' } })).body.stats.floor;
  ok(f2 > f1, 'floor rises with verified on-chain burns');
  setStat('realBurned', 0);                   // a stale writer tries to undo it
  const f3 = (await call('GET', { query: { action: 'state' } })).body.stats.floor;
  ok(f3 >= FLOOR_MIN_OK, 'floor never reads below its base');
  setStat('realBurned', before.realBurned || 0);
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
  r = await call('POST', { body: { action: 'shot', auth: { wallet: 'demo-fresh1' }, target: TARGET5, side: 'YES', stake: 500 } });
  ok(!r.body.ok && /print is 55s old/.test(r.body.reason || ''), 'stale print refused on a 5-minute window');
  ok(!getMem('u:demo-fresh1') || getMem('u:demo-fresh1').cr === 5000, 'refusal costs the player nothing');

  for (const [caseIndex, missingAge] of [null, ''].entries()) {
    PX.ages = Object.fromEntries(TEST_FEEDS.map(f => [f, 3]));
    PX.ages[FLASH_FEED] = missingAge;
    r = await call('POST', { body: { action:'shot',
      auth:{wallet:'demo-a90'+caseIndex},
      target:TARGET5, side:'YES', stake:500 } });
    ok(!r.body.ok && r.body.code === 'ORACLE_STALE',
      'null/empty publish age is refused instead of coercing to zero: '+JSON.stringify(r.body));
  }

  // The same staleness is meaningless over an hour, so it must still seal.
  PX.ages = { SOL: 55, BTC: 55, ETH: 55, BONK: 55, WIF: 55, JUP: 55, PUMP: 55 };
  r = await call('POST', { body: { action: 'shot', auth: { wallet: 'demo-fresh2' }, target: TARGET60, side: 'YES', stake: 500 } });
  ok(r.body.ok, 'the same age still seals on a 1-hour window — the bound is proportionate');
  ok(r.body.shot.entryAge === 55, 'the entry price age is recorded on the shot');

  PX.ages = { SOL: 3, BTC: 3, ETH: 3, BONK: 3, WIF: 3, JUP: 3, PUMP: 3 };
  r = await call('POST', { body: { action: 'shot', auth: { wallet: 'demo-fresh3' }, target: TARGET5, side: 'YES', stake: 500 } });
  ok(r.body.ok, 'a fresh print seals normally');
  ok(r.body.shot.economyRule === 'credits-at-valid-oracle-seal-v1'
     && r.body.shot.economyMode === 'demo'
     && /^[0-9a-f]{64}$/.test(r.body.shot.oracleSeal?.snapshotHash || ''),
     'an accepted stake records its economy rule and exact Pyth snapshot fingerprint');
  ok(r.body.shot.oracleSeal?.provider === 'Pyth Network'
     && Number.isFinite(r.body.shot.oracleSeal?.feeds?.[r.body.shot.feed]?.postedSlot),
     'the seal retains Pyth attribution, publish evidence and slots');

  PX.confs = Object.fromEntries(TEST_FEEDS.map(f => [f, f === FLASH_FEED ? 201 : 10]));
  r = await call('POST', { body: { action:'shot', auth:{wallet:'demo-confwide1'},
    target:TARGET5, side:'YES', stake:500 } });
  ok(!r.body.ok && /confidence interval/.test(r.body.reason || ''),
    'a confidence explosion is refused at the final economic boundary');
  ok(!getMem('u:demo-confwide1') || getMem('u:demo-confwide1').cr === 5000,
    'wide-confidence refusal debits no credits');
  for (const [caseIndex, missingConf] of [null, ''].entries()) {
    PX.confs = Object.fromEntries(TEST_FEEDS.map(f => [f, 10]));
    PX.confs[FLASH_FEED] = missingConf;
    r = await call('POST', { body: { action:'shot',
      auth:{wallet:'demo-c90'+caseIndex},
      target:TARGET5, side:'YES', stake:500 } });
    ok(!r.body.ok && r.body.code === 'FEED_UNAVAILABLE',
      'null/empty confidence is refused instead of coercing to zero: '+JSON.stringify(r.body));
  }
  delete PX.confs;
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
  ok(up.hits === 1 && up.xp === 41, 'an unverified wallet gets settle XP plus skill XP');
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
  ok(zScore('lbd:', r.body.day, OLD) === 16, 'and ranks with settle XP plus skill XP');
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
  const run = async (streak) => { seed(streak); seedStubPx(Date.now()); tickPx();
    await call('GET', { query:{ action:'state', wallet:W } });
    return getMem(`u:${W}`).closed[0]; };

  const cold = await run(0), warm = await run(3), hot = await run(20);
  ok(cold.xp === 101 && cold.skillXp === 100 && cold.settleXp === 1, `no streak: 100 skill + 1 settle XP (${cold.xp})`);
  ok(warm.xp === 146 && warm.streakMult === 1.45, `a 3-run: 145 skill + 1 settle XP (${warm.xp})`);
  ok(hot.xp === 201 && hot.streakMult === 2, `the skill bonus caps at x2, then adds 1 (${hot.xp})`);
  ok(cold.xpBase === 100 && warm.xpBase === 100, 'the base XP is recorded, so the bonus is auditable');
  // a miss must cost the run — that is the whole mechanic
  setMem(`u:${W}`, { ...getMem(`u:${W}`), streak: 5, closed: [],
    open:[{ id:'sm', kind:'dir', feed:'SOL', side:'NO', entry:90, exp:Date.now()-1000,
            stake:500, xp:100, label:'t', src:'cr' }] });
  seedStubPx(Date.now()); tickPx(); await call('GET', { query:{ action:'state', wallet:W } });
  ok(getMem(`u:${W}`).streak === 0, 'one miss resets the run — which is what makes it worth protecting');
  ok(getMem(`u:${W}`).closed[0].xp === 1, 'the same miss still earns fixed settlement XP');
}

// ============================================================
//  THE PRICE PATH is servable, bounded, and refuses nonsense.
// ============================================================
{
  resetRL();
  const now = Date.now(), from = now - 10*60e3;
  const { bucketKey: bk2 } = require('../lib/pxlog.js');
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


// ============================================================
//  LIVE DAILY PODIUM — yesterday fills only today's empty seats.
// ============================================================
{
  const P1='PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP1';
  const P2='QQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQ2';
  const P3='RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR3';
  const A ='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1';
  const B ='BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB2';
  const C ='CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC3';
  const day=new Date().toISOString().slice(0,10);
  setMem('g:podium',{v:2,id:'yesterday',period:'1999-01-01',t:Date.now()-86400e3,list:[
    {w:P1,pct:.5,ata:null},{w:P2,pct:.3,ata:null},{w:P3,pct:.2,ata:null},
  ]});
  mem.delete('g:podium:fallback'); mem.delete('g:podium:history');
  const zk='Z'+`z:lbd:${day}`;mem.set(zk,new Map());
  setMem('mig:'+`z:lbd:${day}`,{t:Date.now()});

  await game.refreshLivePodium(true);
  let seated=(getMem('g:podium').list||[]).map(x=>x.w);
  ok(JSON.stringify(seated)===JSON.stringify([P1,P2,P3]),
    'new day starts on yesterday podium instead of sending the cut nowhere');

  mem.get(zk).set(A,100); await game.refreshLivePodium(true);
  seated=getMem('g:podium').list.map(x=>x.w);
  ok(JSON.stringify(seated)===JSON.stringify([A,P1,P2]),
    'today #1 takes seat 1 and replaces yesterday #3 first');

  mem.get(zk).set(B,80); await game.refreshLivePodium(true);
  seated=getMem('g:podium').list.map(x=>x.w);
  ok(JSON.stringify(seated)===JSON.stringify([A,B,P1]),
    'today #2 takes seat 2 and replaces yesterday #2');

  mem.get(zk).set(C,60); await game.refreshLivePodium(true);
  seated=getMem('g:podium').list.map(x=>x.w);
  ok(JSON.stringify(seated)===JSON.stringify([A,B,C]),
    'three ranked wallets today fully own the live podium');

  mem.get(zk).set(B,120); await game.refreshLivePodium(true);
  seated=getMem('g:podium').list.map(x=>x.w);
  ok(JSON.stringify(seated)===JSON.stringify([B,A,C]),
    'a settled XP lead change immediately reorders live payout shares');

  const history=getMem('g:podium:history')||[];
  ok(history.length>0 && history.every(x=>Number(x.until)>Date.now()),
    'replaced payout snapshots retain only bounded signing grace');
}


// ============================================================
//  CHALLENGES — a player's own question, which only counts if
//  somebody takes the other side.
// ============================================================
{
  resetRL();
  const { publicKey: pkA, privateKey: skA } = crypto.generateKeyPairSync('ed25519');
  const { publicKey: pkB, privateKey: skB } = crypto.generateKeyPairSync('ed25519');
  const WA = b58encode(pkA.export({format:'der',type:'spki'}).subarray(12));
  const WB = b58encode(pkB.export({format:'der',type:'spki'}).subarray(12));
  const au = (w,k)=>{ const ts=Date.now();
    return { wallet:w, ts, sig: crypto.sign(null, Buffer.from(`RATCHET | ${w} | ${ts}`,'utf8'), k).toString('base64') }; };
  const fundW = w => setMem(`u:${w}`, { w, xp:0, streak:0, best:0, hits:0, shots:0, cr:20000,
    granted:true, qualified:true, burned:0, day:new Date().toISOString().slice(0,10), open:[], closed:[] });
  fundW(WA); fundW(WB);

  // guests are kept out — free credits against earned ones is not a market
  r = await call('POST', { body:{ action:'challenge', auth:{wallet:'demo-zz1'}, kind:'dir', feed:'SOL', mins:30, side:'YES', stake:500 } });
  ok(!r.body.ok && /real wallet/.test(r.body.reason||''), 'a guest cannot write a challenge');

  resetRL();
  const crA0 = getMem(`u:${WA}`).cr;
  const shotsBeforeOffer = Number(stats().shots) || 0;
  r = await call('POST', { body:{ action:'challenge', auth:au(WA,skA), kind:'thr', feed:'SOL', pct:0.01, mins:30, side:'YES', stake:500 } });
  ok(r.body.ok && r.body.challenge.id && r.body.challenge.outcomeRule === 'strict-compare-v2',
    'a real wallet writes one with the strict comparison rule');
  const cid = r.body.ok && r.body.challenge.id;
  ok(getMem(`u:${WA}`).cr === crA0 - 500, 'the author pays on writing — otherwise it is not an offer');
  ok((Number(stats().shots)||0) === shotsBeforeOffer, 'an untaken offer is not counted as a shot');
  ok(!r.body.challenge.thresh, 'and no level is struck yet');

  r = await call('GET', { query:{ action:'challenges' } });
  ok(r.body.ok && r.body.open.some(c=>c.id===cid && c.outcomeRule==='strict-compare-v2'),
    'it appears on the public board with its outcome rule');
  ok(/struck when someone accepts/.test(r.body.rule||''), 'the board states when the level is struck');

  // you cannot take your own
  resetRL();
  r = await call('POST', { body:{ action:'accept', auth:au(WA,skA), id:cid } });
  ok(!r.body.ok && /your own/.test(r.body.reason||''), 'the author cannot take their own side');

  // one challenge at a time
  resetRL();
  r = await call('POST', { body:{ action:'challenge', auth:au(WA,skA), kind:'dir', feed:'BTC', mins:10, side:'NO', stake:500 } });
  ok(!r.body.ok && /one at a time/.test(r.body.reason||''), 'one open challenge per wallet');

  // An underfunded taker used to win the atomic acceptance key before the
  // balance check and permanently brick somebody else's offer.
  const { publicKey:pkC, privateKey:skC } = crypto.generateKeyPairSync('ed25519');
  const WC = b58encode(pkC.export({format:'der',type:'spki'}).subarray(12));
  setMem(`u:${WC}`, {w:WC,xp:0,streak:0,best:0,hits:0,shots:0,cr:0,granted:true,
    qualified:true,burned:0,day:new Date().toISOString().slice(0,10),open:[],closed:[]});
  resetRL();
  r = await call('POST', { body:{ action:'accept', auth:au(WC,skC), id:cid } });
  ok(!r.body.ok && !getMem(`chaltaken:${cid}`),
     'an underfunded taker releases the acceptance gate');
  ok((Number(stats().shots)||0) === shotsBeforeOffer, 'a failed acceptance creates no shot accounting');

  // the taker gets the opposite side, struck now
  resetRL();
  const crB0 = getMem(`u:${WB}`).cr;
  r = await call('POST', { body:{ action:'accept', auth:au(WB,skB), id:cid } });
  ok(r.body.ok, 'another wallet takes it');
  ok(r.body.shot && r.body.shot.side === 'NO', 'and gets the opposite side');
  ok(Math.abs(r.body.struckAt - 100) < 1e-9, 'struck on the price at acceptance, not at authoring');
  ok(Math.abs(r.body.shot.thresh - 101) < 1e-9, 'the threshold comes off that same price');
  ok(getMem(`u:${WB}`).cr === crB0 - 500, 'the taker pays the same stake');
  const opA = getMem(`u:${WA}`).open, opB = getMem(`u:${WB}`).open;
  ok(opA.length===1 && opB.length===1, 'both wallets now hold a shot');
  ok(opA[0].side !== opB[0].side, 'on opposite sides');
  ok(opA[0].entry === opB[0].entry && opA[0].exp === opB[0].exp, 'identical terms — exactly one can win');
  ok(opA[0].chal === cid && opB[0].chal === cid, 'both reference the challenge');
  ok(opA[0].outcomeRule === 'strict-compare-v2' && opB[0].outcomeRule === 'strict-compare-v2',
    'both accepted sides preserve the same strict outcome rule');
  ok(!!opA[0].commit && !!opB[0].commit, 'and both are recorded with a commitment like any shot');
  ok((Number(stats().shots)||0) === shotsBeforeOffer + 2, 'one accepted challenge counts exactly two durable shots');
  resetRL();
  await call('GET', { query:{ action:'state', wallet:WA }, ip:'30.0.0.1' });
  await call('GET', { query:{ action:'state', wallet:WB }, ip:'30.0.0.2' });
  ok((Number(stats().shots)||0) === shotsBeforeOffer + 2, 'state repair cannot recount accepted challenge shots');

  resetRL();
  r = await call('GET', { query:{ action:'challenges' } });
  ok(!r.body.open.some(c=>c.id===cid), 'a taken challenge leaves the board');
  resetRL();
  r = await call('POST', { body:{ action:'accept', auth:au(WB,skB), id:cid } });
  ok(!r.body.ok, 'and cannot be taken twice');

  // nobody takes it -> the stake comes back
  resetRL();
  fundW(WA);
  const crA1 = getMem(`u:${WA}`).cr;
  r = await call('POST', { body:{ action:'challenge', auth:au(WA,skA), kind:'dir', feed:'ETH', mins:15, side:'YES', stake:1000 } });
  const gone = r.body.challenge.id;
  const cl = getMem('g:chal'); cl.find(c=>c.id===gone).expiresAt = Date.now()-1000; setMem('g:chal', cl);
  await new Promise(resolve => setTimeout(resolve, 5)); // let the prior response's finally release its player lease
  await call('GET', { query:{ action:'state', wallet:WA } }); // sweep then wallet drains its atomic refund
  ok(getMem(`u:${WA}`).cr === crA1, 'an offer nobody took refunds the author in full');
  ok(!(getMem('g:chal')||[]).some(c=>c.id===gone), 'and leaves the board');

  // bounds
  resetRL();
  r = await call('POST', { body:{ action:'challenge', auth:au(WB,skB), kind:'thr', feed:'SOL', pct:0.9, mins:30, side:'YES', stake:500 } });
  ok(!r.body.ok && /move must be/.test(r.body.reason||''), 'a 90% move is refused');
  resetRL();
  r = await call('POST', { body:{ action:'challenge', auth:au(WB,skB), kind:'dir', feed:'DOGE', mins:30, side:'YES', stake:500 } });
  ok(!r.body.ok && /unknown feed/.test(r.body.reason||''), 'an unknown feed is refused');
  resetRL();
  r = await call('POST', { body:{ action:'challenge', auth:au(WB,skB), kind:'dir', feed:'SOL', mins:1, side:'YES', stake:500 } });
  ok(!r.body.ok && /window must be/.test(r.body.reason||''), 'a one-minute window is refused — below the oracle heartbeat');
}

console.log(fails ? `\n${fails} FAILURES` : '\nALL PASS');
process.exit(fails ? 1 : 0);
