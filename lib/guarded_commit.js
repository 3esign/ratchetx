'use strict';
const crypto=require('node:crypto');
const {isDeepStrictEqual}=require('node:util');
function prepare(input){
  const tx=JSON.parse(JSON.stringify(input));
  if(!tx || typeof tx.id!=='string' || !/^[a-f0-9]{32}$/.test(tx.id) || !Array.isArray(tx.entries) || !tx.entries.length
    || tx.entries.length>12 || !Array.isArray(tx.debits) || !Array.isArray(tx.leases)) throw new Error('invalid guarded commit');
  const names=new Set();
  for(const e of tx.entries){
    if(typeof e.key!=='string'||!e.key.length||e.key.length>180||names.has(e.key)||e.key.startsWith('guarded:')||!Object.hasOwn(e,'expected')||!Object.hasOwn(e,'value')) throw new Error('invalid guarded entry');
    names.add(e.key);
  }
  for(const [key,amount] of tx.debits){
    if(!/^(pend|c7|cs7):/.test(key)||names.has(key)||!Number.isFinite(amount)||amount<0) throw new Error('invalid guarded debit');
    names.add(key);
  }
  for(const l of tx.leases){
    if(typeof l.key!=='string'||!l.key.startsWith('lock:')||typeof l.token!=='string'
      ||!Number.isSafeInteger(l.expiresAt)) throw new Error('invalid guarded lease');
  }
  for(const e of tx.entries){
    if((e.key.startsWith('u:')||e.key==='g:chal')&&!tx.leases.some(l=>l.key==='lock:'+e.key))
      throw new Error('guarded player/board write requires its lease');
    if(e.key.startsWith('u:')&&e.value?._writeGuard!==1)throw new Error('player guard marker required');
  }
  if(Buffer.byteLength(JSON.stringify(tx))>1500000) throw new Error('guarded commit too large');
  return {...tx,digest:crypto.createHash('sha256').update(JSON.stringify(tx)).digest('hex')};
}
const receiptKey=id=>'guarded:receipt:'+id;
// Memory implementation has no await between checks and mutation. Durable
// backends execute the same decision inside one Lua/SQL transaction.
function memoryCommit(mem,tx,now=Date.now()){
  const get=k=>mem.has(k)?JSON.parse(mem.get(k)):null;
  const receipt=get(receiptKey(tx.id));
  if(receipt) return receipt.digest===tx.digest?{ok:true,replay:true}:{ok:false,code:'COMMIT_ID_CONFLICT'};
  for(const l of tx.leases) if(get(l.key)!==l.token||now>=l.expiresAt) return {ok:false,code:'WRITE_LEASE_EXPIRED'};
  for(const e of tx.entries) if(!isDeepStrictEqual(get(e.key),e.expected)) return {ok:false,code:'WRITE_CONFLICT'};
  for(const [key,amount] of tx.debits) if(!Number.isFinite(Number(get(key)||0))||Number(get(key)||0)<amount) return {ok:false,code:'CREDIT_QUEUE_CONFLICT'};
  for(const [key,amount] of tx.debits) mem.set(key,JSON.stringify(Number(get(key)||0)-amount));
  for(const e of tx.entries) mem.set(e.key,JSON.stringify(e.value));
  mem.set(receiptKey(tx.id),JSON.stringify({digest:tx.digest}));
  return {ok:true,replay:false};
}
const LUA=`
local tx=cjson.decode(ARGV[1])
local prior=redis.call('GET',KEYS[1])
if prior then
  if cjson.decode(prior).digest==tx.digest then return cjson.encode({ok=true,replay=true}) end
  return cjson.encode({ok=false,code='COMMIT_ID_CONFLICT'})
end
local clock=redis.call('TIME')
local now=tonumber(clock[1])*1000+math.floor(tonumber(clock[2])/1000)
for _,l in ipairs(tx.leases) do
  local raw=redis.call('GET',l.key)
  if not raw or cjson.decode(raw)~=l.token or now>=l.expiresAt then return cjson.encode({ok=false,code='WRITE_LEASE_EXPIRED'}) end
end
for _,e in ipairs(tx.entries) do
  local raw=redis.call('GET',e.key)
  if e.expected==cjson.null then
    if raw and raw~='null' then return cjson.encode({ok=false,code='WRITE_CONFLICT'}) end
  elseif raw~=e.expectedEncoded then return cjson.encode({ok=false,code='WRITE_CONFLICT'}) end
end
for _,d in ipairs(tx.debits) do
  local n=tonumber(redis.call('GET',d[1]) or '0')
  if not n or n<d[2] then return cjson.encode({ok=false,code='CREDIT_QUEUE_CONFLICT'}) end
end
for _,d in ipairs(tx.debits) do redis.call('INCRBYFLOAT',d[1],-d[2]) end
for _,e in ipairs(tx.entries) do redis.call('SET',e.key,e.encoded) end
redis.call('SET',KEYS[1],cjson.encode({digest=tx.digest}),'EX',604800)
return cjson.encode({ok=true,replay=false})`;
module.exports={prepare,memoryCommit,receiptKey,LUA};
