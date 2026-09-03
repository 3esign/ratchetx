// THE FREEZE HAS TO BE EXERCISED, NOT DESCRIBED.
//
// RX_MIGRATION_FREEZE=1 stops the machine selling so the legacy root can be
// built against a store where every credit is in somebody's `cr`. It is the
// switch the whole cutover rests on, and it will be thrown exactly once, on
// the day mistakes are least affordable. test_legacy_root.mjs checks that the
// source SAYS the right thing; that is not the same as the machine DOING it,
// and a switch nobody has ever flipped is one you learn about at cutover.
//
// So this loads api/game.js twice against one shared store -- once selling,
// once frozen, like a deploy in the middle of a live game -- and asserts the
// two halves of the promise separately:
//
//   it stops SELLING          no shot, no challenge, no take
//   it never stops SETTLING   open shots pay out, state still reads
//
// The second half is the one worth having. A freeze that also stopped
// settlement would strand every open stake at the cutover instant, which is
// precisely the harm the freeze exists to avoid.
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

process.env.RATCHET_MINT = process.env.RATCHET_MINT || 'FQb2EyaLZ9TWBemYmQ9zWtXcEwLiSXtz7j619ThQpump';
delete process.env.RX_MIGRATION_FREEZE;

// ---- stub the oracle and the chain BEFORE game.js loads them, exactly as
// test_harness.mjs does. Two copies of a stub that disagree would be two
// different games.
const pricesPath = require.resolve('../lib/prices.js');
const burnPath = require.resolve('../lib/burn.js');
const gamePath = require.resolve('../api/game.js');
const TEST_FEEDS = ['SOL','BTC','ETH','BONK','WIF','JUP','PUMP'];
const PX = { src:'pyth-onchain', SOL:100, BTC:60000, ETH:2000, BONK:0.000002, WIF:0.1, JUP:0.2, PUMP:0.005 };
require.cache[pricesPath] = { id: pricesPath, filename: pricesPath, loaded: true,
  exports: { getPrices: async () => { const t = Math.floor(Date.now()/1000); return { ...PX,
    ages: Object.fromEntries(TEST_FEEDS.map(f=>[f,1])),
    confs: Object.fromEntries(TEST_FEEDS.map(f=>[f,10])),
    pubs: Object.fromEntries(TEST_FEEDS.map(f=>[f,t])),
    prevPubs: Object.fromEntries(TEST_FEEDS.map(f=>[f,t-60])),
    slots: Object.fromEntries(TEST_FEEDS.map((f,i)=>[f,300000+i])),
    postedSlots: Object.fromEntries(TEST_FEEDS.map((f,i)=>[f,299900+i])),
    emaPrices: Object.fromEntries(TEST_FEEDS.map(f=>[f,PX[f]])),
    emaConfs: Object.fromEntries(TEST_FEEDS.map(f=>[f,8])) }; } } };
require.cache[burnPath] = { id: burnPath, filename: burnPath, loaded: true,
  exports: { INCINERATOR: '1nc1nerator11111111111111111111111111111111',
    rpcCall: async (m) => (m === 'getTokenAccountsByOwner' ? { value: [] } : null),
    getTx: async () => null, decideBurn: () => ({ ok:false, reason:'stub' }) } };

let game = require('../api/game.js');
const mem = globalThis.__ratchet_mem;

/** Reload api/game.js with a different environment, against the SAME store.
 *  MIGRATION_FREEZE is a module-level const read once at load, which is the
 *  point -- it ships in the release rather than flipping under a running
 *  process -- so the only honest way to test the other state is to reload. The
 *  store lives on globalThis, so it survives, and the reload is exactly what a
 *  redeploy does to a game with shots already open. */
const reload = frozen => {
  if (frozen) process.env.RX_MIGRATION_FREEZE = '1';
  else delete process.env.RX_MIGRATION_FREEZE;
  delete require.cache[gamePath];
  game = require('../api/game.js');
};

const call = (method, { query = {}, body = null, ip = '9.9.9.9' } = {}) =>
  new Promise(resolve => {
    const req = { method, query, body, headers: { 'x-forwarded-for': ip }, socket: {} };
    const res = { _status: 200, _headers: {},
      setHeader(n,v){ this._headers[String(n).toLowerCase()] = String(v); },
      status(c){ this._status = c; return this; },
      json(o){ resolve({ status:this._status, body:o, headers:this._headers }); } };
    game(req, res).catch(e => resolve({ status:599, body:{ ok:false, reason:String(e) } }));
  });

let fails = 0, checks = 0;
const ok = (cond, name) => { checks++; console.log((cond?'PASS':'FAIL')+'  '+name); if (!cond) fails++; };
const getMem = k => (mem.has(k) ? JSON.parse(mem.get(k)) : null);
const setMem = (k, v) => {
  mem.set(k, JSON.stringify(v));
  const b = globalThis.__ratchet_bucketmemo; if (b) b.delete(k);
  const r = globalThis.__ratchet_rmemo; if (r) r.delete(k);
};
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
const resetRL = () => { const rl = globalThis.__ratchet_rl; if (rl && rl.clear) rl.clear(); };

const HOUR = Math.floor(Date.now() / 3600e3);
const TARGET5 = `H${HOUR}Q0`;
const W = 'demo-freeze01';

// ---- 1. selling, so the test knows the machine works before it is stopped ---
// A refusal test that never saw the thing succeed proves nothing: the seal
// could be failing for an unrelated reason and the freeze assertions would
// still pass.
{
  const r = await call('POST', { body: { action:'shot', auth:{wallet:W}, target:TARGET5, side:'YES', stake:500 } });
  ok(r.body.ok === true, 'baseline: the machine sells while the freeze is off');
  ok(getMem('u:'+W).open.length === 1, 'baseline: the shot is open and holding stake');
}
const crAfterSeal = getMem('u:'+W).cr;
const openShot = JSON.parse(JSON.stringify(getMem('u:'+W).open[0]));

// ---- 2. freeze on: it stops SELLING -------------------------------------
reload(true); resetRL();
{
  const r = await call('POST', { body: { action:'shot', auth:{wallet:'demo-freeze02'}, target:TARGET5, side:'YES', stake:500 } });
  ok(r.body.ok !== true, 'frozen: a shot is refused');
  ok(r.body.code === 'MIGRATION_FREEZE',
    'frozen: refused by NAME, not a generic SHOT_REFUSED — an agent must be able to tell a freeze from a fault, which is exactly what the Bankr RELEASE_MISMATCH failure was');
  ok(/not selling/i.test(r.body.reason || ''), 'frozen: the reason says what is happening');
  ok(/settle|safe/i.test(r.body.reason || ''),
    'frozen: and says open shots are unaffected, so nobody thinks their stake is stuck');
}
{
  // No credits may be taken by a refused seal. This is the money assertion:
  // a freeze that debited before refusing would be worse than no freeze.
  const before = getMem('u:demo-freeze02');
  ok(before === null || before.cr === 5000 || !before.open || before.open.length === 0,
    'frozen: a refused seal takes no credits and opens no chamber');
}
{
  const r = await call('POST', { body: { action:'challenge', auth:{wallet:'demo-freeze03'},
    target:TARGET5, side:'YES', stake:500 } });
  ok(r.body.ok !== true,
    'frozen: a challenge is refused too — takeStake is the ONE chokepoint every stake passes, so no second path stays open');
}

// ---- 3. freeze on: it does NOT stop SETTLING ----------------------------
// The half that matters. Every open shot must still run to its own expiry and
// pay, or the freeze strands exactly the stake it exists to protect.
{
  const p = getMem('u:'+W);
  p.open[0].exp = Date.now() - 1000;
  p.open[0].entry = PX[p.open[0].feed] * 0.9;      // price rose: this is a HIT
  seedStubPx(p.open[0].exp); setMem('u:'+W, p); tickPx();
  const r = await call('GET', { query: { action:'state', wallet:W } });
  ok(r.body.ok === true, 'frozen: state still reads');
  ok(r.body.player.open.length === 0, 'frozen: the open shot settled rather than sitting there');
  ok(r.body.player.hits === 1, 'frozen: a correct prediction is still recorded as correct');
  ok(r.body.player.cr === crAfterSeal + Math.round(openShot.stake * 1.7),
    'frozen: and it PAYS — 1.7x the stake returned, exactly as if nothing were frozen');
}

// ---- 4. the freeze is off by default ------------------------------------
// Every deployment today runs without the variable. If the default were ever
// inverted the whole game would go quiet on a redeploy, so it is worth an
// assertion rather than an assumption.
reload(false); resetRL();
{
  const r = await call('POST', { body: { action:'shot', auth:{wallet:'demo-freeze04'}, target:TARGET5, side:'YES', stake:500 } });
  ok(r.body.ok === true, 'unset: selling resumes — the switch is off unless it is explicitly on');
}
// and a value that is not exactly "1" must not freeze anything by accident
process.env.RX_MIGRATION_FREEZE = 'false';
delete require.cache[gamePath];
game = require('../api/game.js');
resetRL();
{
  const r = await call('POST', { body: { action:'shot', auth:{wallet:'demo-freeze05'}, target:TARGET5, side:'YES', stake:500 } });
  ok(r.body.ok === true,
    'RX_MIGRATION_FREEZE=false does NOT freeze — a string comparison against "1", so no truthy accident can take the game down');
}
delete process.env.RX_MIGRATION_FREEZE;

console.log(fails
  ? `\nFAIL  migration freeze: ${fails} of ${checks} checks failed`
  : `\nPASS  migration freeze: ${checks} checks — it stops selling, it never stops settling`);
process.exit(fails ? 1 : 0);
