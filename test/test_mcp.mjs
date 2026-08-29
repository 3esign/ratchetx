// The MCP server is a doorway for AI agents into the SAME api/game.js everyone
// else uses. This drives the real server file over real stdio JSON-RPC against
// the real game handler — if this passes, an MCP client can actually play.
import http from 'node:http';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

let pass = 0, failn = 0;
const ok = (c, label) => { if (c) { pass++; console.log('PASS  ' + label); }
  else { failn++; console.log('FAIL  ' + label); } };

// stub only the oracle and the chain — everything else is production code
const pricesPath = require.resolve('../lib/prices.js');
const burnPath = require.resolve('../lib/burn.js');
let T = 100;
const FEEDS = ['SOL','BTC','ETH','BONK','WIF','JUP','PUMP'];
require.cache[pricesPath] = { id: pricesPath, filename: pricesPath, loaded: true,
  exports: { getPrices: async () => { const t=Math.floor(Date.now()/1000), scale=(T+=0.4)/100; return { src:'pyth-onchain',
    ages:Object.fromEntries(FEEDS.map(f=>[f,3])), confs:Object.fromEntries(FEEDS.map(f=>[f,10])),
    pubs:Object.fromEntries(FEEDS.map(f=>[f,t])), prevPubs:Object.fromEntries(FEEDS.map(f=>[f,t-60])),
    slots:Object.fromEntries(FEEDS.map((f,i)=>[f,600000+i])),
    postedSlots:Object.fromEntries(FEEDS.map((f,i)=>[f,599900+i])),
    emaPrices:Object.fromEntries(FEEDS.map(f=>[f,({SOL:T,BTC:60000*scale,ETH:2000*scale,BONK:0.000002*scale,WIF:0.1*scale,JUP:0.2*scale,PUMP:0.005*scale})[f]])),
    emaConfs:Object.fromEntries(FEEDS.map(f=>[f,8])),
    SOL:T, BTC:60000*scale, ETH:2000*scale, BONK:0.000002*scale, WIF:0.1*scale, JUP:0.2*scale, PUMP:0.005*scale }; } } };
require.cache[burnPath] = { id: burnPath, filename: burnPath, loaded: true,
  exports: { INCINERATOR:'1nc1nerator11111111111111111111111111111111',
    rpcCall: async()=>null, getTx: async()=>null, decideBurn: ()=>({ok:false,reason:'stub'}) } };

const game = require('../api/game.js');
const proof = require('../api/proof.js');
const srv = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  let body = null;
  if (req.method === 'POST') {
    const chunks = []; for await (const c of req) chunks.push(c);
    try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch {}
  }
  const q = Object.fromEntries(u.searchParams);
  const fake = { method: req.method, query: q, body, headers: {'x-forwarded-for':'8.8.8.'+Math.floor(Math.random()*250)}, socket:{} };
  const out = { _s:200, status(c){this._s=c;return this;}, setHeader(){},
    json(o){ res.writeHead(this._s,{'content-type':'application/json'}); res.end(JSON.stringify(o)); } };
  const handler = u.pathname.startsWith('/proof') ? proof : game;
  try { await handler(fake, out); } catch (e) { out.status(500).json({ok:false,reason:String(e)}); }
});
// 8302 on purpose: test_agent_e2e owns 8301 and suites must never share a port.
await new Promise(r => srv.listen(8302, r));

// ---- a minimal MCP client over stdio ----
const child = spawn('node', [require.resolve('../mcp/ratchet-mcp.mjs')], {
  env: { ...process.env, RATCHET_API: 'http://127.0.0.1:8302/game', RATCHET_DEMO_HANDLE: 'mcptest' },
  stdio: ['pipe', 'pipe', 'inherit'],
});
const pending = new Map();
let nextId = 1;
readline.createInterface({ input: child.stdout }).on('line', l => {
  let m; try { m = JSON.parse(l); } catch { return; }
  if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const rpc = (method, params) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, resolve);
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout: ${method}`)); } }, 20000);
});
const notify = (method) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n');
const toolJSON = r => { try { return JSON.parse(r.result.content[0].text); } catch { return null; } };

try {
  // 1 ---- handshake
  const init = await rpc('initialize', { protocolVersion: '2025-06-18',
    capabilities: {}, clientInfo: { name: 'test', version: '0' } });
  ok(init.result && init.result.serverInfo && init.result.serverInfo.name === 'ratchet-mcp',
    'initialize returns the server identity');
  ok(init.result.protocolVersion === '2025-06-18', 'protocol version is echoed back');
  notify('notifications/initialized');

  // 2 ---- tools are listed with schemas
  const list = await rpc('tools/list', {});
  const names = (list.result.tools || []).map(t => t.name);
  ok(names.length === 13 && names.includes('ratchet_pyth_context')
    && names.includes('ratchet_pyth_path') && names.includes('ratchet_shot')
    && names.includes('ratchet_proof'), 'all thirteen tools are listed');
  ok(names.indexOf('ratchet_pyth_context') < names.indexOf('ratchet_board'),
    'Pyth context is discovered before the board');
  ok(list.result.tools.every(t => t.inputSchema && t.inputSchema.type === 'object'),
    'every tool carries an input schema');

  // 3 ---- identity: demo by default, and says so
  const who = toolJSON(await rpc('tools/call', { name: 'ratchet_whoami', arguments: {} }));
  ok(who.mode === 'demo' && who.wallet === 'demo-mcptest', 'demo identity with a stable handle');

  // 4 ---- the board reads
  const board = toolJSON(await rpc('tools/call', { name: 'ratchet_board', arguments: {} }));
  ok(Array.isArray(board.targets) && board.targets.length > 0 && board.prices,
    'board carries targets and live prices');
  const dir = board.targets.find(t => t.kind === 'dir');
  ok(!!dir, 'a directional target exists to fire on');
  const context = toolJSON(await rpc('tools/call', { name:'ratchet_pyth_context',
    arguments:{ feed:dir.feed, hours:1 } }));
  if (!(context?.pyth?.provider === 'Pyth Network'
    && context?.access?.requestTriggeredOracleRead === false
    && context?.feeds?.[0]?.current?.postedSlot != null)) console.error('context:', context);
  ok(context.pyth?.provider === 'Pyth Network'
    && context.access?.requestTriggeredOracleRead === false
    && context.feeds?.[0]?.current?.postedSlot != null,
    'stdio MCP reads the shared Pyth snapshot with attribution and slots');
  const path = toolJSON(await rpc('tools/call', { name:'ratchet_pyth_path',
    arguments:{ feed:dir.feed, from:Date.now()-120000, to:Date.now()+1000, limit:10 } }));
  if (!(path?.attribution?.provider === 'Pyth Network' && Array.isArray(path?.points)))
    console.error('path:', path);
  ok(path.attribution?.provider === 'Pyth Network' && Array.isArray(path.points),
    'stdio MCP reads a bounded retained Pyth observation path');

  // 5 ---- a demo shot seals through the real handler
  const shot = toolJSON(await rpc('tools/call', { name: 'ratchet_shot',
    arguments: { target: dir.id, side: 'YES', stake: 500 } }));
  ok(shot.ok === true && shot.shot && typeof shot.shot.commit === 'string',
    'demo shot seals and returns its commitment');

  // 6 ---- state shows the open shot, slimmed
  const st = toolJSON(await rpc('tools/call', { name: 'ratchet_state', arguments: {} }));
  ok(st.player && Array.isArray(st.player.open) && st.player.open.length === 1
    && typeof st.player.credits === 'number',
    'state projection carries credits and the open shot');

  // 7 ---- ranked-only tools refuse politely in demo mode
  const reg = toolJSON(await rpc('tools/call', { name: 'ratchet_register_agent',
    arguments: { name: 'TEST BOT' } }));
  ok(reg.ok === false && /ranked/.test(reg.reason), 'arena registration refuses demo mode with the reason');

  // 8 ---- proof answers through the same doorway
  const proofOut = toolJSON(await rpc('tools/call', { name: 'ratchet_proof', arguments: {} }));
  ok(Array.isArray(proofOut.checks) && proofOut.checks.every(c => c.id && c.status),
    'proof checks come back slimmed to id/status/label');

  // 9 ---- unknown tool is an error, not a crash
  const bad = await rpc('tools/call', { name: 'ratchet_nope', arguments: {} });
  ok(bad.result && bad.result.isError === true, 'unknown tool returns isError');
} catch (e) {
  failn++; console.log('FAIL  ' + (e && e.message || e));
} finally {
  child.kill();
  srv.close();
}

console.log(failn === 0 ? '\nALL PASS' : `\n${failn} FAILED`);
process.exit(failn ? 1 : 0);
