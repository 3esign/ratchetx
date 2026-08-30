// Operator-only isolated storage probe. No game/API dispatch, chain access,
// signatures, user wallets, rankings or real credits. Never load credential files.
import assert from 'node:assert/strict';
import {randomBytes, createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const require = createRequire(import.meta.url);
const {PublicKey} = require('@solana/web3.js');
const {prepare, receiptKey} = require('../lib/guarded_commit.js');
const sessions = require('../lib/play_session.js');
const {serverHeaders} = require('../lib/supabase_auth.js');
const PROJECT = 'gxwffzshaicpewbkziau';
const ORIGIN = `https://${PROJECT}.supabase.co`;
const marker = '_isolatedPlaySessionProbe';
const hex = () => randomBytes(16).toString('hex');
const clone = value => structuredClone(value);
function fail(code) { throw Object.assign(new Error(code),{code}); }

// Exported only to permit an offline fixture harness. The CLI below is the only
// live entrypoint and refuses writes without explicit opt-in/project validation.
export async function probe({kv, table, onStart = () => {}}) {
  const probeId = hex();
  let walletBytes;
  do { walletBytes = randomBytes(32); } while (PublicKey.isOnCurve(walletBytes));
  const wallet = new PublicKey(walletBytes).toBase58(); // deliberately unowned
  const sessionKey = 'play-session:v1:'+wallet, playerKey = 'u:'+wallet;
  const leaseKey = 'lock:'+playerKey;
  const acceptedId = hex(), refusedId = hex();
  const exactKeys = [sessionKey,playerKey,leaseKey,receiptKey(acceptedId),receiptKey(refusedId)];
  const digests = new Map();
  let armed = false, token = null;
  onStart({probeId,fixtureWallet:wallet,cleanupKeys:exactKeys});
  try {
    // Read raw table rows, not TTL-hiding getters: even an expired collision is
    // a refusal. This is an exact IN filter over five newly generated keys.
    assert.deepEqual(await table('GET',exactKeys),[],'fixture namespace must be absent');
    armed = true;
    const startedAt = Date.now(), sessionId = hex(), requestId = hex();
    const grant = sessions.canonicalGrant({wallet,id:sessionId,issuedAt:startedAt,
      expiresAt:startedAt+120000,
      tokenHash:createHash('sha256').update('not-a-capability:'+probeId).digest('hex'),
      limits:{maxAttempts:1,maxStakeCredits:100,maxGrossCredits:100,minIntervalMs:5000}},startedAt);
    const initialSession = {grant,revokedAt:null,attempts:0,grossCredits:0,lastReservedAt:null,
      pending:null,requests:{},revision:hex(),[marker]:probeId};
    assert.equal(await kv.casPlaySession(sessionKey,null,initialSession),true);
    assert.equal(await kv.casPlaySession(sessionKey,null,{...initialSession,revision:hex()}),false,
      'duplicate insertion must not overwrite the existing session');
    const initialPlayer = {w:wallet,cr:1000,qualified:false,open:[],closed:[],_writeGuard:1,[marker]:probeId};
    token = `${Date.now()}-${hex()}`;
    const lease = {key:leaseKey,token,expiresAt:Math.min(Date.now()+120000,grant.expiresAt)};
    const inserted = await Promise.all([
      kv.setnxJSON(playerKey,initialPlayer),kv.setnxJSON(leaseKey,token,120),
    ]);
    assert.deepEqual(inserted,[true,true],'fixture player and lease must be newly inserted');

    const intent = sessions.normalizeIntent({requestId,target:'FIXTURE_NO_GAME',side:'YES',p:0.5,stake:100});
    const request = {intentHash:createHash('sha256').update(JSON.stringify(intent)).digest('hex'),
      intent,stake:100,state:'reserved',reservedAt:Date.now()};
    const candidates = [0,1].map(()=>({...initialSession,revision:hex(),attempts:1,grossCredits:100,
      lastReservedAt:request.reservedAt,pending:requestId,requests:{[requestId]:request}}));
    const contenders = await Promise.all(candidates.map(next=>kv.casPlaySession(sessionKey,initialSession.revision,next)));
    assert.equal(contenders.filter(Boolean).length,1,'one real concurrent PostgREST CAS winner');
    assert.equal(await kv.casPlaySession(sessionKey,initialSession.revision,{...candidates[0],revision:hex()}),false,
      'the stale revision must be refused');
    const reserved = await kv.getJSONStrict(sessionKey);
    assert.deepEqual(reserved,candidates[contenders[0]?0:1]);
    const shotId = randomBytes(6).toString('hex');
    const shot = {id:shotId,requestId:`session:${sessionId}:${requestId}`,side:'YES',sp:0.5,stake:100,[marker]:probeId};
    const acceptedPlayer = {...initialPlayer,cr:900,open:[shot]};
    const acceptedSession = {...reserved,revision:hex(),pending:null,requests:{[requestId]:{
      ...reserved.requests[requestId],state:'accepted',result:{state:'accepted',shotId},finishedAt:Date.now(),
    }}};
    const transaction = (id,expectedSession) => {
      const tx = {id,entries:[{key:playerKey,expected:initialPlayer,value:acceptedPlayer},
        {key:sessionKey,expected:expectedSession,value:acceptedSession}],debits:[],leases:[lease]};
      digests.set(receiptKey(id),prepare(tx).digest);
      return tx;
    };
    const refusedTx = transaction(refusedId,initialSession);
    assert.deepEqual(await kv.commitGuarded(refusedTx),{ok:false,code:'WRITE_CONFLICT'});
    assert.deepEqual(await kv.getManyJSON([playerKey,sessionKey,receiptKey(refusedId)]),
      [initialPlayer,reserved,null],'stale session must roll back the proposed player debit and receipt');

    const acceptedTx = transaction(acceptedId,reserved);
    assert.deepEqual(await kv.commitGuarded(acceptedTx),{ok:true,replay:false});
    assert.deepEqual(await kv.commitGuarded(acceptedTx),{ok:true,replay:true},
      'identical acknowledgement-loss retry must replay one receipt');
    const conflict = clone(acceptedTx);conflict.entries[0].value.cr=800;
    assert.deepEqual(await kv.commitGuarded(conflict),{ok:false,code:'COMMIT_ID_CONFLICT'});
    assert.deepEqual(await kv.getManyJSON([playerKey,sessionKey,receiptKey(acceptedId)]),
      [acceptedPlayer,acceptedSession,{digest:digests.get(receiptKey(acceptedId))}],
      'one debit, one shot and accepted session receipt must remain stable together');
    return {project:PROJECT,probeId,fixtureWallet:wallet,postgrestCas:true,staleCasRefused:true,
      guardedAtomicAcceptance:true,staleSessionRollback:true,receiptReplay:true,conflictingReplayRefused:true,
      cleanup:'PASS',chainRequests:0,realPlayerRowsRead:0};
  } finally {
    if (armed) {
      try {
        const rows = await table('GET',exactKeys);
        assert.ok(Array.isArray(rows) && rows.every(row=>exactKeys.includes(row.key)));
        const owned = rows.filter(row=>[sessionKey,playerKey].includes(row.key)
          ? row.value?.[marker]===probeId
          : row.key===leaseKey ? token!==null && row.value===token
          : digests.has(row.key) && row.value?.digest===digests.get(row.key));
        // Never delete an unexpected row, even in the cryptographically unlikely
        // event of a namespace collision. Delete only this run's verified keys.
        if (owned.length) await table('DELETE',owned.map(row=>row.key));
        assert.deepEqual(await table('GET',exactKeys),[],'exact fixture cleanup must be verified');
      } catch {
        throw Object.assign(new Error('CLEANUP_INCOMPLETE'),{code:'CLEANUP_INCOMPLETE',cleanupKeys:exactKeys});
      }
    }
  }
}

function privateInput() {
  if (!process.stdin.isTTY) fail('PRIVATE_TTY_REQUIRED');
  return new Promise((resolveInput,rejectInput)=>{
    const previousRaw = !!process.stdin.isRaw;
    let buffer='',done=false;
    const finish = (error,value) => {
      if(done)return;done=true;buffer='';clearTimeout(timer);
      process.stdin.off('data',read);process.stdin.off('end',ended);
      process.stdin.setRawMode(previousRaw);process.stdin.pause();
      if(error)rejectInput(Object.assign(new Error(error),{code:error}));else resolveInput(value);
    };
    const ended = () => finish('PRIVATE_INPUT_ENDED');
    const read = chunk => {
      buffer+=chunk.toString();
      if(buffer.includes('\x03'))return finish('PRIVATE_INPUT_CANCELLED');
      if(buffer.length>8192)return finish('PRIVATE_INPUT_TOO_LARGE');
      let input;try{input=JSON.parse(buffer.trim());}catch{return;}
      if(!input || typeof input!=='object' || Array.isArray(input)
        || Object.keys(input).some(key=>key!=='apiKey') || typeof input.apiKey!=='string')
        return finish('INVALID_PRIVATE_INPUT');
      const key=input.apiKey;input.apiKey='';finish(null,key);
    };
    const timer=setTimeout(()=>finish('PRIVATE_INPUT_TIMEOUT'),60000);
    process.stdin.setRawMode(true);process.stdin.resume();
    process.stdin.on('data',read);process.stdin.once('end',ended);
    console.log('PRIVATE_SESSION_INPUT_READY');
  });
}

async function main() {
  const args=process.argv.slice(2);
  if(args.length===1 && args[0]==='--help') {
    console.log('Usage: node tools/play_session_live_probe.mjs --isolated-fixture-write [--private-input]');
    console.log('Exact production project only. Uses env SUPABASE_URL plus server key, or private raw-TTY {apiKey}.');
    console.log('Writes five isolated synthetic fixture keys at most, then verifies exact cleanup. No chain/game calls.');
    console.log('Cleanup keys are printed before writes for recovery after process termination/network loss. No secrets are printed.');
    return;
  }
  if(!args.includes('--isolated-fixture-write'))fail('EXPLICIT_ISOLATED_FIXTURE_WRITE_REQUIRED');
  if(new Set(args).size!==args.length || args.some(arg=>!['--isolated-fixture-write','--private-input'].includes(arg)))fail('INVALID_ARGUMENTS');
  const privateMode=args.includes('--private-input');
  let endpoint;
  try{endpoint=new URL(process.env.SUPABASE_URL || (privateMode?ORIGIN:''));}catch{fail('INVALID_PROJECT');}
  if(endpoint.origin!==ORIGIN || endpoint.pathname!=='/' || endpoint.username || endpoint.password
    || endpoint.search || endpoint.hash)fail('WRONG_PROJECT');
  if(privateMode){process.env.SUPABASE_SERVICE_KEY=await privateInput();delete process.env.SUPABASE_SERVICE_ROLE_KEY;}
  const key=process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(process.env.SUPABASE_SERVICE_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY
    && process.env.SUPABASE_SERVICE_KEY!==process.env.SUPABASE_SERVICE_ROLE_KEY)fail('AMBIGUOUS_SERVER_CREDENTIAL');
  if(typeof key!=='string' || !key || /[\x00-\x20\x7f]/.test(key))fail('INVALID_SERVER_CREDENTIAL');
  if(!key.startsWith('sb_secret_')) {
    let claims;try{claims=JSON.parse(Buffer.from(key.split('.')[1]||'','base64url').toString());}catch{fail('SERVER_CREDENTIAL_REQUIRED');}
    if(claims?.role!=='service_role' || (claims.ref && claims.ref!==PROJECT))fail('SERVER_CREDENTIAL_REQUIRED');
  }
  process.env.SUPABASE_URL=ORIGIN;
  const headers={...serverHeaders(key),'Content-Type':'application/json',Accept:'application/json'};
  const kv=require('../lib/supabase_kv.js'); // credentials enter adapter memory only after validation
  if(kv.backend!=='supabase')fail('SUPABASE_ADAPTER_REQUIRED');
  let requests=0;
  const originalFetch=globalThis.fetch;
  const paths=new Set(['/rest/v1/ratchet_kv','/rest/v1/rpc/ratchet_kv_guarded_ready',
    '/rest/v1/rpc/ratchet_kv_setnx','/rest/v1/rpc/ratchet_kv_get',
    '/rest/v1/rpc/ratchet_kv_mget','/rest/v1/rpc/ratchet_kv_commit_guarded']);
  globalThis.fetch=(url,options)=>{
    const destination=new URL(url);
    if(destination.origin!==ORIGIN || !paths.has(destination.pathname) || options?.redirect!=='error')fail('NETWORK_SCOPE_REFUSED');
    requests++;return originalFetch(url,options);
  };
  const table=async(method,keys)=>{
    if(!keys.length || keys.length>5 || keys.some(k=>! /^(?:play-session:v1:|u:|lock:u:|guarded:receipt:)[A-Za-z0-9]+$/.test(k)))fail('INVALID_EXACT_KEYS');
    const query=new URLSearchParams({key:'in.('+keys.join(',')+')',select:method==='GET'?'key,value':'key'});
    const response=await fetch(ORIGIN+'/rest/v1/ratchet_kv?'+query,{method,redirect:'error',
      headers:{...headers,Prefer:'return=representation'},signal:AbortSignal.timeout(10000)});
    if(!response.ok)fail('FIXTURE_TABLE_REQUEST_FAILED');
    const rows=await response.json();if(!Array.isArray(rows))fail('INVALID_FIXTURE_RESPONSE');return rows;
  };
  try {
    await require('../lib/check_store_schema.js').check(); // read-only; never applies migration 003
    const result=await probe({kv,table,onStart:scope=>console.log(JSON.stringify({phase:'isolated-fixture',...scope}))});
    console.log(JSON.stringify({result:'PASS',...result,httpRequests:requests}));
  } finally {
    globalThis.fetch=originalFetch;
    delete process.env.SUPABASE_SERVICE_KEY;delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  }
}

if(process.argv[1] && pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  main().catch(error=>{
    // Never print raw adapter/SQL/network messages, response bodies or stacks.
    const code=error.code==='ERR_ASSERTION'?'PROBE_ASSERTION_FAILED':
      /^[A-Z0-9_]{1,64}$/.test(error.code||'')?error.code:'PROBE_FAILED';
    console.error(JSON.stringify({result:'FAIL',code,
      ...(error.code==='CLEANUP_INCOMPLETE'?{cleanupKeys:error.cleanupKeys}: {})}));
    process.exitCode=1;
  });
}
