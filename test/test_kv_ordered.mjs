import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const fields = ['publishTime','postedSlot','rpcSlot','observedAt'];
const a = {publishTime:10,postedSlot:401,rpcSlot:401,observedAt:1000,price:100};
const b = {...a,postedSlot:402,rpcSlot:402,price:110};
const c = {...b,postedSlot:403,rpcSlot:403,price:120};
const envKeys = ['SUPABASE_URL','SUPABASE_SERVICE_KEY','SUPABASE_SERVICE_ROLE_KEY',
  'KV_REST_API_URL','KV_REST_API_TOKEN','UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN'];
function fresh(mode) {
  for (const key of envKeys) delete process.env[key];
  if (mode === 'supabase') {
    process.env.SUPABASE_URL='https://kv-fixture.invalid';
    process.env.SUPABASE_SERVICE_KEY='fixture-only';
  } else if (mode === 'redis') {
    process.env.KV_REST_API_URL='https://kv-fixture.invalid';
    process.env.KV_REST_API_TOKEN='fixture-only';
  }
  for (const module of ['../lib/kv.js','../lib/supabase_kv.js']) delete require.cache[require.resolve(module)];
  globalThis.__ratchet_mem=new Map();
  return require('../lib/kv.js');
}

const rows = new Map();
let race = null, commands = [], reads = 0, writes = 0;
const response = value => new Response(JSON.stringify(value), {status:200});
const rowFor = value => ({value:structuredClone(value), expires_at:new Date(Date.now()+60000).toISOString(),
  updated_at:new Date().toISOString()});
globalThis.fetch = async (input, options) => {
  const url = new URL(input), q=url.searchParams;
  if (url.pathname.endsWith('/rpc/ratchet_kv_get')) {
    return response(rows.get(JSON.parse(options.body).p_key)?.value ?? null);
  }
  assert.equal(url.pathname,'/rest/v1/ratchet_kv');
  assert.equal(options.headers.Authorization,'Bearer fixture-only');
  const key=q.get('key')?.slice(3);
  if (options.method === 'GET') {
    reads++;
    return response(rows.has(key) ? [rows.get(key)] : []);
  }
  writes++;
  const body=JSON.parse(options.body);
  if (race) race(body.key,options.method);
  if (options.method === 'POST') {
    assert.equal(q.get('on_conflict'),'key');
    assert.match(options.headers.Prefer,/resolution=ignore-duplicates/);
    if (rows.has(body.key)) return response([]);
    rows.set(body.key,body); return response([{key:body.key}]);
  }
  assert.equal(options.method,'PATCH');
  const current=rows.get(key);
  assert.ok(q.has('value') && q.has('updated_at') && q.has('expires_at'),
    'CAS predicates must cover value and both timestamps');
  const matched=current && q.get('value') === 'eq.'+JSON.stringify(current.value)
    && q.get('updated_at') === 'eq.'+current.updated_at
    && q.get('expires_at') === (current.expires_at == null ? 'is.null' : 'eq.'+current.expires_at);
  if (!matched) return response([]);
  rows.set(key,body); return response([{key}]);
};
let kv=fresh('supabase');
assert.equal(await kv.setJSONIfNewer('p',a,fields,60),true);
assert.equal(await kv.setJSONIfNewer('p',b,fields,60),true);
const expiry=rows.get('p').expires_at;
assert.equal(await kv.setJSONIfNewer('p',{...a,rpcSlot:999,observedAt:9999},fields,600),false);
assert.equal(await kv.setJSONIfNewer('p',b,fields,600),false);
assert.equal(rows.get('p').expires_at,expiry,'older/equal arrivals do not refresh TTL');

// A competing process wins after our read but before the conditional PATCH.
rows.set('p',rowFor(a));
race=(key,method)=>{if(method==='PATCH'){rows.set(key,rowFor(c));race=null;}};
assert.equal(await kv.setJSONIfNewer('p',b,fields,60),false);
assert.deepEqual(rows.get('p').value,c,'CAS loser must re-read and preserve competing newer state');
// Same race on first insert: ignore duplicates, never upsert-overwrite.
race=(key,method)=>{if(method==='POST'){rows.set(key,rowFor(c));race=null;}};
assert.equal(await kv.setJSONIfNewer('new',b,fields,60),false);
assert.deepEqual(rows.get('new').value,c);

rows.set('expired',{...rowFor(c),expires_at:new Date(Date.now()-10000).toISOString()});
assert.equal(await kv.setJSONIfNewer('expired',a,fields,60),true,'expired projections can restart');
rows.set('null-expiry',{...rowFor(a),expires_at:null});
assert.equal(await kv.setJSONIfNewer('null-expiry',b,fields,60),true,'nullable legacy TTL uses is.null CAS');
// A permanent competing writer cannot cause a spin or unconditional overwrite.
rows.set('busy',rowFor(a));
race=(key)=>{const r=rows.get(key);r.updated_at=new Date(Date.parse(r.updated_at)+1).toISOString();};
const before=reads;
await assert.rejects(kv.setJSONIfNewer('busy',b,fields,60),/contention/);
assert.equal(reads-before,5,'contention retries are bounded');
assert.deepEqual(rows.get('busy').value,a);
race=null;
globalThis.fetch=async()=>new Response('',{status:503});
await assert.rejects(kv.setJSONIfNewer('outage',b,fields,60),/503/,'store failure is never a missing row');

// Redis command-shape fixture; actual Lua execution is a separate live probe.
rows.clear();
globalThis.fetch=async (_url,options)=>{
  const command=JSON.parse(options.body);commands.push(command);
  const [op,script,count,key,encoded,encodedFields,ttl]=command;
  assert.equal(op,'EVAL');assert.equal(count,'1');
  assert.match(script,/redis.call\('GET', KEYS\[1\]\)/);
  assert.match(script,/redis.call\('SET', KEYS\[1\], ARGV\[1\], 'EX', ARGV\[3\]\)/);
  assert.equal(Number(ttl),60);
  const value=JSON.parse(encoded), order=JSON.parse(encodedFields), current=rows.get(key);
  let replace=!current;
  if(current) for(const field of order){const delta=(value[field]||0)-(current[field]||0);
    if(delta){replace=delta>0;break;}}
  if(replace)rows.set(key,value);
  return response({result:replace?1:0});
};
kv=fresh('redis');
assert.equal(await kv.setJSONIfNewer('r',b,fields,60),true);
assert.equal(await kv.setJSONIfNewer('r',a,fields,60),false);
assert.equal(await kv.setJSONIfNewer('r',b,fields,60),false);
assert.equal(commands.length,3,'one atomic server-side script per decision');
assert.deepEqual(rows.get('r'),b);

globalThis.fetch=async()=>{throw new Error('memory backend must not use network');};
kv=fresh('memory');
await Promise.all([c,a,b,a,c,b].map(v=>kv.setJSONIfNewer('m',v,fields,60)));
assert.deepEqual(await kv.getJSONStrict('m'),c,'concurrent memory calls retain maximum order');
await assert.rejects(kv.setJSONIfNewer('m',{...c,postedSlot:1.5},fields,60),/clock/);
await assert.rejects(kv.setJSONIfNewer('m',c,fields,0),/ordered write/);
console.log('Ordered KV: memory ordering, Redis atomic command shape, Postgres CAS races, duplicate/TTL handling, failures and bounded contention pass');
