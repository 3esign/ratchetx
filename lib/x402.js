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
//  The funded mainnet smoke and idempotent replay passed on 2026-08-28. The
//  direct registration flow remains wallet/name-bound. A separate canonical
//  paid resource issues a single-use payer-bound entry claim so generic Bazaar
//  agents can discover the door without weakening Ratchet authentication.
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
const CLAIM_SECONDS = 86400;
const CAPABILITY_CACHE_MS = 300000;
const AGENT_ENTRY_PATH = '/api/agent-entry';
const PROOF_BUNDLE_PATH = '/api/agent-proof-bundle';
const DEFAULT_PROOF_RECEIVER = 'HXFDaHyZ3i477z1BakiTWZg9UQN8rcreruuv9ifC1HvM';

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

// Static output from @x402/extensions/bazaar 2.24.0. Keeping this small object
// in the runtime avoids pulling the extension validator and its transitive
// schema stack into every serverless invocation. The test suite validates it
// with the official package, so protocol drift fails the release gate.
function agentEntryDiscovery() {
  return { bazaar: {
    info: {
      input: { type: 'http', bodyType: 'json', body: {}, method: 'POST' },
      output: { type: 'json', example: {
        ok: true,
        claim: 'opaque-single-use-token',
        payer: 'Solana wallet that funded the x402 payment',
        expiresAt: 0,
        use: { endpoint: '/api/game', action: 'agent-register', bodyField: 'entryClaim' },
      } },
    },
    schema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        input: {
          type: 'object',
          properties: {
            type: { type: 'string', const: 'http' },
            method: { type: 'string', enum: ['POST', 'PUT', 'PATCH'] },
            bodyType: { type: 'string', enum: ['json', 'form-data', 'text'] },
            body: { type: 'object', properties: {}, additionalProperties: false },
          },
          required: ['type', 'method', 'bodyType', 'body'],
          additionalProperties: false,
        },
        output: {
          type: 'object',
          properties: { type: { type: 'string' }, example: { type: 'object' } },
          required: ['type'],
        },
      },
      required: ['input'],
    },
    routeTemplate: AGENT_ENTRY_PATH,
  } };
}

function paymentRequired({ id, payTo, amountAtomic, feePayer, error,
  purpose = 'registration' }) {
  const claim = purpose === 'agent-entry-claim';
  const proofBundle = purpose === 'proof-bundle';
  const resource = claim ? {
    url: `${publicOrigin()}${AGENT_ENTRY_PATH}`,
    description: 'Buy a single-use RatchetX ranked-arena entry claim. The full toll goes directly to the current daily champion; RatchetX takes 0%.',
    mimeType: 'application/json',
    serviceName: 'RatchetX',
    tags: ['forecasting', 'solana', 'ai-agents', 'x402'],
    iconUrl: `${publicOrigin()}/og.png`,
  } : proofBundle ? {
    url: `${publicOrigin()}${PROOF_BUNDLE_PATH}?x402Quote=${id}`,
    description: 'Buy one deterministic RatchetX verification bundle for the request bound into this quote. Fee: 0.01 USDC to the RatchetX proof service.',
    mimeType: 'application/json',
    serviceName: 'RatchetX proof service',
    tags: ['forecasting', 'solana', 'pyth', 'verification', 'x402'],
    iconUrl: `${publicOrigin()}/og.png`,
  } : {
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
    accepts: [requirements], ...(claim ? { extensions: agentEntryDiscovery() } : {}) },
    requirements, resource };
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

async function newQuote({ wallet, name, error, purpose = 'registration', meta }) {
  const { getJSONStrict, setJSONEx } = require('./kv.js');
  const isBundle = purpose === 'proof-bundle';
  const proofReceiver = String(process.env.X402_PROOF_RECEIVER || DEFAULT_PROOF_RECEIVER).trim();
  if (isBundle && !isSolanaWallet(proofReceiver))
    throw new Error('X402_PROOF_RECEIVER is not a Solana wallet');
  const payTo = isBundle ? proofReceiver : await championWallet(getJSONStrict);
  if (!payTo) return null;
  const { feePayer } = await capabilities();
  const id = crypto.randomBytes(16).toString('hex');
  const made = paymentRequired({ id, payTo, amountAtomic: isBundle ? 10000 : entryAmountAtomic(), feePayer,
    error, purpose });
  await setJSONEx(`x402:q:${id}`, { id, wallet, name, purpose, meta, createdAt: Date.now(),
    expiresAt: Date.now() + QUOTE_SECONDS * 1000, required: made.required,
    requirements: made.requirements, resource: made.resource }, QUOTE_SECONDS);
  return made.required;
}

function quoteId(payload) {
  try {
    const u = new URL(payload && payload.resource && payload.resource.url);
    const id = u.searchParams.get('x402Quote');
    if (/^[a-f0-9]{32}$/.test(id || '')) return id;
    const memo = payload && payload.accepted && payload.accepted.extra
      && payload.accepted.extra.memo;
    const m = /^ratchetx:([a-f0-9]{32})$/.exec(String(memo || ''));
    return m ? m[1] : null;
  } catch { return null; }
}

function paymentHash(header) {
  return crypto.createHash('sha256').update(String(header)).digest('hex');
}

function isSolanaWallet(value) {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(value || ''));
}

function receiptFrom(quote, settlement, verifiedPayer) {
  const payer = quote.purpose === 'agent-entry-claim'
    ? (verifiedPayer || quote.verifiedPayer || settlement.payer || null)
    : (settlement.payer || verifiedPayer || quote.verifiedPayer || null);
  return { granted: true, sig: settlement.transaction, payTo: quote.requirements.payTo,
    amountAtomic: quote.requirements.amount, payer,
    network: settlement.network, quoteId: quote.id };
}

// Returns null when the door is unavailable, "responded" after an HTTP error,
// or a durable grant. Call paid retries only while holding the arena name lease:
// settlement must never happen before the requested name is known to be free.
async function entryGate(req, res, { wallet, name, purpose = 'registration', meta } = {}) {
  if (!enabled()) return null;
  const header = paymentHeader(req);
  if (!header) {
    try {
      const required = await newQuote({ wallet, name, purpose, meta });
      return required ? respondRequired(res, required)
        : respondUnavailable(res, purpose === 'proof-bundle' ? 'proof bundle unavailable' : 'no daily champion exists, so Ratchet has no lawful toll recipient');
    } catch (e) { return respondUnavailable(res, e && e.message); }
  }

  let payload;
  try { payload = decodePaymentSignatureHeader(String(header)); }
  catch {
    try {
      const required = await newQuote({ wallet, name, purpose, meta,
        error: 'invalid PAYMENT-SIGNATURE header; request a fresh quote and retry' });
      return required ? respondRequired(res, required)
        : respondUnavailable(res, purpose === 'proof-bundle' ? 'proof bundle unavailable' : 'no daily champion exists, so Ratchet has no lawful toll recipient');
    } catch (e) { return respondUnavailable(res, e && e.message); }
  }

  const id = quoteId(payload);
  const { getJSONStrict, setJSONEx } = require('./kv.js');
  let q = id && await getJSONStrict(`x402:q:${id}`);
  // An unpaid authorization expires with the ten-minute quote. A settled
  // payment is different: its KV record deliberately survives for 24 hours
  // so a failed player/claim write can recover without charging again.
  if (!q || (!q.settlement && q.expiresAt < Date.now())) {
    try {
      const required = await newQuote({ wallet, name, purpose, meta,
        error: 'payment quote is missing or expired; sign this fresh quote' });
      return required ? respondRequired(res, required)
        : respondUnavailable(res, purpose === 'proof-bundle' ? 'proof bundle unavailable' : 'no daily champion exists, so Ratchet has no lawful toll recipient');
    } catch (e) { return respondUnavailable(res, e && e.message); }
  }

  const reject = reason => respondRequired(res, q.required, reason);
  if ((q.purpose || 'registration') !== purpose)
    return reject('this quote was issued for a different Ratchet capability');
  if (purpose === 'registration' && (q.wallet !== wallet || q.name !== name)) {
    return reject('this quote is bound to a different signed wallet or agent name');
  }
  if (purpose === 'proof-bundle' && q.meta !== meta) {
    return reject('this quote is bound to a different proof bundle request');
  }
  if (!payload || payload.x402Version !== 2)
    return reject('only x402 v2 payment payloads are accepted');
  if (!deepEqual(payload.resource, q.resource))
    return reject('payment resource does not match the issued quote');
  if (!deepEqual(payload.accepted, q.requirements))
    return reject('accepted payment requirements do not match the issued quote');
  if (purpose === 'agent-entry-claim'
      && !deepEqual(payload.extensions, q.required.extensions))
    return reject('Bazaar payment extensions do not match the issued discovery declaration');

  const hash = paymentHash(header);
  if (q.settlement) {
    if (q.paymentHash !== hash) return reject('this quote was already settled by another payment');
    exposePaymentHeaders(res);
    setHeader(res, 'PAYMENT-RESPONSE', encodePaymentResponseHeader(q.settlement));
    return receiptFrom(q, q.settlement, q.verifiedPayer);
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
  if (purpose === 'agent-entry-claim' && !isSolanaWallet(verified.payer))
    return reject('facilitator verification did not identify the Solana payer');

  let settlement;
  try { settlement = await cap.client.settle(payload, q.requirements); }
  catch (e) { return reject(`facilitator could not settle payment: ${String(e && e.message || e).slice(0, 180)}`); }
  if (!settlement || !settlement.success || !settlement.transaction
      || settlement.network !== SOLANA_MAINNET)
    return reject(settlement && (settlement.errorMessage || settlement.errorReason)
      || 'facilitator did not return a successful Solana mainnet settlement');

  q = { ...q, paymentHash: hash, settledAt: Date.now(),
    verifiedPayer: verified.payer || null, settlement };
  await setJSONEx(`x402:q:${id}`, q, SETTLED_SECONDS);
  exposePaymentHeaders(res);
  setHeader(res, 'PAYMENT-RESPONSE', encodePaymentResponseHeader(settlement));
  return receiptFrom(q, settlement, verified.payer);
}

async function claimForReceipt(receipt) {
  const { getJSONStrict, setJSONEx, acquireLease, releaseLease } = require('./kv.js');
  const leaseKey = `lock:x402:claim:${receipt.quoteId}`;
  const lease = await acquireLease(leaseKey, 15);
  if (!lease) throw new Error('entry claim is being issued — retry the same paid request');
  try {
    const q = await getJSONStrict(`x402:q:${receipt.quoteId}`);
    if (!q || !q.settlement || (q.purpose || 'registration') !== 'agent-entry-claim')
      throw new Error('settled entry quote is unavailable');
    if (!isSolanaWallet(receipt.payer))
      throw new Error('settled entry quote has no valid Solana payer');

    if (q.claim && q.claim.token && q.claim.expiresAt > Date.now()) {
      return { ok: true, claim: q.claim.token, payer: receipt.payer,
        expiresAt: q.claim.expiresAt,
        paidTo: receipt.payTo, amountAtomic: receipt.amountAtomic,
        settlement: receipt.sig, network: receipt.network,
        use: { endpoint: '/api/game', action: 'agent-register',
          bodyField: 'entryClaim', note: 'sign the normal Ratchet auth with this payer wallet' } };
    }

    const token = crypto.randomBytes(32).toString('base64url');
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = Date.now() + CLAIM_SECONDS * 1000;
    const record = { hash, quoteId: receipt.quoteId, payer: receipt.payer,
      paidTo: receipt.payTo, amountAtomic: receipt.amountAtomic, sig: receipt.sig,
      network: receipt.network, createdAt: Date.now(), expiresAt };
    await setJSONEx(`x402:c:${hash}`, record, CLAIM_SECONDS);
    q.claim = { token, hash, expiresAt };
    await setJSONEx(`x402:q:${receipt.quoteId}`, q, SETTLED_SECONDS);
    return { ok: true, claim: token, payer: receipt.payer, expiresAt,
      paidTo: receipt.payTo, amountAtomic: receipt.amountAtomic,
      settlement: receipt.sig, network: receipt.network,
      use: { endpoint: '/api/game', action: 'agent-register',
        bodyField: 'entryClaim', note: 'sign the normal Ratchet auth with this payer wallet' } };
  } finally {
    try { await releaseLease(leaseKey, lease); } catch {}
  }
}

// Canonical paid resource for generic x402 clients and Bazaar discovery.
// It deliberately accepts an empty POST body: payment proves the payer, while
// the later signed registration proves wallet ownership and chooses a name.
async function claimGate(req, res) {
  if (!enabled()) return respondUnavailable(res, 'x402 entry is not enabled on this deployment');
  const gate = await entryGate(req, res, { purpose: 'agent-entry-claim' });
  if (gate === 'responded') return gate;
  if (!gate || !gate.granted) return respondUnavailable(res, 'entry payment did not produce a grant');
  try {
    return await claimForReceipt(gate);
  } catch (e) {
    exposePaymentHeaders(res);
    setHeader(res, 'cache-control', 'no-store');
    res.status(503).json({ ok: false, error: 'paid entry claim unavailable',
      reason: String(e && e.message || e).slice(0, 240), retryable: true });
    return 'responded';
  }
}

// Consume only after the signed registration has proved wallet ownership and
// the arena lease has proved the chosen name is free. The use marker is
// idempotent for the same wallet/name so a failed player write can be retried,
// but the claim can never admit another wallet or a second identity.
async function consumeEntryClaim(token, { wallet, name } = {}) {
  const raw = String(token || '').trim();
  if (!/^[A-Za-z0-9_-]{43}$/.test(raw))
    return { granted: false, status: 403, reason: 'entryClaim is malformed' };
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const { getJSONStrict, setnxJSON } = require('./kv.js');
  const claim = await getJSONStrict(`x402:c:${hash}`);
  if (!claim) return { granted: false, status: 403, reason: 'entryClaim is missing or expired' };
  if (claim.expiresAt < Date.now())
    return { granted: false, status: 403, reason: 'entryClaim has expired' };
  if (claim.payer !== wallet)
    return { granted: false, status: 403,
      reason: 'entryClaim belongs to a different Solana payer wallet' };

  const usedKey = `x402:cu:${hash}`;
  const marker = { wallet, name, quoteId: claim.quoteId, usedAt: Date.now() };
  const ttl = Math.max(1, Math.ceil((claim.expiresAt - Date.now()) / 1000));
  const won = await setnxJSON(usedKey, marker, ttl);
  if (!won) {
    const prior = await getJSONStrict(usedKey);
    if (!prior || prior.wallet !== wallet || prior.name !== name)
      return { granted: false, status: 409,
        reason: 'entryClaim was already used for another arena identity' };
  }
  return { granted: true, sig: claim.sig, payTo: claim.paidTo,
    amountAtomic: claim.amountAtomic, payer: claim.payer,
    network: claim.network, quoteId: claim.quoteId };
}

// Test seam: no production request can reach it. It lets the integration suite
// drive the real game and official header codecs without making network calls.
function setFacilitatorForTest(client) {
  injectedClient = client || null;
  capabilityCache = null;
}

module.exports = { entryGate, claimGate, consumeEntryClaim, paymentRequired,
  paymentHeader, championWallet, agentEntryDiscovery,
  entryAmountAtomic, enabled, capabilities, setFacilitatorForTest, USDC_MINT,
  SOLANA_MAINNET, DEFAULT_FACILITATOR, AGENT_ENTRY_PATH, PROOF_BUNDLE_PATH,
  QUOTE_SECONDS };
