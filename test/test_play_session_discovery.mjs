import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
for(const key of ['SUPABASE_URL','SUPABASE_SERVICE_KEY','SUPABASE_SERVICE_ROLE_KEY','KV_REST_API_URL',
  'KV_REST_API_TOKEN','UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN','SOLANA_RPC','SOLANA_RPC_URL'])delete process.env[key];
const require=createRequire(import.meta.url),originalNow=Date.now,originalFetch=globalThis.fetch;
let time=Date.UTC(2026,7,30,18),network=0,audit=false,failRead=false,operations=[];
Date.now=()=>time;globalThis.fetch=async()=>{network++;throw new Error('discovery fixture forbids network');};
globalThis.__ratchet_mem=new Map();
const kv=require('../lib/kv.js');assert.equal(kv.backend,'memory');
const backend=kv.backend,durable=kv.durable,originals={};
for(const [name,fn] of Object.entries(kv))if(typeof fn==='function'){
  originals[name]=fn;kv[name]=(...args)=>{
    if(audit){operations.push({name,key:args[0]});assert.equal(name,'getJSONStrict','discovery may only read one exact key');
      if(failRead)throw new Error('synthetic-private-provider-error');}
    return fn(...args);
  };
}
const sessions=require('../lib/play_session.js'),bridge=require('../lib/play_session_game.js'),game=require('../api/game.js');
const id=n=>n.toString(16).padStart(32,'0');let sequence=0;
function owner(){
  const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519');
  const bytes=publicKey.export({format:'der',type:'spki'}).subarray(12),alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n=BigInt('0x'+bytes.toString('hex')),wallet='';while(n){wallet=alphabet[Number(n%58n)]+wallet;n/=58n;}
  for(const byte of bytes){if(byte)break;wallet='1'+wallet;}
  return {wallet,sign:payload=>crypto.sign(null,Buffer.from(payload),privateKey).toString('base64')};
}
async function install(f){
  const token=`rxp1.${f.wallet}.${id(++sequence)}.${crypto.randomBytes(32).toString('hex')}`;
  const grant=sessions.canonicalGrant({wallet:f.wallet,id:id(sequence),issuedAt:time,expiresAt:time+3600000,
    tokenHash:crypto.createHash('sha256').update(token).digest('hex'),
    limits:{maxAttempts:3,maxStakeCredits:500,maxGrossCredits:1500,minIntervalMs:30000}},time);
  const payload=JSON.stringify(grant);await bridge.service.grant(payload,f.sign(payload));return {token,grant};
}
function body(f,overrides={}){
  const command=sessions.canonicalDiscovery({wallet:f.wallet,issuedAt:time,nonce:id(999)},time);
  const payload=JSON.stringify({...command,...overrides});return {op:'owner-discover',payload,signature:f.sign(payload)};
}
async function invoke(request,headers={},method='POST'){
  let status=200,output;const responseHeaders={};
  await game({method,query:{action:'play-session'},body:request,
    headers:{'content-type':'application/json','x-forwarded-for':'discovery-fixture',...headers},socket:{}},
    {setHeader(k,v){responseHeaders[k.toLowerCase()]=v;},status(n){status=n;return this;},json(v){output=v;return v;},end(){}});
  return {status,body:output,headers:responseHeaders};
}
async function lookup(f,request=body(f),headers={},reads=1){
  const before=[...globalThis.__ratchet_mem.entries()];operations=[];audit=true;
  let result;try{result=await invoke(request,headers);}finally{audit=false;}
  assert.deepEqual([...globalThis.__ratchet_mem.entries()],before,'lookup cannot mutate sessions, players, leases, nonce or credit queues');
  assert.deepEqual(operations,Array.from({length:reads},()=>({name:'getJSONStrict',key:'play-session:v1:'+f.wallet})));
  assert.equal(result.headers['cache-control'],'no-store, private');assert.equal(result.headers.pragma,'no-cache');
  assert.equal(result.headers['referrer-policy'],'no-referrer');
  assert.ok(!JSON.stringify(result).includes('synthetic-private-provider-error'));
  return result;
}
try{
  // Gate metadata only; every read/write remains in memory. The gate asks for
  // durability now rather than for a vendor's name, so open it that way.
  kv.backend='supabase';kv.durable=true;
  const a=owner(),b=owner(),empty=await lookup(a);
  assert.deepEqual(empty.body,{ok:true,readOnly:true,discovery:'latest-retained-session-v1',wallet:a.wallet,
    nonce:id(999),observedAt:time,session:null});
  assert.equal(await originals.getJSONStrict('u:'+a.wallet),null,'no player or admission required for owner lookup');
  const discovery=await invoke(undefined,{},'GET');
  assert.deepEqual(discovery.body.rights,['shot','status']);
  assert.equal(discovery.body.ownerDiscovery.op,'owner-discover');assert.equal(discovery.body.ownerDiscovery.readOnly,true);
  assert.equal(discovery.body.ownerDiscovery.requiresSessionId,false);assert.equal(discovery.body.ownerDiscovery.requiresBearer,false);
  const canonical=sessions.canonicalDiscovery({wallet:a.wallet,issuedAt:time,nonce:id(999)},time);
  assert.equal(JSON.stringify(canonical),`{"domain":"ratchetx.xyz","network":"solana:mainnet","version":"play-session-v1","action":"owner_discover","wallet":"${a.wallet}","issuedAt":${time},"nonce":"${id(999)}"}`);
  for(const change of [{domain:'attacker.invalid'},{network:'solana:devnet'},{version:'other'},
    {action:'revoke'},{id:id(1)},{requestId:id(1)},{nonce:'bad'},{issuedAt:time-300001},{issuedAt:time+5001}]){
    const result=await lookup(a,body(a,change),{},0);assert.equal(result.status,401);assert.equal(result.body.ok,false);
  }
  const wrong=body(a);wrong.signature=b.sign(wrong.payload);
  assert.equal((await lookup(a,wrong,{},0)).body.code,'INVALID_SIGNATURE');
  assert.equal((await lookup(a,body(a),{authorization:'Bearer private-fixture'},0)).body.code,'INVALID_CAPABILITY');
  assert.equal((await lookup(a,body(a),{authorization:''},0)).body.code,'INVALID_CAPABILITY');
  assert.equal((await lookup(a,body(a),{origin:'https://attacker.invalid'},0)).status,403);
  assert.equal((await lookup(a,{...body(a),wallet:a.wallet},{},0)).body.code,'SCOPE_REFUSED');
  const scope=body(a);scope.op='recover';assert.equal((await lookup(a,scope,{},0)).body.code,'INVALID_OWNER_COMMAND');
  const command=bridge.service.verifyOwner(body(a).payload,body(a).signature,'owner_discover');
  await assert.rejects(bridge.service.ownerDiscover({...command}),e=>e.code==='INVALID_OWNER_COMMAND');
  await assert.rejects(bridge.service.ownerStatus(command),e=>e.code==='INVALID_OWNER_COMMAND');
  let grant=await install(a);
  const sameRequest=body(a),first=await lookup(a,sameRequest);
  assert.equal(first.body.session.id,grant.grant.id);assert.equal(first.body.session.expired,false);
  assert.deepEqual((await lookup(a,sameRequest)).body,first.body,'fresh nonce/signature is repeatable and never consumed');
  time++;grant=await install(a);
  assert.equal((await lookup(a,sameRequest)).body.session.id,grant.grant.id,'same fresh signed lookup rereads latest replacement, not a cached old grant');
  const intent={requestId:id(555),target:'H496695Q0',side:'YES',p:0.55,stake:100};
  const authorized=await bridge.service.authorize(grant.token,intent);
  let result=await lookup(a);assert.equal(result.body.session.pending,intent.requestId);
  assert.deepEqual(result.body.session.requests[intent.requestId].intent,intent);
  const raw=await originals.getJSONStrict('play-session:v1:'+a.wallet);
  const encoded=JSON.stringify(result);
  for(const secret of [grant.token,grant.grant.tokenHash,raw.revision,raw.requests[intent.requestId].intentHash])assert.ok(!encoded.includes(secret));
  const revoke=JSON.stringify(sessions.canonicalRevoke({wallet:a.wallet,id:grant.grant.id,issuedAt:time},time));
  await bridge.service.revoke(revoke,a.sign(revoke));
  result=await lookup(a);assert.equal(result.body.session.revokedAt,time);assert.equal(result.body.session.pending,intent.requestId);
  time=grant.grant.expiresAt+1;result=await lookup(a);assert.equal(result.body.session.expired,true);
  assert.equal(result.body.session.pending,intent.requestId,'expiry/revoke must preserve recovery context');
  await bridge.service.finish(authorized.permit,{state:'rejected',code:'RECOVERED_NO_DISPATCH'});
  result=await lookup(a);assert.equal(result.body.session.pending,null);
  assert.deepEqual(result.body.session.requests[intent.requestId].result,{state:'rejected',code:'RECOVERED_NO_DISPATCH'});
  failRead=true;result=await lookup(a);failRead=false;assert.equal(result.status,503);assert.equal(result.body.code,'SESSION_UNAVAILABLE');
  const key='play-session:v1:'+a.wallet,retained=await originals.getJSONStrict(key);
  for(const malformed of [false,0,[],{...retained,grant:{...retained.grant,wallet:b.wallet}},
    {...retained,requests:[]},{...retained,grossCredits:101}]){
    await originals.setJSON(key,malformed);result=await lookup(a);assert.equal(result.status,503);assert.equal(result.body.code,'SESSION_UNAVAILABLE');
  }
  await originals.setJSON(key,retained);
  assert.equal(network,0);
  console.log('Owner discovery PASS: exact signed bytes, latest/null, expiry/revoke/pending, no bearer/hash exposure, strict errors and zero KV/player/settlement writes');
}finally{audit=false;Object.assign(kv,originals);kv.backend=backend;kv.durable=durable;Date.now=originalNow;globalThis.fetch=originalFetch;}
