'use strict';
const crypto = require('node:crypto');
const x402 = require('./x402.js');
const { canon } = require('./canon.js');
const { findSettledShot } = require('./record.js');
const { getJSONStrict, setJSONEx } = require('./kv.js');
const { saveAgentRun } = require('./agent_receipts.js');
const { verifyEvidence } = require('./verifier.js');

const PREPARED_SECONDS = 600;
function publicOrigin() {
  return String(process.env.PUBLIC_ORIGIN || 'https://ratchetx.xyz').trim().replace(/\/$/, '');
}
function requestDigest(shotId) {
  return crypto.createHash('sha256').update(canon({ version:1, shotId })).digest('hex');
}
function parseBody(req) {
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const shotId = String(body.shotId || body.runId || '').trim();
  if (!/^[A-Za-z0-9:_-]{1,80}$/.test(shotId)) throw new Error('shotId is missing or malformed');
  return { shotId };
}

async function prepareBundle(shotId, digest) {
  const key = `proof:prepared:${digest}`;
  const cached = await getJSONStrict(key);
  if (cached && cached.bundle) return cached.bundle;

  const evidence = await findSettledShot(shotId);
  if (!evidence) return { errorStatus:404, error:'settled shot not found' };
  if (!['hit', 'miss'].includes(String(evidence.shot.result || '').toLowerCase()))
    return { errorStatus:422, error:'only settled hit/miss shots have premium verification bundles' };

  const receipt = await verifyEvidence(evidence);
  if (receipt.result === 'INSUFFICIENT_EVIDENCE')
    return { errorStatus:503, error:'independent Pyth evidence is temporarily unavailable', detail:receipt.reason };
  if (receipt.result !== 'MATCH')
    return { errorStatus:422, error:'canonical record diverges from independent verification', detail:receipt.reason };
  const run = await saveAgentRun({ shotId, receipt, chain:evidence.chain });

  const s = evidence.shot;
  const bundle = {
    bundleVersion:'ratchetx-proof-bundle-v1',
    request:{ shotId, digest },
    receipt,
    agentRun:{ digest:run.digest, verifiedAt:run.verifiedAt },
    chain:evidence.chain,
    commitment:{ value:s.commit || null, version:Number(s.commitV || 1),
      verified:true },
    verifier:{ source:`${publicOrigin()}/openapi.json`,
      command:`node scripts/verifier.mjs ${publicOrigin()}/shot.html?id=${encodeURIComponent(shotId)}` },
  };
  await setJSONEx(key, { bundle }, PREPARED_SECONDS);
  return bundle;
}

module.exports = async function agentProofBundle(req, res) {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'POST, OPTIONS');
  res.setHeader('access-control-allow-headers', 'Content-Type, PAYMENT-SIGNATURE');
  res.setHeader('access-control-expose-headers', 'PAYMENT-REQUIRED, PAYMENT-RESPONSE');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('allow', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok:false, reason:'POST required' });

  let shotId;
  try { ({ shotId } = parseBody(req)); }
  catch (e) { return res.status(400).json({ ok:false, reason:String(e.message || e) }); }

  try {
    const digest = requestDigest(shotId);
    // The resource is completely prepared before a facilitator may move one
    // cent. Invalid, unsettled, divergent or unavailable proofs never charge.
    const bundle = await prepareBundle(shotId, digest);
    if (bundle.errorStatus) return res.status(bundle.errorStatus).json({ ok:false,
      reason:bundle.error, ...(bundle.detail ? { detail:bundle.detail } : {}) });

    const gate = await x402.entryGate(req, res, { purpose:'proof-bundle', meta:digest });
    if (gate === 'responded') return;
    if (!gate || !gate.granted)
      return res.status(503).json({ ok:false, reason:'x402 proof payment is not enabled' });
    return res.status(200).json({ ok:true, payment:{ quoteId:gate.quoteId,
      settlement:gate.sig, network:gate.network, amountAtomic:gate.amountAtomic,
      paidTo:gate.payTo }, bundle });
  } catch (e) {
    return res.status(500).json({ ok:false, reason:String(e && e.message || e).slice(0,240) });
  }
};

module.exports.requestDigest = requestDigest;
module.exports.prepareBundle = prepareBundle;
