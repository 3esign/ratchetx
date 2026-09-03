'use strict';
const {serverHeaders}=require('./supabase_auth.js');
// Read-only deployment gate, not a migration runner. Never emit credentials or
// database response bodies. Only the administrator applies the additive SQL.
async function check({env=process.env,fetchImpl=fetch}={}) {
  const base=env.SUPABASE_URL,key=env.SUPABASE_SERVICE_KEY||env.SUPABASE_SERVICE_ROLE_KEY;
  // This gate asks Supabase whether migration 003 is in place. When Supabase is
  // not the store, there is nothing to ask: migration 003 is a Supabase object,
  // and lib/kv.js implements the guarded commit natively on the Redis protocol
  // (see commitGuarded). Blocking the build in that case would have been a
  // deployment gate for a database the deployment does not use -- which is
  // exactly what it did on 2026-09-03, when the store moved and every deploy
  // stopped. What must still be refused is a production build with NO durable
  // store at all: that is the in-memory demo mode, and it is not a thing to ship.
  const redisUrl=env.KV_REST_API_URL||env.UPSTASH_REDIS_REST_URL;
  const redisToken=env.KV_REST_API_TOKEN||env.UPSTASH_REDIS_REST_TOKEN;
  if(!base||!key){
    if(redisUrl&&redisToken)return true;
    throw new Error('Guarded player deployment requires a configured durable store');
  }
  let origin;
  try {origin=new URL(base);}catch {throw new Error('Invalid database endpoint configuration');}
  if(origin.protocol!=='https:'||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)
    throw new Error('Invalid database endpoint configuration');
  const response=await fetchImpl(origin.origin+'/rest/v1/rpc/ratchet_kv_guarded_ready',{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),
    headers:{...serverHeaders(key),'Content-Type':'application/json'},body:'{}'});
  if(!response.ok)throw new Error('Database migration 003 is unavailable; deployment blocked');
  const result=await response.json();
  if(result?.schema!=='guarded-player-v1'||result.ready!==true)
    throw new Error('Guarded database trigger is not ready; deployment blocked');
  return true;
}
module.exports={check};
if(require.main===module)check().then(()=>console.log('Durable store prerequisite PASS'))
  .catch(()=>{console.error('Deployment blocked: verify database configuration and migration 003. No data was changed.');process.exitCode=1;});
