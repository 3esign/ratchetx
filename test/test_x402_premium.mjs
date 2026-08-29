import http from 'node:http';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { encodePaymentSignatureHeader } = require('@x402/core/http');

process.env.PUBLIC_ORIGIN = 'http://127.0.0.1:8247';
process.env.X402_ENABLED = '1';
globalThis.__ratchet_mem = new Map();

const MAINNET = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
const FEE_PAYER = 'FeePayer111111111111111111111111111111111';
const log = require('../lib/log.js');
const x402 = require('../lib/x402.js');
const pxlog = require('../lib/pxlog.js');

let supported = 0, verifies = 0, settles = 0;
x402.setFacilitatorForTest({
  async getSupported() { supported++; return { kinds:[{ x402Version:2,
    scheme:'exact', network:MAINNET, extra:{ feePayer:FEE_PAYER } }] }; },
  async verify() { verifies++; return { isValid:true,
    payer:'ProofPayer1111111111111111111111111111111' }; },
  async settle() { settles++; return { success:true,
    transaction:'ProofSettlement0001', network:MAINNET }; },
});

const base = Math.floor((Date.now() - 8 * 60_000) / 1000) * 1000;
async function seed(id, offset) {
  const wallet = 'HXFDaHyZ3i477z1BakiTWZg9UQN8rcreruuv9ifC1HvM';
  const side = 'YES', salt = crypto.randomBytes(8).toString('hex');
  const commit = crypto.createHash('sha256')
    .update(`RATCHET|v2|${wallet}|${id}|${side}|${salt}`).digest('hex');
  const exp = base + offset;
  await log.append({ k:'seal', w:wallet, id, feed:'SOL', kind:'dir', stake:100,
    exp, entry:100 + offset / 100000, commit, commitV:2,
    settleRule:'pyth-first-observed-after-v3', outcomeRule:'strict-compare-v2' });
  const exit = 101 + offset / 100000;
  const publishTime = Math.floor((exp + 1000) / 1000);
  await pxlog.ingestUpdate('SOL', { price:exit, publishTime,
    prevPublishTime:publishTime - 1, confBps:1, receivedAt:publishTime * 1000 + 100,
    slot:300000000 + offset, postedSlot:300000001 + offset });
  await log.append({ k:'settle', w:wallet, id, res:'hit',
    exitPx:exit, exitAt:publishTime * 1000, prevExitAt:(publishTime - 1) * 1000,
    exitConfBps:1, side, salt, sp:0.7,
    commit, commitV:2, settleRule:'pyth-first-observed-after-v3',
    settleRuleApplied:'pyth-first-observed-after-v3', outcomeRule:'strict-compare-v2' });
  return { exp, exit };
}
const first = await seed('premium1', 0);
const second = await seed('premium2', 100_000);

async function seedWithoutObservation(id) {
  const wallet = 'HXFDaHyZ3i477z1BakiTWZg9UQN8rcreruuv9ifC1HvM';
  const side = 'YES', salt = crypto.randomBytes(8).toString('hex');
  const commit = crypto.createHash('sha256')
    .update(`RATCHET|v2|${wallet}|${id}|${side}|${salt}`).digest('hex');
  const exp = base - 5 * 3600_000;
  await log.append({ k:'seal', w:wallet, id, feed:'SOL', kind:'dir', stake:100,
    exp, entry:100, commit, commitV:2,
    settleRule:'pyth-first-observed-after-v3', outcomeRule:'strict-compare-v2' });
  await log.append({ k:'settle', w:wallet, id, res:'hit', exitPx:101,
    exitAt:exp + 1000, side, salt, sp:0.7, commit, commitV:2,
    settleRule:'pyth-first-observed-after-v3',
    settleRuleApplied:'pyth-first-observed-after-v3', outcomeRule:'strict-compare-v2' });
}
await seedWithoutObservation('premium-expired');

async function seedDurableObservation(id) {
  const wallet = 'HXFDaHyZ3i477z1BakiTWZg9UQN8rcreruuv9ifC1HvM';
  const side = 'YES', salt = crypto.randomBytes(8).toString('hex');
  const commit = crypto.createHash('sha256')
    .update(`RATCHET|v2|${wallet}|${id}|${side}|${salt}`).digest('hex');
  const exp = base - 6 * 3600_000, exitAt = exp + 1000;
  await log.append({ k:'seal', w:wallet, id, feed:'SOL', kind:'dir', stake:100,
    exp, entry:100, commit, commitV:2,
    settleRule:'pyth-first-observed-after-v3', outcomeRule:'strict-compare-v2' });
  await log.append({ k:'settle', w:wallet, id, res:'hit', exitPx:101,
    exitAt, prevExitAt:exitAt - 1000, exitConfBps:1,
    exitObservedAt:exitAt + 100, exitSlot:310000000,
    exitPostedSlot:310000001, exitSource:'pyth-onchain-stream',
    side, salt, sp:0.7, commit, commitV:2,
    settleRule:'pyth-first-observed-after-v3',
    settleRuleApplied:'pyth-first-observed-after-v3', outcomeRule:'strict-compare-v2' });
}
await seedDurableObservation('premium-durable');

const nativeFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('premium verifier must not use HTTP'); };

const handler = require('../lib/proof_bundle.js');
assert.doesNotMatch(require.resolve('../lib/verifier.js'), /[\\/]scripts[\\/]/,
  'production proof handler must statically depend on deployable lib/verifier.js');
const srv = http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  req.body = Buffer.concat(chunks).toString();
  res.status = c => { res.statusCode = c; return res; };
  res.json = o => { res.setHeader('content-type','application/json'); res.end(JSON.stringify(o)); };
  try { await handler(req, res); }
  catch (e) { res.status(500).json({ ok:false, reason:String(e) }); }
});
await new Promise(resolve => srv.listen(8247, '127.0.0.1', resolve));

const call = (body, headers = {}) => new Promise((resolve, reject) => {
  const req = http.request('http://127.0.0.1:8247/api/agent-proof-bundle', {
    method:'POST', headers:{ 'content-type':'application/json', ...headers },
  }, res => { const chunks=[]; res.on('data', c => chunks.push(c)); res.on('end', () => {
    const raw=Buffer.concat(chunks).toString(); resolve({ status:res.statusCode,
      headers:res.headers, body:raw ? JSON.parse(raw) : null }); }); });
  req.on('error', reject); req.end(JSON.stringify(body));
});

let r = await call({ shotId:'does-not-exist' });
assert.equal(r.status, 404);
assert.equal(supported, 0); assert.equal(verifies, 0); assert.equal(settles, 0);

r = await call({ shotId:'premium-expired' });
assert.equal(r.status, 410);
assert.match(r.body.reason, /retention/);
assert.equal(supported, 0); assert.equal(verifies, 0); assert.equal(settles, 0);

r = await call({ shotId:'premium-durable' });
assert.equal(r.status, 402);
assert.equal(r.body.accepts[0].amount, '10000');
assert.equal(verifies, 0); assert.equal(settles, 0);

r = await call({ shotId:'premium1' });
assert.equal(r.status, 402);
assert.equal(r.body.accepts[0].amount, '10000');
assert.match(r.body.resource.url, /\/api\/agent-proof-bundle\?x402Quote=/);
const required = r.body;
const payload = { x402Version:2, resource:required.resource,
  accepted:required.accepts[0], payload:{ transaction:'signed-proof-payment' } };
const header = encodePaymentSignatureHeader(payload);

const paid = await call({ shotId:'premium1' }, { 'payment-signature':header });
assert.equal(paid.status, 200);
assert.equal(paid.body.bundle.receipt.result, 'MATCH');
assert.equal(paid.body.bundle.bundleVersion, 'ratchetx-proof-bundle-v2');
assert.equal(paid.body.bundle.receipt.proofVersion, 'ratchetx-keyless-audit-v1');
assert.equal(paid.body.bundle.receipt.trustBoundary.independentPythReplay, false);
assert.equal(paid.body.bundle.receipt.commitment.matches, true);
assert.equal(paid.body.bundle.receipt.chainVerification.ok, true);
assert.equal(paid.body.bundle.receipt.oracle[0].retainedBy,
  'pxlog-validated-account-observation');
assert.equal(paid.body.bundle.request.shotId, 'premium1');
assert.equal(verifies, 1); assert.equal(settles, 1);

const replay = await call({ shotId:'premium1' }, { 'payment-signature':header });
assert.equal(replay.status, 200);
assert.deepEqual(replay.body.bundle, paid.body.bundle);
assert.equal(verifies, 1); assert.equal(settles, 1);

const rebound = await call({ shotId:'premium2' }, { 'payment-signature':header });
assert.equal(rebound.status, 402);
assert.match(rebound.body.error, /different proof bundle request/);
assert.equal(verifies, 1); assert.equal(settles, 1);

srv.close();
globalThis.fetch = nativeFetch;
console.log('PASS premium proof prevalidation, exact binding, funded delivery and idempotent replay');
