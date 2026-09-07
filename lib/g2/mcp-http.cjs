'use strict';
// Stateless Streamable HTTP: read/unsigned preparation only. No DB or secrets.
const config = require('./devnet-config.json');
const ORIGINS = new Set(['https://ratchetx.xyz', 'https://www.ratchetx.xyz', 'https://ratchetx.vercel.app']);
const VERSION = '2025-11-25';
let runtime;
async function getRuntime() {
  if (!runtime) runtime = Promise.all([import('./agent-tools.mjs'), import('@solana/web3.js')]).then(([module, web3]) => ({
    module, adapter: module.createG2AgentTools({ web3,
      connection: new web3.Connection('https://api.devnet.solana.com', { commitment: 'confirmed', disableRetryOnRateLimit: true }), config, local: false }),
  }));
  return runtime;
}
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const reply = (status, body) => res.status(status).json(body);
  const origin = req.headers?.origin;
  if (origin && !ORIGINS.has(origin)) return reply(403, { error: 'Origin not allowed' });
  if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return reply(405, { error: 'Use POST with MCP JSON-RPC. This stateless server does not open an SSE stream.' });
  }
  if (req.headers?.['mcp-protocol-version'] && req.headers['mcp-protocol-version'] !== VERSION)
    return reply(400, { error: 'Unsupported MCP-Protocol-Version', supported: [VERSION] });
  if (!String(req.headers?.['content-type'] || '').toLowerCase().startsWith('application/json'))
    return reply(415, { error: 'Content-Type must be application/json' });
  const accept = String(req.headers?.accept || '');
  if (!accept.includes('application/json') || !accept.includes('text/event-stream'))
    return reply(406, { error: 'Accept must include application/json and text/event-stream' });
  let body;
  try {
    const raw = typeof req.body === 'string' ? req.body : Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(req.body);
    if (!raw || Buffer.byteLength(raw) > 65536) return reply(413, { error: 'Request body must be at most 64 KiB' });
    body = JSON.parse(raw);
  } catch { return reply(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
  try {
    const { module: protocol, adapter } = await getRuntime();
    const response = await protocol.handleG2JsonRpc(body, adapter);
    if (response === null) return res.status(202).end();
    return reply(response.error?.code === -32600 ? 400 : 200, response);
  } catch { return reply(503, { error: 'G2 adapter unavailable. No transaction was signed or sent.' }); }
};
