'use strict';
// Private capability transport, reusing the canonical game, never wallet signing.
const kv = require('./kv.js');
const bridge = require('./play_session_game.js');
const sessions = require('./play_session.js');
const {RELEASE} = require('./release.js');
const ORIGIN = 'https://ratchetx.xyz';
const OWNER_OPS = new Set(['grant','revoke','owner-status','recover']);
// Persist only known canonical codes. Raw inner errors may contain provider
// details or credentials and must never be echoed or stored in session receipts.
const SHOT_REFUSALS = Object.freeze({
  SHOT_REFUSED:'The game refused this attempt; a specific reason was not retained.',
  ORACLE_STALE:'The oracle observation was too old for the selected horizon.',
  ORACLE_CONFIDENCE_TOO_WIDE:'The oracle confidence interval exceeded the game limit.',
  FEED_UNAVAILABLE:'A required price feed was unavailable.',
  TARGET_UNAVAILABLE:'The target or side was not valid on the current or grace board.',
  CHAMBERS_FULL:'The wallet had no free forecast chamber.',
  INVALID_STAKE:'The stake was outside the canonical game limits.',
  INSUFFICIENT_CREDITS:'The wallet had insufficient existing play credits.',
  SETTLEMENT_DELIVERY_PENDING:'Existing settlement delivery must finish before another shot.',
  INVALID_PROBABILITY:'The stated probability was invalid.',
  AGENT_ADMISSION_REQUIRED:'The wallet did not meet existing arena admission requirements.',
  PLAYER_BUSY:'Another update held the player lock.',
  RATE_LIMITED:'The request exceeded the game rate limit.',
  WRITE_CONFLICT:'The guarded player state changed during the attempt.',
  WRITE_LEASE_EXPIRED:'The guarded writer lease expired.',
  CREDIT_QUEUE_CONFLICT:'The queued credit state changed during the attempt.',
});
function refusalCode(code){
  return typeof code==='string' && Object.hasOwn(SHOT_REFUSALS,code) ? code : 'SHOT_REFUSED';
}
function refusalOf(request){
  if(request?.state!=='rejected')return {};
  const code=refusalCode(request.result?.code);
  return {refusal:{code,reason:SHOT_REFUSALS[code],
    next:'This attempt is terminal. Replay only retrieves its receipt. Read status; another attempt requires remaining signed allowance or a new owner-approved session.'}};
}
const CODES = new Set(['INVALID_WALLET','INVALID_GRANT','INVALID_WINDOW','INVALID_LIMITS',
  'INVALID_SIGNATURE','INVALID_PAYLOAD','NON_CANONICAL_PAYLOAD','INVALID_REVOKE',
  'INVALID_OWNER_COMMAND','INVALID_CAPABILITY','UNKNOWN_SESSION','SESSION_REVOKED',
  'SESSION_EXPIRED','SESSION_CONTENTION','GRANT_CONFLICT','STALE_GRANT',
  'PRIOR_ATTEMPT_UNRESOLVED','SESSION_BUDGET_EXHAUSTED','SESSION_RATE_LIMIT',
  'REQUEST_CONFLICT','INVALID_INTENT','OUTCOME_CONFLICT','WRITE_CONFLICT',
  'WRITE_LEASE_EXPIRED','CREDIT_QUEUE_CONFLICT','AGENT_ADMISSION_REQUIRED',
  'OWNER_ACTION_MISMATCH','UNKNOWN_REQUEST','OWNER_PLAYER_MISMATCH','ATTEMPT_ALREADY_TERMINAL']);
function fail(code){throw Object.assign(new Error(code),{code});}
function admitted(p,w){return !!(p && p.w===w && p.agent && (p.qualified || p.x402Entry));}
function privateHeaders(req,res){
  res.setHeader('cache-control','no-store, private');
  res.setHeader('pragma','no-cache');
  res.setHeader('referrer-policy','no-referrer');
  res.setHeader('access-control-allow-origin',ORIGIN);
  res.setHeader('access-control-allow-methods','GET, POST, OPTIONS');
  res.setHeader('access-control-allow-headers','Content-Type, Authorization');
  res.setHeader('vary','Origin');
  // Bankr server-side requests have no browser Origin. A present Origin must
  // be the actual owner-consent site, not null/iframe/third-party origins.
  return !req.headers?.origin || req.headers.origin===ORIGIN;
}
async function invoke(game,req){
  let status=200,body=null;
  await game(req,{setHeader(){},status(n){status=n;return this;},
    json(v){body=v;return v;},end(){}});
  return {status,body};
}
async function handle(req,res,ctx){
  if(!privateHeaders(req,res))return res.status(403).json({ok:false,code:'ORIGIN_REFUSED'});
  const query=req.query||{};
  if(Object.keys(query).some(k=>k!=='action') || (query.action && query.action!=='play-session'))
    return res.status(400).json({ok:false,code:'QUERY_NOT_ALLOWED'});
  if(req.method==='OPTIONS')return res.status(204).end();
  if(req.method==='GET')return res.json({ok:true,v:RELEASE,enabled:kv.backend==='supabase',
    stage:'owner-approved-beta',network:sessions.NETWORK,rights:['shot','status'],
    setup:ORIGIN+'/play-session.html',endpoint:ORIGIN+'/api/game?action=play-session',
    credentialHeader:'Authorization: Bearer <private capability>',
    requiresExistingAdmittedAgent:true,budgetRule:sessions.BUDGET_RULE,
    limitBounds:{maxAttempts:100,maxStakeCredits:10000,maxGrossCredits:100000,maxDurationMs:86400000},
    agentContract:{method:'POST',contentType:'application/json',transport:'server-side HTTPS only; refuse redirects; no credentials in query/body/logs',
      status:{body:{op:'status'},effect:'Resolve expired shots through canonical settlement and return player credits/open/closed/Brier fields.',minPollIntervalSeconds:5},
      shot:{body:{op:'shot',intent:{requestId:'32 lowercase hex characters; persist and reuse for the SAME intent only',
        target:'exact active board target id',side:'YES or NO',p:'number 0.01..0.99 in steps of 0.01',stake:'integer play credits 100..10000, also bounded by your signed grant'}},
        replay:'Identical requestId and intent returns the retained receipt; never dispatches a second shot.',
        rejected:'HTTP 409 SHOT_REFUSED retains the canonical refusal code in request.result.code and a safe explanation in refusal. A replay may be HTTP 200 with ok:true but remains rejected; inspect request.state.',
        refusalCodes:SHOT_REFUSALS,
        uncertain:'A reserved/unknown response is not permission to create another request. Read status or request owner recovery.'},
      publicBoard:ORIGIN+'/api/game?action=board',
      installation:'Per-user protected secret only; this does not enable Bankr globally or prove caller authorship.'},
    forbidden:['transfer','reload','registration','wallet-signing','new-grants'],
    recovery:'Owner-signed status/recovery remains available after expiry/revocation. Never redispatch a reserved request.'});
  if(req.method!=='POST')return res.status(405).json({ok:false,code:'POST_REQUIRED'});
  if(kv.backend!=='supabase')return res.status(503).json({ok:false,code:'DURABLE_SESSION_STORE_REQUIRED'});
  const contentType=String(req.headers?.['content-type']||'').split(';')[0].trim().toLowerCase();
  if(contentType!=='application/json')return res.status(415).json({ok:false,code:'JSON_REQUIRED'});
  const b=req.body;
  if(!b || typeof b!=='object' || Array.isArray(b) || Buffer.byteLength(JSON.stringify(b))>8192)
    return res.status(400).json({ok:false,code:'INVALID_BODY'});
  const owner=OWNER_OPS.has(b.op);
  const allowed=owner ? ['op','payload','signature'] : b.op==='shot' ? ['op','intent'] : ['op'];
  if(Object.keys(b).some(k=>!allowed.includes(k)) || (!owner && !['shot','status'].includes(b.op)))
    return res.status(400).json({ok:false,code:'SCOPE_REFUSED'});
  try{
    if(owner){
      if(req.headers?.authorization)fail('INVALID_CAPABILITY');
      if(b.op==='grant'){
        const g=bridge.service.verifyGrant(b.payload,b.signature);
        if(!(await ctx.acquirePlayerLock(g.wallet)))return res.status(409).json({ok:false,code:'PLAYER_BUSY'});
        if(!admitted(await kv.getJSONStrict('u:'+g.wallet),g.wallet))fail('AGENT_ADMISSION_REQUIRED');
        const result=await bridge.service.grant(b.payload,b.signature);
        return res.json({ok:true,...result,wallet:g.wallet,expiresAt:g.expiresAt});
      }
      if(b.op==='revoke')return res.json({ok:true,...await bridge.service.revoke(b.payload,b.signature)});
      if(b.op==='owner-status')return res.json({ok:true,session:await bridge.service.ownerStatus(b.payload,b.signature)});
      const command=bridge.service.verifyOwner(b.payload,b.signature,'recover');
      if(!(await ctx.acquirePlayerLock(command.wallet)))return res.status(409).json({ok:false,code:'PLAYER_BUSY'});
      const p=await kv.getJSONStrict('u:'+command.wallet);
      if(!p || p.w!==command.wallet)fail('AGENT_ADMISSION_REQUIRED');
      ctx.trackPlayer(p,JSON.parse(JSON.stringify(p)));
      return res.json({ok:true,...await bridge.recover(command,p)});
    }
    const auth=req.headers?.authorization;
    if(typeof auth!=='string'||!/^Bearer rxp1\.[1-9A-HJ-NP-Za-km-z]{32,44}\.[a-f0-9]{32}\.[a-f0-9]{64}$/.test(auth))fail('INVALID_CAPABILITY');
    const token=auth.slice(7);
    const before=await bridge.service.status(token); // authenticate before player reads
    if(b.op==='status'){
      if(!(await kv.setnxJSON('play-status-throttle:'+before.wallet,{t:Date.now()},5)))
        return res.status(429).json({ok:false,code:'SESSION_RATE_LIMIT',retryAfterSeconds:5});
      if(!(await ctx.acquirePlayerLock(before.wallet)))return res.status(409).json({ok:false,code:'PLAYER_BUSY'});
      const player=await ctx.resolvePlayer(before.wallet);
      return res.json({ok:true,session:await bridge.service.status(token),player});
    }
    if(!admitted(await kv.getJSONStrict('u:'+before.wallet),before.wallet))fail('AGENT_ADMISSION_REQUIRED');
    const authorization=await bridge.service.authorize(token,b.intent);
    if(!authorization.dispatch)return res.json({ok:true,idempotent:true,request:authorization.request,...refusalOf(authorization.request),
      next:authorization.request.state==='reserved'?'owner recovery or status; never redispatch':'status'});
    const {permit,intent}=authorization;
    const inner={method:'POST',query:{},headers:{'content-type':'application/json',
      'x-forwarded-for':String(req.headers?.['x-forwarded-for']||req.socket?.remoteAddress||'session').slice(0,200)},
      socket:{},body:{action:'shot',auth:{wallet:permit.wallet},target:intent.target,side:intent.side,
        stake:intent.stake,p:intent.p,requestId:`session:${permit.id}:${intent.requestId}`}};
    bridge.markVerified(inner,permit,intent);
    const result=await invoke(ctx.game,inner);
    if(!result.body?.ok && result.status>=400 && result.status<500){
      // Only a definite refused call is terminalized here. A failed/ambiguous
      // write stays reserved for fenced owner recovery, never auto-dispatch.
      try{await bridge.service.finish(permit,{state:'rejected',code:refusalCode(result.body?.code)});}catch{}
    }
    let request;
    try{request=await bridge.service.receipt(permit);}catch{}
    if(request?.state==='accepted')return res.json({ok:true,request,
      ...(result.body?.ok?{shot:result.body.shot,credits:result.body.cr}:{}),
      next:'POST status after shot expiry; replay the same requestId to retrieve acceptance without another shot'});
    if(request?.state==='rejected')return res.status(409).json({ok:false,code:'SHOT_REFUSED',request,...refusalOf(request)});
    return res.status(202).json({ok:false,code:'ATTEMPT_UNRESOLVED',requestId:intent.requestId,
      next:'Owner-signed recovery fences delayed work. Do not change requestId or retry execution.'});
  }catch(e){
    const code=CODES.has(e.code)?e.code:'SESSION_UNAVAILABLE';
    const status=code==='SESSION_UNAVAILABLE'?503:code==='AGENT_ADMISSION_REQUIRED'?403:
      ['SESSION_RATE_LIMIT','SESSION_BUDGET_EXHAUSTED'].includes(code)?429:
      /CONFLICT|CONTENTION|UNRESOLVED|WRITE_LEASE/.test(code)?409:401;
    return res.status(status).json({ok:false,code,
      ...(code==='AGENT_ADMISSION_REQUIRED'?{next:'Connect this same wallet on /agents and complete normal arena admission; this endpoint never registers or reloads.'}:{})});
  }
}
module.exports={handle,privateHeaders,admitted};
