import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';

// Public wallet/session/event IDs and claimed X identities are not authority.
// Only synthetic keys, admitted memory fixtures and stubbed prices are used.
for(const key of ['SUPABASE_URL','SUPABASE_SERVICE_KEY','SUPABASE_SERVICE_ROLE_KEY','KV_REST_API_URL',
  'KV_REST_API_TOKEN','UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN','RATCHET_MINT',
  'RATCHET_SEAL_PROGRAM_ID','RATCHET_SEAL_RPC_URL','SOLANA_RPC','SOLANA_RPC_URL'])delete process.env[key];
const require=createRequire(import.meta.url),originalFetch=globalThis.fetch,originalNow=Date.now;
const time=Date.UTC(2026,7,30,18);let networkAttempts=0;
Date.now=()=>time;globalThis.fetch=async()=>{networkAttempts++;throw new Error('identity fixture forbids network');};
globalThis.__ratchet_mem=new Map();
const kv=require('../lib/kv.js'),originalBackend=kv.backend,originalDurable=kv.durable;assert.equal(kv.backend,'memory');
const feeds=['SOL','BTC','ETH','BONK','PUMP','JUP','WIF'],pricePath=require.resolve('../lib/prices.js');
require.cache[pricePath]={id:pricePath,filename:pricePath,loaded:true,exports:{getPrices:async()=>({src:'pyth-onchain',
  ...Object.fromEntries(feeds.map(f=>[f,100])),ages:Object.fromEntries(feeds.map(f=>[f,0])),
  confs:Object.fromEntries(feeds.map(f=>[f,1])),pubs:Object.fromEntries(feeds.map(f=>[f,time/1000])),
  prevPubs:Object.fromEntries(feeds.map(f=>[f,time/1000-60]))})}};
require('../lib/pxlog.js').sample=async()=>false;
const sessions=require('../lib/play_session.js'),bridge=require('../lib/play_session_game.js'),game=require('../api/game.js');
const id=n=>n.toString(16).padStart(32,'0');
async function owner(n){
  const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519');
  const bytes=publicKey.export({format:'der',type:'spki'}).subarray(12),alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let value=BigInt('0x'+bytes.toString('hex')),wallet='';while(value){wallet=alphabet[Number(value%58n)]+wallet;value/=58n;}
  for(const byte of bytes){if(byte)break;wallet='1'+wallet;}
  const sessionId=id(n),token=`rxp1.${wallet}.${sessionId}.${crypto.randomBytes(32).toString('hex')}`;
  const grant=sessions.canonicalGrant({wallet,id:sessionId,issuedAt:time,expiresAt:time+1800000,
    tokenHash:crypto.createHash('sha256').update(token).digest('hex'),
    limits:{maxAttempts:3,maxStakeCredits:500,maxGrossCredits:1500,minIntervalMs:30000}},time);
  const payload=JSON.stringify(grant),signature=crypto.sign(null,Buffer.from(payload),privateKey).toString('base64');
  await bridge.service.grant(payload,signature);
  await kv.setJSON('u:'+wallet,{w:wallet,cr:1000,bal:0,granted:true,qualified:true,agent:{name:'identity fixture'},
    xp:0,streak:0,best:0,hits:0,shots:0,burned:0,day:new Date(time).toISOString().slice(0,10),open:[],closed:[]});
  return {wallet,sessionId,token};
}
async function invoke(body,headers={},query={action:'play-session'}){
  let status=200,result;
  await game({method:'POST',query,body,headers:{'content-type':'application/json','x-forwarded-for':'identity-fixture',...headers},socket:{}},
    {setHeader(){},status(n){status=n;return this;},json(value){result=value;return value;},end(){}});
  return {status,body:result};
}
try{
  // Production transport gate only; underlying KV stays memory. The gate now
  // asks for durability rather than for a vendor's name, so the fixture opens
  // it the way production does.
  kv.backend='supabase'; kv.durable=true;
  const alice=await owner(1),bob=await owner(2);
  const keys=[alice,bob].flatMap(f=>['u:'+f.wallet,'play-session:v1:'+f.wallet]);
  const snapshot=()=>Promise.all(keys.map(k=>kv.getJSONStrict(k))),before=await snapshot();
  const intent={requestId:alice.sessionId,target:`H${Math.floor(time/3600e3)}Q0`,side:'YES',p:0.55,stake:100};
  const command={op:'shot',intent},claimedX={'x-bankr-user':'alice-public-x-name','x-ratchet-owner':alice.wallet,'x-session-id':alice.sessionId};
  for(const [body,headers,query] of [
    [command,{}], [command,claimedX],
    [command,{authorization:'Bearer '+alice.wallet}], [command,{authorization:'Bearer '+alice.sessionId}],
    [command,{authorization:`Bearer rxp1.${alice.wallet}.${alice.sessionId}.${'0'.repeat(64)}`}],
    [command,{authorization:'Bearer '+bob.token.replace(bob.wallet,alice.wallet)}],
    [{...command,wallet:alice.wallet,sessionId:alice.sessionId},claimedX],
    [{...command,auth:{wallet:alice.wallet}},{authorization:'Bearer '+bob.token}],
    [{...command,token:alice.token},{}],
    [{action:'shot',auth:{wallet:alice.wallet},...intent,requestId:`session:${alice.sessionId}:${intent.requestId}`},
      {authorization:'Bearer '+bob.token,...claimedX},{}],
  ]){
    const result=await invoke(body,headers,query);
    assert.ok([400,401].includes(result.status));assert.equal(result.body.ok,false);
    assert.deepEqual(await snapshot(),before,'public IDs, forged identity and wrong-wallet token cannot spend either wallet');
    assert.ok(!JSON.stringify(result).includes(alice.token));assert.ok(!JSON.stringify(result).includes(bob.token));
  }
  // A valid Bob capability plus Alice-looking command IDs/headers still grants
  // authority only over Bob. No backend X binding is inferred or claimed.
  const accepted=await invoke(command,{authorization:'Bearer '+bob.token,...claimedX});
  assert.equal(accepted.status,200);assert.equal(accepted.body.request.state,'accepted');
  const [alicePlayer,aliceSession,bobPlayer,bobSession]=await snapshot();
  assert.deepEqual(alicePlayer,before[0]);assert.deepEqual(aliceSession,before[1]);
  assert.equal(bobPlayer.cr,900);assert.equal(bobPlayer.open.length,1);
  assert.equal(bobPlayer.open[0].requestId,`session:${bob.sessionId}:${intent.requestId}`);
  assert.equal(bobSession.attempts,1);assert.equal(bobSession.grossCredits,100);
  assert.equal(networkAttempts,0);
  console.log('Owner identity boundary PASS: public wallet/session/command IDs and claimed X headers cannot authorize; only the protected capability owner is debited (offline fixtures)');
}finally{kv.backend=originalBackend;kv.durable=originalDurable;Date.now=originalNow;globalThis.fetch=originalFetch;}
