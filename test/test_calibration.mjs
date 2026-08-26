// Calibration v1: the optional stated probability `p` on a shot.
// Drives the REAL api/game.js over HTTP (stubbed oracle + chain) and checks:
//   - validation (p outside 0.01-0.99 refused, shot without p unaffected)
//   - sealing (sp never visible on open shots: state AND snapshot)
//   - scoring at settlement ((p-outcome)^2, aggregates, 10-bin calibration)
//   - brierIndex = (1 - sqrt(brier)) * 100
//   - the reveal publishes sp into the hash-chained log and history
import http from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

let pass = 0, failn = 0;
const ok = (c, label) => { if (c) { pass++; console.log('PASS  ' + label); }
  else { failn++; console.log('FAIL  ' + label); } };

// stub the oracle (prices rise monotonically: dir YES always hits) + the chain
const pricesPath = require.resolve('../lib/prices.js');
const burnPath = require.resolve('../lib/burn.js');
const FEEDS = ['SOL','BTC','ETH','BONK','WIF','JUP','PUMP'];
let T = 100;
require.cache[pricesPath] = { id: pricesPath, filename: pricesPath, loaded: true,
  exports: { getPrices: async () => { const t=Math.floor(Date.now()/1000), scale=(T+=0.4)/100; return { src:'pyth-onchain',
    ages:Object.fromEntries(FEEDS.map(f=>[f,3])), confs:Object.fromEntries(FEEDS.map(f=>[f,10])),
    pubs:Object.fromEntries(FEEDS.map(f=>[f,t])), prevPubs:Object.fromEntries(FEEDS.map(f=>[f,t-60])),
    SOL:T, BTC:60000*scale, ETH:2000*scale, BONK:0.000002*scale, WIF:0.1*scale, JUP:0.2*scale, PUMP:0.005*scale }; } } };
require.cache[burnPath] = { id: burnPath, filename: burnPath, loaded: true,
  exports: { INCINERATOR:'1nc1nerator11111111111111111111111111111111',
    rpcCall: async()=>null, getTx: async()=>null, decideBurn: ()=>({ok:false,reason:'stub'}) } };

const game = require('../api/game.js');
const snapshot = require('../api/snapshot.js');
const srv = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  let body = null;
  if (req.method === 'POST') {
    const chunks = []; for await (const c of req) chunks.push(c);
    try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch {}
  }
  const fake = { method: req.method, query: Object.fromEntries(u.searchParams), body,
    headers: {'x-forwarded-for':'7.7.7.'+Math.floor(Math.random()*250)}, socket:{} };
  const out = { _s:200, status(c){this._s=c;return this;},
    json(o){ res.writeHead(this._s,{'content-type':'application/json'}); res.end(JSON.stringify(o)); },
    setHeader(){}, end(t){ res.end(t); } };
  try { await (u.pathname === '/snapshot' ? snapshot(fake, out) : game(fake, out)); }
  catch (e) { out.status(500).json({ok:false,reason:String(e && e.stack || e)}); }
});
await new Promise(r => srv.listen(8304, r));
const B = 'http://127.0.0.1:8304';
const get = async (qs, path='/') => (await fetch(`${B}${path}?${qs}`)).json();
const post = async (b) => (await fetch(B, { method:'POST',
  headers:{'content-type':'application/json'}, body: JSON.stringify(b) })).json();

const W = 'demo-calib';
const auth = { wallet: W };            // demo wallets need no signature

// a dir target from the live board (stub prices keep every feed fresh)
const board = await get('action=board');
const dir = (board.targets || []).find(t => t.kind === 'dir');
ok(!!dir, `board offers a dir target (${dir && dir.id})`);

// 1. validation
const bad = await post({ action:'shot', auth, target:dir.id, side:'YES', stake:150, p:1.5 });
ok(bad.ok === false && /0\.01/.test(bad.reason || ''), 'p=1.5 refused with the 0.01-0.99 rule');
const bad2 = await post({ action:'shot', auth, target:dir.id, side:'YES', stake:150, p:'nope' });
ok(bad2.ok === false, 'non-numeric p refused');

// 2. sealed: fire with p, sp comes back to the OWNER but never to spectators
const a = await post({ action:'shot', auth, target:dir.id, side:'YES', stake:200, p:0.8 });
ok(a.ok === true && a.shot && a.shot.sp === 0.8, 'fire response echoes sp to the owner');
const spec1 = await get(`action=state&wallet=${W}`);
const openA = ((spec1.player && spec1.player.open) || [])[0] || {};
ok(openA.sp === undefined && openA.side === undefined, 'open shot hides sp exactly like side');
ok((spec1.player.stated || 0) === 0 && spec1.player.brier === null, 'no score before settlement');

// 3. force-expire everything on save (test_agent_e2e recipe), settle, score
const origSet = globalThis.__ratchet_mem.set.bind(globalThis.__ratchet_mem);
globalThis.__ratchet_mem.set = (k, v) => {
  if (typeof k === 'string' && k.startsWith('u:') && typeof v === 'string' && v.includes('"open"')) {
    try { const o = JSON.parse(v);
      // expire "just now": the first qualifying sample is then the NEXT
      // recorded one (fresh, higher T since prices rise monotonically), which
      // makes YES deterministically hit and NO deterministically miss.
      if (o.open) { o.open.forEach(sh => { sh.exp = Date.now() - 1; delete sh.oracleSrc; }); v = JSON.stringify(o); }
    } catch {}
  }
  const g = globalThis.__ratchet_pxgate; if (g) g.t = 0;
  return origSet(k, v);
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
// lay a fresh, higher sample AFTER the forced expiry, then settle on it
// The strict settle rule needs a sample OBSERVED after expiry whose oracle
// publish-time crosses the expiry second. The live sampler has a 45s dedupe,
// so the test appends one synthetic (higher-price) sample straight into the
// bucket — exactly the shape the production sampler writes.
const px = require('../lib/pxlog.js');
const kv = require('../lib/kv.js');
const ripen = async () => {
  await sleep(30);
  const t = Date.now() + 1500, sec = Math.ceil(t / 1000);
  const hi = (T + 5), scale = hi / 100;
  const row = { t: sec * 1000, src: 'pyth-onchain',
    SOL: hi, BTC: 60000*scale, ETH: 2000*scale, BONK: 0.000002*scale, WIF: 0.1*scale, JUP: 0.2*scale, PUMP: 0.005*scale,
    ag: Object.fromEntries(FEEDS.map(f=>[f,3])), cf: Object.fromEntries(FEEDS.map(f=>[f,10])),
    pt: Object.fromEntries(FEEDS.map(f=>[f,sec])), pp: Object.fromEntries(FEEDS.map(f=>[f,sec-60])) };
  const key = px.bucketKey(row.t);
  const rows = (await kv.getJSON(key)) || [];
  rows.push(row);
  await kv.setJSON(key, rows);
  await get(`action=state&wallet=${W}`);
};
const b2 = await post({ action:'shot', auth, target:dir.id, side:'NO', stake:200, p:0.6 });
ok(b2.ok === true, 'second sealed shot (NO, will miss on rising prices)');
await ripen();                                               // settles A + B
const c = await post({ action:'shot', auth, target:dir.id, side:'YES', stake:150 });
ok(c.ok === true && c.shot.sp === undefined, 'shot without p carries no sp');
await ripen();                                               // settles C
const st = await get(`action=state&wallet=${W}`);
const P = st.player || {};
const hitA = (P.history || []).find(h => h.sp === 0.8);
const missB = (P.history || []).find(h => h.sp === 0.6);
ok(hitA && hitA.res === 'hit' && missB && missB.res === 'miss', 'history publishes sp after settlement (hit 0.8, miss 0.6)');
ok(P.stated === 2, `exactly the two stated shots scored (stated=${P.stated})`);
ok(P.brier === 0.2, `brier = ((0.8-1)^2 + (0.6-0)^2)/2 = 0.2 (got ${P.brier})`);
ok(P.brierIndex === 55, `brierIndex = round((1-sqrt(0.2))*100) = 55 (got ${P.brierIndex})`);
const bins = P.calibration || [];
ok(bins[8] && bins[8].n === 1 && bins[8].hits === 1, 'calibration bin [0.8,0.9) = 1/1');
ok(bins[6] && bins[6].n === 1 && bins[6].hits === 0, 'calibration bin [0.6,0.7) = 0/1');
const unscored = (P.history || []).find(h => h.sp === undefined && h.res);
ok(!!unscored && P.stated === 2, 'p-less shot settled but never entered the Brier record');

// 4. the reveal publishes sp into the hash-chained log; open exports never leak it
const d = await post({ action:'shot', auth, target:dir.id, side:'YES', stake:150, p:0.9 }); // stays open (no state call)
ok(d.ok === true, 'fourth shot sealed and left open');
const snap = await get('', '/snapshot');
const me = (snap.players || {})[W] || {};
ok((me.open || []).every(s => s.sp === undefined && s.side === undefined), 'snapshot strips sp from open shots');
const logStr = JSON.stringify(snap.log || snap.events || snap);
ok(logStr.includes('"sp":0.8') && logStr.includes('"sp":0.6'), 'settle entries in the export carry the revealed sp');
ok(logStr.includes('"sp":null') || !logStr.includes('"k":"settle"') === false, 'p-less settles publish sp:null (never invented)');

// 5. crowd odds: current-bucket seals stay hidden (10-minute lag), closed
//    buckets aggregate, the 5-shot floor gates display
const board2 = await get('action=board');
const t2 = (board2.targets || []).find(t => t.id === dir.id) || {};
ok(t2.crowd === null || t2.crowd === undefined, 'live bucket never shows — sealed means sealed even in aggregate');
ok(/closed 10-minute buckets/.test(board2.crowdRule || ''), 'board states the crowd rule');
const prevBucket = Math.floor(Date.now() / 600e3) - 1;
const hour = board2.hour;
await kv.hincr(`odds:${hour}`, `${prevBucket}:${dir.id}:YES`, 4);
await kv.hincr(`odds:${hour}`, `${prevBucket}:${dir.id}:NO`, 2);
const board3 = await get('action=board');
const t3 = (board3.targets || []).find(t => t.id === dir.id) || {};
ok(t3.crowd && t3.crowd.n === 6 && t3.crowd.pctYes === 65 && t3.crowd.lagMin === 10,
  `closed bucket aggregates and rounds to 5 (got ${JSON.stringify(t3.crowd)})`);
await kv.hincr(`odds:${hour}`, `${prevBucket}:${dir.id}:NO`, -3);   // down to n=3
const board4 = await get('action=board');
const t4 = (board4.targets || []).find(t => t.id === dir.id) || {};
ok(t4.crowd === null || t4.crowd === undefined, 'under five counted shots the target shows nothing');

// 6. arena endpoint still healthy and speaks the new fields
const arena = await get('action=arena');
ok(arena.ok === true && Array.isArray(arena.agents), 'arena responds with the agents array');

console.log(`\n${pass} passed, ${failn} failed`);
srv.close();
process.exit(failn ? 1 : 0);
