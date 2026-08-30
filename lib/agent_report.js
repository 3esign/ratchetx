'use strict';
const { getJSONStrict, getCached } = require('./kv.js');
const { getAgentRuns } = require('./agent_receipts.js');
const { RELEASE } = require('./release.js');

const ARENA_MIN_CALLS = 10;
const walletShape = v => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(v || ''));
const demoShape = v => /^demo-[a-z0-9]{3,18}$/.test(String(v || ''));
const demoHandleShape = v => /^[a-z0-9]{3,18}$/.test(String(v || ''));

async function buildAgentReport(id) {
  const requested = String(id || '').trim();
  if (!walletShape(requested) && !demoShape(requested) && !demoHandleShape(requested))
    return { status:400, body:{ ok:false, reason:'invalid id format' } };
  const identity = walletShape(requested) ? requested
    : `demo-${requested.toLowerCase().replace(/^demo-/, '')}`;
  const p = await getJSONStrict(`u:${identity}`);
  if (!p) return { status:404, body:{ ok:false, reason:'agent not found or has no state' } };

  const compact = (await getCached(`hist:${identity}`, 3_000)) || [];
  const rich = Array.isArray(p.closed) ? p.closed : [];
  const byId = new Map(rich.map(row => [row.id, row]));
  const history = compact.map(row => ({ ...(byId.get(row.id) || {}), ...row }));
  for (const row of rich) if (!history.some(h => h.id === row.id)) history.push(row);

  const settled = history.filter(r => r.res === 'hit' || r.res === 'miss');
  const voided = history.filter(r => r.res === 'void').length;
  const feeds = {}, days = new Set();
  for (const row of settled) {
    if (row.feed) feeds[row.feed] = (feeds[row.feed] || 0) + 1;
    const when = Number(row.settledAt || row.t);
    if (Number.isFinite(when)) days.add(new Date(when).toISOString().slice(0,10));
  }

  const stated = Number(p.bn) || 0;
  const brier = stated ? +((Number(p.bsum) || 0) / stated).toFixed(4) : null;
  const calibration = Array.from({ length:10 }, (_, bin) => {
    const c = p.calib && p.calib[bin];
    return c ? { bin, forecastRange:[bin / 10, (bin + 1) / 10],
      count:c.n, hits:c.h, observedRate:c.n ? +(c.h / c.n).toFixed(4) : null } : null;
  }).filter(Boolean);
  const stage = stated >= 30 && Object.keys(feeds).length >= 3 && days.size >= 7
    ? 'ESTABLISHED' : 'PROVISIONAL';

  const receipts = await getAgentRuns(history.map(row => row.id));
  receipts.sort((a,b) => Number(b.verifiedAt) - Number(a.verifiedAt));
  const latest = receipts[0] || null;
  const receiptBoundary = latest && latest.receipt && latest.receipt.trustBoundary;
  const registered = !!p.agent && walletShape(identity);
  const registry = p.agent && p.agent.identity || null;
  return { status:200, body:{ ok:true, v:RELEASE, reportCard:{
    identity,
    identityProof:{ walletAuthenticatedRegistration:registered,
      registryLinked:!!registry, registry:registry || null,
      demo:demoShape(identity) },
    evidenceStage:stage,
    ranking:{ listed:registered && stated >= ARENA_MIN_CALLS,
      statedCalls:stated, minimumStatedCalls:ARENA_MIN_CALLS,
      reason:stated >= ARENA_MIN_CALLS ? null
        : `Brier ranking needs ${ARENA_MIN_CALLS} stated-probability calls` },
    stats:{ scoredCalls:Number(p.shots) || settled.length, recentScoredCalls:settled.length,
      recentVoidCalls:voided, brierScore:brier,
      brierVsHalf:brier == null ? null : +(1 - brier / 0.25).toFixed(4),
      calibration, recentFeedDistribution:feeds, recentActiveDays:days.size,
      recentVoidRate:(settled.length + voided) ? +(voided / (settled.length + voided)).toFixed(3) : 0 },
    latestReceipt:latest ? { shotId:latest.shotId, digest:latest.digest,
      result:latest.receipt && latest.receipt.result, verifiedAt:latest.verifiedAt,
      proofPage:`https://ratchetx.xyz/shot.html?id=${encodeURIComponent(latest.shotId)}`,
      oracleAuthentication:receiptBoundary && typeof receiptBoundary.oracleAccountValidation === 'string'
        ? receiptBoundary.oracleAccountValidation : null,
      independentPythReplay:receiptBoundary && typeof receiptBoundary.independentPythReplay === 'boolean'
        ? receiptBoundary.independentPythReplay : null,
      selectionAuthority:'ratchet-server-hash-chain' }
      : { status:'not-yet-replayed', selectionAuthority:'ratchet-server-hash-chain' },
  } } };
}

async function handler(req, res) {
  res.setHeader('access-control-allow-origin','*');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ ok:false, reason:'GET only' });
  const out = await buildAgentReport(req.query && req.query.id);
  if (out.status === 200) res.setHeader('cache-control','public, max-age=60');
  return res.status(out.status).json(out.body);
}

module.exports = { buildAgentReport, handler, ARENA_MIN_CALLS };
