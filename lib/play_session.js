'use strict';

// Bounded authorization and receipt preparation. Accepted receipts are NEVER
// written here: play_session_game supplies them to the canonical player commit.
const crypto = require('node:crypto');
const {isDeepStrictEqual} = require('node:util');
const {b58decode, isWalletShaped} = require('./verify.js');
const {PREFIX} = require('./play_session_record.js');
const VERSION = 'play-session-v1';
const DOMAIN = 'ratchetx.xyz';
const NETWORK = 'solana:mainnet';
const BUDGET_RULE = 'gross-reserved-attempts-v1';
const HEX32 = /^[a-f0-9]{32}$/;
const HEX64 = /^[a-f0-9]{64}$/;
const digest = s => crypto.createHash('sha256').update(s).digest('hex');
const revision = () => crypto.randomBytes(16).toString('hex');

function fail(code) { const e = new Error(code); e.code = code; throw e; }
function integer(n, min, max) { return Number.isSafeInteger(n) && n >= min && n <= max; }
function wallet(w) {
  try { if (typeof w === 'string' && isWalletShaped(w) && b58decode(w).length === 32) return w; } catch {}
  fail('INVALID_WALLET');
}
function canonicalGrant(input, now = Date.now()) {
  if (!input || typeof input !== 'object') fail('INVALID_GRANT');
  const w = wallet(input.wallet);
  if (typeof input.id !== 'string' || !HEX32.test(input.id)
    || typeof input.tokenHash !== 'string' || !HEX64.test(input.tokenHash)) fail('INVALID_GRANT');
  if (!integer(input.issuedAt, now - 300000, now + 5000)
    || !integer(input.expiresAt, Math.max(now + 1, input.issuedAt + 60000), input.issuedAt + 86400000)) fail('INVALID_WINDOW');
  const l = input.limits;
  if (!l || !integer(l.maxAttempts, 1, 100) || !integer(l.maxStakeCredits, 100, 10000000)
    || !integer(l.maxGrossCredits, l.maxStakeCredits, 100000000)
    || !integer(l.minIntervalMs, 1000, 600000)) fail('INVALID_LIMITS');
  return {domain:DOMAIN, network:NETWORK, version:VERSION, action:'grant', wallet:w,
    id:input.id, tokenHash:input.tokenHash, issuedAt:input.issuedAt, expiresAt:input.expiresAt,
    actions:['shot','status'], budgetRule:BUDGET_RULE, inFlightPolicy:'finish-authorized-attempt-no-retry-v1',
    limits:{maxAttempts:l.maxAttempts,maxStakeCredits:l.maxStakeCredits,
      maxGrossCredits:l.maxGrossCredits,minIntervalMs:l.minIntervalMs}};
}
function canonicalRevoke(input, now = Date.now()) {
  if (!input || typeof input.id !== 'string' || !HEX32.test(input.id)
    || !integer(input.issuedAt, now - 300000, now + 5000)) fail('INVALID_REVOKE');
  return {domain:DOMAIN,network:NETWORK,version:VERSION,action:'revoke',wallet:wallet(input.wallet),
    id:input.id,issuedAt:input.issuedAt};
}
function canonicalOwner(input, now = Date.now()) {
  if (!input || !['owner_status','recover'].includes(input.action)
    || typeof input.id !== 'string' || !HEX32.test(input.id)
    || !integer(input.issuedAt, now - 300000, now + 5000)) fail('INVALID_OWNER_COMMAND');
  const out = {domain:DOMAIN,network:NETWORK,version:VERSION,action:input.action,
    wallet:wallet(input.wallet),id:input.id,issuedAt:input.issuedAt};
  if (input.action === 'recover') {
    if (typeof input.requestId !== 'string' || !HEX32.test(input.requestId)) fail('INVALID_OWNER_COMMAND');
    out.requestId = input.requestId;
  }
  return out;
}
// ID-less discovery is a separate signed action. Existing ID-bound commands
// retain their exact canonical bytes and cannot be replayed as discovery.
function canonicalDiscovery(input, now = Date.now()) {
  if (!input || typeof input.nonce !== 'string' || !HEX32.test(input.nonce)
    || !integer(input.issuedAt, now - 300000, now + 5000)) fail('INVALID_OWNER_COMMAND');
  return {domain:DOMAIN,network:NETWORK,version:VERSION,action:'owner_discover',
    wallet:wallet(input.wallet),issuedAt:input.issuedAt,nonce:input.nonce};
}
function verifySigned(payload, signature, normalize, now) {
  if (typeof payload !== 'string' || payload.length > 2048 || typeof signature !== 'string'
    || !/^[A-Za-z0-9+/]{86}==$/.test(signature)) fail('INVALID_SIGNATURE');
  let parsed;
  try { parsed = JSON.parse(payload); } catch { fail('INVALID_PAYLOAD'); }
  const value = normalize(parsed, now);
  if (JSON.stringify(value) !== payload) fail('NON_CANONICAL_PAYLOAD');
  const key = crypto.createPublicKey({key:Buffer.concat([
    Buffer.from('302a300506032b6570032100','hex'),b58decode(value.wallet)]),format:'der',type:'spki'});
  if (!crypto.verify(null,Buffer.from(payload),key,Buffer.from(signature,'base64'))) fail('INVALID_SIGNATURE');
  return value;
}
function parseToken(token) {
  if (typeof token !== 'string' || token.length > 160) fail('INVALID_CAPABILITY');
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== 'rxp1' || !HEX32.test(parts[2]) || !HEX64.test(parts[3])) fail('INVALID_CAPABILITY');
  return {wallet:wallet(parts[1]),id:parts[2],tokenHash:digest(token)};
}
function checkToken(record, token, now) {
  if (!record || record.grant.id !== token.id || !crypto.timingSafeEqual(
    Buffer.from(record.grant.tokenHash,'hex'),Buffer.from(token.tokenHash,'hex'))) fail('INVALID_CAPABILITY');
  if (record.revokedAt != null) fail('SESSION_REVOKED');
  if (now >= record.grant.expiresAt) fail('SESSION_EXPIRED');
}
function normalizeIntent(input) {
  if (!input || Object.keys(input).some(k => !['requestId','target','side','p','stake'].includes(k))
    || typeof input.requestId !== 'string' || !HEX32.test(input.requestId) || typeof input.target !== 'string'
    || !/^[A-Za-z0-9:_-]{3,96}$/.test(input.target)
    || !['YES','NO'].includes(input.side) || typeof input.p !== 'number'
    || !Number.isFinite(input.p) || input.p < 0.01 || input.p > 0.99
    || Math.abs(input.p * 100 - Math.round(input.p * 100)) > 1e-9
    || !integer(input.stake,100,10000000)) fail('INVALID_INTENT');
  return {requestId:input.requestId,target:input.target,side:input.side,p:input.p,stake:input.stake};
}

// The wallet key is the latest retained session, not an archive or index.
// Validate stored shape without reapplying grant-signature freshness: expired
// and revoked records intentionally remain discoverable for owner recovery.
// Explicit projection excludes verifier hashes, revisions and future extras.
function discoverySnapshot(w, record, observedAt) {
  try {
    const g=record?.grant,l=g?.limits;
    if (!record || !g || g.wallet!==w || g.domain!==DOMAIN || g.network!==NETWORK
      || g.version!==VERSION || g.action!=='grant' || typeof g.id!=='string' || !HEX32.test(g.id)
      || typeof g.tokenHash!=='string' || !HEX64.test(g.tokenHash)
      || typeof record.revision!=='string' || !HEX32.test(record.revision)
      || !integer(g.issuedAt,0,Number.MAX_SAFE_INTEGER)
      || !integer(g.expiresAt,g.issuedAt+60000,g.issuedAt+86400000)
      || !isDeepStrictEqual(g.actions,['shot','status']) || g.budgetRule!==BUDGET_RULE
      || g.inFlightPolicy!=='finish-authorized-attempt-no-retry-v1'
      || !l || !integer(l.maxAttempts,1,100) || !integer(l.maxStakeCredits,100,10000000)
      || !integer(l.maxGrossCredits,l.maxStakeCredits,100000000) || !integer(l.minIntervalMs,1000,600000)
      || !integer(record.attempts,0,l.maxAttempts) || !integer(record.grossCredits,0,l.maxGrossCredits)
      || !(record.revokedAt===null || integer(record.revokedAt,0,Number.MAX_SAFE_INTEGER))
      || !(record.pending===null || typeof record.pending==='string' && HEX32.test(record.pending))
      || !record.requests || typeof record.requests!=='object' || Array.isArray(record.requests))
      fail('SESSION_UNAVAILABLE');
    const entries=Object.entries(record.requests),requests={};
    if(entries.length!==record.attempts)fail('SESSION_UNAVAILABLE');
    let gross=0,pending=null;
    for(const [id,request] of entries){
      const intent=normalizeIntent(request?.intent);
      if(!HEX32.test(id) || intent.requestId!==id || request.stake!==intent.stake
        || typeof request.intentHash!=='string' || !HEX64.test(request.intentHash)
        || !integer(request.reservedAt,0,Number.MAX_SAFE_INTEGER)
        || !['reserved','accepted','rejected'].includes(request.state))fail('SESSION_UNAVAILABLE');
      const row={intent,stake:request.stake,state:request.state,reservedAt:request.reservedAt};
      gross+=request.stake;
      if(request.state==='reserved'){
        if(pending!==null || request.result!==undefined || request.finishedAt!==undefined)fail('SESSION_UNAVAILABLE');
        pending=id;
      }else{
        if(!integer(request.finishedAt,0,Number.MAX_SAFE_INTEGER) || request.result?.state!==request.state)
          fail('SESSION_UNAVAILABLE');
        if(request.state==='accepted'){
          if(typeof request.result.shotId!=='string' || !/^[a-f0-9]{12}$/.test(request.result.shotId))fail('SESSION_UNAVAILABLE');
          row.result={state:'accepted',shotId:request.result.shotId};
        }else{
          if(typeof request.result.code!=='string' || !/^[A-Z0-9_]{1,64}$/.test(request.result.code))fail('SESSION_UNAVAILABLE');
          row.result={state:'rejected',code:request.result.code};
        }
        row.finishedAt=request.finishedAt;
      }
      requests[id]=row;
    }
    if(gross!==record.grossCredits || pending!==record.pending)fail('SESSION_UNAVAILABLE');
    return {wallet:w,id:g.id,expiresAt:g.expiresAt,revokedAt:record.revokedAt,
      expired:observedAt>=g.expiresAt,limits:{maxAttempts:l.maxAttempts,maxStakeCredits:l.maxStakeCredits,
        maxGrossCredits:l.maxGrossCredits,minIntervalMs:l.minIntervalMs},budgetRule:BUDGET_RULE,
      attempts:record.attempts,grossCredits:record.grossCredits,pending:record.pending,requests};
  }catch{fail('SESSION_UNAVAILABLE');}
}

function createService({kv, now = Date.now}) {
  if (!kv || typeof kv.casPlaySession !== 'function') fail('SESSION_STORE_UNAVAILABLE');
  const permits = new WeakMap();
  const ownerCommands = new WeakSet();
  const read = w => kv.getJSONStrict(PREFIX + w);
  async function change(w, fn) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const current = await read(w);
      const decision = fn(current);
      if (!decision.next) return decision.result;
      decision.next.revision = revision();
      if (await kv.casPlaySession(PREFIX + w,current?.revision ?? null,decision.next)) return decision.result;
    }
    fail('SESSION_CONTENTION');
  }
  function verifyGrant(payload, signature) {
    return verifySigned(payload,signature,canonicalGrant,now());
  }
  async function grant(payload, signature) {
    const g = verifyGrant(payload,signature);
    return change(g.wallet,current => {
      if (now() >= g.expiresAt) fail('SESSION_EXPIRED');
      if (current?.grant.id === g.id) {
        if (!isDeepStrictEqual(current.grant,g)) fail('GRANT_CONFLICT');
        if (current.revokedAt != null) fail('SESSION_REVOKED');
        return {result:{id:g.id,idempotent:true}};
      }
      if (current?.pending) fail('PRIOR_ATTEMPT_UNRESOLVED');
      if (current && g.issuedAt <= current.grant.issuedAt) fail('STALE_GRANT');
      return {next:{grant:g,revokedAt:null,attempts:0,grossCredits:0,lastReservedAt:null,
        pending:null,requests:{}},result:{id:g.id,idempotent:false}};
    });
  }
  async function revoke(payload, signature) {
    const r = verifySigned(payload,signature,canonicalRevoke,now());
    return change(r.wallet,current => {
      if (!current || current.grant.id !== r.id) fail('UNKNOWN_SESSION');
      if (current.revokedAt != null) return {result:{revoked:true,idempotent:true}};
      // Already reserved attempts may finish. Revocation never refunds allowance
      // or promises cancellation of a write which was already authorized.
      return {next:{...current,revokedAt:now()},result:{revoked:true,idempotent:false}};
    });
  }
  async function authorize(tokenText, input) {
    const t = parseToken(tokenText), intent = Object.freeze(normalizeIntent(input));
    const intentHash = digest(JSON.stringify(intent));
    const out = await change(t.wallet,current => {
      checkToken(current,t,now());
      const old = current.requests[intent.requestId];
      if (old) {
        if (old.intentHash !== intentHash) fail('REQUEST_CONFLICT');
        return {result:{dispatch:false,request:structuredClone(old)}};
      }
      if (current.pending) fail('PRIOR_ATTEMPT_UNRESOLVED');
      const l = current.grant.limits;
      if (intent.stake > l.maxStakeCredits || current.attempts >= l.maxAttempts
        || current.grossCredits + intent.stake > l.maxGrossCredits) fail('SESSION_BUDGET_EXHAUSTED');
      const time = now();
      if (current.lastReservedAt != null && time - current.lastReservedAt < l.minIntervalMs) fail('SESSION_RATE_LIMIT');
      const request = {intentHash,intent:{...intent},stake:intent.stake,state:'reserved',reservedAt:time};
      return {next:{...current,attempts:current.attempts+1,grossCredits:current.grossCredits+intent.stake,
        lastReservedAt:time,pending:intent.requestId,requests:{...current.requests,[intent.requestId]:request}},
      result:{dispatch:true,request,expiresAt:current.grant.expiresAt}};
    });
    if (!out.dispatch) return out;
    // A slow storage call may outlive the grant after the decision was made.
    // Keep its reservation fail-closed; never hand out a fresh expired permit.
    if (now() >= out.expiresAt) fail('SESSION_EXPIRED');
    // In-memory branded permit: JSON from a caller cannot authorize completion.
    const permit = Object.freeze({wallet:t.wallet,id:t.id,requestId:intent.requestId,expiresAt:out.expiresAt});
    permits.set(permit,{intentHash,intent});
    return {...out,permit,intent};
  }
  function permitContext(permit, input) {
    const internal = permits.get(permit);
    if (!internal) fail('INVALID_PERMIT');
    if (!isDeepStrictEqual(internal.intent,normalizeIntent(input))) fail('REQUEST_CONFLICT');
    return {...permit,intent:internal.intent};
  }
  async function receipt(permit) {
    const internal = permits.get(permit);
    if (!internal) fail('INVALID_PERMIT');
    const current = await read(permit.wallet);
    if (!current || current.grant.id !== permit.id) fail('UNKNOWN_SESSION');
    const request = current.requests[permit.requestId];
    if (!request || request.intentHash !== internal.intentHash) fail('REQUEST_CONFLICT');
    // An in-flight worker can still report its already-authorized outcome if
    // the owner revokes or the grant expires before the HTTP response arrives.
    // This does not admit a new bearer request or authorize another dispatch.
    return structuredClone(request);
  }
  function terminalEntry(current, requestId, result) {
    const request = current.requests[requestId];
    return {key:PREFIX+current.grant.wallet,expected:current,value:{...current,revision:revision(),
      pending:null,requests:{...current.requests,
        [requestId]:{...request,state:result.state,result,finishedAt:now()}}}};
  }
  async function prepareAcceptance(permit, shotId) {
    const internal = permits.get(permit);
    if (!internal) fail('INVALID_PERMIT');
    if (typeof shotId !== 'string' || !/^[a-f0-9]{12}$/.test(shotId)) fail('INVALID_OUTCOME');
    const current = await read(permit.wallet);
    // The guarded player lease is also capped to this deadline by the bridge,
    // so a slow database acknowledgement cannot admit a newly expired shot.
    if (now() >= permit.expiresAt) fail('SESSION_EXPIRED');
    if (!current || current.grant.id !== permit.id) fail('UNKNOWN_SESSION');
    const request = current.requests[permit.requestId];
    if (!request || request.intentHash !== internal.intentHash
      || !isDeepStrictEqual(request.intent,internal.intent)) fail('REQUEST_CONFLICT');
    if (request.state !== 'reserved') fail('ATTEMPT_ALREADY_TERMINAL');
    if (current.pending !== permit.requestId) fail('REQUEST_CONFLICT');
    // Revocation intentionally does not cancel already reserved work. Copy the
    // current record, including revokedAt, and CAS the whole expected record.
    return terminalEntry(current,permit.requestId,{state:'accepted',shotId});
  }
  async function finish(permit, outcome) {
    const internal = permits.get(permit);
    if (!internal) fail('INVALID_PERMIT');
    let result;
    if (outcome?.state === 'accepted') fail('ATOMIC_ACCEPTANCE_REQUIRED');
    if (outcome?.state === 'rejected' && typeof outcome.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(outcome.code))
      result = {state:'rejected',code:outcome.code};
    else fail('INVALID_OUTCOME');
    return change(permit.wallet,current => {
      if (!current || current.grant.id !== permit.id) fail('UNKNOWN_SESSION');
      const request = current.requests[permit.requestId];
      if (!request || request.intentHash !== internal.intentHash) fail('REQUEST_CONFLICT');
      if (request.state !== 'reserved') {
        if (!isDeepStrictEqual(request.result,result)) fail('OUTCOME_CONFLICT');
        return {result:{idempotent:true}};
      }
      if (current.pending !== permit.requestId) fail('REQUEST_CONFLICT');
      return {next:{...current,pending:null,requests:{...current.requests,
        [permit.requestId]:{...request,state:result.state,result,finishedAt:now()}}},result:{idempotent:false}};
    });
  }
  function publicStatus(w, r) {
    return {wallet:w,id:r.grant.id,expiresAt:r.grant.expiresAt,revokedAt:r.revokedAt,
      expired:now() >= r.grant.expiresAt,limits:{...r.grant.limits},
      budgetRule:BUDGET_RULE,attempts:r.attempts,grossCredits:r.grossCredits,pending:r.pending,
      requests:structuredClone(r.requests)};
  }
  async function status(tokenText) {
    const t = parseToken(tokenText), r = await read(t.wallet);
    checkToken(r,t,now());
    return publicStatus(t.wallet,r);
  }
  function verifyOwner(payload, signature, action) {
    if (!['owner_status','recover','owner_discover'].includes(action)) fail('INVALID_OWNER_COMMAND');
    const command = verifySigned(payload,signature,action==='owner_discover'?canonicalDiscovery:canonicalOwner,now());
    if (command.action !== action) fail('OWNER_ACTION_MISMATCH');
    Object.freeze(command); ownerCommands.add(command);
    return command;
  }
  function checkOwner(command, action) {
    if (!ownerCommands.has(command) || command.action !== action) fail('INVALID_OWNER_COMMAND');
  }
  async function ownerStatus(payload, signature) {
    const command = typeof payload === 'object' ? payload : verifyOwner(payload,signature,'owner_status');
    checkOwner(command,'owner_status');
    const current = await read(command.wallet);
    if (!current || current.grant.id !== command.id) fail('UNKNOWN_SESSION');
    return publicStatus(command.wallet,current);
  }
  async function ownerDiscover(payload, signature) {
    const command=typeof payload==='object'?payload:verifyOwner(payload,signature,'owner_discover');
    checkOwner(command,'owner_discover');
    // Verify before the single strict read. No player access, nonce consumption,
    // settlement or state mutation: a repeated fresh signature rereads latest.
    const current=await read(command.wallet),observedAt=now();
    return {wallet:command.wallet,nonce:command.nonce,observedAt,
      session:current===null?null:discoverySnapshot(command.wallet,current,observedAt)};
  }
  async function prepareRecovery(command) {
    checkOwner(command,'recover');
    const current = await read(command.wallet);
    if (!current || current.grant.id !== command.id) fail('UNKNOWN_SESSION');
    const request = current.requests[command.requestId];
    if (!request) fail('UNKNOWN_REQUEST');
    if (request.state !== 'reserved') return {idempotent:true,request:structuredClone(request)};
    if (current.pending !== command.requestId) fail('REQUEST_CONFLICT');
    const entry = terminalEntry(current,command.requestId,{state:'rejected',code:'RECOVERED_NO_DISPATCH'});
    return {entry,idempotent:false,request:structuredClone(entry.value.requests[command.requestId])};
  }
  return {grant,verifyGrant,revoke,authorize,finish,status,permitContext,receipt,prepareAcceptance,
    verifyOwner,ownerStatus,ownerDiscover,prepareRecovery};
}

module.exports = {VERSION,DOMAIN,NETWORK,BUDGET_RULE,canonicalGrant,canonicalRevoke,
  canonicalOwner,canonicalDiscovery,normalizeIntent,parseToken,createService};
