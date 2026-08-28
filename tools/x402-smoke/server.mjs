import http from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const port = Number(process.argv[2] || 8462);
const rpcUrls = ['https://solana-rpc.publicnode.com', 'https://api.mainnet-beta.solana.com'];
const rpcMethods = new Set(['getTokenSupply', 'getTokenAccountsByOwner', 'getLatestBlockhash',
  'getSignatureStatuses', 'getTransaction']);
const files = new Map([
  ['/', [join(here, 'index.html'), 'text/html; charset=utf-8']],
  ['/direct', [join(here, 'direct.html'), 'text/html; charset=utf-8']],
  ['/smoke-core.js', [join(here, 'smoke-core.js'), 'text/javascript; charset=utf-8']],
  ['/smoke-app.js', [join(here, 'smoke-app.js'), 'text/javascript; charset=utf-8']],
  ['/bazaar-app.js', [join(here, 'bazaar-app.js'), 'text/javascript; charset=utf-8']],
  ['/rpc-bridge.js', [join(here, 'rpc-bridge.js'), 'text/javascript; charset=utf-8']],
  ['/solana-web3.js', [join(root, 'vendor', 'solana-web3-1.98.4.min.js'), 'text/javascript; charset=utf-8']],
]);

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    chunks.push(chunk);
    size += chunk.length;
    if (size > 65536) throw new Error('request too large');
  }
  return Buffer.concat(chunks);
}

async function proxyRpc(raw) {
  const body = JSON.parse(raw.toString('utf8'));
  if (!body || body.jsonrpc !== '2.0' || !rpcMethods.has(body.method) || !Array.isArray(body.params)) {
    throw new Error('RPC method is not allowed by the smoke proxy');
  }
  let last;
  for (const url of rpcUrls) {
    try {
      const response = await fetch(url, { method:'POST', headers:{ 'content-type':'application/json' },
        body:JSON.stringify(body), signal:AbortSignal.timeout(15000) });
      const json = await response.json();
      if (!response.ok || json.error) throw new Error(json.error && json.error.message || `RPC HTTP ${response.status}`);
      return json;
    } catch (error) { last = error; }
  }
  throw new Error(`all upstream RPC endpoints failed: ${last && last.message}`);
}

const server = http.createServer(async (req, res) => {
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-content-type-options', 'nosniff');
  if (req.method === 'GET' && files.has(req.url)) {
    const [path, type] = files.get(req.url);
    res.writeHead(200, { 'content-type':type }); res.end(readFileSync(path)); return;
  }
  if (req.method === 'POST' && req.url === '/rpc') {
    try {
      const json = await proxyRpc(await readBody(req));
      res.writeHead(200, { 'content-type':'application/json' }); res.end(JSON.stringify(json));
    } catch (error) {
      res.writeHead(502, { 'content-type':'application/json' });
      res.end(JSON.stringify({ jsonrpc:'2.0', id:null, error:{ code:-32000, message:error.message } }));
    }
    return;
  }
  if (req.method === 'POST' && req.url === '/report') {
    try {
      const report = JSON.parse((await readBody(req)).toString('utf8'));
      if (!report || typeof report !== 'object' || 'auth' in report || 'paymentHeader' in report || 'transaction' in report) {
        throw new Error('unsafe report shape');
      }
      writeFileSync(join(here, 'smoke-report.json'), JSON.stringify(report, null, 2) + '\n', { encoding:'utf8', mode:0o600 });
      res.writeHead(204); res.end();
    } catch (error) {
      res.writeHead(400, { 'content-type':'application/json' });
      res.end(JSON.stringify({ ok:false, error:error.message }));
    }
    return;
  }
  res.writeHead(404); res.end('not found');
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Ratchet x402 smoke with local RPC proxy ready: http://127.0.0.1:${port}/`);
});
