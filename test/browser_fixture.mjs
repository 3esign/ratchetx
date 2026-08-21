// Self-contained browser fixture. The old browser suites depended on private
// servers on ports 8255/8258 that were never committed, so nobody else could
// run them. This drives the real game handler in memory for a complete state
// shape, then intercepts only the browser's API requests.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const MINT = 'FQb2EyaLZ9TWBemYmQ9zWtXcEwLiSXtz7j619ThQpump';
const WALLET = 'HXFDaHyZ3i477z1BakiTWZg9UQN8rcreruuv9ifC1HvM';
process.env.RATCHET_MINT ||= MINT;

const pricesPath = require.resolve('../lib/prices.js');
const burnPath = require.resolve('../lib/burn.js');
require.cache[pricesPath] = { id:pricesPath, filename:pricesPath, loaded:true, exports:{
  getPrices: async () => ({ src:'pyth-onchain', SOL:100, BTC:60000, ETH:2000,
    BONK:0.000002, WIF:0.1, JUP:0.2, PUMP:0.005,
    ages:{SOL:2,BTC:2,ETH:2,BONK:2,WIF:2,JUP:2,PUMP:2} }) } };
require.cache[burnPath] = { id:burnPath, filename:burnPath, loaded:true, exports:{
  INCINERATOR:'1nc1nerator11111111111111111111111111111111',
  rpcCall:async m => m === 'getTokenAccountsByOwner' ? { value:[] } : null,
  getTx:async()=>null, decideBurn:()=>({ok:false,reason:'fixture'}) } };
const game = require('../api/game.js');

const callState = () => new Promise((resolve, reject) => {
  const req = { method:'GET', query:{action:'state',wallet:WALLET},
    headers:{'x-forwarded-for':'browser-fixture'}, socket:{} };
  const res = { _status:200, status(c){this._status=c;return this;},
    json(body){ this._status === 200 ? resolve(body) : reject(new Error(body.reason)); } };
  game(req,res).catch(reject);
});
const basePromise = callState();
const clone = x => structuredClone(x);

function settledShot() {
  const now = Date.now();
  return { id:'fixture-settle', res:'hit', side:'YES', label:'SOL higher in 2 minutes',
    xp:10, streakMult:1, feed:'SOL', t:now-120000, exp:now-1000,
    settledAt:now, entry:100, exitPx:101, back:170, stake:100 };
}

async function stateFor(mode, stateCall) {
  const s = clone(await basePromise);
  s.durable = true; s.mint = MINT;
  const p = s.player;
  p.rcx = { bal:0, stale:false };
  if (mode === 'unqual') { p.qualified = false; p.cr = 5000; }
  if (mode === 'broke')  { p.qualified = true;  p.cr = 0; }
  if (mode === 'rich')   { p.qualified = true;  p.cr = 5000; p.rcx.bal = 10000; }
  // First navigation is used only to seed localStorage; second is the clean
  // baseline; a later poll introduces one new settlement.
  if (mode === 'settle' && stateCall >= 3) {
    const e = settledShot(); p.open = []; p.closed = [e]; p.history = [e];
    p.shots = Math.max(1,p.shots||0); p.hits = Math.max(1,p.hits||0);
  } else if (mode === 'settle') { p.open=[]; p.closed=[]; p.history=[]; }
  return s;
}

const challenges = { ok:true, open:[
  {id:'c1',by:'HXFD…C1Hv',kind:'dir',feed:'SOL',mins:30,side:'YES',stake:500,
    label:'SOL higher in 30 minutes',expiresAt:Date.now()+600000},
  {id:'c2',by:'4abc…9xyz',kind:'thr',feed:'BTC',pct:0.01,mins:60,side:'NO',stake:1000,
    label:'BTC up +1.00% within 1 hour',expiresAt:Date.now()+600000},
]};

export async function installFixtureRoutes(page, fixedMode=null) {
  let stateCalls = 0;
  await page.route('**/api/game**', async route => {
    const u = new URL(route.request().url());
    const action = u.searchParams.get('action') || 'state';
    const mode = fixedMode || new URL(page.url()).searchParams.get('who') || 'normal';
    let body;
    if (action === 'state') body = await stateFor(mode, ++stateCalls);
    else if (action === 'challenges') body = challenges;
    else if (action === 'arena') body = {ok:true,minCalls:10,agents:[]};
    else if (action === 'path') body = {ok:true,path:[]};
    else body = {ok:false,reason:'fixture action not implemented'};
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
  });
}

