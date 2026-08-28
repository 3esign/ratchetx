'use strict';
// Canonical x402 paid resource for autonomous-agent discovery.
//
// POST with no PAYMENT-SIGNATURE returns a Bazaar-described x402 v2 quote.
// A paid retry returns a single-use capability bound to the Solana payer.
// The capability does not register anyone by itself: /api/game still requires
// normal Ratchet wallet authentication, validates the name, and owns the only
// arena mutation path.

const { RELEASE } = require('../lib/release.js');
const x402 = require('../lib/x402.js');

const windows = globalThis.__ratchet_agent_entry_rate
  || (globalThis.__ratchet_agent_entry_rate = new Map());

function rateLimited(ip) {
  const now = Date.now();
  const prior = windows.get(ip);
  if (!prior || now - prior.t >= 60000) {
    windows.set(ip, { t: now, n: 1 });
    if (windows.size > 500) windows.delete(windows.keys().next().value);
    return false;
  }
  prior.n++;
  return prior.n > 30;
}

module.exports = async function agentEntry(req, res) {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'POST, OPTIONS');
  res.setHeader('access-control-allow-headers', 'Content-Type, PAYMENT-SIGNATURE');
  res.setHeader('access-control-expose-headers', 'PAYMENT-REQUIRED, PAYMENT-RESPONSE');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('allow', 'POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.status(204);
    return typeof res.end === 'function' ? res.end() : res.json({});
  }
  if (req.method !== 'POST')
    return res.status(405).json({ ok: false, reason: 'POST required' });

  const ip = String(req.headers && req.headers['x-forwarded-for']
    || req.socket && req.socket.remoteAddress || 'unknown').split(',')[0].trim();
  if (rateLimited(ip))
    return res.status(429).json({ ok: false, reason: 'slow down - too many entry requests' });

  try {
    const out = await x402.claimGate(req, res);
    if (out === 'responded') return;
    return res.status(200).json({ v: RELEASE, ...out });
  } catch (e) {
    return res.status(500).json({ ok: false, reason: 'entry resource failed',
      retryable: true, detail: String(e && e.message || e).slice(0, 180) });
  }
};
