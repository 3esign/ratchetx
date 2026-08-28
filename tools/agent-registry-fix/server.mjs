import http from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PublicKey, Transaction } from '@solana/web3.js';
import { SolanaSDK } from '8004-solana';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const port = Number(process.argv[2] || 8465);
const RPC_URLS = ['https://solana-rpc.publicnode.com', 'https://api.mainnet-beta.solana.com'];
const OWNER = 'HXFDaHyZ3i477z1BakiTWZg9UQN8rcreruuv9ifC1HvM';
const ASSET = 'Auj5yXbsaeQUJpYpSRugkgRE3ABc76uqmUe3Vz7fxqCu';
const REGISTRY = '8oo4dC4JvBLwy5tGgiH3WwK4B9PWxL9Z4XjA2jzkQMbQ';
const COMPUTE_BUDGET = 'ComputeBudget111111111111111111111111111111';
const TARGET_URI = 'https://ratchetx.xyz/agent-registration.json';
const sdk = new SolanaSDK({ cluster:'mainnet-beta', rpcUrl:RPC_URLS[0] });

const files = new Map([
  ['/', [join(here, 'index.html'), 'text/html; charset=utf-8']],
  ['/app.js', [join(here, 'app.js'), 'text/javascript; charset=utf-8']],
  ['/solana-web3.js', [join(root, 'vendor', 'solana-web3-1.98.4.min.js'), 'text/javascript; charset=utf-8']],
]);

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    chunks.push(chunk);
    size += chunk.length;
    if (size > 32768) throw new Error('request too large');
  }
  return Buffer.concat(chunks);
}

function inspectTransaction(transaction, requireSignature = false) {
  const tx = transaction instanceof Transaction
    ? transaction
    : Transaction.from(Buffer.from(transaction, 'base64'));
  const required = tx.signatures.map(row => row.publicKey.toBase58());
  if (required.length !== 1 || required[0] !== OWNER) throw new Error('unexpected required signer');
  if (!tx.feePayer || tx.feePayer.toBase58() !== OWNER) throw new Error('unexpected fee payer');
  const registryInstructions = tx.instructions.filter(ix => ix.programId.toBase58() === REGISTRY);
  const extras = tx.instructions.filter(ix => ix.programId.toBase58() !== REGISTRY);
  if (registryInstructions.length !== 1) throw new Error('expected exactly one registry instruction');
  if (extras.some(ix => ix.programId.toBase58() !== COMPUTE_BUDGET || ix.keys.length !== 0)) {
    throw new Error('unexpected non-compute instruction');
  }
  const ix = registryInstructions[0];
  const keys = ix.keys.map(row => row.pubkey.toBase58());
  if (!keys.includes(OWNER) || !keys.includes(ASSET)) throw new Error('owner or asset missing');
  const present = tx.signatures.filter(row => row.signature).length;
  if (requireSignature && present !== 1) throw new Error('wallet signature missing');
  if (!requireSignature && present !== 0) throw new Error('prepared transaction must be unsigned');
  return tx;
}

async function proxyRpc(body) {
  if (!body || body.jsonrpc !== '2.0' || !Array.isArray(body.params)) throw new Error('invalid RPC request');
  if (!['sendTransaction', 'getSignatureStatuses', 'getTransaction'].includes(body.method)) {
    throw new Error('RPC method is not allowed');
  }
  if (body.method === 'sendTransaction') {
    if (typeof body.params[0] !== 'string') throw new Error('signed transaction is required');
    inspectTransaction(body.params[0], true);
    body.params = [body.params[0], { encoding:'base64', skipPreflight:false, preflightCommitment:'confirmed' }];
  }
  let last;
  for (const url of RPC_URLS) {
    try {
      const response = await fetch(url, {
        method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify(body),
        signal:AbortSignal.timeout(20000),
      });
      const json = await response.json();
      if (!response.ok || json.error) throw new Error(json.error?.message || `RPC HTTP ${response.status}`);
      return json;
    } catch (error) { last = error; }
  }
  throw new Error(`all upstream RPC endpoints failed: ${last?.message || 'unknown error'}`);
}

const server = http.createServer(async (req, res) => {
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'");
  if (req.method === 'GET' && files.has(req.url)) {
    const [path, type] = files.get(req.url);
    res.writeHead(200, { 'content-type':type }); res.end(readFileSync(path)); return;
  }
  if (req.method === 'POST' && req.url === '/prepare') {
    try {
      const input = JSON.parse((await readBody(req)).toString('utf8'));
      if (input.wallet !== OWNER) throw new Error(`connect the owner wallet ${OWNER}`);
      const agent = await sdk.loadAgent(new PublicKey(ASSET));
      const owner = agent.getOwnerPublicKey().toBase58();
      if (owner !== OWNER) throw new Error(`on-chain owner changed to ${owner}`);
      const currentUri = agent.agent_uri;
      const prepared = await sdk.setAgentUri(new PublicKey(ASSET), TARGET_URI, {
        skipSend:true,
        signer:new PublicKey(OWNER),
        feePayer:new PublicKey(OWNER),
      });
      if ('signature' in prepared) throw new Error(prepared.error || 'SDK did not return a prepared transaction');
      inspectTransaction(prepared.transaction, false);
      res.writeHead(200, { 'content-type':'application/json' });
      res.end(JSON.stringify({ ok:true, owner, asset:ASSET, registry:REGISTRY, currentUri,
        targetUri:TARGET_URI, prepared }));
    } catch (error) {
      res.writeHead(400, { 'content-type':'application/json' });
      res.end(JSON.stringify({ ok:false, error:error.message }));
    }
    return;
  }
  if (req.method === 'POST' && req.url === '/rpc') {
    try {
      const body = JSON.parse((await readBody(req)).toString('utf8'));
      const json = await proxyRpc(body);
      res.writeHead(200, { 'content-type':'application/json' }); res.end(JSON.stringify(json));
    } catch (error) {
      res.writeHead(502, { 'content-type':'application/json' });
      res.end(JSON.stringify({ jsonrpc:'2.0', id:null, error:{ code:-32000, message:error.message } }));
    }
    return;
  }
  res.writeHead(404); res.end('not found');
});

server.listen(port, '127.0.0.1', () => {
  console.log(`RatchetX Agent Registry URI correction ready: http://127.0.0.1:${port}/`);
});
