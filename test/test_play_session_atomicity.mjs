import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
for (const key of ['SUPABASE_URL','SUPABASE_SERVICE_KEY','SUPABASE_SERVICE_ROLE_KEY',
  'KV_REST_API_URL','KV_REST_API_TOKEN','UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN']) delete process.env[key];
globalThis.fetch = async () => { throw new Error('offline session atomicity tests must not call network'); };
const kv = require('../lib/kv.js');
const writes = require('../lib/player_writes.js');
const sessions = require('../lib/play_session.js');
const {createBridge} = require('../lib/play_session_game.js');
const originalNow = Date.now;
let time = 1788089000000, sequence = 0;
Date.now = () => time;
const clone = v => structuredClone(v);
const id = n => n.toString(16).padStart(32,'0');
const hash = s => crypto.createHash('sha256').update(s).digest('hex');
const rejection = (p,code) => assert.rejects(p,e=>e.code===code,code);
const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58(bytes) {
  let n = BigInt('0x'+bytes.toString('hex')), out = '';
  while (n) { out = alphabet[Number(n % 58n)] + out; n /= 58n; }
  for (const b of bytes) { if (b !== 0) break; out = '1'+out; }
  return out;
}
async function fixture() {
  // Fixture-only ephemeral owner key: no disk, network, real wallet or funds.
  const {publicKey,privateKey} = crypto.generateKeyPairSync('ed25519');
  const wallet = base58(publicKey.export({format:'der',type:'spki'}).subarray(12));
  const sign = payload => crypto.sign(null,Buffer.from(payload),privateKey).toString('base64');
  const sessionId = id(++sequence);
  const token = `rxp1.${wallet}.${sessionId}.${crypto.randomBytes(32).toString('hex')}`;
  const service = sessions.createService({kv,now:()=>time});
  const bridge = createBridge({service});
  const grant = sessions.canonicalGrant({wallet,id:sessionId,tokenHash:hash(token),issuedAt:time,
    expiresAt:time+60000,limits:{maxAttempts:3,maxStakeCredits:500,maxGrossCredits:1500,minIntervalMs:30000}},time);
  const payload = JSON.stringify(grant);
  assert.deepEqual(service.verifyGrant(payload,sign(payload)),grant);
  await service.grant(payload,sign(payload));
  await kv.setJSON('u:'+wallet,{w:wallet,cr:1000,qualified:true,agent:{name:'fixture'},open:[],closed:[]});
  return {wallet,sign,sessionId,token,service,bridge,grant};
}
function ownerCommand(f,action,requestId) {
  const payload = JSON.stringify(sessions.canonicalOwner({action,wallet:f.wallet,id:f.sessionId,
    issuedAt:time,...(requestId ? {requestId} : {})},time));
  return f.service.verifyOwner(payload,f.sign(payload),action);
}
async function revoke(f) {
  const payload = JSON.stringify(sessions.canonicalRevoke({wallet:f.wallet,id:f.sessionId,issuedAt:time},time));
  return f.service.revoke(payload,f.sign(payload));
}
const status = f => f.service.ownerStatus(ownerCommand(f,'owner_status'));
const player = f => kv.getJSONStrict('u:'+f.wallet);
const row = f => kv.getJSONStrict('play-session:v1:'+f.wallet);
const intent = n => ({requestId:id(n),target:'H496689Q0',side:'YES',p:0.52,stake:500});
async function reserve(f,n=100) {
  const auth = await f.service.authorize(f.token,intent(n));
  assert.equal(auth.dispatch,true);
  const req = {body:{action:'shot',auth:{wallet:f.wallet},target:auth.intent.target,
    side:auth.intent.side,p:auth.intent.p,stake:auth.intent.stake,
    requestId:`session:${f.sessionId}:${auth.intent.requestId}`}};
  f.bridge.markVerified(req,auth.permit,auth.intent);
  const shot = {id:'123456abcdef',requestId:req.body.requestId,side:auth.intent.side,
    sp:auth.intent.p,stake:auth.intent.stake};
  return {auth,req,shot};
}
async function withPlayer(f,fn) {
  return writes.run(async()=>{
    const key = 'lock:u:'+f.wallet, token = await kv.acquireLease(key,30);
    assert.ok(token,'fixture owns player lease');
    writes.lease(key,token,30);
    try {
      const p = await player(f);
      writes.track(p,clone(p));
      return await fn(p);
    } finally { await kv.releaseLease(key,token); }
  });
}
function insertShot(p,shot) { p.cr-=shot.stake; p.open.unshift(shot); }
async function accept(f,attempt) {
  return withPlayer(f,async p=>{
    insertShot(p,attempt.shot);
    const extra = await f.bridge.acceptanceExtra(attempt.req,attempt.shot);
    return writes.save([p],[extra]);
  });
}
async function recover(f,requestId) {
  const command = ownerCommand(f,'recover',requestId);
  return withPlayer(f,p=>f.bridge.recover(command,p));
}
const rawCommit = kv.commitGuarded;
try {
  const f = await fixture(), a = await reserve(f);
  assert.deepEqual((await row(f)).requests[id(100)].intent,intent(100),'persist the exact reserved intent');
  assert.equal(f.bridge.isVerifiedRequest(a.req,a.req.body),true);
  assert.equal(f.bridge.isVerifiedRequest(clone(a.req),a.req.body),false,'serialization loses authority');
  for (const change of [{action:'reload'},{stake:100},{p:'0.52'},{target:'other'},
    {requestId:`session:${f.sessionId}:${id(999)}`},{auth:{wallet:(await fixture()).wallet}}]) {
    assert.equal(f.bridge.isVerifiedRequest(a.req,{...a.req.body,...change}),false);
  }
  assert.throws(()=>f.bridge.markVerified({},clone(a.auth.permit),a.auth.intent),/INVALID_PERMIT/);
  assert.throws(()=>f.bridge.markVerified({},a.auth.permit,{...a.auth.intent,stake:100}),/REQUEST_CONFLICT/);
  await rejection(f.service.finish(a.auth.permit,{state:'accepted',shotId:a.shot.id}),'ATOMIC_ACCEPTANCE_REQUIRED');
  await rejection(f.bridge.acceptanceExtra(a.req,{...a.shot,stake:100}),'REQUEST_CONFLICT');
  await accept(f,a);
  assert.equal((await player(f)).cr,500);
  assert.equal((await player(f)).open.length,1);
  assert.deepEqual((await status(f)).requests[id(100)].result,{state:'accepted',shotId:a.shot.id});
  assert.equal((await f.service.authorize(f.token,intent(100))).dispatch,false);
  await rejection(accept(f,a),'ATTEMPT_ALREADY_TERMINAL');
  assert.equal((await player(f)).cr,500,'a terminal receipt prevents redispatch/debit');
  console.log('Exact persisted intent, nonserializable request binding, atomic accepted receipt and replay PASS');

  // One lost ACK retries the SAME guarded transaction; two lost ACKs are
  // discoverable from the terminal session without looking in a bounded ring.
  for (const lostAcks of [1,2]) {
    const f = await fixture(), a = await reserve(f);
    let calls = 0;
    kv.commitGuarded = async tx=>{
      const result = await rawCommit(tx);
      if (++calls <= lostAcks) throw new Error('fixture lost commit acknowledgement');
      return result;
    };
    if (lostAcks===1) await accept(f,a);
    else await assert.rejects(accept(f,a),/lost commit acknowledgement/);
    kv.commitGuarded = rawCommit;
    assert.equal(calls,2);
    assert.equal((await player(f)).cr,500);
    assert.equal((await player(f)).open.length,1);
    assert.equal((await status(f)).requests[id(100)].state,'accepted');
    await withPlayer(f,async p=>{p.open=[];await writes.save([p]);});
    const recovered = await recover(f,id(100));
    assert.equal(recovered.idempotent,true);
    assert.equal(recovered.request.result.shotId,a.shot.id,'receipt survives removal from all bounded shot rings');
    assert.equal((await player(f)).cr,500);
  }
  console.log('Single/double lost acceptance ACK and durable receipt recovery after ring eviction PASS');

  // Reservation committed but no permit reached the process: recovery closes
  // that existing reservation and never invokes a shot dispatcher.
  {
    const f = await fixture();
    const uncertain = sessions.createService({now:()=>time,kv:{...kv,casPlaySession:async(...args)=>{
      const result=await kv.casPlaySession(...args);if(result)throw new Error('reservation ACK lost');return result;
    }}});
    await assert.rejects(uncertain.authorize(f.token,intent(100)),/reservation ACK lost/);
    assert.equal((await f.service.authorize(f.token,intent(100))).dispatch,false);
    const before = await player(f);
    const recovered = await recover(f,id(100));
    assert.equal(recovered.request.result.code,'RECOVERED_NO_DISPATCH');
    assert.equal((await status(f)).pending,null);
    assert.equal((await status(f)).attempts,1);
    assert.equal((await status(f)).grossCredits,500);
    assert.equal((await player(f)).cr,before.cr);
    assert.deepEqual((await player(f)).open,before.open);
    assert.equal((await recover(f,id(100))).idempotent,true);
    time+=30000;
    await reserve(f,101);
    assert.equal((await status(f)).grossCredits,1000,'recovery never refunds reserved authority');
  }
  console.log('Lost reservation ACK, owner-only terminal recovery and unchanged gross budget PASS');

  {
    const f=await fixture();await reserve(f);
    let calls=0;
    kv.commitGuarded=async tx=>{
      await rawCommit(tx);calls++;
      throw new Error('fixture lost recovery acknowledgement');
    };
    await assert.rejects(recover(f,id(100)),/lost recovery acknowledgement/);
    kv.commitGuarded=rawCommit;
    assert.equal(calls,2);
    assert.equal((await recover(f,id(100))).idempotent,true);
    assert.equal((await status(f)).requests[id(100)].result.code,'RECOVERED_NO_DISPATCH');
    assert.equal((await player(f)).cr,1000);
    assert.equal((await status(f)).grossCredits,500);
  }
  console.log('Double lost recovery ACK replays its terminal receipt without redispatch or refund PASS');

  // A revoke between receipt preparation and commit invalidates the expected
  // session entry: neither player nor receipt can partially commit.
  {
    const f=await fixture(),a=await reserve(f);
    await withPlayer(f,async p=>{
      insertShot(p,a.shot);
      const extra=await f.bridge.acceptanceExtra(a.req,a.shot);
      await revoke(f);
      await rejection(writes.save([p],[extra]),'WRITE_CONFLICT');
    });
    assert.equal((await player(f)).cr,1000);
    assert.equal((await player(f)).open.length,0);
    assert.equal((await row(f)).requests[id(100)].state,'reserved');
    await accept(f,a); // reserved before revoke may finish; revocation is retained.
    assert.equal((await status(f)).requests[id(100)].state,'accepted');
    assert.notEqual((await row(f)).revokedAt,null);
    assert.equal((await f.service.receipt(a.auth.permit)).state,'accepted',
      'the authorized in-flight worker can report acceptance after revocation');
    await rejection(f.service.receipt(clone(a.auth.permit)),'INVALID_PERMIT');
    time=f.grant.expiresAt;
    assert.equal((await f.service.receipt(a.auth.permit)).state,'accepted',
      'the authorized in-flight worker can report acceptance after expiry');
    await rejection(f.service.authorize(f.token,intent(101)),'SESSION_REVOKED');
  }
  console.log('Concurrent revocation CAS rollback and finish-authorized revocation preservation PASS');

  // Recovery replaces an expired worker's lease. Even an already prepared
  // acceptance entry cannot debit or overwrite the recovery receipt afterwards.
  {
    const f=await fixture(),a=await reserve(f);
    let resume,entered;
    const ready=new Promise(r=>entered=r),blocked=new Promise(r=>resume=r);
    const late=withPlayer(f,async p=>{
      insertShot(p,a.shot);
      const extra=await f.bridge.acceptanceExtra(a.req,a.shot);
      entered();await blocked;
      return writes.save([p],[extra]);
    });
    await ready;time+=36000;
    await recover(f,id(100));
    resume();await rejection(late,'WRITE_LEASE_EXPIRED');
    assert.equal((await player(f)).cr,1000);
    assert.equal((await player(f)).open.length,0);
    assert.equal((await status(f)).requests[id(100)].result.code,'RECOVERED_NO_DISPATCH');
    await rejection(accept(f,a),'ATTEMPT_ALREADY_TERMINAL');
  }
  console.log('Recovery under replacement player lease fences a paused already-prepared acceptance PASS');

  // Independent CAS control: keep the same live lease and identical guarded
  // player bytes. Only the expected session record distinguishes a recovered
  // reservation from a still-authorized one at the final acceptance write.
  {
    const f=await fixture(),a=await reserve(f);
    await withPlayer(f,p=>writes.save([p])); // establish the guard marker first
    await withPlayer(f,async p=>{
      insertShot(p,a.shot);
      const extra=await f.bridge.acceptanceExtra(a.req,a.shot);
      const recoveryPlayer=await player(f);
      writes.track(recoveryPlayer,clone(recoveryPlayer));
      await f.bridge.recover(ownerCommand(f,'recover',id(100)),recoveryPlayer);
      await rejection(writes.save([p],[extra]),'WRITE_CONFLICT');
    });
    assert.equal((await player(f)).cr,1000);
    assert.equal((await player(f)).open.length,0);
    assert.equal((await status(f)).requests[id(100)].result.code,'RECOVERED_NO_DISPATCH');
  }
  console.log('Expected session CAS independently fences recovery even with identical player/live lease PASS');

  // Closing reserved work is permitted after revoke/expiry with a fresh owner
  // signature; bearer authority and stale owner signatures cannot extend it.
  for (const mode of ['revoked','expired']) {
    const f=await fixture(),a=await reserve(f);
    if(mode==='revoked') await revoke(f); else time=f.grant.expiresAt;
    await rejection(f.service.status(f.token),mode==='revoked'?'SESSION_REVOKED':'SESSION_EXPIRED');
    const before=await player(f),command=ownerCommand(f,'owner_status');
    assert.equal((await f.service.ownerStatus(command)).pending,id(100));
    assert.deepEqual(await player(f),before,'owner-status does not mutate/settle player state');
    assert.throws(()=>f.service.verifyOwner(JSON.stringify(command),f.sign(JSON.stringify(command)),'recover'),/OWNER_ACTION_MISMATCH/);
    const other=await fixture();
    assert.throws(()=>f.service.verifyOwner(JSON.stringify(command),other.sign(JSON.stringify(command)),'owner_status'),/INVALID_SIGNATURE/);
    const stale=JSON.stringify({...command,issuedAt:time-300001});
    assert.throws(()=>f.service.verifyOwner(stale,f.sign(stale),'owner_status'),/INVALID_OWNER_COMMAND/);
    await rejection(f.service.prepareRecovery({...ownerCommand(f,'recover',id(100))}),'INVALID_OWNER_COMMAND');
    const result=await recover(f,id(100));
    assert.equal(result.request.state,'rejected');
    assert.equal((await player(f)).cr,1000);
    assert.equal((await status(f)).grossCredits,500);
    if(mode==='expired') await rejection(accept(f,a),'SESSION_EXPIRED');
  }
  console.log('Fresh owner-signed read-only status/recovery after expiry or revoke; no bearer extension PASS');

  // Expiry after preparation but before the atomic storage decision is checked
  // by the shortened owned lease, not by the application's preflight clock.
  {
    const f=await fixture(),a=await reserve(f);
    time=f.grant.expiresAt-1000;
    await withPlayer(f,async p=>{
      insertShot(p,a.shot);
      const extra=await f.bridge.acceptanceExtra(a.req,a.shot);
      time=f.grant.expiresAt;
      await rejection(writes.save([p],[extra]),'WRITE_LEASE_EXPIRED');
    });
    assert.equal((await player(f)).cr,1000);
    assert.equal((await row(f)).requests[id(100)].state,'reserved');
    await recover(f,id(100));
  }
  console.log('Database-admission deadline prevents expiry-between-check-and-write partial acceptance PASS');
} finally { kv.commitGuarded=rawCommit;Date.now=originalNow; }
console.log('Play-session atomicity PASS (offline real memory guarded primitive; no external writes or funds)');
