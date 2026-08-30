// Real PostgreSQL execution in PGlite: SQL semantics/rollback/trigger coverage.
// Single connection; NOT proof of distributed contention or deployed schema.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {PGlite} from '@electric-sql/pglite';
const require=createRequire(import.meta.url);
const {prepare,memoryCommit}=require('../lib/guarded_commit.js');
const db=new PGlite();
await db.exec('create role anon; create role authenticated; create role service_role;');
for(const file of ['001_ratchet_kv.sql','003_guarded_player_commits.sql'])
  await db.exec(readFileSync(new URL('../supabase/'+file,import.meta.url),'utf8'));
// Repeat migration; it may not change a player balance.
await db.exec(readFileSync(new URL('../supabase/003_guarded_player_commits.sql',import.meta.url),'utf8'));
const mem=new Map();
let seq=0;
const make=x=>prepare({id:(++seq).toString(16).padStart(32,'0'),leases:[],debits:[],...x});
const put=async(k,v)=>{mem.set(k,JSON.stringify(v));await db.query('select ratchet_kv_set($1,$2::jsonb)',[k,JSON.stringify(v)]);};
const get=async k=>(await db.query('select ratchet_kv_get($1) v',[k])).rows[0].v;
const sql=async tx=>(await db.query('select ratchet_kv_commit_guarded($1::jsonb) v',[JSON.stringify(tx)])).rows[0].v;
const both=async(tx,expected)=>{
  assert.deepEqual(await sql(tx),expected);assert.deepEqual(memoryCommit(mem,tx),expected);
};
try {
  assert.deepEqual((await db.query('select ratchet_kv_guarded_ready() v')).rows[0].v,{schema:'guarded-player-v1',ready:true});
  const now=Date.now(),token=now+'-fixture';
  await put('lock:u:A',token);await put('lock:u:B',token);
  const leases=['A','B'].map(w=>({key:'lock:u:'+w,token,expiresAt:now+60000}));
  const a={w:'A',cr:1000},b={w:'B',cr:500};
  await put('u:A',a);await put('u:B',b);await put('pend:A',125);
  // Snapshot was 100; the extra 25 arriving during work must survive.
  const nextA={...a,cr:600,_writeGuard:1},nextB={...b,cr:400,_writeGuard:1};
  const tx=make({entries:[{key:'u:A',expected:a,value:nextA},{key:'u:B',expected:b,value:nextB}],
    debits:[['pend:A',100]],leases});
  await both(tx,{ok:true,replay:false});
  assert.equal(await get('pend:A'),25);assert.equal((await get('u:A')).cr,600);
  // Lost acknowledgement retry returns receipt even after its lease expires.
  await db.query("update ratchet_kv set expires_at=now()-interval '1 second' where key='lock:u:A'");
  mem.delete('lock:u:A');
  await both(tx,{ok:true,replay:true});assert.equal(await get('pend:A'),25);
  await both({...tx,digest:'f'.repeat(64)},{ok:false,code:'COMMIT_ID_CONFLICT'});
  const expired=make({entries:[{key:'u:A',expected:nextA,value:{...nextA,cr:0}}],leases:[leases[0]],debits:[['pend:A',25]]});
  await both(expired,{ok:false,code:'WRITE_LEASE_EXPIRED'});
  await put('lock:u:A',token);
  const stale=make({entries:[{key:'u:A',expected:a,value:nextA},{key:'u:B',expected:nextB,value:{...nextB,cr:0}}],debits:[['pend:A',25]],leases});
  await both(stale,{ok:false,code:'WRITE_CONFLICT'});
  assert.equal((await get('u:B')).cr,400);assert.equal(await get('pend:A'),25);
  const short=make({entries:[{key:'u:A',expected:nextA,value:nextA}],debits:[['pend:A',26]],leases});
  await both(short,{ok:false,code:'CREDIT_QUEUE_CONFLICT'});
  // JSONB reorders properties; structural equality must still accept the CAS.
  const reordered=make({entries:[{key:'u:A',expected:{cr:600,_writeGuard:1,w:'A'},value:nextA}],leases});
  await both(reordered,{ok:true,replay:false});
  await assert.rejects(()=>db.query('select ratchet_kv_set($1,$2::jsonb)',['u:A',JSON.stringify(a)]),/unguarded player write/);
  await assert.rejects(()=>db.query("select ratchet_kv_take('pend:A')"),/unguarded credit drain/);
  await db.query("select ratchet_kv_incr('pend:A',10)");
  assert.equal(await get('pend:A'),35,'legacy deposits remain permitted');
  const incr=async(k,n)=>(await db.query('select ratchet_kv_incr($1,$2) n',[k,n])).rows[0].n;
  assert.equal(Number(await incr('counter:new',7)),7,'missing counter starts at zero');
  assert.equal(Number(await incr('counter:new',-2)),5,'non-player numeric counters retain signed deltas');
  await put('counter:expired',99);
  await db.query("update ratchet_kv set expires_at=now()-interval '1 second' where key='counter:expired'");
  assert.equal(Number(await incr('counter:expired',3)),3,'expired counters do not revive their old value');
  assert.equal((await db.query("select expires_at from ratchet_kv where key='counter:expired'")).rows[0].expires_at,null);
  await assert.rejects(()=>incr('pend:A',-1),/unguarded credit drain/);
  assert.equal(await get('pend:A'),35);
  // A failure AFTER the queue deduction must roll the entire SQL transaction back.
  await db.exec(`create function reject_fixture() returns trigger language plpgsql as $$ begin
    if new.key='fixture:fail' then raise exception 'forced write failure'; end if; return new; end; $$;
    create trigger fail_fixture before insert on ratchet_kv for each row execute function reject_fixture();`);
  const crash=make({entries:[{key:'u:A',expected:nextA,value:{...nextA,cr:0}},{key:'fixture:fail',expected:null,value:true}],debits:[['pend:A',35]],leases});
  await assert.rejects(()=>sql(crash),/forced write failure/);
  assert.equal(await get('pend:A'),35);assert.equal((await get('u:A')).cr,600);
  assert.equal(await get('guarded:receipt:'+crash.id),null);
  await put('lock:g:chal',token);
  const board=make({entries:[{key:'g:chal',expected:null,value:[]}],leases:[{key:'lock:g:chal',token,expiresAt:now+60000}]});await sql(board);
  assert.throws(()=>make({entries:[{key:'u:A',expected:nextA,value:nextA}]}),/requires its lease/);
  await assert.rejects(()=>sql({...reordered,id:'a'.repeat(32),leases:[]}),/requires its lease/);
  await assert.rejects(()=>db.query("select ratchet_kv_set('g:chal','[]'::jsonb)"),/unguarded challenge write/);
  await assert.rejects(()=>sql({}),/invalid guarded commit/);
  await db.exec('alter table ratchet_kv disable trigger ratchet_guarded_player');
  assert.equal((await db.query('select ratchet_kv_guarded_ready() v')).rows[0].v.ready,false);
  console.log('PostgreSQL + memory: atomic multi-player CAS, queue conservation, replay, JSONB order, rollback and rolling-writer guards PASS');
} finally {await db.close();}
