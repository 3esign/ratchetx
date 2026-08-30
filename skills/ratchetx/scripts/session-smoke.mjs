#!/usr/bin/env node
// Owner-approved, one-shot protocol smoke test. No signer, funding, or new grant.
import {randomBytes,createHash} from 'node:crypto';
import {open} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export const ORIGIN='https://ratchetx.xyz';
export const URLS=Object.freeze({session:ORIGIN+'/api/game?action=play-session',
  board:ORIGIN+'/api/game?action=board',context:ORIGIN+'/api/game?action=pyth-context'});
const WALLET=/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, HEX32=/^[a-f0-9]{32}$/, SHOT=/^[a-f0-9]{12}$/;
const TOKEN=/^rxp1\.([1-9A-HJ-NP-Za-km-z]{32,44})\.([a-f0-9]{32})\.[a-f0-9]{64}$/;
const SCHEMA='ratchetx-session-smoke-v1', STAKE=100, MIN_ROOM=22*60000;
const REMOTE_CODES=new Set(['SESSION_EXPIRED','SESSION_REVOKED','INVALID_CAPABILITY',
  'SESSION_RATE_LIMIT','SESSION_BUDGET_EXHAUSTED','AGENT_ADMISSION_REQUIRED','PLAYER_BUSY',
  'ORACLE_STALE','ORACLE_CONFIDENCE_TOO_WIDE','FEED_UNAVAILABLE','TARGET_UNAVAILABLE',
  'CHAMBERS_FULL','INVALID_STAKE','INSUFFICIENT_CREDITS','SETTLEMENT_DELIVERY_PENDING',
  'INVALID_PROBABILITY','RATE_LIMITED','WRITE_CONFLICT','WRITE_LEASE_EXPIRED',
  'CREDIT_QUEUE_CONFLICT','SHOT_REFUSED','RECOVERED_NO_DISPATCH']);
export function canonical(value){
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
const same=(a,b)=>canonical(a)===canonical(b);
const hash=value=>createHash('sha256').update(canonical(value)).digest('hex');
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const integer=n=>Number.isSafeInteger(n)&&n>=0;
class Stop extends Error {constructor(code,category='FAILED'){super(code);this.code=code;this.category=category;}}
const stop=(code,category)=>{throw new Stop(code,category);};
const need=(condition,code)=>{if(!condition)stop(code);};
const safeCode=code=>REMOTE_CODES.has(code)?code:'SHOT_REFUSED';
function validIntent(i){return i&&HEX32.test(i.requestId)&&/^H\d+Q\d+$/.test(i.target)
  &&['YES','NO'].includes(i.side)&&finite(i.p)&&i.p>=0.01&&i.p<=0.99
  &&Math.abs(i.p*100-Math.round(i.p*100))<1e-9&&i.stake===STAKE
  &&Object.keys(i).sort().join(',')==='p,requestId,side,stake,target';}
function ids(rows){need(Array.isArray(rows)&&rows.every(s=>s&&/^[a-z0-9]{4,16}$/i.test(s.id)),'INVALID_PLAYER');
  const out=rows.map(s=>s.id);need(new Set(out).size===out.length,'INVALID_PLAYER');return out;}
function baseline(p,payout){
  need(p&&finite(p.credits)&&p.credits>=STAKE&&integer(p.stated),'INVALID_PLAYER');
  need(p.stated===0?p.brier===null:finite(p.brier)&&p.brier>=0&&p.brier<=1,'INVALID_PLAYER');
  need(Array.isArray(p.open)&&p.open.length===0,'EXISTING_OPEN_SHOTS');
  return {credits:p.credits,stated:p.stated,brier:p.brier,closedIds:ids(p.closed),hitPayout:payout};
}
function receipt(r,intent){return !!(r&&r.state==='accepted'&&r.result?.state==='accepted'
  &&SHOT.test(r.result.shotId)&&same(r.intent,intent)&&r.stake===STAKE
  &&integer(r.reservedAt)&&integer(r.finishedAt)&&r.finishedAt>=r.reservedAt);}
function limits(value){
  need(value&&value.maxAttempts===1&&integer(value.maxStakeCredits)&&value.maxStakeCredits>=100&&value.maxStakeCredits<=10000
    &&integer(value.maxGrossCredits)&&value.maxGrossCredits>=value.maxStakeCredits&&value.maxGrossCredits<=100000
    &&integer(value.minIntervalMs)&&value.minIntervalMs>=5000&&value.minIntervalMs<=600000,'INVALID_SESSION');
  return {maxAttempts:1,maxStakeCredits:value.maxStakeCredits,maxGrossCredits:value.maxGrossCredits,minIntervalMs:value.minIntervalMs};
}

// Exclusive creation and fsync precede the first shot. Keep one descriptor so
// later append operations do not follow a replaced path. Never truncate a file.
export function createFileJournal(file){
  let handle;
  return {
    async create(value){handle=await open(file,'wx',0o600);await handle.writeFile(JSON.stringify(value)+'\n');await handle.sync();},
    async read(){handle=await open(file,'r+');const stat=await handle.stat();
      if(!stat.isFile()||stat.size>65536)throw new Error('invalid journal');
      const text=await handle.readFile('utf8');return text.trim().split('\n').map(line=>JSON.parse(line));},
    async append(value){if(!handle)throw new Error('journal not open');await handle.writeFile(JSON.stringify(value)+'\n');await handle.sync();},
    async close(){if(handle)await handle.close();handle=null;},
  };
}

/** Inject fetch/monotonic clock/sleep/journal/env for entirely offline fixtures.
 * Only env.RATCHET_PLAY_SESSION supplies the capability, including in tests.
 * Output and journals are selected nonsecret fields, never provider replies.
 */
export async function runSmoke(options={},dependencies={}){
  const {fetch:fetcher=globalThis.fetch,now=()=>performance.now(),
    sleep=ms=>new Promise(r=>setTimeout(r,ms)),journal,
    randomId=()=>randomBytes(16).toString('hex'),env=process.env,onEvent=()=>{}}=dependencies;
  let phase='preflight',start,wire=null,wirePersisted=false,debit=false,shotId=null,clock=null,retained=false;
  const began=now(),maxWait=options.maxWaitMs??21*60000,pollMs=options.pollMs??10000;
  const emit=code=>{try{onEvent({phase,code});}catch{}};
  const serverNow=()=>{need(clock,'SERVER_DATE_REQUIRED');return clock.server+Math.max(0,now()-clock.local);};
  const result=(category,code,extra={})=>({ok:category==='PASS',category,code,phase,journalRetained:retained,
    immediateWireReplayVerified:!!wire&&wirePersisted,debitObserved:debit,
    ...(shotId?{shotId,proofUrl:ORIGIN+'/api/shot?w='+encodeURIComponent(options.wallet)+'&id='+shotId,
      reportUrl:ORIGIN+'/api/agent?id='+encodeURIComponent(options.wallet)}:{}),...extra});
  const save=async event=>{try{await journal.append(event);}catch{stop('JOURNAL_WRITE_FAILED');}};
  try{
    need(['execute','resume'].includes(options.mode),'EXPLICIT_MODE_REQUIRED');
    need(Object.keys(options).every(k=>['mode','wallet','sessionId','target','side','p','maxWaitMs','pollMs'].includes(k)),'INVALID_OPTIONS');
    if(options.mode==='resume')need(!['target','side','p'].some(k=>k in options),'RESUME_STATUS_ONLY');
    need(WALLET.test(options.wallet||'')&&HEX32.test(options.sessionId||''),'EXPECTED_IDENTITY_REQUIRED');
    need(integer(maxWait)&&maxWait>=5000&&maxWait<=25*60000&&integer(pollMs)&&pollMs>=5000&&pollMs<=30000,'INVALID_WAIT');
    need(journal&&typeof journal.create==='function'&&typeof journal.read==='function'&&typeof journal.append==='function','JOURNAL_REQUIRED');
    const token=env.RATCHET_PLAY_SESSION;
    need(typeof token==='string'&&TOKEN.test(token),'MISSING_OR_INVALID_CAPABILITY');
    const parsed=TOKEN.exec(token);
    need(parsed[1]===options.wallet&&parsed[2]===options.sessionId,'CAPABILITY_IDENTITY_MISMATCH');
    async function request(url,body){
      need(Object.values(URLS).includes(url),'DESTINATION_REFUSED');
      need(!body||url===URLS.session,'BEARER_DESTINATION_REFUSED');
      const remaining=maxWait-(now()-began);
      if(remaining<=0)stop('WAIT_LIMIT','PENDING');
      const headers={Accept:'application/json'};
      if(body){headers['Content-Type']='application/json';headers.Authorization='Bearer '+token;}
      let response;
      try{response=await fetcher(url,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined,
        redirect:'error',cache:'no-store',signal:AbortSignal.timeout(Math.max(1,Math.floor(Math.min(15000,remaining))))});}catch{stop('TRANSPORT_UNCERTAIN','PENDING');}
      need(!response.redirected&&(!response.url||response.url===url)
        &&integer(response.status)&&response.status>=200&&response.status<=599
        &&!(response.status>=300&&response.status<400),'REDIRECT_REFUSED');
      const age=Number(response.headers?.get('age')||0);need(finite(age)&&age>=0&&age<=86400,'INVALID_SERVER_AGE');
      const stamp=Date.parse(response.headers?.get('date')||'')+age*1000;need(Number.isFinite(stamp),'SERVER_DATE_REQUIRED');
      if(clock)need(stamp>=clock.server-2000,'SERVER_CLOCK_REWIND');
      clock={server:stamp,local:now()};
      let value;
      try{const text=await response.text();need(text.length<=262144,'RESPONSE_TOO_LARGE');value=JSON.parse(text);}catch(e){if(e instanceof Stop)throw e;stop('INVALID_RESPONSE');}
      need(value&&typeof value==='object'&&!Array.isArray(value),'INVALID_RESPONSE');
      return {http:response.status,body:value};
    }
    function checkStatus(r){
      if(r.http!==200||r.body.ok!==true)stop(REMOTE_CODES.has(r.body.code)?r.body.code:'STATUS_UNAVAILABLE','PENDING');
      const {session:s,player:p}=r.body;
      need(s&&s.wallet===options.wallet&&s.id===options.sessionId&&p?.wallet===options.wallet,'STATUS_IDENTITY_MISMATCH');
      need(s.revokedAt===null&&!s.expired&&finite(s.expiresAt)&&s.expiresAt>serverNow(),'SESSION_INACTIVE');
      need(s.budgetRule==='gross-reserved-attempts-v1'&&s.limits?.maxAttempts===1
        &&integer(s.attempts)&&integer(s.grossCredits)&&s.requests&&typeof s.requests==='object','INVALID_SESSION');
      const bounds=limits(s.limits);
      if(start)need(s.expiresAt===start.expiresAt&&same(bounds,start.limits),'SESSION_CHANGED');
      return {s,p};
    }
    if(options.mode==='resume'){
      phase='resume';let entries;try{entries=await journal.read();retained=true;}catch{stop('JOURNAL_READ_FAILED');}
      need(Array.isArray(entries)&&entries.length>=1&&entries.length<=10,'INVALID_JOURNAL');
      start=entries[0];
      need(start?.schema===SCHEMA&&start.kind==='start'&&start.wallet===options.wallet
        &&start.sessionId===options.sessionId&&validIntent(start.intent)&&finite(start.expiresAt)
        &&finite(start.createdAt)&&start.limits?.maxAttempts===1,'JOURNAL_IDENTITY_MISMATCH');
      need(start.baseline&&finite(start.baseline.credits)&&integer(start.baseline.stated)
        &&Array.isArray(start.baseline.closedIds)&&finite(start.baseline.hitPayout),'INVALID_JOURNAL');
      for(const entry of entries.slice(1)){
        if(entry.kind==='wire'){
          need(!wire&&SHOT.test(entry.shotId)&&/^[a-f0-9]{64}$/.test(entry.receiptHash)
            &&entry.submitHttp===200&&entry.replayHttp===200&&entry.idempotent===true,'INVALID_JOURNAL');
          wire=entry;wirePersisted=true;shotId=wire.shotId;debit=entry.debitObserved===true;
        }else if(entry.kind==='debit'){need(entry.credits===start.baseline.credits-STAKE,'INVALID_JOURNAL');debit=true;}
        else stop('INVALID_JOURNAL');
      }
    }else{
      const intent={requestId:randomId(),target:options.target,side:options.side,p:options.p,stake:STAKE};
      need(validIntent(intent),'EXPLICIT_INTENT_REQUIRED');
      const contract=await request(URLS.session);
      need(contract.http===200&&contract.body.ok===true&&contract.body.enabled===true
        &&contract.body.network==='solana:mainnet'&&same(contract.body.rights,['shot','status'])
        &&contract.body.requiresExistingAdmittedAgent===true&&contract.body.endpoint===URLS.session
        &&contract.body.budgetRule==='gross-reserved-attempts-v1'
        &&contract.body.agentContract?.shot?.replay&&contract.body.agentContract?.shot?.rejected,'CONTRACT_REFUSED');
      const context=await request(URLS.context),board=await request(URLS.board);
      need(typeof contract.body.v==='string'&&contract.body.v===context.body.v&&contract.body.v===board.body.v,'RELEASE_MISMATCH');
      need(board.http===200&&board.body.ok===true&&board.body.prices?.src==='pyth-onchain'
        &&finite(board.body.flipsAt)&&board.body.flipsAt>serverNow()&&finite(board.body.stakeRule?.hitPayout)
        &&board.body.stakeRule.hitPayout>0&&board.body.stakeRule.min<=STAKE&&board.body.stakeRule.max>=STAKE,'BOARD_REFUSED');
      const target=board.body.targets?.find(t=>t.id===intent.target);
      need(target&&target.kind==='dir'&&target.mins===5&&!target.feed2,'TARGET_NOT_FIVE_MINUTES');
      const current=context.body.feeds?.find(f=>f.feed===target.feed);
      need(context.http===200&&context.body.ok===true&&context.body.schema==='ratchetx-pyth-context-v1'
        &&context.body.access?.mode==='shared-read'&&context.body.validation?.fullVerificationRequired===true
        &&context.body.validation?.ownerFeedIdAndDiscriminatorChecked===true
        &&context.body.validation?.maxConfidenceBps===200,'CONTEXT_REFUSED');
      const quote=current?.current,age=quote&&Math.max(quote.ageNowS,
        (serverNow()-quote.publishTime*1000)/1000,
        quote.ageNowS+Math.max(0,serverNow()-context.body.generatedAt)/1000);
      need(finite(context.body.generatedAt)&&context.body.generatedAt<=serverNow()+2000
        &&quote&&finite(quote.price)&&quote.price>0&&finite(quote.ageNowS)&&quote.ageNowS>=0
        &&finite(quote.publishTime)&&finite(quote.prevPublishTime)
        &&current.activeTargets?.some(t=>t.id===intent.target&&t.horizonMinutes===5),'CONTEXT_REFUSED');
      need(finite(age)&&age>=0&&age<=45,'ORACLE_STALE');
      need(finite(quote.confidenceBps)&&quote.confidenceBps>=0&&quote.confidenceBps<=200,'ORACLE_CONFIDENCE_TOO_WIDE');
      const preflight=checkStatus(await request(URLS.session,{op:'status'}));
      need(preflight.s.attempts===0&&preflight.s.grossCredits===0&&preflight.s.pending===null
        &&Object.keys(preflight.s.requests).length===0,'GRANT_ALREADY_USED');
      need(preflight.s.limits.maxStakeCredits>=STAKE&&preflight.s.limits.maxGrossCredits>=STAKE,'ALLOWANCE_TOO_SMALL');
      need(preflight.s.expiresAt-serverNow()>=MIN_ROOM,'INSUFFICIENT_SESSION_LIFETIME');
      // Re-evaluate cached context age after the private preflight's round trip.
      need(Math.max(age,(serverNow()-quote.publishTime*1000)/1000)<=45,'ORACLE_STALE');
      start={schema:SCHEMA,kind:'start',wallet:options.wallet,sessionId:options.sessionId,intent,
        createdAt:serverNow(),expiresAt:preflight.s.expiresAt,limits:limits(preflight.s.limits),
        baseline:baseline(preflight.p,board.body.stakeRule.hitPayout)};
      try{await journal.create(start);retained=true;}catch{stop('JOURNAL_CREATE_FAILED');}
      need(start.expiresAt-serverNow()>=MIN_ROOM,'INSUFFICIENT_SESSION_LIFETIME');
      need((serverNow()-quote.publishTime*1000)/1000<=45,'ORACLE_STALE');
      phase='submit';emit('SUBMIT_ONCE');
      const body={op:'shot',intent};
      const submitted=await request(URLS.session,body);
      if(submitted.body.request?.state==='rejected')return result('REFUSED',safeCode(submitted.body.request.result?.code));
      if(submitted.http!==200||submitted.body.ok!==true||submitted.body.idempotent===true||!receipt(submitted.body.request,intent))
        return result('PENDING','SUBMIT_UNRESOLVED');
      shotId=submitted.body.request.result.shotId;
      // No status call, sleep, optional inspection, or journal append between
      // the first accepted response and this exact second wire request.
      phase='replay';
      const replay=await request(URLS.session,body);
      if(replay.http!==200||replay.body.ok!==true||replay.body.idempotent!==true
        ||!receipt(replay.body.request,intent)||!same(replay.body.request,submitted.body.request))
        return result('PENDING','REPLAY_UNVERIFIED');
      debit=submitted.body.credits===start.baseline.credits-STAKE;
      if(finite(submitted.body.credits)&&!debit)stop('CONCURRENT_ACCOUNTING_CHANGE','INCONCLUSIVE');
      wire={kind:'wire',shotId,receiptHash:hash(replay.body.request),submitHttp:submitted.http,
        replayHttp:replay.http,idempotent:true,debitObserved:debit};
      await save(wire);wirePersisted=true;emit('IMMEDIATE_WIRE_REPLAY_VERIFIED');
    }
    phase='settlement';
    let first=options.mode==='resume';
    while(now()-began<maxWait){
      if(clock&&serverNow()+pollMs>=start.expiresAt)return result('PENDING','SESSION_EXPIRING');
      if(!first){const remaining=maxWait-(now()-began);if(remaining<=0)return result('PENDING','WAIT_LIMIT');
        await sleep(Math.min(pollMs,remaining));}
      first=false;
      if(now()-began>=maxWait)return result('PENDING','WAIT_LIMIT');
      const {s,p}=checkStatus(await request(URLS.session,{op:'status'}));
      const r=s.requests[start.intent.requestId];
      if(!r)return result('PENDING',s.attempts===0?'NO_RECORDED_ATTEMPT':'ATTEMPT_NOT_FOUND');
      need(s.attempts===1&&s.grossCredits===STAKE&&Object.keys(s.requests).length===1&&same(r.intent,start.intent),'SESSION_ACCOUNTING_CHANGED');
      if(r.state==='rejected')return result('REFUSED',safeCode(r.result?.code));
      if(r.state==='reserved')return result('PENDING','ATTEMPT_RESERVED');
      need(receipt(r,start.intent)&&s.pending===null,'INVALID_ACCEPTED_RECEIPT');
      shotId=r.result.shotId;
      if(wire)need(wire.shotId===shotId&&wire.receiptHash===hash(r),'RECEIPT_CHANGED');
      const openIds=ids(p.open),closedIds=ids(p.closed);
      const closed=p.closed.find(row=>row.id===shotId),opened=p.open.find(row=>row.id===shotId);
      const shot=closed||opened;
      need(shot&&shot.requestId===`session:${options.sessionId}:${start.intent.requestId}`
        &&shot.stake===STAKE&&finite(shot.exp)&&shot.exp>=r.reservedAt+300000
        &&shot.exp<=r.finishedAt+300000&&r.finishedAt<start.expiresAt,'SHOT_IDENTITY_MISMATCH');
      const expectedClosed=closed?[shotId,...start.baseline.closedIds].slice(0,20):start.baseline.closedIds;
      if(!same(closedIds,expectedClosed)||!same(openIds,closed?[]:[shotId]))stop('CONCURRENT_ACTIVITY','INCONCLUSIVE');
      if(!closed){
        if(p.credits!==start.baseline.credits-STAKE||p.stated!==start.baseline.stated||p.brier!==start.baseline.brier)
          stop('CONCURRENT_ACCOUNTING_CHANGE','INCONCLUSIVE');
        if(!debit){await save({kind:'debit',credits:p.credits});debit=true;}
        emit('SETTLEMENT_PENDING');continue;
      }
      need(['hit','miss','void'].includes(closed.res)&&closed.side===start.intent.side&&closed.sp===start.intent.p
        &&finite(closed.settledAt)&&closed.settledAt>=shot.exp&&closed.settledAt<=serverNow()+2000,'TERMINAL_IDENTITY_MISMATCH');
      const win=closed.res==='hit',voided=closed.res==='void';
      const payout=win?Math.floor(STAKE*start.baseline.hitPayout):voided?STAKE:0;
      if(p.credits!==start.baseline.credits-STAKE+payout||p.stated!==start.baseline.stated+(voided?0:1))
        stop('CONCURRENT_ACCOUNTING_CHANGE','INCONCLUSIVE');
      if(win&&closed.back!==payout)stop('PAYOUT_CHANGED','INCONCLUSIVE');
      const loss=voided?null:(start.intent.p-(win?1:0))**2;
      const mean=voided?start.baseline.brier:((start.baseline.brier??0)*start.baseline.stated+loss)/p.stated;
      const tolerance=voided?0:0.000051+start.baseline.stated*0.00005/p.stated;
      if(mean===null?p.brier!==null:!finite(p.brier)||Math.abs(p.brier-mean)>tolerance)
        stop('BRIER_ACCOUNTING_CHANGED','INCONCLUSIVE');
      const accounting={outcome:closed.res.toUpperCase(),creditsBefore:start.baseline.credits,
        creditsAfter:p.credits,statedBefore:start.baseline.stated,statedAfter:p.stated,
        squaredError:loss,brier:p.brier,brierCheck:'public-rounded-mean',debitObserved:debit,
        immediateWireReplayVerified:!!wire};
      if(!wire||!debit)return result('INCONCLUSIVE','SETTLED_WITHOUT_COMPLETE_WIRE_EVIDENCE',accounting);
      return result('PASS','PASS_'+closed.res.toUpperCase(),accounting);
    }
    return result('PENDING','WAIT_LIMIT');
  }catch(error){
    let category=error instanceof Stop?error.category:'FAILED';
    const code=error instanceof Stop?error.code:'RUNNER_FAILED';
    // A malformed/missing acknowledgement is not evidence of non-execution.
    // Preserve the journal and report uncertainty after either shot wire call.
    if(['submit','replay'].includes(phase)&&['INVALID_RESPONSE','RESPONSE_TOO_LARGE','SERVER_DATE_REQUIRED',
      'SERVER_CLOCK_REWIND','INVALID_SERVER_AGE','REDIRECT_REFUSED','RUNNER_FAILED'].includes(code))category='PENDING';
    return result(category,code);
  }
  finally{try{await journal?.close?.();}catch{}}
}

export function parseArgs(args){
  const options={},seen=new Set();let file;
  const values=new Set(['--wallet','--session-id','--target','--side','--p','--journal','--max-wait-seconds']);
  for(let i=0;i<args.length;i++){
    const key=args[i];need(!seen.has(key),'INVALID_ARGUMENTS');seen.add(key);
    if(key==='--execute'||key==='--resume'){need(!options.mode,'INVALID_ARGUMENTS');options.mode=key.slice(2);continue;}
    need(values.has(key)&&typeof args[i+1]==='string'&&!args[i+1].startsWith('--'),'INVALID_ARGUMENTS');
    const value=args[++i];
    if(key==='--journal')file=value;
    else if(key==='--session-id')options.sessionId=value;
    else if(key==='--max-wait-seconds')options.maxWaitMs=Number(value)*1000;
    else options[key.slice(2)]=key==='--p'?Number(value):value;
  }
  need(file&&options.mode,'EXPLICIT_MODE_AND_JOURNAL_REQUIRED');
  if(options.mode==='resume')need(!['target','side','p'].some(k=>k in options),'RESUME_STATUS_ONLY');
  return {options,file};
}
async function main(){
  if(process.argv.length===3&&process.argv[2]==='--help'){
    console.log('Usage: node session-smoke.mjs --execute --wallet BASE58 --session-id HEX32 --target BOARD_ID --side YES|NO --p 0.55 --journal NEW_FILE [--max-wait-seconds 1260]');
    console.log('Resume: node session-smoke.mjs --resume --wallet BASE58 --session-id HEX32 --journal EXISTING_FILE');
    console.log('Capability: protected RATCHET_PLAY_SESSION environment variable only. Fixed100 play credits, one unused signed attempt,22min remaining. Resume only reads status. No funding/signing/new grant.');return;
  }
  try{const {options,file}=parseArgs(process.argv.slice(2));
    const output=await runSmoke(options,{journal:createFileJournal(file),onEvent:event=>console.log(JSON.stringify(event))});
    console.log(JSON.stringify(output));process.exitCode=output.ok?0:output.category==='PENDING'?2:1;
  }catch{console.log(JSON.stringify({ok:false,category:'FAILED',code:'INVALID_ARGUMENTS'}));process.exitCode=1;}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)await main();
