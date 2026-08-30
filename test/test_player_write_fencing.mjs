import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
for(const key of ['SUPABASE_URL','SUPABASE_SERVICE_KEY','SUPABASE_SERVICE_ROLE_KEY',
  'KV_REST_API_URL','KV_REST_API_TOKEN','UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN']) delete process.env[key];
const kv=require('../lib/kv.js');
const originalNow=Date.now;
let time=1788090000000;
Date.now=()=>time;
const feeds=['SOL','BTC','ETH','BONK','PUMP','JUP','WIF'];
const pricePath=require.resolve('../lib/prices.js');
require.cache[pricePath]={id:pricePath,filename:pricePath,loaded:true,exports:{getPrices:async()=>({
  src:'pyth-onchain',...Object.fromEntries(feeds.map(f=>[f,100])),
  ages:Object.fromEntries(feeds.map(f=>[f,0])),confs:Object.fromEntries(feeds.map(f=>[f,1])),
  pubs:Object.fromEntries(feeds.map(f=>[f,Math.floor(time/1000)])),
  prevPubs:Object.fromEntries(feeds.map(f=>[f,Math.floor(time/1000)-60]))})}};
const w='demo-fencedplayer';
let paused=false,release,entered;
const enteredPromise=new Promise(r=>entered=r),resume=new Promise(r=>release=r);
const rawGet=kv.getJSONStrict;
kv.getJSONStrict=async key=>{
  const value=await rawGet(key);
  if(key==='u:'+w&&!paused){paused=true;entered();await resume;}
  return value;
};
const game=require('../api/game.js');
async function invoke(method,query={},body=null){
  let result,status=200;
  await game({method,query,body,headers:{'x-forwarded-for':'fence-fixture'},socket:{}},
    {setHeader(){},status(n){status=n;return this;},json(value){result=value;return value;}});
  return {status,body:result};
}
try {
  await kv.setJSON('u:'+w,{w,cr:1000,bal:0,granted:true,qualified:false,xp:0,streak:0,best:0,hits:0,shots:0,
    burned:0,day:new Date(time).toISOString().slice(0,10),open:[],closed:[]});
  const board=await invoke('GET',{action:'board'});
  const target=board.body.targets[0].id;
  const body={action:'shot',auth:{wallet:w},target,side:'YES',p:0.52,stake:500};
  const old=invoke('POST',{},body);
  await Promise.race([enteredPromise,old.then(x=>{throw new Error('old request did not reach player read: '+JSON.stringify(x));})]);
  time+=36000;
  const newer=await invoke('POST',{},body);
  assert.equal(newer.body.ok,true,JSON.stringify(newer));
  release();
  const late=await old;
  const final=await rawGet('u:'+w);
  assert.ok(final.open.some(s=>s.id===newer.body.shot.id),'late old write must not erase newer accepted shot');
  assert.equal(final.cr,500,'stale call may not debit a second time or replace the newer balance');
  assert.equal(late.body.ok,false,'expired/stale caller must be refused');
  assert.ok([409,503].includes(late.status));
  console.log('Canonical game: delayed old caller after lease expiry cannot overwrite a newer accepted shot PASS');
} finally {release?.();Date.now=originalNow;}
