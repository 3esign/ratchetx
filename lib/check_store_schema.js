'use strict';
const {serverHeaders}=require('./supabase_auth.js');
// Read-only deployment gate, not a migration runner. Never emit credentials or
// database response bodies. Only the administrator applies the additive SQL.
async function check({env=process.env,fetchImpl=fetch}={}) {
  const base=env.SUPABASE_URL,key=env.SUPABASE_SERVICE_KEY||env.SUPABASE_SERVICE_ROLE_KEY;
  if(!base||!key)throw new Error('Guarded player deployment requires the configured Supabase store');
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
if(require.main===module)check().then(()=>console.log('Guarded player database prerequisite PASS'))
  .catch(()=>{console.error('Deployment blocked: verify database configuration and migration 003. No data was changed.');process.exitCode=1;});
