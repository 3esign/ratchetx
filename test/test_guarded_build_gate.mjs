import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const require=createRequire(import.meta.url),{check}=require('../lib/check_store_schema.js');
const env={SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SERVICE_KEY:'fixture-only'};
let calls=0;
const fetchImpl=async(url,options)=>{
  calls++;assert.equal(url,'https://fixture.supabase.co/rest/v1/rpc/ratchet_kv_guarded_ready');
  assert.equal(options.redirect,'error');assert.equal(options.body,'{}');
  return new Response(JSON.stringify({schema:'guarded-player-v1',ready:true}));
};
assert.equal(await check({env,fetchImpl}),true);assert.equal(calls,1);
// The refusal is unchanged; only its noun is. The gate used to name Supabase
// because Supabase was the only store; it now names the requirement itself,
// because a Redis-protocol store satisfies it and a missing one still does not.
await assert.rejects(()=>check({env:{},fetchImpl}),/requires a configured durable store/);
assert.equal(await check({env:{KV_REST_API_URL:'https://x.upstash.io',KV_REST_API_TOKEN:'t'},
  fetchImpl:async()=>{throw new Error('a Redis store must not be asked about migration 003');}}),true);
await assert.rejects(()=>check({env:{...env,SUPABASE_URL:'http://fixture.supabase.co'},fetchImpl}),/Invalid database/);
await assert.rejects(()=>check({env,fetchImpl:async()=>new Response('{}',{status:404})}),/migration 003/);
await assert.rejects(()=>check({env,fetchImpl:async()=>new Response('{"schema":"guarded-player-v1","ready":false}')}),/trigger/);
const config=JSON.parse(readFileSync(new URL('../vercel.json',import.meta.url),'utf8'));
assert.equal(config.buildCommand,'node lib/check_store_schema.js');
assert.equal(config.outputDirectory,'.','the readiness-only build must publish the existing root static site, not a nonexistent public folder');
assert.match(readFileSync(new URL('../index.html',import.meta.url),'utf8'),/<!doctype html>/i);
console.log('Vercel build blocks absent/mismatched database migration; readiness probe is read-only and never follows redirects PASS');
