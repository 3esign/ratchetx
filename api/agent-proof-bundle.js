'use strict';
const x402 = require('../lib/x402.js');
const { getJSONStrict } = require('../lib/kv.js');
function publicOrigin() { return String(process.env.PUBLIC_ORIGIN || 'https://ratchetx.xyz').trim(); }

module.exports = async function agentProofBundle(req, res) {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'POST, OPTIONS');
  res.setHeader('access-control-allow-headers', 'Content-Type, PAYMENT-SIGNATURE');
  res.setHeader('access-control-expose-headers', 'PAYMENT-REQUIRED, PAYMENT-RESPONSE');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('allow', 'POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.status(204);
    return res.end ? res.end() : res.json({});
  }
  if (req.method !== 'POST') return res.status(405).json({ ok: false, reason: 'POST required' });

  try {
    const gate = await x402.entryGate(req, res, { purpose: 'proof-bundle' });
    if (gate === 'responded') return;
    if (!gate || !gate.granted) return res.status(503).json({ ok: false, error: 'Payment did not produce a grant' });

    let body = {};
    if (req.body) {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    }
    const shotId = body.shotId || body.runId;
    if (!shotId) {
      return res.status(400).json({ ok: false, reason: 'Missing shotId or runId in POST body' });
    }

    const shot = await getJSONStrict(shotId);
    if (!shot) return res.status(404).json({ ok: false, reason: 'Shot not found' });
    if (!shot.res) return res.status(400).json({ ok: false, reason: 'Shot not settled yet' });

    // Import the ES module verifier dynamically
    const { verifyShot } = await import('../scripts/verifier.mjs');
    const shotUrl = `${publicOrigin()}/shot.html?id=${shotId}`;
    const evidence = await verifyShot(shotUrl);

    if (evidence.result === 'DIVERGENCE' || evidence.result === 'INSUFFICIENT_EVIDENCE') {
      return res.status(422).json({
        ok: false,
        error: 'Bundle generation failed',
        reason: evidence.reason,
        detail: evidence
      });
    }

    const bundle = {
      shotId: shotId,
      receipt: evidence,
      timestamp: Date.now(),
      verifierCommand: `node scripts/verifier.mjs ${shotUrl}`,
      logAnchor: shot.commit || 'omitted'
    };

    return res.status(200).json({
      ok: true,
      bundle
    });
  } catch(e) {
    return res.status(500).json({ ok: false, reason: String(e && e.message || e) });
  }
};
