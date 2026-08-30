import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
for(const k of ['SUPABASE_URL','SUPABASE_SERVICE_KEY','SUPABASE_SERVICE_ROLE_KEY','KV_REST_API_URL','KV_REST_API_TOKEN','UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN']) delete process.env[k];
globalThis.__ratchet_mem=new Map();
let oracleReads=0;
const pricePath=require.resolve('../lib/prices.js');
require.cache[pricePath]={id:pricePath,filename:pricePath,loaded:true,exports:{
  getPrices:async()=>{oracleReads++;throw new Error('read-only scorecard called oracle');}}};
const kv=require('../lib/kv.js');
const identity='demo-score100',shotId='score100-shot';
await kv.setJSON('u:'+identity,{w:identity,shots:1,bn:1,bsum:.2704,
  closed:[{id:shotId,feed:'BTC',res:'miss',sp:.52,settledAt:1788080000000}],open:[]});
await kv.setJSON('agentrun:'+shotId,{shotId,digest:'sha256:'+'a'.repeat(64),verifiedAt:1788080000000,
  receipt:{result:'MATCH',trustBoundary:{oracleAccountValidation:'Pyth PriceUpdateV2 decoded and validated at observation time',
    selectionAuthority:'ratchet-server-hash-chain',independentPythReplay:false}}});
const mcp=require('../api/mcp.js'),game=require('../api/game.js');
async function call(id){
  let body,status=200;
  await mcp({method:'POST',headers:{},socket:{},body:{jsonrpc:'2.0',id:1,method:'tools/call',
    params:{name:'ratchet_agent_record',arguments:{id}}}},
  {setHeader(){},status(n){status=n;return this;},json(v){body=v;return v;},end(){}});
  return {status,body};
}
test('advertised MCP scorecard executes the same read-only canonical handler as REST',async()=>{
  let rest;
  await game({method:'GET',headers:{},socket:{},query:{action:'agent-report',id:'score100'}},
    {setHeader(){},status(){return this;},json(v){rest=v;return v;}});
  const r=await call('score100');
  assert.equal(r.status,200);
  assert.notEqual(r.body.result.isError,true,'listed tool must execute, not merely appear in tools/list');
  assert.deepEqual(r.body.result.structuredContent,rest);
  assert.equal(rest.reportCard.stats.brierScore,.2704);
  assert.equal(oracleReads,0);
});
test('receipt provenance comes from retained evidence, never obsolete Benchmarks text',async()=>{
  const {body}=await call('score100');
  const receipt=body.result.structuredContent?.reportCard.latestReceipt;
  assert.equal(receipt?.oracleAuthentication,'Pyth PriceUpdateV2 decoded and validated at observation time');
  assert.equal(receipt.independentPythReplay,false);
  const stored=await kv.getJSONStrict('agentrun:'+shotId);
  delete stored.receipt.trustBoundary;
  await kv.setJSON('agentrun:'+shotId,stored);
  const unknown=await call('score100');
  assert.equal(unknown.body.result.structuredContent.reportCard.latestReceipt.oracleAuthentication,null);
  assert.equal(unknown.body.result.structuredContent.reportCard.latestReceipt.independentPythReplay,null);
});
test('bad and unknown identities return structured tool errors, not module-stack exceptions',async()=>{
  for(const id of ['bad identity!','unknown100']){
    const {body}=await call(id);
    assert.equal(body.result.isError,true);
    assert.equal(body.result.structuredContent?.ok,false);
    assert.doesNotMatch(JSON.stringify(body),/Cannot find module|Require stack/);
  }
  assert.equal(oracleReads,0);
});
