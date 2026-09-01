#!/usr/bin/env node
// One explicitly approved command per invocation. No signer, scheduler or funds.
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {ORIGIN,URLS,canonical,createFileJournal} from './session-smoke.mjs';
export {ORIGIN,URLS,canonical,createFileJournal};

const SCHEMA='ratchetx-session-play-v1', MIN_ROOM=22*60000, HORIZON=300000;
const WALLET=/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, HEX32=/^[a-f0-9]{32}$/, HEX64=/^[a-f0-9]{64}$/;
const SHOT=/^[a-f0-9]{12}$/, COMMAND=/^(?:[0-9]{1,32}|[a-f0-9]{32})$/;
const TOKEN=/^rxp1\.([1-9A-HJ-NP-Za-km-z]{32,44})\.([a-f0-9]{32})\.[a-f0-9]{64}$/;
const CODES=new Set(['SESSION_EXPIRED','SESSION_REVOKED','INVALID_CAPABILITY','SESSION_RATE_LIMIT',
  'SESSION_BUDGET_EXHAUSTED','AGENT_ADMISSION_REQUIRED','PLAYER_BUSY','ORACLE_STALE',
  'ORACLE_CONFIDENCE_TOO_WIDE','FEED_UNAVAILABLE','TARGET_UNAVAILABLE','CHAMBERS_FULL',
  'INVALID_STAKE','INSUFFICIENT_CREDITS','SETTLEMENT_DELIVERY_PENDING','INVALID_PROBABILITY',
  'RATE_LIMITED','WRITE_CONFLICT','WRITE_LEASE_EXPIRED','CREDIT_QUEUE_CONFLICT','SHOT_REFUSED',
  'RECOVERED_NO_DISPATCH','REQUEST_CONFLICT','PRIOR_ATTEMPT_UNRESOLVED']);
const finite=n=>typeof n==='number'&&Number.isFinite(n), integer=n=>Number.isSafeInteger(n)&&n>=0;
const same=(a,b)=>canonical(a)===canonical(b);
const digest=text=>createHash('sha256').update(text).digest('hex'), hash=value=>digest(canonical(value));
class Stop extends Error {constructor(code,category='FAILED'){super(code);this.code=code;this.category=category;}}
const stop=(code,category)=>{throw new Stop(code,category);};
const need=(condition,code)=>{if(!condition)stop(code);};
const safeCode=code=>CODES.has(code)?code:'SHOT_REFUSED';
function bounds(value){
  need(value&&integer(value.maxAttempts)&&value.maxAttempts>=1&&value.maxAttempts<=100
    &&integer(value.maxStakeCredits)&&value.maxStakeCredits>=100&&value.maxStakeCredits<=10000000
    &&integer(value.maxGrossCredits)&&value.maxGrossCredits>=value.maxStakeCredits&&value.maxGrossCredits<=100000000
    &&integer(value.minIntervalMs)&&value.minIntervalMs>=1000&&value.minIntervalMs<=600000,'INVALID_SESSION');
  return {maxAttempts:value.maxAttempts,maxStakeCredits:value.maxStakeCredits,
    maxGrossCredits:value.maxGrossCredits,minIntervalMs:value.minIntervalMs};
}
export function commandRequestId(wallet,sessionId,commandId){
  need(typeof wallet==='string'&&WALLET.test(wallet)&&typeof sessionId==='string'&&HEX32.test(sessionId)
    &&typeof commandId==='string'&&COMMAND.test(commandId),'INVALID_COMMAND_ID');
  // A public command ID is deduplication context, NEVER authentication or proof
  // of X authorship. Excluding intent makes changed-intent redelivery conflict.
  return hash({domain:'ratchetx.xyz',version:'session-play-command-v1',wallet,sessionId,commandId}).slice(0,32);
}
function validIntent(i){return !!(i&&HEX32.test(i.requestId)&&/^[A-Za-z0-9:_-]{3,96}$/.test(i.target)
  &&['YES','NO'].includes(i.side)&&finite(i.p)&&i.p>=0.01&&i.p<=0.99
  &&Math.abs(i.p*100-Math.round(i.p*100))<1e-9&&integer(i.stake)&&i.stake>=100&&i.stake<=10000000
  &&Object.keys(i).sort().join(',')==='p,requestId,side,stake,target');}
function intentHash(i){return digest(JSON.stringify({requestId:i.requestId,target:i.target,side:i.side,p:i.p,stake:i.stake}));}
function validReceipt(r,intent){return !!(r&&validIntent(r.intent)&&same(r.intent,intent)&&r.stake===intent.stake
  &&r.intentHash===intentHash(intent)&&integer(r.reservedAt)
  &&['reserved','accepted','rejected'].includes(r.state)
  &&(r.state==='reserved'||integer(r.finishedAt)&&r.finishedAt>=r.reservedAt&&r.result?.state===r.state)
  &&(r.state!=='accepted'||SHOT.test(r.result?.shotId||'')));}
function ids(rows){
  need(Array.isArray(rows)&&rows.every(row=>row&&/^[a-z0-9]{4,16}$/i.test(row.id)),'INVALID_PLAYER');
  const out=rows.map(row=>row.id);need(new Set(out).size===out.length,'INVALID_PLAYER');return out;
}
function playerShape(p){
  need(p&&finite(p.credits)&&p.credits>=0&&integer(p.stated),'INVALID_PLAYER');
  need(p.stated===0?p.brier===null:finite(p.brier)&&p.brier>=0&&p.brier<=1,'INVALID_PLAYER');
  ids(p.open);ids(p.closed);
  need(p.open.every(row=>integer(row.exp)),'INVALID_PLAYER');
}

/** Injected dependencies permit offline fixtures. Only the protected env var
 * supplies a capability. Output is allowlisted; journal intent stays private.
 * Distinct commands still require explicit requester approval in the caller.
 */
export async function runPlay(options={},dependencies={}){
  const {fetch:fetcher=globalThis.fetch,now=()=>performance.now(),sleep=ms=>new Promise(r=>setTimeout(r,ms)),
    journal,env=process.env,onEvent=()=>{}}=dependencies;
  let phase=options.mode==='status'?'status':'preflight',clock=null,start=null,wire=null,wirePersisted=false;
  let retained=false,debit=false,shotId=null,requestId=null,commandId=options.commandId;
  const began=now(),maxWait=options.maxWaitMs??(options.mode==='status'?15000:21*60000),pollMs=options.pollMs??30000;
  const serverNow=()=>{need(clock,'SERVER_DATE_REQUIRED');return clock.server+Math.max(0,now()-clock.local);};
  const emit=code=>{try{onEvent({phase,code});}catch{}};
  const result=(category,code,extra={})=>({ok:['PASS','STATUS'].includes(category),category,code,phase,
    ...(typeof options.wallet==='string'&&WALLET.test(options.wallet)?{wallet:options.wallet}:{}),
    ...(typeof options.sessionId==='string'&&HEX32.test(options.sessionId)?{sessionId:options.sessionId}:{}),
    ...(typeof commandId==='string'&&COMMAND.test(commandId)?{commandId}:{}),...(requestId?{requestId}:{}),
    journalRetained:retained,immediateWireReplayVerified:!!wire&&wirePersisted,debitObserved:debit,
    ...(shotId?{shotId,proofUrl:ORIGIN+'/api/shot?w='+encodeURIComponent(options.wallet)+'&id='+shotId}:{}),...extra});
  const append=async value=>{try{await journal.append(value);}catch{stop('JOURNAL_WRITE_FAILED');}};
  try{
    need(['status','execute','resume'].includes(options.mode),'EXPLICIT_MODE_REQUIRED');
    need(Object.keys(options).every(key=>['mode','wallet','sessionId','commandId','target','side','p','stake','maxWaitMs','pollMs'].includes(key)),'INVALID_OPTIONS');
    if(options.mode!=='execute')need(!['commandId','target','side','p','stake'].some(key=>key in options),'STATUS_ONLY_MODE');
    need(typeof options.wallet==='string'&&WALLET.test(options.wallet)
      &&typeof options.sessionId==='string'&&HEX32.test(options.sessionId),'EXPECTED_IDENTITY_REQUIRED');
    need(integer(maxWait)&&maxWait>=5000&&maxWait<=25*60000&&integer(pollMs)&&pollMs>=5000&&pollMs<=30000,'INVALID_WAIT');
    if(options.mode!=='status')need(journal&&typeof journal.create==='function'&&typeof journal.read==='function'
      &&typeof journal.append==='function','JOURNAL_REQUIRED');
    else need(!journal,'STATUS_REQUIRES_NO_JOURNAL');
    const token=env.RATCHET_PLAY_SESSION,parts=typeof token==='string'&&TOKEN.exec(token);
    need(parts,'MISSING_OR_INVALID_CAPABILITY');
    need(parts[1]===options.wallet&&parts[2]===options.sessionId,'CAPABILITY_IDENTITY_MISMATCH');
    async function request(url,body){
      need(Object.values(URLS).includes(url)&&(!body||url===URLS.session),'DESTINATION_REFUSED');
      const remaining=maxWait-(now()-began);if(remaining<=0)stop('WAIT_LIMIT','PENDING');
      const headers={Accept:'application/json'};
      if(body){headers['Content-Type']='application/json';headers.Authorization='Bearer '+token;}
      let response;
      try{response=await fetcher(url,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined,
        redirect:'error',cache:'no-store',signal:AbortSignal.timeout(Math.max(1,Math.floor(Math.min(15000,remaining))))});}
      catch{stop('TRANSPORT_UNCERTAIN','PENDING');}
      need(!response.redirected&&(!response.url||response.url===url)&&integer(response.status)
        &&response.status>=200&&response.status<=599&&!(response.status>=300&&response.status<400),'REDIRECT_REFUSED');
      const age=Number(response.headers?.get('age')||0);need(finite(age)&&age>=0&&age<=86400,'INVALID_SERVER_AGE');
      const stamp=Date.parse(response.headers?.get('date')||'')+age*1000;need(finite(stamp),'SERVER_DATE_REQUIRED');
      if(clock)need(stamp>=clock.server-2000,'SERVER_CLOCK_REWIND');
      clock={server:stamp,local:now()};
      let value;
      try{const text=await response.text();need(text.length<=262144,'RESPONSE_TOO_LARGE');value=JSON.parse(text);}
      catch(error){if(error instanceof Stop)throw error;stop('INVALID_RESPONSE');}
      need(value&&typeof value==='object'&&!Array.isArray(value),'INVALID_RESPONSE');
      return {http:response.status,body:value};
    }
    function status(r){
      if(r.http!==200||r.body.ok!==true)stop(CODES.has(r.body.code)?r.body.code:'STATUS_UNAVAILABLE','PENDING');
      const {session:s,player:p}=r.body;
      need(s&&s.wallet===options.wallet&&s.id===options.sessionId&&p?.wallet===options.wallet,'STATUS_IDENTITY_MISMATCH');
      need(s.revokedAt===null&&s.expired===false&&integer(s.expiresAt)&&s.expiresAt>serverNow(),'SESSION_INACTIVE');
      const l=bounds(s.limits);
      need(s.budgetRule==='gross-reserved-attempts-v1'&&integer(s.attempts)&&s.attempts<=l.maxAttempts
        &&integer(s.grossCredits)&&s.grossCredits<=l.maxGrossCredits&&s.requests&&typeof s.requests==='object'
        &&!Array.isArray(s.requests),'INVALID_SESSION');
      const rows=Object.entries(s.requests),pending=[];let gross=0,lastReservedAt=null;
      need(rows.length===s.attempts,'INVALID_SESSION');
      for(const [key,r] of rows){
        need(HEX32.test(key)&&r?.intent?.requestId===key&&validReceipt(r,r.intent),'INVALID_SESSION');
        gross+=r.stake;lastReservedAt=Math.max(lastReservedAt??0,r.reservedAt);
        if(r.state==='reserved')pending.push(key);
      }
      need(gross===s.grossCredits&&pending.length<=1
        &&s.pending===(pending.length?pending[0]:null),'INVALID_SESSION');
      playerShape(p);
      if(start)need(s.expiresAt===start.expiresAt&&same(l,start.limits),'SESSION_CHANGED');
      return {s,p,l,nextAttemptAt:lastReservedAt===null?null:lastReservedAt+l.minIntervalMs};
    }
    const summary=({s,p,l,nextAttemptAt})=>({expiresAt:s.expiresAt,limits:l,attempts:s.attempts,grossCredits:s.grossCredits,
      remainingAttempts:l.maxAttempts-s.attempts,remainingGrossCredits:l.maxGrossCredits-s.grossCredits,
      nextAttemptAt,pendingRequestId:s.pending,credits:p.credits,stated:p.stated,brier:p.brier,
      open:p.open.map(row=>({shotId:row.id,expiresAt:row.exp})),
      effect:'Status may collect canonical settlement; no forecast was submitted.'});
    if(options.mode==='status')return result('STATUS','STATUS',summary(status(await request(URLS.session,{op:'status'}))));

    if(options.mode==='resume'){
      phase='resume';let entries;
      try{entries=await journal.read();retained=true;}catch{stop('JOURNAL_READ_FAILED');}
      need(Array.isArray(entries)&&entries.length>=1&&entries.length<=10,'INVALID_JOURNAL');start=entries[0];
      need(start?.schema===SCHEMA&&start.kind==='start'&&start.wallet===options.wallet&&start.sessionId===options.sessionId
        &&COMMAND.test(start.commandId||'')&&validIntent(start.intent)&&integer(start.createdAt)&&integer(start.expiresAt),'INVALID_JOURNAL');
      commandId=start.commandId;requestId=commandRequestId(options.wallet,options.sessionId,commandId);
      need(requestId===start.intent.requestId&&same(bounds(start.limits),start.limits),'INVALID_JOURNAL');
      const b=start.baseline;
      need(b&&finite(b.credits)&&b.credits>=start.intent.stake&&integer(b.stated)
        &&(b.stated===0?b.brier===null:finite(b.brier)&&b.brier>=0&&b.brier<=1)
        &&Array.isArray(b.closedIds)&&b.closedIds.every(id=>/^[a-z0-9]{4,16}$/i.test(id))
        &&new Set(b.closedIds).size===b.closedIds.length&&b.closedIds.length<=20
        &&finite(b.hitPayout)&&b.hitPayout>0&&integer(b.attempts)&&integer(b.grossCredits)
        &&b.requestHashes&&typeof b.requestHashes==='object'&&!Array.isArray(b.requestHashes)
        &&Object.entries(b.requestHashes).every(([id,value])=>HEX32.test(id)&&HEX64.test(value))
        &&Object.keys(b.requestHashes).length===b.attempts&&!Object.hasOwn(b.requestHashes,requestId)
        &&b.attempts<start.limits.maxAttempts&&b.grossCredits+start.intent.stake<=start.limits.maxGrossCredits,'INVALID_JOURNAL');
      for(const entry of entries.slice(1)){
        if(entry.kind==='wire'){
          need(!wire&&SHOT.test(entry.shotId)&&HEX64.test(entry.receiptHash)&&entry.submitHttp===200
            &&entry.replayHttp===200&&entry.idempotent===true&&typeof entry.debitObserved==='boolean','INVALID_JOURNAL');
          wire=entry;wirePersisted=true;shotId=entry.shotId;debit=entry.debitObserved;
        }else if(entry.kind==='debit'){
          need(!debit&&entry.credits===b.credits-start.intent.stake,'INVALID_JOURNAL');debit=true;
        }else stop('INVALID_JOURNAL');
      }
    }else{
      requestId=commandRequestId(options.wallet,options.sessionId,commandId);
      const intent={requestId,target:options.target,side:options.side,p:options.p,stake:options.stake??100};
      need(validIntent(intent),'EXPLICIT_INTENT_REQUIRED');
      // Authenticate first. Duplicate public command IDs stop here, even when
      // delivered with another journal path, and never consume another attempt.
      const before=status(await request(URLS.session,{op:'status'})),{s,p,l,nextAttemptAt}=before;
      const old=s.requests[requestId];
      if(old){
        if(!same(old.intent,intent))return result('REFUSED','COMMAND_CONFLICT');
        if(old.state==='accepted')shotId=old.result.shotId;
        return result('DUPLICATE','COMMAND_ALREADY_RECORDED',{requestState:old.state,
          ...(old.state==='rejected'?{refusalCode:safeCode(old.result?.code)}:{}),next:'Use the original private journal with --resume; never change command ID to retry this instruction.'});
      }
      if(s.pending)return result('PENDING','PRIOR_ATTEMPT_UNRESOLVED');
      need(p.open.length < (p.chambers || 1), 'EXISTING_OPEN_SHOTS');
      if(s.attempts>=l.maxAttempts||intent.stake>l.maxStakeCredits||s.grossCredits+intent.stake>l.maxGrossCredits)
        return result('REFUSED','SESSION_BUDGET_EXHAUSTED');
      if(nextAttemptAt!==null&&nextAttemptAt>serverNow())return result('REFUSED','SESSION_RATE_LIMIT',
        {retryAfterSeconds:Math.ceil((nextAttemptAt-serverNow())/1000)});
      need(p.credits>=intent.stake,'INSUFFICIENT_CREDITS');
      need(s.expiresAt-serverNow()>=MIN_ROOM,'INSUFFICIENT_SESSION_LIFETIME');
      const contract=await request(URLS.session),context=await request(URLS.context),board=await request(URLS.board);
      need(contract.http===200&&contract.body.ok===true&&contract.body.enabled===true&&contract.body.network==='solana:mainnet'
        &&same(contract.body.rights,['shot','status'])&&contract.body.requiresExistingAdmittedAgent===true
        &&contract.body.endpoint===URLS.session&&contract.body.budgetRule==='gross-reserved-attempts-v1'
        &&contract.body.agentContract?.shot?.replay&&contract.body.agentContract?.shot?.rejected,'CONTRACT_REFUSED');
      need(typeof contract.body.v==='string'&&contract.body.v===context.body.v&&contract.body.v===board.body.v,'RELEASE_MISMATCH');
      need(board.http===200&&board.body.ok===true&&board.body.prices?.src==='pyth-onchain'
        &&finite(board.body.flipsAt)&&board.body.flipsAt>serverNow()&&finite(board.body.stakeRule?.hitPayout)
        &&board.body.stakeRule.hitPayout>0&&board.body.stakeRule.min<=intent.stake&&board.body.stakeRule.max>=intent.stake,'BOARD_REFUSED');
      const target=board.body.targets?.find(row=>row.id===intent.target);
      need(target&&target.kind==='dir'&&!target.feed2,'TARGET_NOT_DIRECTIONAL');
      need(context.http===200&&context.body.ok===true&&context.body.schema==='ratchetx-pyth-context-v1'
        &&context.body.access?.mode==='shared-read'&&context.body.validation?.fullVerificationRequired===true
        &&context.body.validation?.ownerFeedIdAndDiscriminatorChecked===true
        &&context.body.validation?.maxConfidenceBps===200,'CONTEXT_REFUSED');
      const feed=context.body.feeds?.find(row=>row.feed===target.feed),q=feed?.current;
      need(finite(context.body.generatedAt)&&context.body.generatedAt<=serverNow()+2000&&q
        &&finite(q.price)&&q.price>0&&finite(q.ageNowS)&&q.ageNowS>=0&&finite(q.publishTime)&&finite(q.prevPublishTime)
        &&feed.activeTargets?.some(row=>row.id===intent.target),'CONTEXT_REFUSED');
      const freshness=()=>Math.max(q.ageNowS,(serverNow()-q.publishTime*1000)/1000,
        q.ageNowS+Math.max(0,serverNow()-context.body.generatedAt)/1000);
      need(finite(freshness())&&freshness()<=45,'ORACLE_STALE');
      need(finite(q.confidenceBps)&&q.confidenceBps>=0&&q.confidenceBps<=200,'ORACLE_CONFIDENCE_TOO_WIDE');
      start={schema:SCHEMA,kind:'start',wallet:options.wallet,sessionId:options.sessionId,commandId,intent,
        createdAt:Math.floor(serverNow()),expiresAt:s.expiresAt,limits:l,baseline:{credits:p.credits,stated:p.stated,brier:p.brier,
          closedIds:ids(p.closed),hitPayout:board.body.stakeRule.hitPayout,attempts:s.attempts,grossCredits:s.grossCredits,
          requestHashes:Object.fromEntries(Object.entries(s.requests).map(([id,r])=>[id,hash(r)]))}};
      try{await journal.create(start);retained=true;}catch{stop('JOURNAL_CREATE_FAILED');}
      need(start.expiresAt-serverNow()>=MIN_ROOM,'INSUFFICIENT_SESSION_LIFETIME');
      need(freshness()<=45,'ORACLE_STALE');
      phase='submit';emit('SUBMIT_ONCE');const body={op:'shot',intent};
      const submitted=await request(URLS.session,body);
      if(submitted.body.request?.state==='rejected'&&validReceipt(submitted.body.request,intent))
        return result('REFUSED',safeCode(submitted.body.request.result?.code));
      if(submitted.http!==200||submitted.body.ok!==true||submitted.body.idempotent===true
        ||!validReceipt(submitted.body.request,intent)||submitted.body.request.state!=='accepted')
        return result('PENDING','SUBMIT_UNRESOLVED');
      shotId=submitted.body.request.result.shotId;
      // Adjacent wire requests: no sleep, status, log or journal append here.
      phase='replay';const replay=await request(URLS.session,body);
      if(replay.http!==200||replay.body.ok!==true||replay.body.idempotent!==true
        ||!same(replay.body.request,submitted.body.request))return result('PENDING','REPLAY_UNVERIFIED');
      debit=submitted.body.credits===start.baseline.credits-intent.stake;
      wire={kind:'wire',shotId,receiptHash:hash(replay.body.request),submitHttp:200,replayHttp:200,idempotent:true,debitObserved:debit};
      await append(wire);wirePersisted=true;emit('IMMEDIATE_WIRE_REPLAY_VERIFIED');
      if(finite(submitted.body.credits)&&!debit)stop('CONCURRENT_ACCOUNTING_CHANGE','INCONCLUSIVE');
    }

    phase='settlement';let first=options.mode==='resume',nextPoll=wire&&debit?null:0;
    while(now()-began<maxWait){
      if(clock&&serverNow()+5000>=start.expiresAt)return result('PENDING','SESSION_EXPIRING');
      if(!first){
        // With a directly observed debit, no pre-expiry status polling is needed.
        const desired=nextPoll===null?start.createdAt+HORIZON:nextPoll||serverNow()+5000;
        while(serverNow()<desired){
          const remaining=maxWait-(now()-began);if(remaining<=0)return result('PENDING','WAIT_LIMIT');
          await sleep(Math.min(30000,desired-serverNow(),remaining));
        }
      }
      first=false;if(now()-began>=maxWait)return result('PENDING','WAIT_LIMIT');
      const {s,p}=status(await request(URLS.session,{op:'status'})),r=s.requests[requestId],b=start.baseline,stake=start.intent.stake;
      if(!r)return result('PENDING','ATTEMPT_NOT_FOUND');
      need(same(r.intent,start.intent),'COMMAND_CONFLICT');
      if(r.state==='rejected')return result('REFUSED',safeCode(r.result?.code));
      if(r.state==='reserved')return result('PENDING','ATTEMPT_RESERVED');
      need(validReceipt(r,start.intent)&&r.state==='accepted','INVALID_ACCEPTED_RECEIPT');shotId=r.result.shotId;
      if(wire)need(wire.shotId===shotId&&wire.receiptHash===hash(r),'RECEIPT_CHANGED');
      if(s.attempts!==b.attempts+1||s.grossCredits!==b.grossCredits+stake||s.pending!==null
        ||Object.keys(s.requests).length!==b.attempts+1||Object.entries(b.requestHashes).some(([id,h])=>!s.requests[id]||hash(s.requests[id])!==h))
        stop('SESSION_ACCOUNTING_CHANGED','INCONCLUSIVE');
      const openIds=ids(p.open),closedIds=ids(p.closed),closed=p.closed.find(row=>row.id===shotId),opened=p.open.find(row=>row.id===shotId),shot=closed||opened;
      need(shot&&shot.requestId===`session:${options.sessionId}:${requestId}`&&shot.stake===stake&&integer(shot.exp)
        &&shot.exp>=r.reservedAt+HORIZON&&shot.exp<=r.finishedAt+HORIZON&&r.finishedAt<start.expiresAt,'SHOT_IDENTITY_MISMATCH');
      if(!same(openIds,closed?[]:[shotId])||!same(closedIds,closed?[shotId,...b.closedIds].slice(0,20):b.closedIds))
        stop('CONCURRENT_ACTIVITY','INCONCLUSIVE');
      if(!closed){
        if(p.credits!==b.credits-stake||p.stated!==b.stated||p.brier!==b.brier)stop('CONCURRENT_ACCOUNTING_CHANGE','INCONCLUSIVE');
        if(!debit){await append({kind:'debit',credits:p.credits});debit=true;}
        nextPoll=Math.max(shot.exp,serverNow()+pollMs);emit('SETTLEMENT_PENDING');continue;
      }
      need(['hit','miss','void'].includes(closed.res)&&closed.side===start.intent.side&&closed.sp===start.intent.p
        &&integer(closed.settledAt)&&closed.settledAt>=shot.exp&&closed.settledAt<=serverNow()+2000,'TERMINAL_IDENTITY_MISMATCH');
      const hit=closed.res==='hit',voided=closed.res==='void',payout=hit?Math.floor(stake*b.hitPayout):voided?stake:0;
      if(p.credits!==b.credits-stake+payout||p.stated!==b.stated+(voided?0:1))stop('CONCURRENT_ACCOUNTING_CHANGE','INCONCLUSIVE');
      if(hit&&closed.back!==payout)stop('PAYOUT_CHANGED','INCONCLUSIVE');
      const loss=voided?null:(start.intent.p-(hit?1:0))**2;
      const mean=voided?b.brier:((b.brier??0)*b.stated+loss)/p.stated;
      const tolerance=voided?0:0.000051+b.stated*0.00005/p.stated;
      if(mean===null?p.brier!==null:!finite(p.brier)||Math.abs(p.brier-mean)>tolerance)stop('BRIER_ACCOUNTING_CHANGED','INCONCLUSIVE');
      const accounting={outcome:closed.res.toUpperCase(),stakeCredits:stake,creditsBefore:b.credits,creditsAfter:p.credits,
        statedBefore:b.stated,statedAfter:p.stated,squaredError:loss,brier:p.brier,brierCheck:'public-rounded-mean',
        remainingAttempts:s.limits.maxAttempts-s.attempts,remainingGrossCredits:s.limits.maxGrossCredits-s.grossCredits};
      if(!wire||!wirePersisted||!debit)return result('INCONCLUSIVE','SETTLED_WITHOUT_COMPLETE_WIRE_EVIDENCE',accounting);
      return result('PASS','PASS_'+closed.res.toUpperCase(),accounting);
    }
    return result('PENDING','WAIT_LIMIT');
  }catch(error){
    const code=error instanceof Stop?error.code:'RUNNER_FAILED';let category=error instanceof Stop?error.category:'FAILED';
    if(['submit','replay'].includes(phase)&&category==='FAILED'&&code!=='JOURNAL_WRITE_FAILED')category='PENDING';
    return result(category,code);
  }finally{try{await journal?.close?.();}catch{}}
}

export function parseArgs(args){
  const options={},seen=new Set();let file;
  const values=new Set(['--wallet','--session-id','--command-id','--target','--side','--p','--stake','--journal','--max-wait-seconds']);
  for(let i=0;i<args.length;i++){
    const flag=args[i];need(!seen.has(flag),'INVALID_ARGUMENTS');seen.add(flag);
    if(['--status','--execute','--resume'].includes(flag)){need(!options.mode,'INVALID_ARGUMENTS');options.mode=flag.slice(2);continue;}
    need(values.has(flag)&&typeof args[i+1]==='string'&&!args[i+1].startsWith('--'),'INVALID_ARGUMENTS');const value=args[++i];
    if(flag==='--journal')file=value;
    else if(flag==='--session-id')options.sessionId=value;
    else if(flag==='--command-id')options.commandId=value;
    else if(flag==='--max-wait-seconds')options.maxWaitMs=Number(value)*1000;
    else options[flag.slice(2)]=['--p','--stake'].includes(flag)?Number(value):value;
  }
  need(options.mode&&(options.mode==='status'?!file:!!file),'EXPLICIT_MODE_AND_JOURNAL_REQUIRED');
  if(options.mode!=='execute')need(!['commandId','target','side','p','stake'].some(key=>key in options),'STATUS_ONLY_MODE');
  return {options,file};
}
async function main(){
  if(process.argv.length===3&&process.argv[2]==='--help'){
    console.log('Status: node session-play.mjs --status --wallet OWNER --session-id SESSION_ID');
    console.log('Play once: node session-play.mjs --execute --wallet OWNER --session-id SESSION_ID --command-id X_POST_ID_OR_32HEX_NONCE --target CURRENT_5M_TARGET --side YES|NO --p 0.55 --journal NEW_PRIVATE_FILE [--stake 100] [--max-wait-seconds 1260]');
    console.log('Resume status only: node session-play.mjs --resume --wallet OWNER --session-id SESSION_ID --journal EXISTING_PRIVATE_FILE');
    console.log('Protected RATCHET_PLAY_SESSION env only. Public IDs never authorize play or prove X identity. One approved five-minute forecast, one open shot, remaining signed limits, 22min session lifetime. Reuse the command ID for the SAME instruction; never change it to retry. No grant, signer, transfer, reload, scheduler or demo.');return;
  }
  try{const {options,file}=parseArgs(process.argv.slice(2));
    const output=await runPlay(options,{...(file?{journal:createFileJournal(file)}:{}),onEvent:event=>console.log(JSON.stringify(event))});
    console.log(JSON.stringify(output));process.exitCode=output.ok?0:output.category==='PENDING'?2:1;
  }catch{console.log(JSON.stringify({ok:false,category:'FAILED',code:'INVALID_ARGUMENTS'}));process.exitCode=1;}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)await main();
