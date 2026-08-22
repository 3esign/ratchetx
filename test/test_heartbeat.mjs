import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

globalThis.__ratchet_mem = new Map();
const pricesPath = require.resolve('../lib/prices.js');
const burnPath = require.resolve('../lib/burn.js');
const now = Math.floor(Date.now() / 1000);
require.cache[pricesPath] = { id:pricesPath, filename:pricesPath, loaded:true, exports:{
  getPrices:async()=>({src:'pyth-onchain',SOL:100,BTC:60000,ETH:2500,
    BONK:0.000002,WIF:0.2,JUP:0.2,PUMP:0.004,
    ages:{SOL:2},confs:{SOL:4},pubs:{SOL:now},prevPubs:{SOL:now-60}}),
  coinbase:async()=>({src:'coinbase',SOL:100}),
}};
require.cache[burnPath] = { id:burnPath, filename:burnPath, loaded:true, exports:{
  INCINERATOR:'1nc1nerator11111111111111111111111111111111',
  rpcCall:async()=>null, getTx:async()=>null, decideBurn:()=>({ok:false}),
}};

const game = require('../api/game.js');
const body = await new Promise((resolve, reject) => {
  const req = {method:'GET',query:{action:'heartbeat'},
    headers:{'x-forwarded-for':'heartbeat-test'},socket:{}};
  const res = {code:200,status(n){this.code=n;return this;},
    json(value){this.code===200?resolve(value):reject(new Error(value.reason));}};
  game(req,res).catch(reject);
});
assert.equal(body.ok,true);
assert.equal(body.src,'pyth-onchain');
assert.equal(body.sampled,true);
assert.equal(typeof body.t,'number');
assert.equal(body.storage,'memory');
console.log('dedicated heartbeat samples once and returns explicit health without a blockhash call');