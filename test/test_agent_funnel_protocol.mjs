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

const mcp = require('../api/mcp.js');
const funnel = require('../lib/funnel.js');

async function call(name, args = {}) {
  let status = 200;
  let body;
  const req = {
    method: 'POST',
    headers: { 'mcp-protocol-version':'2025-11-25' },
    socket: {},
    body: { jsonrpc:'2.0', id:1, method:'tools/call', params:{ name, arguments:args } },
  };
  const res = {
    status(code) { status = code; return this; },
    setHeader() {},
    json(value) { body = value; return value; },
    end() {},
  };
  await mcp(req, res);
  assert.equal(status, 200);
  return body.result;
}

const invited = await call('ratchet_invite', { source:'protocol-test' });
assert.equal(invited.isError, undefined);
const invite = invited.structuredContent.inviteId;
assert.match(invite, /^[a-f0-9]{32}$/);

const hash = crypto.createHash('sha256').update(invite).digest('hex');
const inviteRow = await kv.getJSONStrict(`inv:${hash}`);
assert.equal(inviteRow.source, 'protocol-test');
assert.ok(inviteRow.exp > Date.now());
assert.deepEqual(
  ttlWrites.find(row => row.key === `inv:${hash}`),
  { key:`inv:${hash}`, ttl:30 * 24 * 60 * 60 },
  'invite must use the real 30-day TTL primitive',
);

const rejected = await call('ratchet_new_demo', { invite:'0'.repeat(32) });
assert.equal(rejected.isError, true);
assert.match(rejected.content[0].text, /missing or expired/);

const demo = await call('ratchet_new_demo', { invite });
assert.equal(demo.isError, undefined);
const handle = demo.structuredContent.handle;
assert.match(handle, /^[a-f0-9]{12}$/);

const ledger = await kv.getJSONStrict(`funnel:${hash}`);
assert.deepEqual(ledger.history.map(row => row.milestone), ['invite_seen', 'demo_created']);
assert.equal(ledger.history[1].ref, handle);
assert.equal(await funnel.inviteForDemo(handle), hash);

const duplicate = await funnel.recordMilestone(hash, 'demo_created', { handle });
assert.equal(duplicate, false);
const day = new Date().toISOString().slice(0, 10);
const counts = await kv.hall(`funnel_daily:${day}`);
assert.equal(counts.invite_seen, 1);
assert.equal(counts.demo_created, 1);

console.log('PASS invite TTL, validation, attribution identity and milestone idempotency');
