// The deployment gate must gate the store the deployment actually uses.
//
// It asks Supabase whether migration 003 is ready. On 2026-09-03 the store moved
// to the Redis protocol and this gate -- wired as Vercel's buildCommand -- would
// have failed every build from then on, for a database the deployment no longer
// touches. Worse, it would have failed it while Supabase was quota-restricted,
// so the one lever that could have brought the site back was itself blocked by
// the outage it was meant to survive.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { check } = require('../lib/check_store_schema.js');

let checks = 0;
const noFetch = async () => { throw new Error('the gate must not reach the network here'); };

// ---- a Redis-protocol store: nothing to ask, and nothing asked --------------
checks++;
assert.equal(await check({ env:{ KV_REST_API_URL:'https://x.upstash.io', KV_REST_API_TOKEN:'t' }, fetchImpl:noFetch }), true);
checks++;
assert.equal(await check({ env:{ UPSTASH_REDIS_REST_URL:'https://x.upstash.io', UPSTASH_REDIS_REST_TOKEN:'t' }, fetchImpl:noFetch }), true);

// ---- no durable store at all: still refused ---------------------------------
checks++;
await assert.rejects(() => check({ env:{}, fetchImpl:noFetch }), /durable store/);
checks++;
await assert.rejects(() => check({ env:{ KV_REST_API_URL:'https://x.upstash.io' }, fetchImpl:noFetch }), /durable store/,
  'half a Redis configuration is not a store');

// ---- Supabase configured: the migration question is still asked -------------
let asked = 0;
const supabaseEnv = { SUPABASE_URL:'https://project.supabase.co', SUPABASE_SERVICE_KEY:'k' };
const ready = async () => { asked++; return { ok:true, json: async () => ({ schema:'guarded-player-v1', ready:true }) }; };
checks++;
assert.equal(await check({ env:supabaseEnv, fetchImpl:ready }), true);
checks++;
assert.equal(asked, 1, 'with Supabase configured the gate must still ask');

checks++;
await assert.rejects(() => check({ env:supabaseEnv,
  fetchImpl: async () => ({ ok:true, json: async () => ({ schema:'guarded-player-v1', ready:false }) }) }),
  /not ready/);
checks++;
await assert.rejects(() => check({ env:supabaseEnv, fetchImpl: async () => ({ ok:false }) }), /unavailable/);

// ---- and a Supabase URL that is not one is still refused --------------------
checks++;
await assert.rejects(() => check({ env:{ ...supabaseEnv, SUPABASE_URL:'http://project.supabase.co' }, fetchImpl:noFetch }),
  /Invalid database endpoint/);

console.log(`PASS  store gate: ${checks} checks — it gates the store in use, and still refuses no store at all`);
