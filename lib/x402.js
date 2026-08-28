'use strict';
// ============================================================
//  x402 v2 arena entry — machines pay the DAILY CHAMPION.
//
//  This is a standard facilitator-backed `exact` SVM flow. The server
//  publishes PAYMENT-REQUIRED, accepts PAYMENT-SIGNATURE, asks a facilitator
//  to verify and settle, then returns PAYMENT-RESPONSE. It never holds a
//  treasury key and the payTo address is a player: the daily champion.
//
//  Dynamic recipients need more care than an ordinary API paywall. Each quote
//  is durable and bound to the signed Ratchet wallet, normalized agent name,
//  exact recipient, amount and resource URL. A podium change therefore cannot
//  invalidate a payment already being signed. A settled quote is retained long
//  enough for the same registration to recover if player persistence fails
//  after settlement, without charging a second time.
//
//  Everything remains flag-gated and is deliberately shipped dark until a
//  funded mainnet smoke proves the configured facilitator end to end.
// ============================================================

const crypto = require('node:crypto');
const { HTTPFacilitatorClient } = require('@x402/core/server');
const { decodePaymentSignatureHeader, encodePaymentRequiredHeader,
  encodePaymentResponseHeader } = require('@x402/core/http');
const { deepEqual } = require('@x402/core/utils');

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOLANA_MAINNET = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
const DEFAULT_FACILITATOR = 'https://facilitator.payai.network';
const QUOTE_SECONDS = 600;
const SETTLED_SECONDS = 86400;
const CAPABILITY_CACHE_MS = 300000;

const enabled = () => process.env.X402_ENABLED === '1';
function entryAmountAtomic() {
  const n = Math.floor(Number(process.env.X402_ENTRY_USDC_ATOMIC || 1_000_000));
  return Number.isFinite(n) && n > 0 ? n : 1_000_000;
}

async function championWallet(getJSONStrict) {
  const pod = await getJSONStrict('g:podium');
  const e = pod && Array.isArray(pod.list) && pod.list[0];
  const w = e && (e.w || e);
  return typeof w === 'string' && w.length > 0 ? w : null;
}

function facilitatorUrl() {
  const raw = String(process.env.X402_FACILITATOR_URL || DEFAULT_FACILITATOR).trim();
  const url = new URL(raw);
  if (url.protocol !== 'https:') throw new Error('the x402 facilitator URL must use HTTPS');
  return url.toString().replace(/\/$/, '');
}

let injectedClient = null;
let capabilityCache = null;
function facilitatorClient() {
  if (injectedClient) return injectedClient;
  const bearer = String(process.env.X402_FACILITATOR_BEARER || '').trim();
  return new HTTPFacilitatorClient({
    url: facilitatorUrl(),
    timeoutMs: 5000,
    ...(bearer ? { createAuthHeaders: async () => ({
      headers: { Authorization: `Bearer ${bearer}` },
    }) } : {}),
  });
}

// Capability discovery is not ceremonial: an armed deployment must refuse to
// quote if its facilitator does not currently advertise v2 exact on mainnet.
async function capabilities() {
  const cacheKey = injectedClient || facilitatorUrl();
  if (capabilityCache && capabilityCache.key === cacheKey
      && Date.now() - capabilityCache.t < CAPABILITY_CACHE_MS) return capabilityCache.value;
  const client = facilitatorClient();
  const supported = await client.getSupported();
  const kind = supported && Array.isArray(supported.kinds) && supported.kinds.find(k =>
    Number(k.x402Version) === 2 && k.scheme === 'exact' && k.network === SOLANA_MAINNET);
  const feePayer = kind && kind.extra && kind.extra.feePayer;
  if (!kind || typeof feePayer !== 'string' || !feePayer)
    throw new Error('configured facilitator does not advertise x402 v2 exact on Solana mainnet');
  const value = { client, feePayer, extensions: supported.extensions || [] };
  capabilityCache = { key: cacheKey, t: Date.now(), value };
  return value;
}

function paymentHeader(req) {
  const h = req && req.headers || {};
  return h['payment-signature'] || h['PAYMENT-SIGNATURE'] || null;
}

function publicOrigin() {
  const raw = String(process.env.PUBLIC_ORIGIN || 'https://ratchetx.xyz').trim();
  const u = new URL(raw);
  if (u.protocol !== 'https:' && u.hostname !== 'localhost' && u.hostname !== '127.0.0.1')
    throw new Error('PUBLIC_ORIGIN must use HTTPS');
  return u.origin;
}

function paymentRequired({ id, payTo, amountAtomic, feePayer, error }) {
  const resource = {
    url: `${publicOrigin()}/api/game?action=agent-register&x402Quote=${id}`,
    description: 'Register a ranked RatchetX forecasting agent. The toll goes directly to the daily champion; 0% goes to the team.',
    mimeType: 'application/json',
  };
  const requirements = {
    scheme: 'exact',
    network: SOLANA_MAINNET,
    amount: String(amountAtomic),
    asset: USDC_MINT,
    payTo,
    maxTimeoutSeconds: QUOTE_SECONDS,
    // The official SVM scheme requires a unique memo when the server does not
    // provide one. Supplying the quote id makes construction deterministic and
    // leaves an on-chain reconciliation handle without exposing wallet data.
    extra: { feePayer, memo: `ratchetx:${id}`,
      payToIs: 'daily champion resolved and fixed when this quote was issued' },
  };
  return { required: { x402Version: 2, ...(error ? { error } : {}), resource,
    accepts: [requirements] }, requirements, resource };
}

function setHeader(res, name, value) {
  if (res && typeof res.setHeader === 'function') res.setHeader(name, value);
}

function exposePaymentHeaders(res) {
  setHeader(res, 'access-control-allow-origin', '*');
  setHeader(res, 'access-control-expose-headers', 'PAYMENT-REQUIRED, PAYMENT-RESPONSE');
}

function respondRequired(res, required, error) {
  const body = { ...required, ...(error ? { error } : {}) };
  exposePaymentHeaders(res);
  setHeader(res, 'PAYMENT-REQUIRED', encodePaymentRequiredHeader(body));
  setHeader(res, 'cache-control', 'no-store');
  res.status(402).json(body);
  return 'responded';
}

function respondUnavailable(res, reason) {
  exposePaymentHeaders(res);
  setHeader(res, 'cache-control', 'no-store');
  res.status(503).json({ ok: false, error: 'x402 facilitator unavailable',
    reason: String(reason || 'capability check failed').slice(0, 240), retryable: true });
  return 'responded';
}

async function newQuote({ wallet, name, error }) {
  const { getJSONStrict, setJSONEx } = require('./kv.js');
  const payTo = await championWallet(getJSONStrict);
  if (!payTo) return null;
  const { feePayer } = await capabilities();
  const id = crypto.randomBytes(16).toString('hex');
  const made = paymentRequired({ id, payTo, amountAtomic: entryAmountAtomic(), feePayer, error });
  await setJSONEx(`x402:q:${id}`, { id, wallet, name, createdAt: Date.now(),
    expiresAt: Date.now() + QUOTE_SECONDS * 1000, required: made.required,
    requirements: made.requirements, resource: made.resource }, QUOTE_SECONDS);
  return made.required;
}

function quoteId(payload) {
  try {
    const u = new URL(payload && payload.resource && payload.resource.url);
    const id = u.searchParams.get('x402Quote');
    return /^[a-f0-9]{32}$/.test(id || '') ? id : null;
  } catch { return null; }
}

function paymentHash(header) {
  return crypto.createHash('sha256').update(String(header)).digest('hex');
}

function receiptFrom(quote, settlement) {
  return { granted: true, sig: settlement.transaction, payTo: quote.requirements.payTo,
    amountAtomic: quote.requirements.amount, payer: settlement.payer || null,
    network: settlement.network };
}

// Returns null when the door is unavailable, "responded" after an HTTP error,
// or a durable grant. Call paid retries only while holding the arena name lease:
// settlement must never happen before the requested name is known to be free.
async function entryGate(req, res, { wallet, name } = {}) {
  if (!enabled()) return null;
  const header = paymentHeader(req);
  if (!header) {
    try {
      const required = await newQuote({ wallet, name });
      return required ? respondRequired(res, required)
        : respondUnavailable(res, 'no daily champion exists, so Ratchet has no lawful toll recipient');
    } catch (e) { return respondUnavailable(res, e && e.message); }
  }

  let payload;
  try { payload = decodePaymentSignatureHeader(String(header)); }
  catch {
    try {
      const required = await newQuote({ wallet, name,
        error: 'invalid PAYMENT-SIGNATURE header; request a fresh quote and retry' });
      return required ? respondRequired(res, required)
        : respondUnavailable(res, 'no daily champion exists, so Ratchet has no lawful toll recipient');
    } catch (e) { return respondUnavailable(res, e && e.message); }
  }

  const id = quoteId(payload);
  const { getJSONStrict, setJSONEx } = require('./kv.js');
  let q = id && await getJSONStrict(`x402:q:${id}`);
  if (!q || q.expiresAt < Date.now()) {
    try {
      const required = await newQuote({ wallet, name,
        error: 'payment quote is missing or expired; sign this fresh quote' });
      return required ? respondRequired(res, required)
        : respondUnavailable(res, 'no daily champion exists, so Ratchet has no lawful toll recipient');
    } catch (e) { return respondUnavailable(res, e && e.message); }
  }

  const reject = reason => respondRequired(res, q.required, reason);
  if (q.wallet !== wallet || q.name !== name)
    return reject('this quote is bound to a different signed wallet or agent name');
  if (!payload || payload.x402Version !== 2)
    return reject('only x402 v2 payment payloads are accepted');
  if (!deepEqual(payload.resource, q.resource))
    return reject('payment resource does not match the issued quote');
  if (!deepEqual(payload.accepted, q.requirements))
    return reject('accepted payment requirements do not match the issued quote');

  const hash = paymentHash(header);
  if (q.settlement) {
    if (q.paymentHash !== hash) return reject('this quote was already settled by another payment');
    exposePaymentHeaders(res);
    setHeader(res, 'PAYMENT-RESPONSE', encodePaymentResponseHeader(q.settlement));
    return receiptFrom(q, q.settlement);
  }

  let cap;
  try { cap = await capabilities(); }
  catch (e) { return respondUnavailable(res, e && e.message); }
  let verified;
  try { verified = await cap.client.verify(payload, q.requirements); }
  catch (e) { return reject(`facilitator could not verify payment: ${String(e && e.message || e).slice(0, 180)}`); }
  if (!verified || !verified.isValid)
    return reject(verified && (verified.invalidMessage || verified.invalidReason)
      || 'facilitator rejected payment');

  let settlement;
  try { settlement = await cap.client.settle(payload, q.requirements); }
  catch (e) { return reject(`facilitator could not settle payment: ${String(e && e.message || e).slice(0, 180)}`); }
  if (!settlement || !settlement.success || !settlement.transaction
      || settlement.network !== SOLANA_MAINNET)
    return reject(settlement && (settlement.errorMessage || settlement.errorReason)
      || 'facilitator did not return a successful Solana mainnet settlement');

  q = { ...q, paymentHash: hash, settledAt: Date.now(), settlement };
  await setJSONEx(`x402:q:${id}`, q, SETTLED_SECONDS);
  exposePaymentHeaders(res);
  setHeader(res, 'PAYMENT-RESPONSE', encodePaymentResponseHeader(settlement));
  return receiptFrom(q, settlement);
}

// Test seam: no production request can reach it. It lets the integration suite
// drive the real game and official header codecs without making network calls.
function setFacilitatorForTest(client) {
  injectedClient = client || null;
  capabilityCache = null;
}

module.exports = { entryGate, paymentRequired, paymentHeader, championWallet,
  entryAmountAtomic, enabled, capabilities, setFacilitatorForTest, USDC_MINT,
  SOLANA_MAINNET, DEFAULT_FACILITATOR };
