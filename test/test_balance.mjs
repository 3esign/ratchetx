// A BALANCE WE COULD NOT READ IS NOT A BALANCE OF ZERO.
// rpcCall returns undefined when every endpoint fails. That used to become
// null in findAta and then `bal: 0` at every call site — cached for a minute,
// shown to a holder as "0 RCX", and fed to the staking payout and the podium
// holder rule as though it were a fact about their wallet.
import assert from 'node:assert';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

let fails = 0;
const ok = (c, n) => { console.log((c ? 'PASS  ' : 'FAIL  ') + n); if (!c) fails++; };

const W = 'HXFDaHyZ3i477z1BakiTWZg9UQN8rcreruuv9ifC1HvM';

function boot(rpc) {
  for (const k of Object.keys(require.cache)) delete require.cache[k];
  globalThis.__ratchet_mem = new Map();
  process.env.RATCHET_MINT = 'FQb2EyaLZ9TWBemYmQ9zWtXcEwLiSXtz7j619ThQpump';
  const pricesPath = require.resolve('../lib/prices.js');
  const burnPath = require.resolve('../lib/burn.js');
  require.cache[pricesPath] = { id: pricesPath, filename: pricesPath, loaded: true,
    exports: { getPrices: async () => ({ src:'stub', SOL:100, BTC:60000, ETH:2000,
      BONK:0.000002, WIF:0.1, JUP:0.2, PUMP:0.005 }) } };
  require.cache[burnPath] = { id: burnPath, filename: burnPath, loaded: true,
    exports: { INCINERATOR:'1nc1nerator11111111111111111111111111111111',
      rpcCall: rpc, getTx: async()=>null, decideBurn: ()=>({ok:false,reason:'stub'}) } };
  return require('../api/game.js');
}
const call = (game, q) => new Promise(r => {
  const res = { _s:200, status(c){this._s=c;return this;}, json(o){ r({status:this._s, body:o}); } };
  game({ method:'GET', query:q, headers:{'x-forwarded-for':'7.7.7.7'}, socket:{} }, res)
    .catch(e => r({ status:599, body:{ ok:false, reason:String(e) } }));
});

const ACCOUNT = { value: [{ pubkey: 'AtA111111111111111111111111111111111111111',
  account: { data: { parsed: { info: { tokenAmount: { uiAmount: 191202 } } } } } }] };

// A staker with a seat, so both the stake path and the champion console run.
const seedPlayer = (mem, extra = {}) => {
  mem.set(`u:${W}`, JSON.stringify({ w:W, xp:500, streak:0, best:0, hits:0, shots:0, cr:1000,
    qualified:true, burned:0, stakeOn:true, stakeEarned:0, open:[], closed:[], ...extra }));
  mem.set('g:podium', JSON.stringify({ list:[{ w:W, ata:'AtA111111111111111111111111111111111111111', pct:0.5 }] }));
};

// ---- 1. a healthy read shows the real balance ----
{
  const game = boot(async (m) => m === 'getTokenAccountsByOwner' ? ACCOUNT : null);
  seedPlayer(globalThis.__ratchet_mem);
  const r = await call(game, { action:'state', wallet: W });
  const si = r.body.player.stakeInfo;
  ok(si && si.bal === 191202, `the real balance is served (${si && si.bal})`);
  ok(si.balStale === false, 'and is not marked stale');
  ok(si.perDay > 0, 'and produces yield');
}

// ---- 2. AN UNREADABLE CHAIN MUST NOT READ AS ZERO ----
{
  const game = boot(async () => undefined);          // every RPC endpoint fails
  seedPlayer(globalThis.__ratchet_mem);
  const r = await call(game, { action:'state', wallet: W });
  const si = r.body.player.stakeInfo;
  ok(si.bal === null, `balance is null, not 0 (got ${JSON.stringify(si.bal)})`);
  ok(si.balStale === true, 'and is flagged as not currently readable');
  ok(si.perDay === null, 'yield is unknown rather than zero');
}

// ---- 3. AND MUST NOT SPEND THE STAKER'S DAY ----
// The real cost of the old bug: stakeDay advanced unconditionally, so one
// failed read marked the day paid, paid nothing, and the yield was gone.
{
  const game = boot(async () => undefined);
  const mem = globalThis.__ratchet_mem;
  seedPlayer(mem);
  await call(game, { action:'state', wallet: W });
  const p = JSON.parse(mem.get(`u:${W}`));
  ok(!p.stakeDay, `the day was not consumed by a failed read (stakeDay=${p.stakeDay})`);
  ok((p.stakeEarned || 0) === 0, 'and nothing was paid');
}

// ---- 4. once the chain answers, the day pays normally ----
{
  const game = boot(async (m) => m === 'getTokenAccountsByOwner' ? ACCOUNT : null);
  const mem = globalThis.__ratchet_mem;
  seedPlayer(mem);
  await call(game, { action:'state', wallet: W });
  const p = JSON.parse(mem.get(`u:${W}`));
  ok(!!p.stakeDay, 'a successful read does consume the day');
  ok((p.stakeEarned || 0) > 0, `and pays the yield (${p.stakeEarned})`);
}

// ---- 5. a failed read must not overwrite a balance we already knew ----
{
  let live = true;
  const game = boot(async (m) => (live && m === 'getTokenAccountsByOwner') ? ACCOUNT : undefined);
  const mem = globalThis.__ratchet_mem;
  seedPlayer(mem);
  await call(game, { action:'state', wallet: W });          // caches 191202
  const cached = JSON.parse(mem.get(`champbal:${W}`));
  ok(cached.bal === 191202, 'the good read was cached');

  live = false;
  mem.set(`champbal:${W}`, JSON.stringify({ ...cached, t: Date.now() - 120_000 }));  // force a refresh
  const r = await call(game, { action:'state', wallet: W });
  ok(r.body.player.stakeInfo.bal === 191202,
     'the last known balance is served rather than a zero');
  ok(r.body.player.stakeInfo.balStale === true, 'flagged as stale');
  const after = JSON.parse(mem.get(`champbal:${W}`));
  ok(after.bal === 191202, 'and the failed read never overwrote the cache');
}

// ---- 6. THE HOLDER RULE MUST NOT EVICT ON AN UNREADABLE CHAIN ----
// A seat is forfeited for dumping, not for our infrastructure being down.
{
  const game = require('fs').readFileSync(new URL('../api/game.js', import.meta.url), 'utf8');
  ok(/const unreadable = read === undefined/.test(game),
     'the podium rebuild distinguishes an unreadable balance');
  ok(/if \(!unreadable && acc\.bal \+ 1e-9 < earned7 \* CHAMP\.holdPct\)/.test(game),
     'and only forfeits a seat when the shortfall is actually observed');
}

console.log(fails ? `\n${fails} FAILED` : '\nBALANCE OK');
process.exit(fails ? 1 : 0);
