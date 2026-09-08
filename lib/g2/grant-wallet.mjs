// Review one on-chain grant, sign the exact message, and retain uncertain sends.
import { createDelegateActions } from './delegate-actions.mjs';
import { DEVNET_GENESIS } from './browser-game.mjs';
const same=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
const hex=x=>Array.from(x,b=>b.toString(16).padStart(2,'0')).join('');
const exactJson=x=>JSON.stringify(x,(_,v)=>typeof v==='bigint'?v.toString():v);
const assert=(ok,message)=>{if(!ok)throw Error(message);};
const base58=data=>{const chars='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';let n=0n,out='';for(const b of data)n=(n<<8n)|BigInt(b);while(n){out=chars[Number(n%58n)]+out;n/=58n;}for(const b of data){if(b)break;out='1'+out;}return out;};
export function createGrantWallet({web3,connection,config,wallet,storage=globalThis.localStorage,cryptoImpl=globalThis.crypto,onStatus=()=>{}}){
 const actions=createDelegateActions({web3,connection,config,cryptoImpl}),plans=new WeakMap();let busy=false;
 const owner=()=>{assert(wallet?.publicKey&&typeof wallet.signTransaction==='function','Connect the owner wallet first');return new web3.PublicKey(wallet.publicKey);};
 const identity=input=>{const derived=actions.deriveGrant({...input,player:input.player||owner()});assert(derived.player.equals(owner()),'This setup belongs to a different owner wallet');return {player:derived.player.toBase58(),delegate:derived.delegate.toBase58(),grantId:hex(derived.grantId)};};
 const key=id=>'ratchetx:g2:grant:'+DEVNET_GENESIS+':'+config.economyHash+':'+config.rulesetHash+':'+id.player+':'+id.delegate+':'+id.grantId;
 const load=id=>{const raw=storage?.getItem(key(id));if(!raw)return null;const r=JSON.parse(raw);assert(r.schema===1&&r.genesis===DEVNET_GENESIS&&exactJson(r.identity)===exactJson(id),'Saved grant transaction identity mismatch');return r;};
 const save=(id,r)=>{assert(storage?.getItem&&storage?.setItem,'Local storage is required before signing');const text=exactJson(r);storage.setItem(key(id),text);assert(storage.getItem(key(id))===text,'Grant recovery record could not be saved; no transaction sent');};
 async function exclusive(work){assert(!busy,'A permission action is already in progress');busy=true;try{const locks=globalThis.navigator?.locks;if(locks)return await locks.request('ratchetx:g2:grant:'+owner(),{ifAvailable:true},async lock=>{assert(lock,'Another tab is updating this owner permission');return work();});return await work();}finally{busy=false;}}
 const boundary=async id=>{assert(owner().toBase58()===id.player,'Wallet changed; read the permission again');assert(await connection.getGenesisHash()===DEVNET_GENESIS,'RPC is not Solana devnet');};
 async function reconcileInternal(id){
  await boundary(id);let record=load(id);
  if(record?.state==='pending'){
   const status=(await connection.getSignatureStatuses([record.signature],{searchTransactionHistory:true})).value?.[0];
   const committed = status && (['confirmed','finalized'].includes(status.confirmationStatus) || status.confirmationStatus == null && status.confirmations === null);
   if(status?.err && committed){record={...record,state:'failed'};save(id,record);}
   else if(status && !status.err && committed){record={...record,state:'confirmed'};save(id,record);}
   else if(!status&&await connection.getBlockHeight('finalized')>record.lastValidBlockHeight){record={...record,state:'expired-unconfirmed'};save(id,record);}
  }
  const context=await actions.readGrant(id);return {...context,pending:record?.state==='pending',transactionRecord:record};
 }
 async function prepare(kind,input){const id=identity(input),before=await reconcileInternal(id);assert(!before.pending,'An earlier transaction is unresolved. Refresh its signature before another approval');
  const plan=await actions[kind]({...input,...id});
  const memo={identity:id,message:new Uint8Array(plan.messageBytes),bytes:new Uint8Array(plan.transactionBytes),blockhash:plan.blockhash,lastValidBlockHeight:plan.lastValidBlockHeight,grantHash:plan.grantHash,action:plan.action,limits:plan.intent.limits?JSON.parse(exactJson(plan.intent.limits)):null};
  plans.set(plan,memo);return plan;
 }
 async function approve(plan){const m=plans.get(plan);assert(m,'Review this permission before approving');await boundary(m.identity);
  const current=await reconcileInternal(m.identity);assert(!current.pending,'An earlier permission transaction is unresolved');assert(current.grantHash===m.grantHash,'Permission changed after review. Read and review it again');
  assert(same(plan.messageBytes,m.message)&&same(plan.transactionBytes,m.bytes),'The reviewed transaction was modified');
  assert(await connection.getBlockHeight('confirmed')<=m.lastValidBlockHeight,'The reviewed transaction expired. Review again');
  const storageProbe={schema:1,genesis:DEVNET_GENESIS,identity:m.identity,state:'reviewed',action:m.action};save(m.identity,storageProbe);
  onStatus({phase:'signing'});const transaction=web3.VersionedTransaction.deserialize(m.bytes),signed=await wallet.signTransaction(transaction);await boundary(m.identity);
  const signedMessageBytes = signed?.message ? signed.message.serialize() : new Uint8Array();
  assert(signed.signatures?.length===1&&signed.signatures[0]?.length===64&&signed.signatures[0].some(Boolean),'Owner signature is missing');
  const signerKey=await cryptoImpl.subtle.importKey('raw',owner().toBytes(),{name:'Ed25519'},false,['verify']);
  assert(await cryptoImpl.subtle.verify('Ed25519',signerKey,signed.signatures[0],signedMessageBytes),'Returned owner signature is invalid');
  const signature=base58(signed.signatures[0]);const record={...storageProbe,state:'pending',signature,blockhash:(signed.message.recentBlockhash || m.blockhash),lastValidBlockHeight:m.lastValidBlockHeight,limits:m.limits};save(m.identity,record);plans.delete(plan);
  try{
   onStatus({phase:'sending',signature});const actual=await connection.sendRawTransaction(signed.serialize(),{skipPreflight:false,maxRetries:2});assert(actual===signature,'RPC returned another signature');
   onStatus({phase:'confirming',signature});const confirmation=await connection.confirmTransaction({blockhash:(signed.message.recentBlockhash || m.blockhash),lastValidBlockHeight:m.lastValidBlockHeight,signature},'confirmed');assert(confirmation?.value&&confirmation.value.err===null,'Permission transaction failed');
   const result=await reconcileInternal(m.identity);assert(!result.pending&&result.transactionRecord.state==='confirmed','Confirmation is unresolved');
   if(m.action==='revoke_delegate')assert(result.grant?.revoked===1,'Revocation was not read back');
   else assert(result.grant&&result.grant.revoked===0&&Object.entries(m.limits).every(([k,v])=>String(result.grant[k])===String(v)),'Approved limits were not read back');
   onStatus({phase:'confirmed',signature});return {...result,signature};
  }catch{onStatus({phase:'unresolved',signature});throw Error('The permission transaction needs a chain check. Refresh before approving again. Saved signature: '+signature);}
 }
 return Object.freeze({actions,prepareGrant:input=>exclusive(()=>prepare('prepareGrant',input)),prepareRevoke:input=>exclusive(()=>prepare('prepareRevoke',input)),approve:plan=>exclusive(()=>approve(plan)),reconcile:input=>exclusive(()=>reconcileInternal(identity(input)))});
}
