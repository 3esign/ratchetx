// Offline release-gate diagnostic. Exit 2 means the unsafe boundary reproduced;
// it is intentionally NOT a green acceptance suite or a production mutation.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
for(const key of ['SUPABASE_URL','SUPABASE_SERVICE_KEY','SUPABASE_SERVICE_ROLE_KEY',
  'KV_REST_API_URL','KV_REST_API_TOKEN','UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN']) delete process.env[key];
globalThis.__ratchet_mem = new Map();
globalThis.fetch = async()=>{throw new Error('offline diagnostic cannot call network');};
const kv = require('../lib/kv.js');
assert.equal(kv.backend,'memory');
const originalNow = Date.now;
let clock = 1788089000000;
Date.now = ()=>clock;
try {
  const w = '11111111111111111111111111111111', key='u:'+w, lock='lock:u:'+w;
  await kv.setJSON(key,{w,cr:1000,open:[]});
  const firstLease = await kv.acquireLease(lock,30);
  assert.ok(firstLease);
  const stale = await kv.getJSONStrict(key);
  // Same primitives as loadPlayer/savePlayer: the old caller resumes after its
  // lease has expired and a newer caller has acquired and committed its update.
  clock+=36000;
  const secondLease = await kv.acquireLease(lock,30);
  assert.ok(secondLease && secondLease!==firstLease);
  const fresh = await kv.getJSONStrict(key);
  fresh.cr-=500; fresh.open.push({id:'second'});
  await kv.setJSON(key,fresh);
  stale.cr-=500; stale.open.push({id:'first'});
  await kv.setJSON(key,stale);
  const after = await kv.getJSONStrict(key);
  assert.equal(await kv.releaseLease(lock,firstLease),false,'release is token-checked');
  assert.ok(!after.open.some(s=>s.id==='second'));
  console.error('UNSAFE boundary reproduced offline: stale player SET overwrites the newer shot after lease expiry. Token-checked release alone does not fence writes. Exit 2 is the expected finding, NOT an integration PASS.');
  process.exitCode=2;
} finally {Date.now=originalNow;}
