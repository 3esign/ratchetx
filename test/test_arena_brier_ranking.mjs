// The arena calls itself a Brier leaderboard. Lock that contract to the data:
// total settled sides are not stated-probability observations, and raw hit rate
// must not decide rank ahead of calibration.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const pricesPath = require.resolve('../lib/prices.js');
const burnPath = require.resolve('../lib/burn.js');
const FEEDS = ['SOL','BTC','ETH','BONK','WIF','JUP','PUMP'];
require.cache[pricesPath] = { id:pricesPath, filename:pricesPath, loaded:true, exports:{
  getPrices:async () => ({ src:'pyth-onchain', ages:Object.fromEntries(FEEDS.map(f=>[f,3])),
    confs:Object.fromEntries(FEEDS.map(f=>[f,10])), pubs:Object.fromEntries(FEEDS.map(f=>[f,1])),
    prevPubs:Object.fromEntries(FEEDS.map(f=>[f,0])), SOL:100, BTC:60000, ETH:2000,
    BONK:0.000002, WIF:0.1, JUP:0.2, PUMP:0.005 }) } };
require.cache[burnPath] = { id:burnPath, filename:burnPath, loaded:true, exports:{
  INCINERATOR:'1nc1nerator11111111111111111111111111111111', rpcCall:async()=>null,
  getTx:async()=>null, decideBurn:()=>({ok:false,reason:'stub'}) } };

const game = require('../api/game.js');
const kv = require('../lib/kv.js');
const wallets = ['wallet-unscored', 'wallet-coinflip', 'wallet-calibrated'];
await kv.setJSON('g:arena', wallets);
await kv.setJSON(`u:${wallets[0]}`, { agent:{ name:'PERFECT BUT UNSTATED', since:1 }, bn:0, bsum:0, xp:10 });
await kv.setJSON(`u:${wallets[1]}`, { agent:{ name:'COINFLIP', since:2 }, bn:10, bsum:2.5, xp:10 });
await kv.setJSON(`u:${wallets[2]}`, { agent:{ name:'CALIBRATED', since:3 }, bn:10, bsum:1.6, xp:10 });
await kv.setJSON(`hist:${wallets[0]}`, Array.from({length:10}, () => ({res:'hit'})));
await kv.setJSON(`hist:${wallets[1]}`, Array.from({length:10}, (_,i) => ({res:i<8?'hit':'miss'})));
await kv.setJSON(`hist:${wallets[2]}`, Array.from({length:10}, (_,i) => ({res:i<6?'hit':'miss'})));

let status = 200, body;
const req = { method:'GET', query:{action:'arena'}, headers:{'x-forwarded-for':'7.7.7.7'}, socket:{} };
const res = { status(c){status=c;return this;}, json(v){body=v;return v;} };
await game(req, res);

let failed = 0;
const ok = (condition, label) => { console.log((condition ? 'PASS  ' : 'FAIL  ') + label); if (!condition) failed++; };
ok(status === 200 && body && body.ok === true, 'arena answers');
ok(body.agents[0].name === 'CALIBRATED' && body.agents[0].brierIndex === 60,
  'higher Brier index outranks a higher raw hit rate');
ok(body.agents[1].name === 'COINFLIP' && body.agents[1].brierIndex === 50,
  'second ranked agent follows by Brier index');
const unstated = body.agents.find(a => a.name === 'PERFECT BUT UNSTATED');
ok(unstated && unstated.n === 10 && unstated.stated === 0 && unstated.listed === false,
  'ten outcomes without stated probabilities do not qualify for Brier ranking');
ok(body.agents.every((a, i, all) => !a.listed || i === 0 || all[i - 1].listed),
  'unranked agents cannot sit above ranked agents');

console.log(failed ? `\n${failed} FAILED` : '\nALL PASS');
process.exit(failed ? 1 : 0);
