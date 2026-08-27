// ============================================================
//  THE CRITICAL PATHS — the list, as a test that fails.
//
//  A document listing "things that must always work" rots the week after it
//  is written, because nothing checks it. This file IS that list: every entry
//  names a path, says what a player loses when it breaks, and asserts it.
//
//  Rule for adding to this file: if it breaking would make a player think the
//  machine is dishonest or broken, it belongs here. Being slow does not
//  qualify. Being WRONG, or refusing a button that is supposed to always
//  work, does.
//
//  docs/CRITICAL_PATHS.md is the human-readable copy of this list and points
//  back here. If you add a path there, add it here or it is not protected.
// ============================================================
import http from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

let pass = 0, failn = 0;
const ok = (c, label, breaks) => {
  if (c) { pass++; console.log('PASS  ' + label); }
  else { failn++; console.log('FAIL  ' + label + (breaks ? `\n        breaks: ${breaks}` : '')); }
};

const FEEDS = ['SOL','BTC','ETH','BONK','WIF','JUP','PUMP'];
const pricesPath = require.resolve('../lib/prices.js');
const burnPath = require.resolve('../lib/burn.js');
let T = 100;
require.cache[pricesPath] = { id:pricesPath, filename:pricesPath, loaded:true,
  exports:{ getPrices: async () => { const t=Math.floor(Date.now()/1000), sc=(T+=0.4)/100; return { src:'pyth-onchain',
    ages:Object.fromEntries(FEEDS.map(f=>[f,3])), confs:Object.fromEntries(FEEDS.map(f=>[f,10])),
    pubs:Object.fromEntries(FEEDS.map(f=>[f,t])), prevPubs:Object.fromEntries(FEEDS.map(f=>[f,t-60])),
    SOL:T, BTC:60000*sc, ETH:2000*sc, BONK:0.000002*sc, WIF:0.1*sc, JUP:0.2*sc, PUMP:0.005*sc }; } } };
require.cache[burnPath] = { id:burnPath, filename:burnPath, loaded:true,
  exports:{ INCINERATOR:'1nc1nerator11111111111111111111111111111111',
    rpcCall: async()=>null, getTx: async()=>null, decideBurn: ()=>({ok:false,reason:'stub'}) } };

const game = require('../api/game.js');
const snapshot = require('../api/snapshot.js');
const record = require('../api/record.js');
const mount = (mod) => async (req, res, u) => {
  let body = null;
  if (req.method === 'POST') { const c=[]; for await (const x of req) c.push(x);
    try { body = JSON.parse(Buffer.concat(c).toString()); } catch {} }
  const fake = { method:req.method, query:Object.fromEntries(u.searchParams), body,
    headers:{'x-forwarded-for':'9.9.9.'+Math.floor(Math.random()*250)}, socket:{} };
  const out = { _s:200, status(c){this._s=c;return this;},
    json(o){ res.writeHead(this._s,{'content-type':'application/json'}); res.end(JSON.stringify(o)); },
    setHeader(){}, end(t){ res.writeHead(this._s); res.end(t); } };
  await mod(fake, out);
};
const srv = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  try {
    if (u.pathname === '/snapshot') return await mount(snapshot)(req, res, u);
    if (u.pathname === '/record')   return await mount(record)(req, res, u);
    return await mount(game)(req, res, u);
  } catch (e) { res.writeHead(500); res.end(String(e && e.stack || e)); }
});
await new Promise(r => srv.listen(8331, r));
const B = 'http://127.0.0.1:8331';
const get  = (qs, path='/') => fetch(`${B}${path}?${qs}`).then(r => r.json());
const post = (b) => fetch(B, { method:'POST', headers:{'content-type':'application/json'},
  body: JSON.stringify(b) }).then(async r => ({ status:r.status, body: await r.json() }));

const W = 'demo-critical';
const auth = { wallet: W };

// ── 1. THE BOARD ─────────────────────────────────────────────
// No board, no game. Everything else on the site depends on this one call.
const board = await get('action=board');
ok(board && Array.isArray(board.targets) && board.targets.length > 0,
   'the board loads and offers targets', 'nobody can fire at all — the site is a brochure');
ok(board.prices && Number.isFinite(board.prices.SOL),
   'the board carries live prices', 'players seal against a blank price and cannot judge a call');
ok(board.stakeRule && board.settleRule,
   'the board publishes its own stake and settlement rules',
   'the rules become whatever we say they are today — the opposite of the product');

// ── 2. SEALING A SHOT ────────────────────────────────────────
const dir = board.targets.find(t => t.kind === 'dir');
const shot = await post({ action:'shot', auth, target:dir.id, side:'YES', stake:200 });
ok(shot.body.ok === true && shot.body.shot && shot.body.shot.commit,
   'a shot seals and returns its commitment', 'the core action of the product fails');
ok(shot.body.shot.salt && shot.body.shot.side,
   'the sealer receives side and salt back', 'the player cannot prove their own call later');

// ── 3. READING YOUR OWN RECORD ───────────────────────────────
const st = await get(`action=state&wallet=${W}`);
ok(st.player && Array.isArray(st.player.open),
   'a player can read their own state', 'settlements never get collected and credits look frozen');
ok((st.player.open[0] || {}).side === undefined,
   'open shots do not leak the sealed side', 'sealed stops meaning sealed — the whole premise');

// ── 4. ANCHORING THE LOG, WHILE THE SITE IS POLLING ──────────
// The regression that prompted this file: the per-wallet lock was acquired in
// ONE attempt, so a background state poll made the ANCHOR button return 409 to
// a player colliding with themselves.
const inFlight = get(`action=state&wallet=${W}`);
const anchorish = await post({ action:'anchor', auth, sig:'not-a-real-signature' });
await inFlight;
ok(anchorish.status !== 409,
   'an action is not refused merely because the player is also polling',
   'buttons fail at random for one player using one tab — the exact bug a user reported');
ok(anchorish.body && typeof anchorish.body.reason === 'string',
   'and when it does refuse, it says why', 'players get a dead button with no explanation');

// A burst from one wallet: an agent firing a few calls, or a person with the
// site open in three tabs. Each write holds the per-wallet lock for its whole
// request, so this is bounded by how long a write actually takes — measured
// below and printed, so the day it gets slower this test says so instead of
// going quietly flaky.
const t0 = Date.now();
const burst = await Promise.all(Array.from({ length: 4 }, () =>
  post({ action:'shot', auth, target:dir.id, side:'NO', stake:100 })));
const per = Math.round((Date.now() - t0) / 4);
console.log(`      (four serialized writes, ~${per}ms each)`);
// A game RULE may refuse a burst — the open-chamber cap is supposed to. What
// must never refuse it is the plumbing. Assert the distinction, or this test
// quietly passes on the wrong reason.
const lockRefusals = burst.filter(r => /update in flight/.test((r.body && r.body.reason) || ''));
console.log('      statuses:', burst.map(r => r.status).join(','), '| reasons:',
  burst.map(r => ((r.body && r.body.reason) || 'ok').slice(0, 34)).join(' | '));
ok(lockRefusals.length === 0,
   `a burst from one wallet is never refused by the LOCK (~${per}ms per write)`,
   'one player, several tabs, random failures that look like the machine breaking');
ok(burst.every(r => r.body && (r.body.ok === true || typeof r.body.reason === 'string')),
   'and every refusal in the burst names a rule', 'players cannot tell a limit from an outage');

// ── 5. THE PUBLIC EVIDENCE ───────────────────────────────────
const snap = await get('', '/snapshot');
ok(snap && snap.state && Array.isArray(snap.state.log || snap.state.events || []),
   'the Black Box exports the whole state', 'the resurrection claim becomes a slogan');
const rec = await get('format=json&limit=5&after=0', '/record');
ok(rec && (rec.rows || rec.chain),
   'the public record exports', 'the accuracy dataset nobody has to trust us for disappears');

// ── 6. THE ARENA AND THE LEDGER ──────────────────────────────
const arena = await get('action=arena');
ok(arena.ok === true && Array.isArray(arena.agents),
   'the arena board answers', 'agents lose their scoreboard and the MCP surface looks dead');

// ── 7. REFUSALS EXPLAIN THEMSELVES ───────────────────────────
// Every rejection carries a reason. An unexplained refusal is indistinguishable
// from the machine being broken, which is the impression this product cannot afford.
const bad = await post({ action:'shot', auth, target:'NOPE', side:'YES', stake:200 });
ok(bad.body.ok === false && typeof bad.body.reason === 'string' && bad.body.reason.length > 3,
   'a rejected call explains which rule stopped it', 'players cannot tell a rule from an outage');
const badStake = await post({ action:'shot', auth, target:dir.id, side:'YES', stake:1 });
ok(badStake.body.ok === false && /\d/.test(badStake.body.reason || ''),
   'a stake below the minimum names the number', 'the published stake rule stops being checkable');

console.log(`\n${pass} passed, ${failn} failed`);
process.exitCode = failn ? 1 : 0;
srv.closeAllConnections?.();
await new Promise(r => srv.close(() => r()));
setTimeout(() => process.exit(process.exitCode || 0), 3000).unref();
