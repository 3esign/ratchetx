import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
for(const k of ['SUPABASE_URL','SUPABASE_SERVICE_KEY','SUPABASE_SERVICE_ROLE_KEY','KV_REST_API_URL','KV_REST_API_TOKEN','UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN']) delete process.env[k];
const kv=require('../lib/kv.js');
await kv.setJSON('g:feed',[{w:'player',a:'real receipt',t:100}]);
await kv.setJSON('g:log:head',{i:1});
await kv.setJSON('g:log:e:1',{i:1,t:50,ev:{k:'seal',w:'7'.repeat(44),id:'recorded',stake:500}});
let writes=0,oracle=0;
for(const k of ['setJSON','setJSONEx','setManyJSONAtomic','setnxJSON','acquireLease','releaseLease','hincr','hincrMany','applyOnce'])
  kv[k]=async()=>{writes++;throw new Error('forbidden diagnostic write');};
const prices=require.resolve('../lib/prices.js');
require.cache[prices]={id:prices,filename:prices,loaded:true,exports:{getPrices:async()=>{oracle++;throw new Error('forbidden diagnostic oracle');}}};
const game=require('../api/game.js');
async function call(method,query,body){let status=200,result;await game({method,query,body,headers:{'x-forwarded-for':'read-only-feed-test'},socket:{}},{setHeader(){},status(n){status=n;return this;},json(v){result=v;return v;}});return{status,result};}
const response=await call('GET',{action:'activity-feed',wallet:'7'.repeat(44)});
assert.equal(response.status,200,'activity inspection must stop before game state and settlement');
assert.equal(response.result.feed.length,2);
assert.equal(response.result.projection.persisted,false,'preview must not imply migration was written');
assert.equal(response.result.readOnly,true);
assert.equal((await call('POST',{action:'activity-feed'},{})).status,405);
assert.equal((await call('POST',{}, {action:'activity-feed'})).status,405);
assert.equal(writes,0,'no leases, database writes or economic effects');
assert.equal(oracle,0,'no oracle fetches');
assert.equal(await kv.getJSONStrict('g:feed:players:v2'),null);
console.log('READ-ONLY ACTIVITY ROUTE PASS');
