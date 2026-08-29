// A real Streamable HTTP client drives the new remote MCP adapter into the
// canonical game handler. Ranked writes are intentionally absent: remote means
// free demo only, while private signing stays local.
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { RELEASE } = require('../lib/release.js');
const discoveryVersion = JSON.parse(fs.readFileSync(
  new URL('../.well-known/mcp.json', import.meta.url), 'utf8')).version;

let pass = 0, failed = 0;
const ok = (c, label) => { console.log((c ? 'PASS  ' : 'FAIL  ') + label); if (c) pass++; else failed++; };

const pricesPath = require.resolve('../lib/prices.js');
const burnPath = require.resolve('../lib/burn.js');
const proofPath = require.resolve('../api/proof.js');
const FEEDS = ['SOL','BTC','ETH','BONK','WIF','JUP','PUMP'];
let T = 100;
require.cache[pricesPath] = { id:pricesPath, filename:pricesPath, loaded:true, exports:{
  getPrices:async () => { const t=Math.floor(Date.now()/1000), scale=(T+=0.4)/100; return {
    src:'pyth-onchain', ages:Object.fromEntries(FEEDS.map(f=>[f,3])),
    confs:Object.fromEntries(FEEDS.map(f=>[f,10])), pubs:Object.fromEntries(FEEDS.map(f=>[f,t])),
    prevPubs:Object.fromEntries(FEEDS.map(f=>[f,t-60])), SOL:T, BTC:60000*scale,
    ETH:2000*scale, BONK:0.000002*scale, WIF:0.1*scale, JUP:0.2*scale, PUMP:0.005*scale }; } } };
require.cache[burnPath] = { id:burnPath, filename:burnPath, loaded:true, exports:{
  INCINERATOR:'1nc1nerator11111111111111111111111111111111', rpcCall:async()=>null,
  getTx:async()=>null, decideBurn:()=>({ok:false,reason:'stub'}) } };
require.cache[proofPath] = { id:proofPath, filename:proofPath, loaded:true, exports:async (_req,res) =>
  res.json({ok:true,v:'test',truthPlane:{canonicalSettlement:'ratchet-server'},
    checks:[{id:'oracle',status:'green',label:'oracle answers',detail:'stub'}]}) };

const mcp = require('../api/mcp.js');
let nextId = 1;
const call = async (method, params = {}, headers = {}) => {
  let status=200, body, ended=false; const outHeaders={};
  const req = { method:'POST', body:{jsonrpc:'2.0',id:nextId++,method,params},
    headers:{'x-forwarded-for':'9.9.9.9',...headers}, socket:{} };
  const res = { status(c){status=c;return this;}, setHeader(k,v){outHeaders[k.toLowerCase()]=v;},
    json(v){body=v;ended=true;return v;}, end(v){body=v;ended=true;} };
  await mcp(req,res); return {status,body,headers:outHeaders,ended};
};
const tool = async (name, args={}) => {
  const r=await call('tools/call',{name,arguments:args});
  return {response:r, out:r.body && r.body.result && r.body.result.structuredContent};
};

const init = await call('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'test',version:'0'}},
  {'mcp-protocol-version':'2025-11-25'});
ok(init.status===200 && init.body.result.serverInfo.name==='ratchetx-remote-demo'
  && init.body.result.serverInfo.version===discoveryVersion
  && init.body.result._meta.release===RELEASE,
  'legacy Streamable HTTP initializes with the exact discovery version and deployed build');

const list = await call('tools/list',{}, {'mcp-protocol-version':'2025-11-25'});
const names=(list.body.result.tools||[]).map(t=>t.name);
if (names.length !== 11) console.error('Actual names:', names);
ok(names.length===11 && names.includes('ratchet_demo_shot') && names.includes('ratchet_proof'), '11 remote demo tools are listed');
ok(!names.includes('ratchet_register_agent') && !names.includes('ratchet_challenge'), 'remote endpoint exposes no signed or economic write');

const ident = await tool('ratchet_new_demo');
ok(ident.out && /^[a-f0-9]{12}$/.test(ident.out.handle), 'server creates a fresh stateless demo handle');
const board = await tool('ratchet_board');
const target = board.out && board.out.targets && board.out.targets.find(t=>t.kind==='dir');
ok(!!target, 'remote MCP reads the canonical live board');
ok(board.out.gauntlet && board.out.gauntlet.id==='first-contact-001'
  && board.out.gauntlet.reward.money===false,
  'the first board read exposes the free non-economic Gauntlet contract');
const shot = await tool('ratchet_demo_shot',{handle:ident.out.handle,target:target.id,side:'YES',stake:500,p:0.61});
ok(shot.out && shot.out.ok===true && shot.out.shot && shot.out.shot.commit, 'remote MCP seals a real demo shot with stated probability');
const state = await tool('ratchet_demo_state',{handle:ident.out.handle});
ok(state.out && state.out.player && state.out.player.open.length===1, 'same handle reads its canonical open shot');
ok(state.out.gauntlet && state.out.gauntlet.stage==='awaiting_settlement'
  && state.out.gauntlet.completed===false,
  'demo state derives Gauntlet progress from the canonical open shot');
const proof = await tool('ratchet_proof');
ok(proof.out && proof.out.checks[0].id==='oracle' && proof.out.truthPlane, 'proof is exposed in compact structured form');
const bad = await tool('ratchet_demo_state',{handle:'NOT VALID!'});
ok(bad.response.body.result.isError===true, 'bad demo identity is a tool error, not a server crash');

const modernParams={_meta:{'io.modelcontextprotocol/protocolVersion':'2026-07-28'}};
const modern=await call('tools/list',modernParams,{'mcp-protocol-version':'2026-07-28','mcp-method':'tools/list'});
ok(modern.status===200 && Array.isArray(modern.body.result.tools), '2026 per-request MCP metadata is accepted');
const mismatch=await call('tools/list',modernParams,{'mcp-protocol-version':'2026-07-28','mcp-method':'tools/call'});
ok(mismatch.status===400 && mismatch.body.error.code===-32020, 'modern mirrored-header mismatch is rejected');

let originStatus=200;
const originReq={method:'POST',body:{jsonrpc:'2.0',id:99,method:'ping',params:{}},headers:{origin:'http://evil.example'},socket:{}};
const originRes={status(c){originStatus=c;return this;},setHeader(){},json(v){return v;},end(){}};
await mcp(originReq,originRes);
ok(originStatus===403, 'non-TLS non-local Origin is refused');
let getStatus=200, getBody=null;
const getHeaders={};
const getRes={status(c){getStatus=c;return this;},
  setHeader(k,v){getHeaders[String(k).toLowerCase()]=v;},
  json(v){getBody=v;return v;},end(){}};
await mcp({method:'GET',headers:{},socket:{}},getRes);
ok(getStatus===405 && getBody?.error?.data?.transport?.requestMethod==='POST'
  && getBody.error.data.toolSchemas.length===11
  && /well-known\/mcp\.json/.test(getHeaders.link || ''),
  'GET stays 405 by transport design but exposes discovery, POST flow and all tool schemas');

console.log(`\n${pass} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
