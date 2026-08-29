import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
globalThis.__ratchet_mem = new Map();

const require = createRequire(import.meta.url);
const kvPath = require.resolve('../lib/kv.js');
const kv = require(kvPath);
const ttlWrites = [];
require.cache[kvPath].exports = {
  ...kv,
  setJSONEx: async (key, value, ttl) => {
    ttlWrites.push({ key, ttl });
    return kv.setJSONEx(key, value, ttl);
  },
};

const ranked = require('../lib/ranked.js');
let shotCalls = 0;
const gamePath = require.resolve('../api/game.js');
require.cache[gamePath] = {
  id:gamePath, filename:gamePath, loaded:true,
  exports:async (req, res) => {
    if (req.method === 'GET' && req.query?.action === 'board') {
      return res.json({ ok:true, targets:{ 'SOL:5m:test':{ label:'SOL higher in 5 minutes' } } });
    }
    if (req.method === 'POST' && req.body?.action === 'shot') {
      assert.equal(ranked.isVerifiedRequest(req, req.body), true,
        'game receives only the internally marked, body-bound ranked request');
      shotCalls++;
      return res.json({ ok:true, shot:{ id:'rankedshot1', requestId:req.body.requestId }, cr:9500 });
    }
    return res.status(404).json({ ok:false, reason:'unexpected stub call' });
  },
};

const mcp = require('../api/mcp.js');

function b58encode(bytes) {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = BigInt('0x' + Buffer.from(bytes).toString('hex'));
  let out = '';
  while (n > 0n) { out = alphabet[Number(n % 58n)] + out; n /= 58n; }
  for (const b of bytes) { if (b !== 0) break; out = '1' + out; }
  return out || '1';
}

async function call(name, args = {}) {
  let body;
  const req = { method:'POST', headers:{ 'mcp-protocol-version':'2025-11-25' }, socket:{},
    body:{ jsonrpc:'2.0', id:1, method:'tools/call', params:{ name, arguments:args } } };
  const res = { status(){ return this; }, setHeader(){}, json(value){ body=value; return value; }, end(){} };
  await mcp(req, res);
  return body.result;
}

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const publicDer = publicKey.export({ format:'der', type:'spki' });
const wallet = b58encode(publicDer.subarray(publicDer.length - 32));

const prepared = await call('ratchet_ranked_prepare', {
  wallet, target:'SOL:5m:test', side:'YES', p:0.63, stake:500,
});
assert.equal(prepared.isError, undefined);
const challenge = prepared.structuredContent;
assert.equal(challenge.domain, 'ratchetx.xyz');
assert.equal(challenge.network, 'solana:mainnet');
assert.equal(challenge.economy.oracleRead, 'open shared Pyth context; no RCX charge');
assert.equal(challenge.economy.stake.debitAt, 'accepted fresh Pyth-bound seal');
assert.equal(challenge.economy.stake.void, 'full refund');
assert.deepEqual(challenge.economy.rcx.reloadSplit,
  { destructionPct:70, liveChampionPodiumPct:30, ratchetxPct:0 });
assert.equal(challenge.economy.rcx.perShotTransaction, false);
assert.deepEqual(
  ttlWrites.find(row => row.key === `nonce:ranked:${wallet}:${challenge.nonce}`),
  { key:`nonce:ranked:${wallet}:${challenge.nonce}`, ttl:120 },
  'ranked nonce must use the real TTL primitive',
);

const signature = crypto.sign(null, Buffer.from(challenge.payload), privateKey).toString('base64');
const submitted = await call('ratchet_ranked_submit', {
  wallet, nonce:challenge.nonce, payload:challenge.payload, signature,
});
assert.equal(submitted.isError, undefined);
assert.equal(submitted.structuredContent.shot.id, 'rankedshot1');
assert.equal(shotCalls, 1);

const replay = await call('ratchet_ranked_submit', {
  wallet, nonce:challenge.nonce, payload:challenge.payload, signature,
});
assert.equal(replay.structuredContent.idempotent, true);
assert.equal(shotCalls, 1, 'paid/signed replay must not create another shot');

const tampered = await call('ratchet_ranked_submit', {
  wallet, nonce:challenge.nonce,
  payload:challenge.payload.replace('0.63', '0.64'), signature,
});
assert.equal(tampered.isError, true);
assert.match(tampered.content[0].text, /Payload mismatch/);

const now = Date.now();
const expiring = ranked.payloadFor({ wallet, target:'SOL:5m:test', side:'NO', p:0.4,
  stake:500, nonce:'a'.repeat(32), expiresAt:now + 1000 }, now);
const expiredSig = crypto.sign(null, Buffer.from(expiring), privateKey).toString('base64');
assert.throws(() => ranked.verifyPayload(expiring, expiredSig, wallet, now + 1001), /expired/);

console.log('PASS domain-bound ranked signature, TTL, body binding and idempotent replay');
