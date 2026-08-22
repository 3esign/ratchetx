import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

process.env.SUPABASE_URL = 'https://ratchet-test.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'service-test-only';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const calls = [];
const replies = {
  ratchet_kv_get:{ cr:5000 }, ratchet_kv_mget:[1,null], ratchet_kv_set:null,
  ratchet_kv_set_many:null, ratchet_kv_setnx:true, ratchet_kv_release:true,
  ratchet_kv_del:null, ratchet_kv_scan:['u:A'], ratchet_kv_incr:7,
  ratchet_kv_take:9, ratchet_kv_hincr:4, ratchet_kv_hincr_many:{ a:2 },
  ratchet_kv_hall:{ a:2 }, ratchet_kv_hseed:true, ratchet_kv_zincr:11,
  ratchet_kv_zmax:true, ratchet_kv_ztop:[['A',11]], ratchet_kv_apply_once:true,
  ratchet_kv_zincr_many_once:true,
};
globalThis.fetch = async (url, options) => {
  const name = String(url).split('/').pop();
  const args = JSON.parse(options.body);
  calls.push({ name, args, auth:options.headers.Authorization, key:options.headers.apikey });
  return new Response(JSON.stringify(replies[name] ?? null),
    { status:200, headers:{ 'content-type':'application/json' } });
};

const require = createRequire(import.meta.url);
const kv = require('../lib/kv.js');
assert.equal(kv.backend, 'supabase');
assert.equal(kv.durable, true);
assert.deepEqual(await kv.getJSONStrict('u:A'), { cr:5000 });
assert.deepEqual(await kv.getManyJSON(['a','b']), [1,null]);
await kv.setJSON('a', { x:1 });
await kv.setJSONEx('b', [2], 60);
await kv.setManyJSONAtomic([['a',1],['b',2]]);
assert.equal(await kv.setnxJSON('gate', { ok:true }, 20), true);
const lease = await kv.acquireLease('lock:x', 30);
assert.ok(lease && await kv.releaseLease('lock:x', lease));
await kv.delKey('old');
assert.deepEqual(await kv.scanKeys('u:*'), ['u:A']);
assert.equal(await kv.incrFloat('n', 2), 7);
assert.equal(await kv.takeNum('n'), 9);
assert.equal(await kv.hincr('h', 'a', 2), 4);
await kv.hincrMany('h', { a:2, ignored:0 });
assert.deepEqual(await kv.hall('h'), { a:2 });
assert.equal(await kv.hseed('h2', { a:1 }), true);
assert.equal(await kv.zincr('z', 3, 'A'), 11);
assert.equal(await kv.zmax('z', 12, 'A'), true);
assert.deepEqual(await kv.ztop('z', 3), [['A',11]]);
assert.equal(await kv.applyOnce('gate2', { i:1 }, {
  counters:[['pend:A',5]], hashKey:'h:stats', deltas:{ burned:3 }, exSeconds:90,
}), true);
assert.equal(await kv.zincrManyOnce('gate3', { i:2 }, [['z:a','A',7]], 90), true);

assert.ok(calls.every(call => call.auth === 'Bearer service-test-only' && call.key === 'service-test-only'));
assert.ok(calls.some(call => call.name === 'ratchet_kv_apply_once'
  && call.args.p_counters[0][0] === 'pend:A' && call.args.p_deltas.burned === 3));
assert.ok(calls.some(call => call.name === 'ratchet_kv_zincr_many_once'
  && call.args.p_increments[0][1] === 'A'));
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
assert.ok(!html.includes('SUPABASE_SERVICE_KEY') && !html.includes('service_role'),
  'the service credential must never enter browser code');

console.log('Supabase adapter selects safely and preserves every atomic KV call shape');
