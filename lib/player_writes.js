'use strict';
const {AsyncLocalStorage}=require('node:async_hooks');
const crypto=require('node:crypto');
const kv=require('./kv.js');
const context=new AsyncLocalStorage();
const snapshots=new WeakMap();
const clone=v=>JSON.parse(JSON.stringify(v));
function run(fn){return context.run(new Map(),fn);}
function lease(key,token,seconds){context.getStore()?.set(key,{key,token,expiresAt:Number(token.split('-')[0])+seconds*1000});}
function limitLease(key,expiresAt){
  const owned=context.getStore()?.get(key);
  if(!owned||!Number.isSafeInteger(expiresAt))throw Object.assign(new Error('owned lease required'),{code:'WRITE_LEASE_EXPIRED'});
  owned.expiresAt=Math.min(owned.expiresAt,expiresAt);
}
function track(p,expected){snapshots.set(p,{expected:clone(expected),debits:[]});}
function creditSnapshot(p,amounts){
  const m=snapshots.get(p);
  if(!m) throw new Error('untracked player');
  m.debits=['pend:','c7:','cs7:'].map((prefix,i)=>{
    const amount=amounts[i]==null?0:Number(amounts[i]);
    if(!Number.isFinite(amount)||amount<0)throw new Error('invalid credit queue');
    return [prefix+p.w,amount];
  }).filter(([,amount])=>amount>0);
}
function record(p){
  const q={...p,_writeGuard:1};
  for(const key of ['_existed','_src','_drained','_drained7','_drainedSelf7'])delete q[key];
  return q;
}
async function save(players,extras=[]){
  const locks=context.getStore();
  const entries=[],debits=[],leases=[];
  for(const p of players){
    const m=snapshots.get(p),l=locks?.get('lock:u:'+p.w);
    if(!m||!l)throw Object.assign(new Error('player write has no owned lease'),{code:'WRITE_LEASE_EXPIRED'});
    entries.push({key:'u:'+p.w,expected:m.expected,value:record(p)});
    debits.push(...m.debits);leases.push(l);
  }
  for(const e of extras){entries.push(e);}
  if(extras.some(e=>e.key==='g:chal')){
    const l=locks?.get('lock:g:chal');
    if(!l)throw new Error('challenge write has no owned lease');leases.push(l);
  }
  const tx={id:crypto.randomBytes(16).toString('hex'),entries,debits,leases};
  // Retrying THIS exact transaction is safe even if the first acknowledgement
  // was lost: its durable receipt is checked before any queue can be consumed.
  let result;
  for(let i=0;i<2;i++){
    try{result=await kv.commitGuarded(tx);break;}
    catch(e){if(i===1)throw e;}
  }
  if(!result?.ok)throw Object.assign(new Error('player state changed; retry the same request'),{code:result?.code||'WRITE_UNAVAILABLE'});
  players.forEach((p,i)=>{
    snapshots.set(p,{expected:clone(entries[i].value),debits:[]});
    p._writeGuard=1;
    delete p._drained;delete p._drained7;delete p._drainedSelf7;
  });
  return result;
}
module.exports={run,lease,limitLease,track,creditSnapshot,record,save};
