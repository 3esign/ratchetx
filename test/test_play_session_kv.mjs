import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const keys = ['SUPABASE_URL','SUPABASE_SERVICE_KEY','SUPABASE_SERVICE_ROLE_KEY',
  'KV_REST_API_URL','KV_REST_API_TOKEN','UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN'];
const key = 'play-session:v1:11111111111111111111111111111111';
const a = {revision:'a'.repeat(32),count:0}, b = {revision:'b'.repeat(32),count:1}, c = {revision:'c'.repeat(32),count:2};
const rows = new Map();
const response = value => new Response(JSON.stringify(value),{status:200});
function fresh(mode) {
  for (const k of keys) delete process.env[k];
  if(mode==='redis'){process.env.KV_REST_API_URL='https://fixture.invalid';process.env.KV_REST_API_TOKEN='fixture';}
  if(mode==='supabase'){process.env.SUPABASE_URL='https://fixture.invalid';process.env.SUPABASE_SERVICE_KEY='fixture';}
  for(const p of ['../lib/kv.js','../lib/supabase_kv.js']) delete require.cache[require.resolve(p)];
  globalThis.__ratchet_mem=new Map(); rows.clear(); return require('../lib/kv.js');
}
for(const mode of ['memory','redis','supabase']) {
  const kv = fresh(mode);
  // Adapter protocol fixture, NOT an actual Redis Lua or Postgres deployment.
  globalThis.fetch = async (input,options) => {
    assert.notEqual(mode,'memory');
    if(mode==='redis') {
      const [op,script,n,k,expected,encoded] = JSON.parse(options.body);
      assert.equal(op,'EVAL');assert.equal(n,'1');assert.equal(k,key);
      assert.match(script,/old.revision ~= ARGV\[1\]/);
      assert.match(script,/redis.call\('SET', KEYS\[1\], ARGV\[2\]\)/);
      assert.ok(!/EXPIRE|'EX'/.test(script),'revocation tombstones cannot expire');
      const current = rows.get(k);
      const ok = expected==='' ? !current : current?.revision===expected;
      if(ok)rows.set(k,JSON.parse(encoded));
      return response({result:ok?1:0});
    }
    const u = new URL(input), q=u.searchParams, body=JSON.parse(options.body);
    assert.equal(u.pathname,'/rest/v1/ratchet_kv');
    assert.equal(body.expires_at,null);
    assert.equal(options.headers.Authorization,'Bearer fixture');
    if(options.method==='POST') {
      assert.equal(q.get('on_conflict'),'key');assert.match(options.headers.Prefer,/ignore-duplicates/);
      if(rows.has(key))return response([]);
    } else {
      assert.equal(options.method,'PATCH');assert.equal(q.get('key'),'eq.'+key);
      assert.equal(q.get('expires_at'),'is.null');
      assert.ok(q.has('value->>revision'),'server must compare the revision in the atomic UPDATE');
      if(!rows.has(key)||q.get('value->>revision')!=='eq.'+rows.get(key).revision)return response([]);
    }
    rows.set(key,body.value);return response([{key}]);
  };
  assert.equal(await kv.casPlaySession(key,null,a),true,mode);
  assert.equal(await kv.casPlaySession(key,null,b),false,mode+' cannot overwrite insert');
  const results = await Promise.all([b,c,b,c].map(v=>kv.casPlaySession(key,a.revision,v)));
  assert.equal(results.filter(Boolean).length,1,mode+' exactly one wins');
  assert.equal(await kv.casPlaySession(key,a.revision,c),false,mode+' stale writer fails');
  await assert.rejects(kv.casPlaySession('u:11111111111111111111111111111111',a.revision,b),/invalid play-session CAS/);
  await assert.rejects(kv.casPlaySession(key,a.revision,a),/invalid play-session CAS/);
  await assert.rejects(kv.casPlaySession(key,null,{...c,large:'x'.repeat(65536)}),/invalid play-session CAS/);
  if(mode!=='memory') {
    globalThis.fetch = async()=>new Response('',{status:503});
    await assert.rejects(kv.casPlaySession(key,b.revision,c),/503/);
  }
  console.log(mode+': session CAS insertion, stale revisions, concurrent winner, namespace/size limits and no TTL PASS');
}
