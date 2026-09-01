import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {runPlay,parseArgs,commandRequestId,canonical,URLS} from '../skills/ratchetx/scripts/session-play.mjs';

// Pure fake HTTP/clock/journals. No real network, keys, game state or files.
const wallet='1'.repeat(32),sessionId='a'.repeat(32),commandId='1234567890123456789';
const token=`rxp1.${wallet}.${sessionId}.${'d'.repeat(64)}`,clone=value=>structuredClone(value);
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const normalized=i=>({requestId:i.requestId,target:i.target,side:i.side,p:i.p,stake:i.stake});
function fixture(config={}){
  let elapsed=0,shotCalls=0,statusCalls=0,accepted=0;
  const epoch=Date.UTC(2026,7,30,15,18,7),expiresAt=epoch+(config.lifeMs??3600000);
  const records={},shots={},calls=[],events=[],journals=[];
  const server=()=>epoch+Math.floor(elapsed),limits={maxAttempts:3,maxStakeCredits:500,maxGrossCredits:1000,minIntervalMs:60000,...config.limits};
  const opts={mode:'execute',wallet,sessionId,commandId,target:'H496695Q0',side:'YES',p:0.55,maxWaitMs:1260000,waitSettle:true};
  function memoryJournal(){
    const entries=[];
    const j={entries,async create(value){if(config.createFail||entries.length)throw new Error(token);entries.push(clone(value));},
      async append(value){if(config.appendFail)throw new Error(token);entries.push(clone(value));},
      async read(){if(config.readFail)throw new Error(token);return clone(entries);},async close(){}};
    journals.push(j);return j;
  }
  function receipt(intent,state='accepted',when=server()){
    const r={intent:clone(intent),intentHash:digest(normalized(intent)),stake:intent.stake,state,reservedAt:when};
    if(state!=='reserved'){r.finishedAt=when;r.result=state==='accepted'?{state,shotId:(++accepted).toString(16).padStart(12,'0')}:{state,code:'ORACLE_STALE'};}
    return r;
  }
  if(config.prior){
    const intent={requestId:'b'.repeat(32),target:'H496694Q0',side:'NO',p:0.6,stake:100};
    records[intent.requestId]=receipt(intent,config.pending?'reserved':'rejected',server()-(config.priorAge??60000));
  }
  function player(){
    const p={wallet:config.statusWallet??wallet,credits:1000,stated:0,brier:null,open:[],closed:[]};let losses=0;
    for(const shot of Object.values(shots)){
      p.credits-=shot.stake;
      if(!config.forever&&server()>=shot.exp){
        const res=config.outcome??'hit',win=res==='hit',voided=res==='void';
        p.credits+=win?Math.floor(shot.stake*1.7):voided?shot.stake:0;
        if(!voided){p.stated++;losses+=(shot.sp-(win?1:0))**2;}
        p.closed.unshift({...clone(shot),res,settledAt:shot.exp,...(win?{back:Math.floor(shot.stake*1.7)}:{})});
      }else{const {sp,side,...open}=shot;p.open.push(clone(open));}
    }
    p.closed=p.closed.slice(0,20);p.brier=p.stated?+(losses/p.stated).toFixed(4):null;
    if(config.existingOpen)p.open.push({id:'existing',exp:server()+300000});
    if(config.badOpenExpiry)p.open=[{id:'existing',exp:token}];
    if(config.concurrentCredits&&Object.keys(shots).length)p.credits++;
    if(config.badBrier&&p.stated)p.brier=0.9999;
    if(config.extraClosed&&p.stated)p.closed.push({id:'otherold'});
    return p;
  }
  const reply=(value,status=200,url=URLS.session,extra={})=>({status,url,redirected:false,
    headers:{get:name=>name==='date'?new Date(server()).toUTCString():null},
    async text(){if(config.fractionalClock)elapsed+=0.125;return JSON.stringify(value);},...extra});
  async function fetcher(url,options){
    calls.push({url,options:clone({...options,signal:undefined})});
    assert.ok(Object.values(URLS).includes(url));assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');
    const body=options.body?JSON.parse(options.body):null;
    if(body){assert.equal(url,URLS.session);assert.equal(options.headers.Authorization,'Bearer '+token);assert.ok(['status','shot'].includes(body.op));}
    else assert.equal(options.headers.Authorization,undefined);
    if(config.redirect)return reply({},302,url);
    if(config.missingDate)return reply({},200,url,{headers:{get:()=>null}});
    if(url===URLS.session&&!body)return reply({ok:true,v:'h105-test',enabled:true,network:config.network??'solana:mainnet',
      rights:['shot','status'],requiresExistingAdmittedAgent:true,endpoint:URLS.session,budgetRule:'gross-reserved-attempts-v1',
      agentContract:{shot:{replay:'retained',rejected:'terminal'}}},200,url);
    if(url===URLS.context)return reply({ok:true,v:'h105-test',schema:'ratchetx-pyth-context-v1',generatedAt:server()-(config.contextLag??0),
      access:{mode:'shared-read'},validation:{fullVerificationRequired:true,ownerFeedIdAndDiscriminatorChecked:true,maxConfidenceBps:200},
      feeds:[{feed:'PUMP',current:{price:1,ageNowS:config.age??1,confidenceBps:config.conf??1,
        publishTime:Math.floor(server()/1000)-(config.age??1),prevPublishTime:Math.floor(server()/1000)-61},
        activeTargets:[{id:'H496695Q0',horizonMinutes:5}]}]},200,url);
    if(url===URLS.board)return reply({ok:true,v:config.release??'h105-test',prices:{src:'pyth-onchain'},flipsAt:server()+3600000,
      stakeRule:{min:100,max:1000000000,hitPayout:1.7},targets:[{id:'H496695Q0',kind:config.kind??'dir',feed:'PUMP',feed2:config.feed2??null,mins:config.mins??5}]},200,url);
    if(body.op==='status'){
      statusCalls++;
      if(config.revoked)return reply({ok:false,code:'SESSION_REVOKED'},401);
      if(server()>=expiresAt)return reply({ok:false,code:'SESSION_EXPIRED'},401);
      const pending=Object.keys(records).find(id=>records[id].state==='reserved')??null;
      return reply({ok:true,session:{wallet,id:config.statusSession??sessionId,expiresAt,revokedAt:null,expired:false,limits,
        budgetRule:'gross-reserved-attempts-v1',attempts:Object.keys(records).length,
        grossCredits:Object.values(records).reduce((n,r)=>n+r.stake,0),pending,requests:clone(records)},player:player()});
    }
    shotCalls++;
    assert.ok(journals.some(j=>j.entries[0]?.intent.requestId===body.intent.requestId),'durable intent before dispatch');
    const old=records[body.intent.requestId];
    if(old){
      const previous=calls[calls.length-2];assert.equal(previous.options.body,options.body,'immediate byte-identical replay');
      if(config.replayUnknown)throw new Error(token);
      if(config.replayBadJson)return reply({},200,url,{async text(){return '{bad:'+token;}});
      const retained=clone(old);if(config.alteredReplay)retained.result.shotId='f'.repeat(12);
      return reply({ok:true,idempotent:!config.noIdempotent,request:Object.fromEntries(Object.entries(retained).reverse())});
    }
    const state=config.submitRefused?'rejected':config.submitReserved?'reserved':'accepted',r=receipt(body.intent,state);
    records[body.intent.requestId]=r;
    if(state==='rejected')return reply({ok:false,request:clone(r)},409);
    if(state==='reserved')return reply({ok:false,code:'ATTEMPT_UNRESOLVED'},202);
    shots[body.intent.requestId]={id:r.result.shotId,requestId:`session:${sessionId}:${body.intent.requestId}`,
      stake:body.intent.stake,exp:server()+300000,side:body.intent.side,sp:body.intent.p};
    if(config.submitUnknown)throw new Error(token);
    if(config.submitBadJson)return reply({},200,url,{async text(){return '{bad:'+token;}});
    return reply({ok:true,request:clone(r),...(config.omitCredits?{}:{credits:config.wrongSubmitCredits?999:player().credits})});
  }
  const deps={fetch:fetcher,now:()=>elapsed,sleep:async ms=>{assert.ok(ms>0&&ms<=30000);elapsed+=ms;},
    journal:memoryJournal(),env:{RATCHET_PLAY_SESSION:token},onEvent:e=>events.push(e)};
  return {opts,deps,calls,events,records,shots,journals,memoryJournal,advance:ms=>{elapsed+=ms;},shotCalls:()=>shotCalls,statusCalls:()=>statusCalls,
    async run(options=opts,extra={}){const result=await runPlay(options,{...deps,...extra});
      assert.ok(!JSON.stringify({result,events,journals}).includes(token),'secret never echoed');return result;}};
}

assert.equal(commandRequestId(wallet,sessionId,commandId),commandRequestId(wallet,sessionId,commandId));
for(const inputs of [['2'.repeat(32),sessionId,commandId],[wallet,'b'.repeat(32),commandId],[wallet,sessionId,'9'.repeat(32)]])
  assert.notEqual(commandRequestId(...inputs),commandRequestId(wallet,sessionId,commandId));
assert.throws(()=>commandRequestId(wallet,sessionId,123));
assert.throws(()=>commandRequestId(wallet,sessionId,'arbitrary retry text'));
for(const outcome of ['hit','miss','void']){
  const f=fixture({outcome,prior:true}),r=await f.run();assert.equal(r.code,'PASS_'+outcome.toUpperCase());
  assert.equal(r.remainingAttempts,1);assert.equal(r.remainingGrossCredits,800);assert.equal(f.shotCalls(),2);
  assert.equal(f.statusCalls(),2,'low-usage direct-debit path only checks status before play and at expiry');
  assert.equal(r.immediateWireReplayVerified,true);assert.equal(r.debitObserved,true);assert.match(r.proofUrl,/\/api\/shot\?/);
}
{const f=fixture(),r=await f.run({...f.opts,stake:200});assert.equal(r.code,'PASS_HIT');assert.equal(r.creditsAfter,1140);}
assert.equal((await fixture({omitCredits:true}).run()).code,'PASS_HIT');
// One larger grant serves multiple distinct owner commands, never an automatic series.
{
  const f=fixture(),first=await f.run(),secondJournal=f.memoryJournal();assert.equal(first.code,'PASS_HIT');
  const second=await f.run({...f.opts,commandId:'f'.repeat(32)},{journal:secondJournal});
  assert.equal(second.code,'PASS_HIT');assert.notEqual(first.requestId,second.requestId);
  assert.equal(second.creditsBefore,1070);assert.equal(second.creditsAfter,1140);assert.equal(second.remainingAttempts,1);
  assert.equal(f.shotCalls(),4);assert.equal(Object.keys(f.records).length,2);
}
// Redelivery with a NEW journal path must not allocate another attempt; changing
// intent under the same public command ID must conflict, not derive a fresh ID.
{
  const f=fixture();await f.run();const differentPath=f.memoryJournal(),before=f.calls.length;
  const duplicate=await f.run(f.opts,{journal:differentPath});assert.equal(duplicate.code,'COMMAND_ALREADY_RECORDED');
  assert.equal(f.calls.length-before,1);assert.equal(f.shotCalls(),2);assert.equal(differentPath.entries.length,0);
  const retainedRecords=clone(f.records),retainedShots=clone(f.shots);
  for(const changes of [{side:'NO'},{p:0.52},{stake:10000},{target:'H496699Q0'}]){
    const conflictJournal=f.memoryJournal(),beforeConflict=f.calls.length;
    const conflict=await f.run({...f.opts,...changes},{journal:conflictJournal});
    assert.equal(conflict.code,'COMMAND_CONFLICT',JSON.stringify(changes));
    assert.equal(conflict.requestId,duplicate.requestId);assert.equal(f.shotCalls(),2);
    assert.equal(f.calls.length-beforeConflict,1,'conflict uses only protected status');
    assert.equal(JSON.parse(f.calls.at(-1).options.body).op,'status');
    assert.equal(conflictJournal.entries.length,0,'conflict never creates a new intent journal');
    assert.deepEqual(f.records,retainedRecords,'original request remains intact');
    assert.deepEqual(f.shots,retainedShots,'conflict neither invalidates nor creates a shot');
  }
}
// Stats require exact capability-bound owner/session but no journal or forecast.
{
  const f=fixture({prior:true}),r=await f.run({mode:'status',wallet,sessionId},{journal:undefined});
  assert.equal(r.code,'STATUS');assert.equal(r.remainingAttempts,2);assert.equal(f.calls.length,1);assert.equal(f.shotCalls(),0);
  assert.equal(f.journals[0].entries.length,0);assert.match(r.effect,/settlement/);
}
{const f=fixture({badOpenExpiry:true}),r=await f.run({mode:'status',wallet,sessionId},{journal:undefined});
  assert.equal(r.code,'INVALID_PLAYER');assert.equal(f.calls.length,1);}
for(const replacement of [undefined,'public-session-id',`rxp1.${'2'.repeat(32)}.${sessionId}.${'d'.repeat(64)}`,
  `rxp1.${wallet}.${'e'.repeat(32)}.${'d'.repeat(64)}`]){
  const f=fixture(),r=await f.run({mode:'status',wallet,sessionId},{journal:undefined,env:{RATCHET_PLAY_SESSION:replacement}});
  assert.equal(r.ok,false);assert.equal(f.calls.length,0,'invalid or mismatched bearer cannot reach transport');
}
for(const changes of [{wallet:token},{sessionId:token},{commandId:token},{commandId:undefined},{xHandle:'alice'},{side:'BUY'},{p:0.555},{stake:99}]){
  const f=fixture(),r=await f.run({...f.opts,...changes});assert.equal(r.ok,false);assert.equal(f.calls.length,0);
}
for(const [config,code] of [
  [{age:46},'ORACLE_STALE'],[{conf:201},'ORACLE_CONFIDENCE_TOO_WIDE'],[{contextLag:60000},'ORACLE_STALE'],
  [{kind:'race'},'TARGET_NOT_DIRECTIONAL'],[{feed2:'SOL'},'TARGET_NOT_DIRECTIONAL'],
  [{lifeMs:21*60000},'INSUFFICIENT_SESSION_LIFETIME'],[{lifeMs:-1},'SESSION_EXPIRED'],
  [{prior:true,limits:{maxAttempts:1}},'SESSION_BUDGET_EXHAUSTED'],[{prior:true,limits:{maxGrossCredits:100,maxStakeCredits:100}},'SESSION_BUDGET_EXHAUSTED'],
  [{prior:true,priorAge:59000},'SESSION_RATE_LIMIT'],[{prior:true,pending:true},'PRIOR_ATTEMPT_UNRESOLVED'],
  [{revoked:true},'SESSION_REVOKED'],[{statusWallet:'2'.repeat(32)},'STATUS_IDENTITY_MISMATCH'],
  [{network:'solana:devnet'},'CONTRACT_REFUSED'],[{release:'other'},'RELEASE_MISMATCH'],[{createFail:true},'JOURNAL_CREATE_FAILED'],
  [{redirect:true},'REDIRECT_REFUSED'],[{missingDate:true},'SERVER_DATE_REQUIRED'],
]){const f=fixture(config),r=await f.run();assert.equal(r.code,code);assert.equal(f.shotCalls(),0,code);}
for(const [config,code,count] of [
  [{submitRefused:true},'ORACLE_STALE',1],[{submitReserved:true},'SUBMIT_UNRESOLVED',1],
  [{submitUnknown:true},'TRANSPORT_UNCERTAIN',1],[{replayUnknown:true},'TRANSPORT_UNCERTAIN',2],
  [{submitBadJson:true},'INVALID_RESPONSE',1],[{replayBadJson:true},'INVALID_RESPONSE',2],
  [{alteredReplay:true},'REPLAY_UNVERIFIED',2],[{noIdempotent:true},'REPLAY_UNVERIFIED',2],
  [{appendFail:true},'JOURNAL_WRITE_FAILED',2],
  [{badBrier:true},'BRIER_ACCOUNTING_CHANGED',2],
]){const f=fixture(config),r=await f.run();assert.equal(r.code,code);assert.equal(f.shotCalls(),count);assert.ok(f.journals[0].entries.length);}
for(const config of [{},{submitUnknown:true},{replayUnknown:true},{submitReserved:true},{submitRefused:true}]){
  const f=fixture(config),r=await f.run({...f.opts,maxWaitMs:20000});assert.equal(r.ok,false);
  const sent=f.shotCalls();f.advance(300000);
  const resumed=await f.run({mode:'resume',wallet,sessionId,maxWaitMs:20000});assert.equal(f.shotCalls(),sent,'resume is strictly status-only');
  assert.equal(resumed.code,config.submitReserved?'ATTEMPT_RESERVED':config.submitRefused?'ORACLE_STALE':
    Object.keys(config).length?'SETTLED_WITHOUT_COMPLETE_WIRE_EVIDENCE':'PASS_HIT');
  const redelivery=await f.run(f.opts,{journal:f.memoryJournal()});assert.equal(redelivery.code,'COMMAND_ALREADY_RECORDED');
  assert.equal(f.shotCalls(),sent,'ambiguity must never allocate a fresh command/attempt');
}
{const f=fixture({fractionalClock:true});await f.run({...f.opts,maxWaitMs:20000});
  assert.ok(Number.isSafeInteger(f.journals[0].entries[0].createdAt));f.advance(300000);
  assert.equal((await f.run({mode:'resume',wallet,sessionId,maxWaitMs:20000})).code,'PASS_HIT');assert.equal(f.shotCalls(),2);}
{const f=fixture();f.journals[0].entries.push({kind:'start'});assert.equal((await f.run()).code,'JOURNAL_CREATE_FAILED');assert.equal(f.shotCalls(),0);}
for(const args of [
  ['--execute','--resume','--journal','x'],['--execute','--journal','x','--token',token],['--execute','--journal','x','--x-handle','alice'],
  ['--status','--journal','x'],['--status','--command-id',commandId],['--resume','--journal','x','--target','H1Q0'],['--journal','x'],
])assert.throws(()=>parseArgs(args));
assert.equal(parseArgs(['--status','--wallet',wallet,'--session-id',sessionId]).options.mode,'status');
assert.equal(parseArgs(['--execute','--journal','x','--wallet',wallet,'--session-id',sessionId,'--command-id',commandId,
  '--target','H496695Q0','--side','YES','--p','0.55','--stake','200']).options.stake,200);
assert.equal(canonical({b:2,a:1}),canonical({a:1,b:2}));
console.log('Session play PASS: reusable grant, one-command execution, cross-journal dedup/conflict, stats, protected identity, limits, five-minute oracle gates, immediate replay, status-only recovery and safe errors');
