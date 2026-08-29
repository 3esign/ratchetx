'use strict';
// Streamable HTTP MCP adapter for the FREE demo surface.
//
// This is deliberately an adapter, not a second game implementation: every
// board read, shot, settlement poll and proof read is dispatched into the same
// production handlers used by the website and the stdio MCP server. The remote
// endpoint holds no signing key and exposes no ranked write operation. Ranked
// play stays in the local stdio server, where the agent's key never leaves its
// machine.

const crypto = require('crypto');
const game = require('./game.js');
const proof = require('./proof.js');
const { RELEASE } = require('../lib/release.js');
const { progressFromState } = require('../lib/gauntlet.js');
const funnel = require('../lib/funnel.js');
const ranked = require('../lib/ranked.js');
const { getJSONStrict, setJSONEx, acquireLease, releaseLease } = require('../lib/kv.js');

const MCP_VERSION = '1.1.0';
const MODERN_PROTOCOL = '2026-07-28';
const LEGACY_PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26'];
const SUPPORTED_PROTOCOLS = [MODERN_PROTOCOL, ...LEGACY_PROTOCOLS];

const TOOLS = [
    { name: 'ratchet_invite',
      description: 'Request a fresh invitation to the RatchetX platform. An invite grants a non-privileged tracking handle for attribution but provides no funds or ranked status.',
      inputSchema: { type: 'object', properties: { source: { type: 'string' } } } },
  { name: 'ratchet_new_demo',
      description: 'Create a fresh free demo identity. Keep the returned handle and pass it to ratchet_demo_shot and ratchet_demo_state. Demo calls use the real board and oracle but never rank, enter pots, or move funds.',
      inputSchema: { type: 'object', properties: { invite: { type: 'string', description: 'Optional 128-bit invite ID' } } } },
  { name: 'ratchet_board',
    description: 'Read the live board: target ids, horizons, Pyth prices and ages, sealing and settlement rules, arena scoring, and ranked-entry doors.',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'ratchet_demo_shot',
    description: 'Fire a free unranked sealed commit-reveal forecast. First call ratchet_new_demo. State p honestly: it is the probability (0.01-0.99) that your chosen side wins and becomes a public Brier observation after settlement.',
    inputSchema: { type: 'object', required: ['handle', 'target', 'side'], properties: {
      handle: { type: 'string', description: '3-18 lowercase letters or digits, returned by ratchet_new_demo' },
      target: { type: 'string', description: 'target id from ratchet_board' },
      side: { type: 'string', enum: ['YES', 'NO'] },
      stake: { type: 'integer', minimum: 100, description: 'free demo credits; default 500' },
      p: { type: 'number', minimum: 0.01, maximum: 0.99,
        description: 'stated probability that your chosen side wins' },
    } } },
  
  { name: 'ratchet_agent_record',
    description: 'Fetch the public Agent Report Card showing scored calls, Brier score, and ESTABLISHED status.',
    inputSchema: { type: 'object', required: ['id'], properties: {
      id: { type: 'string', description: 'Agent wallet or demo-handle' }
    } } },
  { name: 'ratchet_demo_state',
    description: 'Read a demo identity record, including credits, open shots and recent settlements. Poll this after expiry because settlement is lazy and this read collects it.',
    inputSchema: { type: 'object', required: ['handle'], properties: {
      handle: { type: 'string', description: 'handle returned by ratchet_new_demo' },
      raw: { type: 'boolean', description: 'return the full state instead of the compact projection' },
    } } },
  { name: 'ratchet_arena',
    description: 'Read the public external-agent Brier leaderboard and the four house strategies that lose in public. Ten stated-probability settlements are required to rank.',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'ratchet_challenges',
    description: 'Read open player-written challenges. Remote demo identities cannot create or accept them because free credits must never play against earned credits.',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'ratchet_proof',
    description: 'Read the compact public health proof: oracle, sampler, stream, token authorities, settlement program, event log and disclosed limitations.',
    inputSchema: { type: 'object', properties: {} } },

  { name: 'ratchet_ranked_prepare',
    description: 'Prepare a bounded forecast for an already-registered ranked wallet. Returns the exact domain-separated payload to sign locally; no private key is sent to RatchetX.',
    inputSchema: { type: 'object', required: ['wallet', 'target', 'side', 'p'], properties: {
      wallet: { type: 'string', description: 'Your Solana wallet address (base58)' },
      target: { type: 'string', description: 'Exact target id returned by ratchet_board' },
      side: { type: 'string', enum: ['YES', 'NO'] },
      p: { type: 'number', minimum: 0.01, maximum: 0.99 },
      stake: { type: 'integer', minimum: 100, description: 'Credits to stake; default 500' }
    } } },
  { name: 'ratchet_ranked_submit',
    description: 'Submit a signed ranked forecasting shot using the payload and signature.',
    inputSchema: { type: 'object', required: ['wallet', 'signature', 'nonce', 'payload'], properties: {
      wallet: { type: 'string' },
      signature: { type: 'string', description: 'base64 Ed25519 signature of the payload string' },
      nonce: { type: 'string' },
      payload: { type: 'string', description: 'The exact canonical JSON string returned by prepare' }
    } } },
];

const MCP_ENDPOINT = 'https://ratchetx.xyz/api/mcp';
const MCP_DISCOVERY = 'https://ratchetx.xyz/.well-known/mcp.json';
function inspectionContract() {
  return {
    transport: {
      type: 'streamable-http',
      endpoint: MCP_ENDPOINT,
      requestMethod: 'POST',
      getStatus: 405,
      getMeaning: 'intentional: this stateless server does not expose an SSE GET stream',
    },
    discovery: MCP_DISCOVERY,
    standardFlow: ['initialize', 'tools/list', 'tools/call'],
    initializeRequest: {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'mcp-protocol-version': '2025-11-25',
      },
      body: {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'ratchet-inspector', version: '1.0' },
        },
      },
    },
    toolsListRequest: {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    },
    toolSchemas: TOOLS,
  };
}

function header(req, name) {
  const hs = req.headers || {};
  const want = name.toLowerCase();
  for (const [k, v] of Object.entries(hs)) if (k.toLowerCase() === want) return Array.isArray(v) ? v[0] : v;
  return undefined;
}

function originAllowed(value) {
  if (!value) return true;
  try {
    const u = new URL(String(value));
    if (u.protocol === 'https:') return true;
    return u.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(u.hostname);
  } catch { return false; }
}

function cors(req, res) {
  const origin = header(req, 'origin');
  res.setHeader('Access-Control-Allow-Origin', originAllowed(origin) && origin ? String(origin) : '*');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, MCP-Protocol-Version, Mcp-Method, Mcp-Name');
  res.setHeader('Access-Control-Expose-Headers', 'MCP-Protocol-Version');
}

function sendJSON(res, status, body) {
  res.status(status);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.json(body);
}

function rpcError(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: '2.0', id: id === undefined ? null : id, error };
}

// Invoke the canonical Vercel handlers in-process. This preserves the caller's
// address for the existing rate limiter and prevents a remote MCP user from
// being placed on a separate economic or settlement path.
async function invoke(handler, outerReq, { method = 'GET', query = {}, body = null,
  verifiedRanked = null } = {}) {
  let status = 200, payload, ended = false;
  const req = { method, query, body, headers: outerReq.headers || {}, socket: outerReq.socket || {} };
  if (verifiedRanked) ranked.markVerified(req, verifiedRanked);
  const res = {
    status(code) { status = code; return this; },
    setHeader() {},
    json(value) { payload = value; ended = true; return value; },
    end(value) {
      if (value) { try { payload = JSON.parse(String(value)); } catch { payload = value; } }
      ended = true;
    },
  };
  await handler(req, res);
  if (!ended) throw new Error('canonical handler returned no response');
  if (status >= 400 && (!payload || payload.ok !== false))
    return { ok: false, reason: `canonical handler returned HTTP ${status}` };
  return payload;
}

const demoHandle = value => {
  const h = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9]{3,18}$/.test(h)) throw new Error('handle must be 3-18 lowercase letters or digits; call ratchet_new_demo first');
  return h;
};

const slimShot = s => ({ id:s.id, label:s.label, side:s.side, stake:s.stake,
  entry:s.entry, exitPx:s.exitPx, res:s.res, xp:s.xp, back:s.back,
  exp:s.exp, commit:s.commit, sp:s.sp });
function slimState(st, wallet) {
  const out = { ok:st.ok, v:st.v };
  if (st.prices) out.prices = { src:st.prices.src, ages:st.prices.ages, SOL:st.prices.SOL };
  const p = st.player || st.p || null;
  if (p) out.player = { wallet, credits:p.cr, xp:p.xp, streak:p.streak,
    hits:p.hits, shots:p.shots, stated:p.stated, brier:p.brier, brierIndex:p.brierIndex,
    open:(p.open || []).map(slimShot), closed:(p.closed || p.history || []).slice(0, 5).map(slimShot) };
  if (p) out.gauntlet = progressFromState(st, wallet);
  return out;
}

async function callTool(req, name, args = {}) {
  switch (name) {
      case 'ratchet_invite': {
        const inviteId = crypto.randomBytes(16).toString('hex');
        const { record } = await funnel.issueInvite(inviteId, args.source || 'agent');
        
        return {
           ok: true,
           inviteId,
           gauntletId: 'first-contact-001',
           mcpEndpoint: 'https://ratchetx.xyz/api/mcp',
           expiresAt: new Date(record.exp).toISOString(),
           note: 'Free tracking invite. Call ratchet_new_demo with this invite ID to start the Gauntlet.',
           next: 'ratchet_new_demo'
        };
      }

    case 'ratchet_new_demo': {
        const handle = crypto.randomBytes(6).toString('hex');
        if (args.invite) {
           const { hash, record } = await funnel.resolveInvite(args.invite);
           await funnel.bindDemoInvite(handle, hash, record.exp);
           await funnel.recordMilestone(hash, 'demo_created', { handle });
        } return { handle, wallet:`demo-${handle}`,
        next:['ratchet_board', 'ratchet_demo_shot', 'ratchet_demo_state'],
        note:'free and unranked; no wallet, token, payment or signature; keep this handle for later calls' };
    }
    case 'ratchet_board': return invoke(game, req, { query:{ action:'board' } });
    case 'ratchet_arena': return invoke(game, req, { query:{ action:'arena' } });
    case 'ratchet_challenges': return invoke(game, req, { query:{ action:'challenges' } });
    
    case 'ratchet_agent_record': {
      const agentMod = require('./agent.js');
      const mockReq = { method: 'GET', query: { id: args.id } };
      let outObj;
      const mockRes = {
        setHeader: () => {},
        status: (code) => mockRes,
        json: (obj) => { outObj = obj; return obj; },
        end: () => {}
      };
      await agentMod(mockReq, mockRes);
      if (!outObj.ok) {
        const error = new Error(outObj.reason);
        error.code = 'AGENT_RECORD_ERROR';
        throw error;
      }
      return outObj;
    }
    case 'ratchet_demo_state': {
      const handle = demoHandle(args.handle);
      const wallet = `demo-${handle}`;
      const st = await invoke(game, req, { query:{ action:'state', wallet } });
      const inviteHash = await funnel.inviteForDemo(handle);
      if (inviteHash) {
        const progress = progressFromState(st, wallet);
        if (progress.latestEvidence && progress.latestEvidence.id) {
          await funnel.recordMilestone(inviteHash, 'settlement_scored', {
            shotId:progress.latestEvidence.id, result:progress.latestEvidence.result });
        }
        if (progress.completed) {
          await funnel.recordMilestone(inviteHash, 'gauntlet_complete', {
            shotId:progress.latestEvidence && progress.latestEvidence.id });
        }
      }
      return args.raw ? st : slimState(st, wallet);
    }
    
    case 'ratchet_ranked_prepare': {
      const { wallet, target, side, p, stake } = args;
      const board = await invoke(game, req, { query:{ action:'board' } });
      if (!board || !board.targets || !board.targets[target]) throw new Error('target is not live; call ratchet_board and choose an exact current id');
      const nonce = crypto.randomBytes(16).toString('hex');
      const expiresAt = Date.now() + 60000;
      const payload = ranked.payloadFor({ wallet, target, side, p, stake, nonce, expiresAt });
      await setJSONEx(`nonce:ranked:${wallet}:${nonce}`, { payload, used:false, createdAt:Date.now() }, 120);
      return { nonce, expiresAt, payload, domain:ranked.DOMAIN, network:ranked.NETWORK,
        instruction:'Sign the exact UTF-8 payload with the wallet Ed25519 key, then call ratchet_ranked_submit.' };
    }
    case 'ratchet_ranked_submit': {
      const { wallet, signature, nonce, payload } = args;
      if (!wallet || !signature || !nonce || !payload) throw new Error('Missing arguments');
      const key = `nonce:ranked:${wallet}:${nonce}`;
      const leaseKey = `lock:${key}`;
      const lease = await acquireLease(leaseKey, 15);
      if (!lease) throw new Error('ranked submission is already processing; retry');
      try {
        const record = await getJSONStrict(key);
        if (!record) throw new Error('Nonce expired or invalid');
        if (record.payload !== payload) throw new Error('Payload mismatch');
        if (record.used && record.result) return { ...record.result, idempotent:true };
        if (record.used) throw new Error('Nonce already used');
        const parsed = ranked.verifyPayload(payload, signature, wallet);
        if (parsed.nonce !== nonce) throw new Error('Nonce mismatch');
        const body = { action:'shot', auth:{ wallet }, target:parsed.target,
          side:parsed.side, p:parsed.p, stake:parsed.stake,
          requestId:`ranked:${parsed.nonce}` };
        const out = await invoke(game, req, { method:'POST', body, verifiedRanked:parsed });
        if (!out || !out.ok) throw new Error(out && out.reason || 'Shot failed');
        await setJSONEx(key, { ...record, used:true, usedAt:Date.now(), result:out }, 120);
        return out;
      } finally {
        await releaseLease(leaseKey, lease).catch(() => {});
      }
    }

    case 'ratchet_demo_shot': {
      const handle = demoHandle(args.handle);
      const body = { action:'shot', auth:{ wallet:`demo-${handle}` },
        target:String(args.target || ''), side:String(args.side || '').toUpperCase(),
        stake:Math.floor(args.stake == null ? 500 : Number(args.stake)) };
      if (args.p !== undefined && args.p !== null) body.p = Number(args.p);
      const out = await invoke(game, req, { method:'POST', body });
      const inviteHash = out && out.ok ? await funnel.inviteForDemo(handle) : null;
      if (inviteHash && out.shot && out.shot.id) {
        await funnel.recordMilestone(inviteHash, 'shot_sealed', { shotId:out.shot.id });
      }
      return out;
    }
    case 'ratchet_proof': {
      const p = await invoke(proof, req);
      if (!p || !Array.isArray(p.checks)) return p;
      return { ok:p.ok, v:p.v, truthPlane:p.truthPlane,
        checks:p.checks.map(c => ({ id:c.id, status:c.status, label:c.label, detail:c.detail })) };
    }
    default: throw new Error(`unknown tool: ${name}`);
  }
}

function validateModernHeaders(req, msg, protocol) {
  if (protocol !== MODERN_PROTOCOL) return null;
  const method = header(req, 'mcp-method');
  const name = header(req, 'mcp-name');
  const metaVersion = msg.params && msg.params._meta
    && msg.params._meta['io.modelcontextprotocol/protocolVersion'];
  if (method !== msg.method) return `Mcp-Method header does not match body method ${msg.method}`;
  if (metaVersion !== protocol) return 'MCP-Protocol-Version header does not match request _meta';
  if (msg.method === 'tools/call' && name !== (msg.params && msg.params.name))
    return 'Mcp-Name header does not match body tool name';
  return null;
}

module.exports = async function handler(req, res) {
  cors(req, res);
  const origin = header(req, 'origin');
  if (!originAllowed(origin)) return sendJSON(res, 403, rpcError(null, -32000, 'forbidden Origin'));
  if (req.method === 'OPTIONS') { res.status(204); return res.end(); }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    res.setHeader('Link', '<https://ratchetx.xyz/.well-known/mcp.json>; rel="service-desc"');
    return sendJSON(res, 405, rpcError(null, -32600,
      'Streamable HTTP accepts POST requests; GET is an inspection response, not an MCP session',
      inspectionContract()));
  }

  const msg = req.body;
  if (!msg || Array.isArray(msg) || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string')
    return sendJSON(res, 400, rpcError(msg && msg.id, -32600, 'invalid JSON-RPC request'));

  const protocol = String(header(req, 'mcp-protocol-version') || '2025-03-26');
  if (!SUPPORTED_PROTOCOLS.includes(protocol))
    return sendJSON(res, 400, rpcError(msg.id, -32600, 'unsupported MCP protocol version',
      { supported:SUPPORTED_PROTOCOLS }));
  const mismatch = validateModernHeaders(req, msg, protocol);
  if (mismatch) return sendJSON(res, 400, rpcError(msg.id, -32020, `header mismatch: ${mismatch}`));

  if (msg.id === undefined) { res.status(202); return res.end(); }

  const { id, method, params } = msg;
  try {
    if (method === 'initialize') {
      const requested = params && params.protocolVersion;
      const chosen = SUPPORTED_PROTOCOLS.includes(requested) ? requested : LEGACY_PROTOCOLS[0];
      res.setHeader('MCP-Protocol-Version', chosen);
      return sendJSON(res, 200, { jsonrpc:'2.0', id, result:{
        protocolVersion:chosen, capabilities:{ tools:{} },
        serverInfo:{ name:'ratchetx-remote-demo', version:MCP_VERSION },
        _meta:{ release:RELEASE },
        instructions:'Free remote demo: call ratchet_new_demo once, keep its handle, read ratchet_board and its gauntlet contract, fire ratchet_demo_shot with an honest p, then poll ratchet_demo_state after expiry. Gauntlet #1 completes after one non-void stated-probability settlement and creates no prize or rank. Demo never ranks or moves funds. Ranked play uses the local stdio server and a local Solana signer.',
      } });
    }
    if (method === 'ping') return sendJSON(res, 200, { jsonrpc:'2.0', id, result:{} });
    if (method === 'tools/list') return sendJSON(res, 200, { jsonrpc:'2.0', id, result:{ tools:TOOLS } });
    if (method === 'tools/call') {
      const name = params && params.name;
      try {
        const out = await callTool(req, name, (params && params.arguments) || {});
        return sendJSON(res, 200, { jsonrpc:'2.0', id, result:{
          content:[{ type:'text', text:JSON.stringify(out, null, 2) }],
          structuredContent:out,
          isError:out && out.ok === false ? true : undefined,
        } });
      } catch (e) {
        return sendJSON(res, 200, { jsonrpc:'2.0', id, result:{
          content:[{ type:'text', text:String(e && e.message || e) }], isError:true,
        } });
      }
    }
    return sendJSON(res, 404, rpcError(id, -32601, `method not found: ${method}`));
  } catch (e) {
    return sendJSON(res, 500, rpcError(id, -32603, String(e && e.message || e)));
  }
};

module.exports.TOOLS = TOOLS;
module.exports.SUPPORTED_PROTOCOLS = SUPPORTED_PROTOCOLS;
module.exports.inspectionContract = inspectionContract;
