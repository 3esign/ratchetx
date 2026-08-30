import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';

// Synthetic owners and a real memory KV implementation only. Advertising the
// Supabase backend below exercises the production HTTP gate, not a database.
for (const key of ['SUPABASE_URL','SUPABASE_SERVICE_KEY','SUPABASE_SERVICE_ROLE_KEY',
  'KV_REST_API_URL','KV_REST_API_TOKEN','UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN',
  'RATCHET_MINT','RATCHET_SEAL_PROGRAM_ID','RATCHET_SEAL_RPC_URL','SOLANA_RPC','SOLANA_RPC_URL'])
  delete process.env[key];
const require = createRequire(import.meta.url);
const originalNow = Date.now, originalFetch = globalThis.fetch;
let time = Date.UTC(2026,7,30,12), networkAttempts = 0, crossingCalls = 0, onPrices = null;
let pumpAge = 0, pumpConfidenceBps = 1, pumpProvenance = true;
Date.now = () => time;
globalThis.fetch = async () => {
  networkAttempts++;
  throw new Error('HTTP session fixture forbids external connections');
};
globalThis.__ratchet_mem = new Map();
const kv = require('../lib/kv.js');
assert.equal(kv.backend,'memory');
const originalBackend = kv.backend, originalCommit = kv.commitGuarded;
const sessions = require('../lib/play_session.js');
const {PREFIX} = require('../lib/play_session_record.js');
const feeds = ['SOL','BTC','ETH','BONK','PUMP','JUP','WIF'];
const pricePath = require.resolve('../lib/prices.js');
require.cache[pricePath] = {id:pricePath,filename:pricePath,loaded:true,exports:{
  getPrices:async()=>{
    if (onPrices) { const effect=onPrices;onPrices=null;await effect(); }
    return {src:'pyth-onchain',...Object.fromEntries(feeds.map(f=>[f,100])),
    ages:Object.fromEntries(feeds.map(f=>[f,f==='PUMP'?pumpAge:0])),
    confs:Object.fromEntries(feeds.map(f=>[f,f==='PUMP'?pumpConfidenceBps:1])),
    pubs:Object.fromEntries(feeds.map(f=>[f,f==='PUMP'&&!pumpProvenance?null:Math.floor(time/1000)])),
    prevPubs:Object.fromEntries(feeds.map(f=>[f,Math.floor(time/1000)-60]))};
  }}};
const px = require('../lib/pxlog.js');
px.sample = async () => false;
px.priceCrossing = async () => {
  crossingCalls++;
  return {price:110,publishTime:Math.floor(time/1000),prevPublishTime:Math.floor(time/1000)-60,
    confBps:1,row:{t:time,slot:123,postedSlot:120,src:'pyth-onchain'}};
};
const acceptanceWrites = [];
let refuseAcceptanceFor = null, loseAcceptanceAckFor = null;
kv.commitGuarded = async tx => {
  const entry = tx.entries.find(e=>e.key.startsWith(PREFIX)
    && Object.values(e.value.requests||{}).some(r=>r.state==='accepted'));
  if (entry) {
    acceptanceWrites.push(structuredClone(tx));
    if (entry.key === PREFIX+refuseAcceptanceFor) throw new Error('injected acceptance outage');
  }
  const result = await originalCommit(tx);
  if (entry && entry.key === PREFIX+loseAcceptanceAckFor) {
    loseAcceptanceAckFor = null;
    throw new Error('injected lost acceptance acknowledgement');
  }
  return result;
};
const game = require('../api/game.js');
const origin = 'https://ratchetx.xyz';
const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const id = n => n.toString(16).padStart(32,'0');
const hash = s => crypto.createHash('sha256').update(s).digest('hex');
function base58(bytes) {
  let n = BigInt('0x'+bytes.toString('hex')), out = '';
  while (n) { out = alphabet[Number(n%58n)]+out; n/=58n; }
  for (const byte of bytes) { if (byte) break; out='1'+out; }
  return out;
}
let sequence = 0;
function owner(limits={}) {
  const {publicKey,privateKey} = crypto.generateKeyPairSync('ed25519');
  const wallet = base58(publicKey.export({format:'der',type:'spki'}).subarray(12));
  const sessionId = id(++sequence);
  const token = `rxp1.${wallet}.${sessionId}.${crypto.randomBytes(32).toString('hex')}`;
  const sign = payload => crypto.sign(null,Buffer.from(payload),privateKey).toString('base64');
  const grant = sessions.canonicalGrant({wallet,id:sessionId,tokenHash:hash(token),issuedAt:time,
    expiresAt:time+3600000,limits:{maxAttempts:3,maxStakeCredits:500,maxGrossCredits:1500,minIntervalMs:5000,...limits}},time);
  const payload = JSON.stringify(grant);
  return {wallet,sessionId,token,sign,grant,body:{op:'grant',payload,signature:sign(payload)}};
}
async function seedPlayer(f,overrides={}) {
  const p = {w:f.wallet,cr:1000,bal:0,granted:true,qualified:true,agent:{name:'HTTP fixture'},
    xp:0,streak:0,best:0,hits:0,shots:0,burned:0,day:new Date(time).toISOString().slice(0,10),
    open:[],closed:[],...overrides};
  await kv.setJSON('u:'+f.wallet,p);
  return p;
}
async function invoke({method='POST',query={action:'play-session'},body,headers={}}={}) {
  let status=200,responseBody=null;
  const responseHeaders = {};
  await game({method,query,body,
    headers:{'content-type':'application/json','x-forwarded-for':'session-http-fixture',...headers},socket:{}},
  {setHeader(k,v){responseHeaders[k.toLowerCase()]=v;},status(n){status=n;return this;},
    json(v){responseBody=v;return v;},end(){}});
  return {status,body:responseBody,headers:responseHeaders};
}
const bearer = f => ({authorization:'Bearer '+f.token});
const player = f => kv.getJSONStrict('u:'+f.wallet);
const record = f => kv.getJSONStrict(PREFIX+f.wallet);
function safeResponse(response,f) {
  assert.equal(response.headers['cache-control'],'no-store, private');
  assert.equal(response.headers['access-control-allow-origin'],origin);
  const encoded = JSON.stringify(response);
  assert.ok(!encoded.includes(f.token),'capability must not be reflected');
  assert.ok(!encoded.includes(f.grant.tokenHash),'private verifier must not be reflected');
}
async function grant(f) {
  const result = await invoke({body:f.body,headers:{origin}});
  assert.equal(result.status,200,result.body?.code);
  assert.equal(result.body.ok,true);
  assert.equal(result.body.id,f.sessionId);
  assert.equal(await kv.getJSONStrict('lock:u:'+f.wallet),null,'grant releases its player lease');
  safeResponse(result,f);
  return result;
}
function ownerBody(f,action,requestId) {
  const canonical = action==='revoke' ? sessions.canonicalRevoke : sessions.canonicalOwner;
  const payload = JSON.stringify(canonical({action,wallet:f.wallet,id:f.sessionId,issuedAt:time,
    ...(requestId?{requestId}:{})},time));
  return {op:action==='owner_status'?'owner-status':action,payload,signature:f.sign(payload)};
}

try {
  const a = owner();
  let result = await invoke({method:'GET'});
  assert.equal(result.body.enabled,false);
  assert.equal(result.body.requiresExistingAdmittedAgent,true);
  const refusalLabels=result.body.agentContract.shot.refusalCodes;
  assert.equal(typeof refusalLabels.ORACLE_STALE,'string');
  assert.match(result.body.agentContract.shot.rejected,/HTTP 200.*rejected/);
  result = await invoke({body:a.body});
  assert.equal(result.status,503);
  assert.equal(result.body.code,'DURABLE_SESSION_STORE_REQUIRED');
  assert.equal(await record(a),null);
  kv.backend = 'supabase'; // TEST-ONLY metadata override; KV functions stay in memory.

  for (const method of ['POST','OPTIONS']) {
    result = await invoke({method,body:a.body,headers:{origin:'https://attacker.invalid'}});
    assert.equal(result.status,403);
    assert.equal(result.body.code,'ORIGIN_REFUSED');
  }
  result = await invoke({method:'OPTIONS',headers:{origin}});
  assert.equal(result.status,204);
  assert.match(result.headers['access-control-allow-headers'],/Authorization/);
  result = await invoke({body:{op:'status'}});
  assert.equal(result.status,401);
  assert.equal(result.body.code,'INVALID_CAPABILITY');
  result = await invoke({body:a.body,query:{action:'play-session',token:a.token}});
  assert.equal(result.status,400);
  assert.equal(result.body.code,'QUERY_NOT_ALLOWED');
  safeResponse(result,a);
  result = await invoke({body:a.body,headers:{'content-type':'text/plain'}});
  assert.equal(result.status,415);
  for (const body of [{op:'reload'},{op:'shot',intent:{},auth:{wallet:a.wallet}},
    {...a.body,token:a.token}]) {
    result = await invoke({body,headers:bearer(a)});
    assert.equal(result.status,400);
    assert.equal(result.body.code,'SCOPE_REFUSED');
  }

  result = await invoke({body:a.body});
  assert.equal(result.status,403);
  assert.equal(result.body.code,'AGENT_ADMISSION_REQUIRED');
  assert.equal(await player(a),null,'grant cannot create a player or credits');
  assert.equal(await record(a),null);
  const initial = await seedPlayer(a);
  const other = owner();
  result = await invoke({body:{...a.body,signature:other.sign(a.body.payload)}});
  assert.equal(result.status,401);
  assert.equal(result.body.code,'INVALID_SIGNATURE');
  assert.equal(await record(a),null);
  for (const field of ['domain','actions']) {
    const changed = structuredClone(a.grant);
    if (field==='domain') changed.domain='attacker.invalid'; else changed.actions.push('reload');
    const payload = JSON.stringify(changed);
    result = await invoke({body:{op:'grant',payload,signature:a.sign(payload)}});
    assert.equal(result.status,401);
    assert.equal(result.body.code,'NON_CANONICAL_PAYLOAD');
  }
  await grant(a);
  assert.deepEqual(await player(a),initial,'grant cannot alter existing credits');
  assert.equal((await grant(a)).body.idempotent,true);
  assert.ok(!JSON.stringify(await record(a)).includes(a.token),'only token hash is stored');
  const denied = owner();
  await seedPlayer(denied,{qualified:false});
  result = await invoke({body:denied.body});
  assert.equal(result.body.code,'AGENT_ADMISSION_REQUIRED');
  assert.equal(await record(denied),null);
  console.log('HTTP grant: Ed25519 owner consent, existing admission, origin/JSON/scope/privacy and lease release PASS');

  const board = await invoke({method:'GET',query:{action:'board'}});
  assert.equal(board.status,200);
  const target = board.body.targets.find(t=>t.kind==='dir'&&t.mins===5);
  assert.ok(target,'canonical board includes a five-minute directional target');
  const intent = {requestId:id(100),target:target.id,side:'YES',p:0.52,stake:500};
  // A token, wallet field and session-looking requestId cannot authorize the
  // generic game route: the HTTP adapter must create the private branded permit.
  result = await invoke({query:{},headers:bearer(a),body:{action:'shot',auth:{wallet:a.wallet},
    ...intent,requestId:`session:${a.sessionId}:${intent.requestId}`}});
  assert.equal(result.status,401);
  assert.deepEqual(await player(a),initial);
  loseAcceptanceAckFor = a.wallet;
  result = await invoke({body:{op:'shot',intent},headers:bearer(a)});
  assert.equal(result.status,200,result.body?.code);
  assert.equal(result.body.ok,true);
  assert.equal(result.body.request.state,'accepted');
  const accepted = result.body.request;
  let saved = await player(a), session = await record(a);
  assert.equal(saved.cr,500,'canonical accepted shot debits once despite lost ACK');
  assert.equal(saved.open.length,1);
  assert.equal(saved.open[0].id,accepted.result.shotId);
  assert.equal(saved.open[0].requestId,`session:${a.sessionId}:${intent.requestId}`);
  assert.equal(session.pending,null);
  assert.equal(session.attempts,1);
  assert.equal(session.grossCredits,500);
  assert.equal(session.requests[intent.requestId].result.shotId,saved.open[0].id);
  const aWrites = acceptanceWrites.filter(tx=>tx.entries.some(e=>e.key===PREFIX+a.wallet));
  assert.equal(aWrites.length,2,'lost ACK retries the exact guarded transaction');
  assert.equal(aWrites[0].id,aWrites[1].id);
  assert.ok(aWrites.every(tx=>tx.entries.some(e=>e.key==='u:'+a.wallet&&e.value.cr===500)
    && tx.entries.some(e=>e.key===PREFIX+a.wallet&&e.value.requests[intent.requestId].state==='accepted')),
    'player debit/shot and terminal session receipt are in the same guarded write');
  safeResponse(result,a);
  const writeCount = acceptanceWrites.length;
  result = await invoke({body:{op:'shot',intent},headers:bearer(a)});
  assert.equal(result.status,200);
  assert.equal(result.body.idempotent,true);
  assert.equal(result.body.request.result.shotId,accepted.result.shotId);
  assert.equal(acceptanceWrites.length,writeCount,'identical replay cannot redispatch');
  result = await invoke({body:{op:'shot',intent:{...intent,side:'NO'}},headers:bearer(a)});
  assert.equal(result.status,409);
  assert.equal(result.body.code,'REQUEST_CONFLICT');
  assert.equal((await player(a)).cr,500);
  assert.equal((await record(a)).attempts,1);
  console.log('Canonical HTTP shot: atomic player/session receipt, exact lost-ACK retry, unchanged replay and changed-intent refusal PASS');

  // Status resolves only the already authorized player's canonical game result.
  // Advance the test clock, never sleep or modify the saved accepted shot.
  time=saved.open[0].exp+1000;
  result = await invoke({body:{op:'status'},headers:bearer(a)});
  assert.equal(result.status,200,result.body?.code);
  assert.equal(result.body.player.open.length,0);
  assert.equal(result.body.player.closed[0].id,accepted.result.shotId);
  assert.equal(result.body.player.closed[0].res,'hit');
  assert.equal(result.body.player.credits,1350);
  assert.equal(result.body.player.stated,1);
  assert.equal(await kv.getJSONStrict('lock:u:'+a.wallet),null,'status releases its player lease');
  saved=await player(a);
  assert.equal(saved.settlementOutbox.length,0);
  assert.equal(saved.bn,1);
  assert.equal((await kv.getJSONStrict('hist:'+a.wallet)).length,1);
  assert.equal(crossingCalls,1);
  safeResponse(result,a);
  result = await invoke({body:{op:'status'},headers:bearer(a)});
  assert.equal(result.status,429,'private settlement status is throttled');
  assert.equal((await player(a)).cr,1350);
  assert.equal(crossingCalls,1);
  console.log('HTTP status: canonical deterministic settlement, drained outbox, one credit/Brier/history result and throttle PASS');

  const uncertain = owner();
  const beforeUncertain = await seedPlayer(uncertain);
  await grant(uncertain);
  const pendingIntent = {...intent,requestId:id(101)};
  refuseAcceptanceFor=uncertain.wallet;
  result = await invoke({body:{op:'shot',intent:pendingIntent},headers:bearer(uncertain)});
  assert.equal(result.status,202);
  assert.equal(result.body.code,'ATTEMPT_UNRESOLVED');
  assert.deepEqual(await player(uncertain),beforeUncertain,'failed atomic acceptance cannot debit or leave a shot');
  assert.equal((await record(uncertain)).requests[pendingIntent.requestId].state,'reserved');
  const failedWrites=acceptanceWrites.length;
  refuseAcceptanceFor=null;
  result = await invoke({body:{op:'shot',intent:pendingIntent},headers:bearer(uncertain)});
  assert.equal(result.status,200);
  assert.equal(result.body.idempotent,true);
  assert.equal(result.body.request.state,'reserved');
  assert.equal(acceptanceWrites.length,failedWrites,'ambiguous replay must never redispatch');
  result = await invoke({body:ownerBody(uncertain,'revoke')});
  assert.equal(result.status,200);
  result = await invoke({body:{op:'status'},headers:bearer(uncertain)});
  assert.equal(result.status,401);
  assert.equal(result.body.code,'SESSION_REVOKED');
  result = await invoke({body:ownerBody(uncertain,'owner_status')});
  assert.equal(result.status,200);
  assert.equal(result.body.session.pending,pendingIntent.requestId);
  result = await invoke({body:ownerBody(uncertain,'recover',pendingIntent.requestId)});
  assert.equal(result.status,200,result.body?.code);
  assert.equal(result.body.request.result.code,'RECOVERED_NO_DISPATCH');
  assert.equal(await kv.getJSONStrict('lock:u:'+uncertain.wallet),null,'recovery releases its player lease');
  assert.equal((await player(uncertain)).cr,1000);
  assert.equal((await player(uncertain)).open.length,0);
  assert.equal((await record(uncertain)).grossCredits,500,'recovery cannot replenish gross authorization');
  console.log('HTTP ambiguity: no partial debit/receipt, no redispatch, owner-only recovery after revoke PASS');

  // The authenticated session can change while status awaits canonical player
  // resolution. Do not return the stale pre-await grant after an owner revokes.
  const revoking = owner();
  await seedPlayer(revoking);
  await grant(revoking);
  onPrices=async()=>{
    const revoked=await invoke({body:ownerBody(revoking,'revoke')});
    assert.equal(revoked.status,200);
  };
  result=await invoke({body:{op:'status'},headers:bearer(revoking)});
  assert.equal(result.status,401);
  assert.equal(result.body.code,'SESSION_REVOKED','status must reread authorization after awaiting player resolution');
  assert.equal(await kv.getJSONStrict('lock:u:'+revoking.wallet),null,'failed post-resolution status releases the lease');
  safeResponse(result,revoking);
  console.log('HTTP status rereads current authorization after asynchronous canonical player resolution PASS');

  // The exact first-pilot terms are valid. Exercise the real canonical handler
  // at the five-minute oracle boundary, not only an always-fresh 500-credit shot.
  // All owners, prices and credits remain synthetic and in memory.
  time=496695*3600e3+18*60e3+7020;
  const pilotBoard=await invoke({method:'GET',query:{action:'board'}});
  const pilotTarget=pilotBoard.body.targets.find(t=>t.id==='H496695Q0');
  assert.ok(pilotTarget);
  assert.equal(pilotTarget.feed,'PUMP');
  assert.equal(pilotTarget.kind,'dir');
  assert.equal(pilotTarget.mins,5);
  const gameModule=require.cache[require.resolve('../api/game.js')];
  const originalGameExport=gameModule.exports;
  const sessionBridge=require('../lib/play_session_game.js');
  let dispatches=0, injectedRefusal=null;
  const privateDiagnostic='synthetic-secret-never-expose-this-raw-reason';
  // Observe only the adapter's recursive canonical call; invoke() still calls
  // the original outer handler. One unknown response tests safe fallback codes.
  gameModule.exports=async(req,res)=>{
    dispatches++;
    assert.deepEqual(req.query,{});
    assert.equal(sessionBridge.isVerifiedRequest(req,req.body),true);
    if(injectedRefusal)return res.status(400).json(injectedRefusal);
    return originalGameExport(req,res);
  };
  try {
    for(const fixture of [
      {name:'fresh',age:0,confidenceBps:1,state:'accepted'},
      {name:'age-boundary',age:45,confidenceBps:1,state:'accepted'},
      {name:'confidence-boundary',age:0,confidenceBps:200,state:'accepted'},
      {name:'stale',age:46,confidenceBps:1,state:'rejected',code:'ORACLE_STALE'},
      {name:'confidence',age:0,confidenceBps:201,state:'rejected',code:'ORACLE_CONFIDENCE_TOO_WIDE'},
      {name:'unknown-refusal',age:0,confidenceBps:1,state:'rejected',code:'SHOT_REFUSED',inject:true},
      {name:'missing-provenance',age:0,confidenceBps:1,state:'reserved',provenance:false},
    ]) {
      const f=owner({maxAttempts:1,maxStakeCredits:500,maxGrossCredits:500});
      const initialPlayer=await seedPlayer(f,{cr:1452042});
      await grant(f);
      pumpAge=fixture.age;
      pumpConfidenceBps=fixture.confidenceBps;
      pumpProvenance=fixture.provenance!==false;
      injectedRefusal=fixture.inject
        ? {ok:false,code:'PRIVATE_INTERNAL_DIAGNOSTIC',reason:privateDiagnostic} : null;
      const pilotIntent={requestId:id(200+sequence),target:pilotTarget.id,side:'YES',p:0.55,stake:100};
      const beforeDispatches=dispatches;
      const response=await invoke({body:{op:'shot',intent:pilotIntent},headers:bearer(f)});
      const accepted=fixture.state==='accepted';
      assert.equal(response.status,accepted?200:fixture.state==='rejected'?409:202,fixture.name);
      assert.equal(response.body.ok,accepted,fixture.name);
      if(!accepted)assert.equal(response.body.code,fixture.state==='rejected'?'SHOT_REFUSED':'ATTEMPT_UNRESOLVED');
      const stored=await record(f), savedPlayer=await player(f);
      const retained=stored.requests[pilotIntent.requestId];
      assert.equal(retained.state,fixture.state,fixture.name);
      assert.equal(stored.attempts,1);
      assert.equal(stored.grossCredits,100);
      assert.equal(stored.pending,fixture.state==='reserved'?pilotIntent.requestId:null);
      assert.equal(savedPlayer.cr,accepted?1451942:1452042);
      assert.equal(savedPlayer.open.length,accepted?1:0);
      if(accepted) {
        assert.equal(savedPlayer.open[0].stake,100);
        assert.equal(savedPlayer.open[0].sp,0.55);
        assert.equal(savedPlayer.open[0].id,retained.result.shotId);
      } else {
        assert.deepEqual(savedPlayer.open,initialPlayer.open);
        assert.deepEqual(savedPlayer.closed,initialPlayer.closed);
        for(const field of ['xp','hits','shots','bn','bsum'])
          assert.equal(savedPlayer[field]??0,initialPlayer[field]??0,fixture.name+' cannot score '+field);
      }
      if(fixture.state==='rejected') {
        assert.deepEqual(retained.result,{state:'rejected',code:fixture.code});
        assert.deepEqual(response.body.request,retained);
        assert.equal(response.body.refusal.code,fixture.code);
        assert.equal(response.body.refusal.reason,refusalLabels[fixture.code]);
        assert.match(response.body.refusal.next,/terminal/);
      } else if(fixture.state==='reserved')assert.equal(retained.result,undefined);
      safeResponse(response,f);
      const encoded=JSON.stringify({response,retained});
      assert.ok(!encoded.includes(privateDiagnostic),'raw canonical reason must not escape');
      assert.ok(!encoded.includes('PRIVATE_INTERNAL_DIAGNOSTIC'),'unknown internal code must not escape');

      // A later healthy oracle never grants another dispatch, replenishes the
      // spent authority, or converts the retained refusal into an accepted shot.
      pumpAge=0;pumpConfidenceBps=1;pumpProvenance=true;injectedRefusal=null;
      const replay=await invoke({body:{op:'shot',intent:pilotIntent},headers:bearer(f)});
      assert.equal(replay.status,200);
      assert.equal(replay.body.idempotent,true);
      assert.deepEqual(replay.body.request,retained,fixture.name+' replay preserves its exact receipt');
      assert.deepEqual(replay.body.refusal,response.body.refusal,fixture.name+' replay preserves its safe explanation');
      assert.equal(dispatches,beforeDispatches+1,fixture.name+' replay must not redispatch');
      assert.deepEqual(await player(f),savedPlayer,fixture.name+' replay cannot mutate the player');
      assert.deepEqual(await record(f),stored,fixture.name+' replay cannot replenish authority');
      safeResponse(replay,f);
    }
  } finally {
    gameModule.exports=originalGameExport;
    pumpAge=0;pumpConfidenceBps=1;pumpProvenance=true;
  }
  console.log('HTTP exact 100-credit PUMP pilot: oracle boundaries, stable refusal codes, safe fallback, unresolved 503 and no-redispatch replay PASS');
  assert.equal(networkAttempts,0,'fixture must not even attempt an external request');
} finally {
  kv.backend=originalBackend;
  kv.commitGuarded=originalCommit;
  Date.now=originalNow;
  globalThis.fetch=originalFetch;
}
console.log('Play-session HTTP integration PASS (offline synthetic signatures; real canonical game and memory commits)');
