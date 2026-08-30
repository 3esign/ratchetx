// Explicit opt-in diagnostic. Never loads/writes an env file or prints secrets.
// Only two random test:pyth-order:* keys are touched, with TTL and final cleanup.
// Example: vercel env run -e production -- node scripts/probe-ordered-kv.mjs --live --backend=supabase
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
const backend=process.argv.find(a=>a.startsWith('--backend='))?.slice(10);
if(!process.argv.includes('--live') || !['supabase','upstash'].includes(backend)) {
  console.error('Requires --live and --backend=supabase|upstash; uses only isolated TTL test keys.');
  process.exit(2);
}
const allowed=backend==='supabase'
  ? ['SUPABASE_URL','SUPABASE_SERVICE_KEY','SUPABASE_SERVICE_ROLE_KEY']
  : ['KV_REST_API_URL','KV_REST_API_TOKEN','UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN'];
// Drop unrelated credentials from this process before loading application code.
for(const key of Object.keys(process.env)) if(!allowed.includes(key)) delete process.env[key];
const require=createRequire(import.meta.url);
const kv=require('../lib/kv.js');
assert.equal(kv.backend,backend,'requested durable backend must be configured');
const prefix='test:pyth-order:h98:'+randomUUID();
const keys=[prefix+':serial',prefix+':race'];
const fields=['publishTime','postedSlot','rpcSlot','observedAt'];
const a={publishTime:100,postedSlot:401,rpcSlot:401,observedAt:1000,price:100,confidenceBps:20};
const b={...a,postedSlot:402,rpcSlot:402,price:110,confidenceBps:199};
let phase='serial', removed=false;
try {
  assert.equal(await kv.setJSONIfNewer(keys[0],a,fields,120),true);
  assert.equal(await kv.setJSONIfNewer(keys[0],b,fields,120),true);
  assert.equal(await kv.setJSONIfNewer(keys[0],{...a,rpcSlot:999,observedAt:9999},fields,120),false);
  assert.equal(await kv.setJSONIfNewer(keys[0],b,fields,120),false);
  assert.equal((await kv.getJSONStrict(keys[0])).postedSlot,402);
  phase='concurrent';
  const candidates=[412,403,409,401,411,405,410,402,408,404,407,406]
    .map(slot=>({...b,postedSlot:slot,rpcSlot:slot}));
  const results=await Promise.allSettled(candidates.map(value=>kv.setJSONIfNewer(keys[1],value,fields,120)));
  const completed=candidates.filter((_,i)=>results[i].status==='fulfilled');
  assert.ok(completed.length);
  const observed=await kv.getJSONStrict(keys[1]);
  assert.ok(observed.postedSlot>=Math.max(...completed.map(v=>v.postedSlot)),
    'latest must be at least the maximum completed candidate');
  assert.ok(observed.postedSlot<=412);
  // A writer deferred by bounded contention retries from fresh state.
  await kv.setJSONIfNewer(keys[1],candidates[0],fields,120);
  assert.equal((await kv.getJSONStrict(keys[1])).postedSlot,412);
  console.log(JSON.stringify({backend,serial:'pass',concurrent:'pass',writers:12,
    boundedDeferrals:results.filter(r=>r.status==='rejected').length,latestSlot:412}));
} catch(error) {
  console.error(JSON.stringify({backend,phase,status:'failed',errorType:error.name}));
  process.exitCode=1;
} finally {
  await Promise.all(keys.map(key=>kv.delKey(key)));
  removed=(await Promise.all(keys.map(key=>kv.getJSONStrict(key)))).every(v=>v===null);
  console.log(JSON.stringify({backend,isolatedProbeKeysRemoved:removed}));
  if(!removed)process.exitCode=1;
}
