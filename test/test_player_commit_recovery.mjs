import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
for(const k of ['SUPABASE_URL','SUPABASE_SERVICE_KEY','SUPABASE_SERVICE_ROLE_KEY','KV_REST_API_URL',
  'KV_REST_API_TOKEN','UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN','RATCHET_MINT'])delete process.env[k];
const kv=require('../lib/kv.js');
const {SETTLE_RULE,OUTCOME_RULE}=require('../lib/outcome.js');
const feeds=['SOL','BTC','ETH','BONK','PUMP','JUP','WIF'];
const pp=require.resolve('../lib/prices.js');
require.cache[pp]={id:pp,filename:pp,loaded:true,exports:{getPrices:async()=>({src:'pyth-onchain',
  ...Object.fromEntries(feeds.map(f=>[f,110])),ages:Object.fromEntries(feeds.map(f=>[f,0])),
  confs:Object.fromEntries(feeds.map(f=>[f,1])),pubs:Object.fromEntries(feeds.map(f=>[f,Math.floor(Date.now()/1000)])),
  prevPubs:Object.fromEntries(feeds.map(f=>[f,Math.floor(Date.now()/1000)-60]))})}};
const px=require('../lib/pxlog.js');
px.priceCrossing=async()=>({price:110,publishTime:Math.floor(Date.now()/1000),prevPublishTime:Math.floor(Date.now()/1000)-60,
  confBps:1,row:{t:Date.now(),slot:123,postedSlot:120,src:'pyth-onchain'}});
const owner='11111111111111111111111111111112',id='012345abcdef';
const baseCommit=kv.commitGuarded,baseApply=kv.applyOnce;
const baseLadder=kv.zincrManyOnce;
let refuseWrite=true,refuseEffect=false,refuseLadder=false,loseAck=false,arrive=false;
kv.zincrManyOnce=async(...args)=>{
  if(refuseLadder&&String(args[0]).startsWith('ladder:'))throw new Error('injected partial-delivery outage');
  return baseLadder(...args);
};
kv.commitGuarded=async tx=>{
  const player=tx.entries.find(e=>e.key==='u:'+owner);
  if(player){
    if(refuseWrite)throw new Error('injected player write outage');
    if(arrive){arrive=false;await kv.incrFloat('pend:'+owner,25);}
  }
  const result=await baseCommit(tx);
  if(player&&loseAck){loseAck=false;throw new Error('acknowledgement lost after commit');}
  return result;
};
kv.applyOnce=async(...args)=>{
  if(refuseEffect&&String(args[0]).startsWith('stakefund:'))throw new Error('injected downstream outage');
  return baseApply(...args);
};
const game=require('../api/game.js');
async function poll(){let status=200,body;await game({method:'GET',query:{action:'state',wallet:owner},headers:{},socket:{}},
  {setHeader(){},status(n){status=n;return this;},json(v){body=v;}});return {status,body};}
const shot={id,kind:'dir',feed:'SOL',side:'YES',stake:500,entry:100,exp:Date.now()-1000,
  xp:10,label:'fixture',sp:0.52,salt:'a'.repeat(32),commit:'b'.repeat(64),commitV:2,
  oracleSrc:'pyth-onchain',allocationRule:'on-settle-v2',settleRule:SETTLE_RULE,outcomeRule:OUTCOME_RULE};
const initial={w:owner,cr:500,bal:0,granted:true,qualified:true,xp:0,streak:0,best:0,hits:0,shots:0,burned:0,
  day:new Date().toISOString().slice(0,10),open:[shot],closed:[]};
await kv.setJSON('u:'+owner,initial);await kv.setJSON('pend:'+owner,100);
let result=await poll();assert.equal(result.status,500);
assert.equal((await kv.getJSONStrict('u:'+owner)).cr,500);
assert.equal(await kv.getJSONStrict('pend:'+owner),100,'failed write may not consume incoming credit');
assert.equal(await kv.getJSONStrict('stakefund:'+owner+':'+id),null,'uncommitted outcome may not fund pots');
assert.equal(await kv.getJSONStrict('ledger:'+owner+':'+id),null);
assert.equal(await kv.getJSONStrict('hist:'+owner),null);
refuseWrite=false;refuseEffect=true;loseAck=true;arrive=true;
result=await poll();assert.equal(result.status,200);
const committed=await kv.getJSONStrict('u:'+owner);
assert.equal(committed.open.length,0);assert.equal(committed.closed[0].res,'hit');
assert.equal(committed.bn,1);assert.equal(committed.settlementOutbox.length,1);
assert.equal(committed.cr,600+committed.closed[0].back,'result credited once despite lost ack');
assert.equal(await kv.getJSONStrict('pend:'+owner),25,'arrivals after snapshot are retained');
// Discard all request objects. Fresh reads must use the stored result/outbox,
// not rerun its oracle decision. This is not an OS process-termination test.
px.priceCrossing=async()=>{throw new Error('oracle must not be read again');};
refuseEffect=false;refuseLadder=true;
await poll();await poll();
assert.equal((await kv.hall('ldg:rx')).n,1,'partial delivery replay may not rescore the ledger');
assert.equal((await kv.getJSONStrict('u:'+owner)).settlementOutbox.length,1);
refuseLadder=false;
result=await poll();assert.equal(result.status,200);
const repaired=await kv.getJSONStrict('u:'+owner);
assert.equal(repaired.settlementOutbox.length,0);assert.equal(repaired.bn,1);
assert.equal(repaired.cr,committed.cr+25);assert.equal(await kv.getJSONStrict('pend:'+owner),0);
assert.equal((await kv.getJSONStrict('hist:'+owner)).length,1);
const stats=await kv.hall('h:stats'),ledger=await kv.hall('ldg:rx');
assert.equal(ledger.n,1);
assert.equal((await kv.ztop('z:lba:all',10)).find(([w])=>w===owner)[1],repaired.xp,'bootstrap must not double-count post-commit XP');
await poll();await poll();
assert.deepEqual(await kv.hall('h:stats'),stats);
assert.deepEqual(await kv.hall('ldg:rx'),ledger);
assert.equal((await kv.getJSONStrict('u:'+owner)).bn,1);
console.log('Canonical game: queue conservation, lost ACK, persisted settlement outbox, crash repair, single Brier/ledger/payout PASS');
