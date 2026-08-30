import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
for (const k of ['SUPABASE_URL','SUPABASE_SERVICE_KEY','SUPABASE_SERVICE_ROLE_KEY',
  'KV_REST_API_URL','KV_REST_API_TOKEN','UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN']) delete process.env[k];
globalThis.fetch = async () => { throw new Error('offline authorization tests must not call network'); };
const kv = require('../lib/kv.js');
const mod = require('../lib/play_session.js');
const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58(bytes) {
  let n = BigInt('0x'+bytes.toString('hex')), out = '';
  while (n) { out = alphabet[Number(n % 58n)] + out; n /= 58n; }
  for (const b of bytes) { if (b !== 0) break; out = '1'+out; }
  return out;
}
function owner() {
  // Ephemeral fixture keys only: never written to disk or sent to any service.
  const {publicKey,privateKey} = crypto.generateKeyPairSync('ed25519');
  return {wallet:base58(publicKey.export({format:'der',type:'spki'}).subarray(12)),
    sign:s => crypto.sign(null,Buffer.from(s),privateKey).toString('base64')};
}
const a = owner(), b = owner();
let time = 1788089000000;
const make = (store = kv) => mod.createService({kv:store,now:()=>time});
const service = make();
const id = n => n.toString(16).padStart(32,'0');
const hash = s => crypto.createHash('sha256').update(s).digest('hex');
function grant(n, overrides = {}, signer = a) {
  const token = `rxp1.${signer.wallet}.${id(n)}.${crypto.randomBytes(32).toString('hex')}`;
  const obj = mod.canonicalGrant({wallet:signer.wallet,id:id(n),tokenHash:hash(token),issuedAt:time,
    expiresAt:time+3600000,limits:{maxAttempts:3,maxStakeCredits:500,maxGrossCredits:1000,minIntervalMs:5000},...overrides},time);
  const payload = JSON.stringify(obj);
  return {obj,payload,signature:signer.sign(payload),token};
}
const install = (g,s=service) => s.grant(g.payload,g.signature);
const intent = (n, overrides={}) => ({requestId:id(n),target:'H496689Q0',side:'YES',p:0.52,stake:500,...overrides});
const rejects = (p, code) => assert.rejects(p,e=>e.code===code,code);
function rev(g, signer=a) {
  const payload = JSON.stringify(mod.canonicalRevoke({wallet:signer.wallet,id:g.obj.id,issuedAt:time},time));
  return [payload,signer.sign(payload)];
}

let g = grant(1);
assert.deepEqual(await install(g),{id:g.obj.id,idempotent:false});
assert.equal((await install(g)).idempotent,true);
await rejects(service.grant(g.payload,b.sign(g.payload)),'INVALID_SIGNATURE');
for (const change of [o=>o.domain='attacker.invalid',o=>o.network='solana:devnet',
  o=>o.actions.push('reload'),o=>o.action='shot',o=>o.budgetRule='accepted-only']) {
  const o = structuredClone(g.obj); change(o);
  const payload = JSON.stringify(o);
  await rejects(service.grant(payload,a.sign(payload)),'NON_CANONICAL_PAYLOAD');
}
const tampered = JSON.stringify({...g.obj,limits:{...g.obj.limits,maxGrossCredits:5000}});
await rejects(service.grant(tampered,g.signature),'INVALID_SIGNATURE');
assert.throws(()=>mod.canonicalGrant({...g.obj,wallet:'demo-123456789abc'},time),/INVALID_WALLET/);
for (const limits of [{maxAttempts:101},{maxStakeCredits:99},{maxGrossCredits:499},{minIntervalMs:4999}])
  assert.throws(()=>mod.canonicalGrant({...g.obj,limits:{...g.obj.limits,...limits}},time),/INVALID_LIMITS/);
for (const change of [{p:0.525},{p:'0.52'},{stake:500.2},{stake:'500'},{auth:{wallet:b.wallet}},
  {action:'reload'},{recipient:b.wallet},{requestId:[id(20)]}])
  await rejects(service.authorize(g.token,intent(20,change)),'INVALID_INTENT');
await rejects(service.status(g.token.replace(a.wallet,b.wallet)),'INVALID_CAPABILITY');
await rejects(service.status(g.token.slice(0,-2)+'zz'),'INVALID_CAPABILITY');
assert.ok(!JSON.stringify(await kv.getJSONStrict('play-session:v1:'+a.wallet)).includes(g.token));
assert.ok(!JSON.stringify(await service.status(g.token)).includes(g.obj.tokenHash));
assert.equal(await kv.getJSONStrict('u:'+a.wallet),null,'foundation cannot create players or credits');

// Multiple server instances, same request: exactly one receives a dispatch permit.
const attempts = await Promise.all(Array.from({length:40},(_,i)=>make().authorize(g.token,intent(20))));
assert.equal(attempts.filter(x=>x.dispatch).length,1);
assert.ok(attempts.filter(x=>!x.dispatch).every(x=>x.request.state==='reserved'));
assert.equal((await service.status(g.token)).grossCredits,500);
assert.equal((await service.status(g.token)).attempts,1);
await rejects(service.authorize(g.token,intent(20,{side:'NO'})),'REQUEST_CONFLICT');
await rejects(service.authorize(g.token,intent(21)),'PRIOR_ATTEMPT_UNRESOLVED');
time++;
await rejects(install(grant(2)),'PRIOR_ATTEMPT_UNRESOLVED');
await rejects(service.finish({...attempts.find(x=>x.dispatch).permit},{state:'accepted',shotId:'123456abcdef'}),'INVALID_PERMIT');
// Restart cannot invent permission to finish an attempt whose outcome is unknown.
await rejects(make().finish(attempts.find(x=>x.dispatch).permit,{state:'accepted',shotId:'123456abcdef'}),'INVALID_PERMIT');

// Use a separately owned fixture session to test completions and strict gross caps.
let h = grant(5,{},b);
await install(h);
const one = await service.authorize(h.token,intent(30));
assert.ok(Object.isFrozen(one.intent));
await rejects(service.finish(one.permit,{state:'accepted',shotId:'123456abcdef'}),'ATOMIC_ACCEPTANCE_REQUIRED');
assert.equal((await service.finish(one.permit,{state:'rejected',code:'NO_CHAMBER'})).idempotent,false);
assert.equal((await service.finish(one.permit,{state:'rejected',code:'NO_CHAMBER'})).idempotent,true);
await rejects(service.finish(one.permit,{state:'rejected',code:'ORACLE_STALE'}),'OUTCOME_CONFLICT');
assert.equal((await service.authorize(h.token,intent(30))).dispatch,false);
await rejects(service.authorize(h.token,intent(31)),'SESSION_RATE_LIMIT');
time+=5000;
const two = await service.authorize(h.token,intent(31));
await service.finish(two.permit,{state:'rejected',code:'ORACLE_STALE'});
assert.equal((await service.status(h.token)).grossCredits,1000,'rejection never replenishes gross authority');
time+=5000;
await rejects(service.authorize(h.token,intent(32)),'SESSION_BUDGET_EXHAUSTED');

// jsonb may return fields in a different order: grant and receipt replay still match.
const rowKey = 'play-session:v1:'+b.wallet;
let row = await kv.getJSONStrict(rowKey);
row.grant = Object.fromEntries(Object.entries(row.grant).reverse());
row.requests[id(30)].result = {code:'NO_CHAMBER',state:'rejected'};
await kv.setJSON(rowKey,row); // fixture setup only, never the production session writer
assert.equal((await install(h)).idempotent,true);
assert.equal((await service.finish(one.permit,{state:'rejected',code:'NO_CHAMBER'})).idempotent,true);
await service.revoke(...rev(h,b));
await rejects(service.authorize(h.token,intent(32)),'SESSION_REVOKED');
await rejects(install(h),'SESSION_REVOKED');
assert.equal((await service.revoke(...rev(h,b))).idempotent,true);

// Expiry and replacement do not resurrect prior grants. Only owner signs new limits.
time++;
const next = grant(6,{expiresAt:time+60000,limits:{maxAttempts:1,maxStakeCredits:500,maxGrossCredits:1000,minIntervalMs:5000}},b);
await install(next);
await rejects(install(h),'STALE_GRANT');
await rejects(service.status(h.token),'INVALID_CAPABILITY');
const three = await service.authorize(next.token,intent(40));
await service.revoke(...rev(next,b));
await service.finish(three.permit,{state:'rejected',code:'NO_CHAMBER'});
await rejects(service.authorize(next.token,intent(41)),'SESSION_REVOKED');
assert.equal((await kv.getJSONStrict(rowKey)).revokedAt,time,'finish cannot un-revoke');
time++;
const expires = grant(7,{expiresAt:time+60000},b);
await install(expires);
time+=60000;
await rejects(service.authorize(expires.token,intent(42)),'SESSION_EXPIRED');

// Definitive grant with max-attempt cap separate from gross cap.
time++;
const calls = grant(8,{limits:{maxAttempts:1,maxStakeCredits:500,maxGrossCredits:1000,minIntervalMs:5000}},b);
await install(calls);
const four = await service.authorize(calls.token,intent(50));
await service.finish(four.permit,{state:'rejected',code:'NO_CHAMBER'});
time+=5000;
await rejects(service.authorize(calls.token,intent(51)),'SESSION_BUDGET_EXHAUSTED');

// Lost acknowledgement after a committed reservation: NEVER dispatch on retry.
time++;
const lost = grant(9,{},b);
await install(lost);
const uncertain = make({...kv,casPlaySession:async(...args)=>{
  const result = await kv.casPlaySession(...args);
  if(result) throw new Error('lost acknowledgement');
  return result;
}});
await assert.rejects(uncertain.authorize(lost.token,intent(60)),/lost acknowledgement/);
const recovery = await make().authorize(lost.token,intent(60));
assert.equal(recovery.dispatch,false);
assert.equal(recovery.request.state,'reserved');
await rejects(make().authorize(lost.token,intent(61)),'PRIOR_ATTEMPT_UNRESOLVED');
assert.equal((await service.status(lost.token)).grossCredits,500);
await assert.rejects(make({...kv,getJSONStrict:async()=>{throw new Error('store unavailable');}}).authorize(lost.token,intent(62)),/store unavailable/);
await rejects(make({...kv,casPlaySession:async()=>false}).revoke(...rev(lost,b)),'SESSION_CONTENTION');
assert.equal(await kv.getJSONStrict('u:'+b.wallet),null,'no game writes even after all authorization cases');

// Revoke wins during an authorization CAS: the stale permit must not escape.
const c = owner(), raceGrant = grant(10,{},c);
await install(raceGrant);
let interleave = true;
const raced = make({...kv,casPlaySession:async(...args)=>{
  if(interleave){interleave=false;await service.revoke(...rev(raceGrant,c));}
  return kv.casPlaySession(...args);
}});
await rejects(raced.authorize(raceGrant.token,intent(70)),'SESSION_REVOKED');
assert.equal((await kv.getJSONStrict('play-session:v1:'+c.wallet)).attempts,0);

time++;
const delayed = grant(11,{expiresAt:time+60000},c);
await install(delayed);
const slow = make({...kv,casPlaySession:async(...args)=>{
  const written=await kv.casPlaySession(...args); time+=60000; return written;
}});
await rejects(slow.authorize(delayed.token,intent(71)),'SESSION_EXPIRED');
assert.equal((await kv.getJSONStrict('play-session:v1:'+c.wallet)).pending,id(71),
  'expiry during storage latency leaves a blocked reservation, never a dispatch permit');
console.log('Play-session foundation: signed scope, two-wallet isolation, caps, CAS concurrency, replay, restart, revocation, expiry, jsonb order and uncertain writes PASS (offline; no game dispatch)');
