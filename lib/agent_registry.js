'use strict';

// Solana Agent Registry / ERC-8004 is an optional provenance layer.  Ratchet
// reads it at registration time and never lets an indexer outage block play.
// Registry identity is not an entry credential and never changes score/rank.
const { isWalletShaped, b58decode } = require('./verify.js');

const INDEXERS = [
  'https://8004-indexer-main.qnt.sh/rest/v1',
  'https://8004-indexer-main2.qnt.sh/rest/v1',
];
const SELECT = [
  'asset', 'agent_wallet', 'owner', 'nft_name', 'agent_uri', 'trust_tier',
  'quality_score', 'confidence', 'risk_score', 'feedback_count',
].join(',');

function validPubkey(value) {
  if (!isWalletShaped(value)) return false;
  try { return b58decode(value).length === 32; } catch { return false; }
}

function safeText(value, max) {
  if (typeof value !== 'string') return null;
  const out = value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
  return out || null;
}

function safeUri(value) {
  const out = safeText(value, 512);
  return out && /^(?:https?:\/\/|ipfs:\/\/|ar:\/\/)/i.test(out) ? out : null;
}

function safeNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const out = Number(value);
  return Number.isFinite(out) ? out : null;
}

function identityFrom(row, wallet, source) {
  if (!row || row.agent_wallet !== wallet || !validPubkey(row.asset)) return null;
  return {
    standard: 'solana-agent-registry-erc8004',
    globalId: `sol:${row.asset}`,
    asset: row.asset,
    agentWallet: wallet,
    owner: validPubkey(row.owner) ? row.owner : null,
    name: safeText(row.nft_name, 80),
    uri: safeUri(row.agent_uri),
    trustTier: safeText(row.trust_tier, 40),
    qualityScore: safeNumber(row.quality_score),
    confidence: safeNumber(row.confidence),
    riskScore: safeNumber(row.risk_score),
    feedbackCount: Math.max(0, Math.trunc(safeNumber(row.feedback_count) || 0)),
    verifiedAt: new Date().toISOString(),
    source,
  };
}

async function lookupAgentByWallet(wallet, fetchFn = fetch, timeoutMs = 2500) {
  if (!validPubkey(wallet)) return { status: 'invalid-wallet' };

  for (const base of INDEXERS) {
    try {
      const url = new URL(base + '/agents');
      url.searchParams.set('agent_wallet', 'eq.' + wallet);
      url.searchParams.set('limit', '2');
      url.searchParams.set('select', SELECT);
      const response = await fetchFn(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response || !response.ok) throw new Error('indexer HTTP failure');
      const rows = await response.json();
      if (!Array.isArray(rows)) throw new Error('indexer returned a non-array');
      if (rows.length === 0) return { status: 'not-found' };
      const identity = rows.map(row => identityFrom(row, wallet, base)).find(Boolean);
      if (!identity) throw new Error('indexer did not return an exact valid wallet match');
      return { status: 'verified', identity };
    } catch {
      // The secondary indexer is an availability fallback.  We deliberately do
      // not turn a failed or malformed dependency read into a negative claim.
    }
  }
  return { status: 'unavailable' };
}

module.exports = { INDEXERS, lookupAgentByWallet, validPubkey };
