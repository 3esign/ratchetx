import assert from 'node:assert/strict';
import {runSmoke,parseArgs,canonical,URLS} from '../skills/ratchetx/scripts/session-smoke.mjs';

// Pure fake HTTP, monotonic clock and journal. This file never uses real fetch,
// env credentials, filesystem journal writes, a game backend, or chain access.
const wallet='1'.repeat(32),sessionId='a'.repeat(32),requestId='b'.repeat(32),shotId='c'.repeat(12);
const token=`rxp1.${wallet}.${sessionId}.${'d'.repeat(64)}`;
const clone=value=>structuredClone(value);
function fixture(config={}){
  let elapsed=0,serverJump=0,shots=0,statusCalls=0,record=null,shot=null;
  const epoch=Date.UTC(2026,7,30,15,18,7),expiresAt=epoch+(config.lifeMs??1800000);
  const calls=[],events=[],entries=[];
  const now=()=>elapsed,server=()=>epoch+elapsed+serverJump;
  const bounds={maxAttempts:config.maxAttempts??1,maxStakeCredits:500,maxGrossCredits:500,minIntervalMs:60000};
  const opts={mode:'execute',wallet,sessionId,target:'H496695Q0',side:'YES',p:0.55,maxWaitMs:1260000};
  const env={RATCHET_PLAY_SESSION:token};
  const journal={
    async create(value){if(config.createFail||entries.length)throw new Error(token);entries.push(clone(value));},
    async append(value){if(config.appendFail)throw new Error(token);entries.push(clone(value));},
    async read(){if(config.readFail)throw new Error(token);return clone(entries);},async close(){},
  };
  const reply=(body,status=200,url=URLS.session,extra={})=>({status,url,redirected:false,
    headers:{get(name){return name==='date'?new Date(server()).toUTCString():null;}},
    async text(){return JSON.stringify(body);},...extra});
  function accept(intent){
    record={intent:clone(intent),intentHash:'e'.repeat(64),stake:100,state:'accepted',reservedAt:server(),finishedAt:server(),result:{state:'accepted',shotId}};
    shot={id:shotId,requestId:`session:${sessionId}:${intent.requestId}`,stake:100,exp:server()+300000,feed:'PUMP'};
  }
  function player(){
    const base={wallet:config.statusWallet??wallet,credits:1000,stated:0,brier:null,brierIndex:null,calibration:null,open:[],closed:[]};
    if(config.existingOpen)base.open=[{id:'f'.repeat(12)}];
    if(!shot)return base;
    base.credits=900;
    if(!config.forever&&server()>=shot.exp){
      const res=config.outcome??'hit',loss=(0.55-(res==='hit'?1:0))**2;
      base.closed=[{...shot,res,side:'YES',sp:0.55,settledAt:server(),...(res==='hit'?{back:170}:{})}];
      base.credits=res==='hit'?1070:res==='void'?1000:900;
      base.stated=res==='void'?0:1;base.brier=res==='void'?null:+loss.toFixed(4);
      if(config.badBrier)base.brier=0.9999;
      if(config.extraClosed)base.closed.push({id:'f'.repeat(12)});
    }else base.open=[clone(shot)];
    if(config.concurrentCredits)base.credits++;
    return base;
  }
  async function fetcher(url,options){
    calls.push({url,options:clone({...options,signal:undefined})});
    assert.ok(Object.values(URLS).includes(url));assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');
    const body=options.body?JSON.parse(options.body):null;
    if(body){assert.equal(url,URLS.session);assert.equal(options.headers.Authorization,'Bearer '+token);assert.ok(['status','shot'].includes(body.op));}
    else assert.equal(options.headers.Authorization,undefined);
    if(config.redirect)return reply({},302,url,{redirected:config.redirect==='followed',url:config.redirect==='followed'?'https://evil.invalid':url});
    if(config.missingDate)return reply({},200,url,{headers:{get(){return null;}}});
    if(url===URLS.session&&!body)return reply({ok:true,v:'h103-test',enabled:true,network:config.network??'solana:mainnet',
      rights:['shot','status'],requiresExistingAdmittedAgent:true,endpoint:URLS.session,budgetRule:'gross-reserved-attempts-v1',
      agentContract:{shot:{replay:'same intent replays receipt',rejected:'HTTP 200 can remain rejected'}}},200,url);
    if(url===URLS.context)return reply({ok:true,v:'h103-test',schema:'ratchetx-pyth-context-v1',generatedAt:server()-(config.contextLag??0),
      access:{mode:'shared-read'},validation:{fullVerificationRequired:true,ownerFeedIdAndDiscriminatorChecked:true,maxConfidenceBps:200},
      feeds:[{feed:'PUMP',status:'current-thin-window',current:{price:1,ageNowS:config.age??1,confidenceBps:config.conf??1,
        publishTime:Math.floor(server()/1000)-(config.age??1),prevPublishTime:Math.floor(server()/1000)-61},
      activeTargets:[{id:'H496695Q0',horizonMinutes:5}]}]},200,url);
    if(url===URLS.board)return reply({ok:true,v:config.release??'h103-test',prices:{src:'pyth-onchain'},flipsAt:server()+3600000,
      stakeRule:{min:100,max:1000000000,hitPayout:1.7},targets:[{id:'H496695Q0',kind:'dir',feed:'PUMP',feed2:null,mins:config.mins??5}]},200,url);
    if(body.op==='status'){
      statusCalls++;
      if(config.revoked)return reply({ok:false,code:'SESSION_REVOKED'},401);
      if(config.expireDuringWait&&statusCalls===3)serverJump=3600000;
      if(server()>=expiresAt)return reply({ok:false,code:'SESSION_EXPIRED'},401);
      return reply({ok:true,session:{wallet,id:config.statusSession??sessionId,expiresAt,revokedAt:null,expired:false,limits:bounds,
        budgetRule:'gross-reserved-attempts-v1',attempts:record?1:config.used?1:0,grossCredits:record?100:config.used?100:0,
        pending:record?.state==='reserved'?requestId:null,requests:record?{[requestId]:clone(record)}:{}},player:player()});
    }
    shots++;
    assert.equal(body.intent.stake,100);
    assert.ok(entries[0]?.kind==='start','journal must exist before the first shot');
    if(shots===1){
      if(config.submitRefused){record={intent:clone(body.intent),stake:100,state:'rejected',result:{state:'rejected',code:'ORACLE_STALE'}};
        return reply({ok:false,code:'SHOT_REFUSED',request:clone(record)},409);}
      if(config.submitReserved){record={intent:clone(body.intent),stake:100,state:'reserved'};return reply({ok:false,code:'ATTEMPT_UNRESOLVED'},202);}
      accept(body.intent);
      if(config.submitUnknown)throw new Error('provider leaked '+token);
      if(config.submitBadJson)return reply({},200,url,{async text(){return '{truncated:'+token;}});
      if(config.submitMissingDate)return reply({},200,url,{headers:{get(){return null;}}});
      return reply({ok:true,request:clone(record),...(config.omitCredits?{}:{credits:config.wrongSubmitCredits?999:900})});
    }
    assert.equal(shots,2,'runner may never send a third shot wire request');
    const prior=calls[calls.length-2];assert.equal(prior.options.body,options.body,'replay must be immediate and byte identical');
    if(config.replayUnknown)throw new Error(token);
    if(config.replayBadJson)return reply({},200,url,{async text(){return '{truncated:'+token;}});
    if(config.replayMissingDate)return reply({},200,url,{headers:{get(){return null;}}});
    const retained=clone(record);if(config.alteredReplay)retained.result.shotId='f'.repeat(12);
    const reordered=Object.fromEntries(Object.entries(retained).reverse());
    return reply({ok:true,idempotent:!config.noIdempotent,request:reordered});
  }
  const deps={fetch:fetcher,now,sleep:async ms=>{assert.ok(ms>0&&ms<=30000);elapsed+=ms;},journal,
    randomId:()=>requestId,env,onEvent:e=>events.push(e)};
  return {opts,deps,calls,entries,events,shots:()=>shots,statusCalls:()=>statusCalls,advance:ms=>{elapsed+=ms;},
    async run(options=opts){const result=await runSmoke(options,deps);assert.ok(!JSON.stringify({result,entries,events}).includes(token),'no secret in output or journal');return result;}};
}
for(const outcome of ['hit','miss','void']){
  const f=fixture({outcome}),r=await f.run();assert.equal(r.code,'PASS_'+outcome.toUpperCase());assert.equal(r.ok,true);
  assert.equal(f.shots(),2);assert.equal(r.immediateWireReplayVerified,true);assert.equal(r.debitObserved,true);
  assert.match(r.proofUrl,/\/api\/shot\?w=1+&id=c+/);assert.match(r.reportUrl,/\/api\/agent\?id=1+/);
  assert.equal(r.statedAfter,outcome==='void'?0:1);assert.equal(r.squaredError,outcome==='void'?null:(0.55-(outcome==='hit'?1:0))**2);
}
assert.equal((await fixture({omitCredits:true}).run()).code,'PASS_HIT','status can prove debit when accepted body omits credits');
for(const [config,code] of [
  [{age:46},'ORACLE_STALE'],[{conf:201},'ORACLE_CONFIDENCE_TOO_WIDE'],[{conf:-1},'ORACLE_CONFIDENCE_TOO_WIDE'],
  [{contextLag:60000},'ORACLE_STALE'],[{mins:60},'TARGET_NOT_FIVE_MINUTES'],[{lifeMs:21*60000},'INSUFFICIENT_SESSION_LIFETIME'],
  [{lifeMs:-1},'SESSION_EXPIRED'],[{maxAttempts:2},'INVALID_SESSION'],[{used:true},'GRANT_ALREADY_USED'],
  [{network:'solana:devnet'},'CONTRACT_REFUSED'],[{statusWallet:'2'.repeat(32)},'STATUS_IDENTITY_MISMATCH'],
  [{statusSession:'e'.repeat(32)},'STATUS_IDENTITY_MISMATCH'],[{revoked:true},'SESSION_REVOKED'],
  [{existingOpen:true},'EXISTING_OPEN_SHOTS'],[{createFail:true},'JOURNAL_CREATE_FAILED'],
  [{redirect:'raw'},'REDIRECT_REFUSED'],[{redirect:'followed'},'REDIRECT_REFUSED'],[{missingDate:true},'SERVER_DATE_REQUIRED'],
  [{release:'other-build'},'RELEASE_MISMATCH'],
]){const f=fixture(config),r=await f.run();assert.equal(r.code,code);assert.equal(f.shots(),0,code+' cannot dispatch');}
for(const opts of [{mode:'demo'},{wallet:'2'.repeat(32)},{sessionId:'e'.repeat(32)},{mode:'resume'}]){
  const f=fixture(),r=await f.run({...f.opts,...opts});assert.equal(r.ok,false);assert.equal(f.shots(),0);}
{const f=fixture();delete f.deps.env.RATCHET_PLAY_SESSION;assert.equal((await f.run()).code,'MISSING_OR_INVALID_CAPABILITY');assert.equal(f.calls.length,0);}
for(const [config,code,count] of [
  [{submitRefused:true},'ORACLE_STALE',1],[{submitReserved:true},'SUBMIT_UNRESOLVED',1],
  [{submitUnknown:true},'TRANSPORT_UNCERTAIN',1],[{replayUnknown:true},'TRANSPORT_UNCERTAIN',2],
  [{alteredReplay:true},'REPLAY_UNVERIFIED',2],[{noIdempotent:true},'REPLAY_UNVERIFIED',2],
  [{appendFail:true},'JOURNAL_WRITE_FAILED',2],[{concurrentCredits:true},'CONCURRENT_ACCOUNTING_CHANGE',2],
  [{wrongSubmitCredits:true},'CONCURRENT_ACCOUNTING_CHANGE',2],[{badBrier:true},'BRIER_ACCOUNTING_CHANGED',2],
  [{extraClosed:true},'CONCURRENT_ACTIVITY',2],[{expireDuringWait:true},'SESSION_EXPIRED',2],
]){const f=fixture(config),r=await f.run();assert.equal(r.code,code);assert.equal(f.shots(),count);assert.ok(f.entries.length>=1);}
for(const [config,code,count] of [
  [{submitBadJson:true},'INVALID_RESPONSE',1],[{submitMissingDate:true},'SERVER_DATE_REQUIRED',1],
  [{replayBadJson:true},'INVALID_RESPONSE',2],[{replayMissingDate:true},'SERVER_DATE_REQUIRED',2],
]){const f=fixture(config),r=await f.run();assert.equal(r.code,code);assert.equal(r.category,'PENDING');
  assert.equal(r.journalRetained,true);assert.equal(r.immediateWireReplayVerified,false);assert.equal(f.shots(),count);}
{const f=fixture({concurrentCredits:true}),r=await f.run();assert.equal(r.ok,false);assert.equal(r.immediateWireReplayVerified,true);}
// Timeout/restart can only poll status. A retained immediate replay permits a
// complete result; an uncertain wire exchange never becomes a claimed PASS.
for(const config of [{},{submitUnknown:true},{replayUnknown:true},{alteredReplay:true},{submitReserved:true},{submitRefused:true}]){
  const f=fixture(config),first=await f.run({...f.opts,maxWaitMs:20000});assert.equal(first.ok,false);
  const sent=f.shots();f.advance(300000);
  const resumed=await f.run({mode:'resume',wallet,sessionId,maxWaitMs:20000});assert.equal(f.shots(),sent);
  assert.equal(resumed.code,config.submitRefused?'ORACLE_STALE':config.submitReserved?'ATTEMPT_RESERVED':
    Object.keys(config).length?'SETTLED_WITHOUT_COMPLETE_WIRE_EVIDENCE':'PASS_HIT');
  const restart=await f.run();assert.equal(restart.ok,false);assert.equal(f.shots(),sent,'execute restart never creates a new shot');
}
{const f=fixture();f.entries.push({kind:'start'});assert.equal((await f.run()).code,'JOURNAL_CREATE_FAILED');assert.equal(f.shots(),0);}
assert.throws(()=>parseArgs(['--execute','--resume','--journal','x']));
assert.throws(()=>parseArgs(['--execute','--journal','x','--token',token]));
assert.throws(()=>parseArgs(['--resume','--journal','x','--target','H1Q0']));
assert.throws(()=>parseArgs(['--journal','x']));
assert.throws(()=>parseArgs(['--execute','--journal','x','--stake','500']));
assert.equal(parseArgs(['--execute','--journal','x','--wallet',wallet,'--session-id',sessionId,'--target','H496695Q0','--side','YES','--p','0.55']).options.p,0.55);
assert.equal(canonical({b:1,a:{d:2,c:3}}),canonical({a:{c:3,d:2},b:1}));
console.log('Session smoke runner PASS: offline wire-order, protected transport, durable intent, refusal/ambiguity/restart, HIT/MISS/VOID, expiry and accounting guards');
