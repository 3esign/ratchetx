'use strict';
const { ACCOUNTS } = require('./onchain_px.js');
const { SETTLE_RULE, questionOutcome } = require('./outcome.js');
const { SETTLE_GRACE_MS } = require('./pxlog.js');

const BENCHMARKS_URL = process.env.PYTH_BENCHMARKS_URL || 'https://benchmarks.pyth.network/v1';
const cleanId = id => String(id || '').replace(/^0x/i, '').toLowerCase();
const asMs = t => Number(t) < 1e12 ? Number(t) * 1000 : Number(t);

function normalizeShot(raw) {
  return {
    ...raw,
    id: raw.id || raw.shotId,
    kind: raw.kind || 'dir',
    expiry: Number(raw.expiry == null ? raw.exp : raw.expiry),
    thresh: raw.thresh == null ? raw.threshold : raw.thresh,
    statedProbability: raw.statedProbability == null ? raw.sp : raw.statedProbability,
    result: String(raw.result || raw.res || '').toLowerCase(),
    exit: raw.exit == null ? raw.exitPx : raw.exit,
    exit2: raw.exit2 == null ? raw.exitPx2 : raw.exit2,
  };
}

function parsedUpdates(data) {
  const list = Array.isArray(data && data.parsed) ? data.parsed
    : Array.isArray(data) ? data : [];
  return list.map(u => ({ id:cleanId(u.id), price:u.price || u }));
}

function toPrice(p) {
  return Number(p && p.price) * Math.pow(10, Number(p && p.expo));
}

function nearlyEqual(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= Math.max(1e-12, Math.abs(b) * 1e-10);
}

async function fetchBenchmarkUpdates(shot, { fetchFn=fetch,
  apiKey=process.env.PYTH_API_KEY || '' } = {}) {
  const symbols = [shot.feed, ...(shot.kind === 'race' ? [shot.feed2] : [])];
  const specs = symbols.map(symbol => ({ symbol, id:ACCOUNTS[symbol] && ACCOUNTS[symbol][1] }));
  if (specs.some(x => !x.id)) throw new Error('shot names an unsupported Pyth feed');
  const start = Math.floor(shot.expiry / 1000);
  const seconds = Math.floor(SETTLE_GRACE_MS / 1000);
  const params = specs.map(x => `ids[]=${encodeURIComponent(x.id)}`).join('&');
  const url = `${BENCHMARKS_URL}/updates/price/${start}/${seconds}?${params}`;
  const res = await fetchFn(url, apiKey ? { headers:{ Authorization:`Bearer ${apiKey}` } } : {});
  if (!res.ok) throw new Error(`Pyth Benchmarks HTTP ${res.status}`);
  const updates = parsedUpdates(await res.json());
  const selected = {};
  for (const spec of specs) {
    const candidates = updates.filter(u => u.id === cleanId(spec.id))
      .map(u => ({ symbol:spec.symbol, value:toPrice(u.price),
        publishTime:asMs(u.price.publish_time), confidence:Number(u.price.conf)
          * Math.pow(10, Number(u.price.expo)) }))
      .filter(u => Number.isFinite(u.value) && Number.isFinite(u.publishTime)
        && u.publishTime >= shot.expiry && u.publishTime <= shot.expiry + SETTLE_GRACE_MS)
      .sort((a, b) => a.publishTime - b.publishTime || a.value - b.value);
    if (!candidates.length) throw new Error(`no ${spec.symbol} update in the settlement window`);
    selected[spec.symbol] = candidates;
  }
  return selected;
}

async function verifyEvidence(raw, options={}) {
  const shot = normalizeShot(raw && raw.shot ? raw.shot : raw || {});
  if (!shot.id || !shot.feed || !Number.isFinite(shot.expiry))
    return { result:'INSUFFICIENT_EVIDENCE', reason:'record lacks shot id, feed or expiry' };
  if (!['hit', 'miss'].includes(shot.result))
    return { result:'INSUFFICIENT_EVIDENCE', reason:'only settled hit/miss shots can produce this bundle' };
  if (shot.settleRule !== SETTLE_RULE)
    return { result:'INSUFFICIENT_EVIDENCE', reason:`unsupported settlement rule ${shot.settleRule || 'missing'}` };
  if (!shot.kind || (shot.kind === 'race' && (!shot.feed2 || !Number.isFinite(Number(shot.entry2))))
      || ((shot.kind === 'thr' || shot.kind === 'thrDown') && !Number.isFinite(Number(shot.thresh)))
      || (shot.kind === 'range' && !Number.isFinite(Number(shot.pct))))
    return { result:'INSUFFICIENT_EVIDENCE', reason:'record lacks the sealed question parameters' };

  let all;
  try { all = await fetchBenchmarkUpdates(shot, options); }
  catch (e) { return { result:'INSUFFICIENT_EVIDENCE', reason:String(e.message || e) }; }

  const matchAt = (symbol, at, value) => (all[symbol] || []).find(u =>
    u.publishTime === Number(at) && nearlyEqual(u.value, Number(value)));
  const first = matchAt(shot.feed, shot.exitAt, shot.exit);
  const second = shot.kind === 'race' ? matchAt(shot.feed2, shot.exitAt2, shot.exit2) : null;
  if (!first || (shot.kind === 'race' && !second)) {
    return { result:'DIVERGENCE', shotId:shot.id,
      reason:'the canonical exit price/publish time is absent from Pyth Benchmarks' };
  }

  const marketOutcome = questionOutcome(shot, first.value, second && second.value);
  const verifierSettlement = marketOutcome === 'VOID' ? 'void'
    : marketOutcome === shot.side ? 'hit' : 'miss';
  const matched = verifierSettlement === shot.result;
  const probability = Number(shot.statedProbability);
  const brier = Number.isFinite(probability)
    ? Math.pow(probability - (verifierSettlement === 'hit' ? 1 : 0), 2) : null;
  const earliest = all[shot.feed][0];

  return {
    proofVersion:'ratchetx-pyth-benchmarks-v1',
    shotId:shot.id,
    feed:shot.feed,
    ...(shot.feed2 ? { feed2:shot.feed2 } : {}),
    question:{ kind:shot.kind, entry:Number(shot.entry),
      ...(shot.entry2 != null ? { entry2:Number(shot.entry2) } : {}),
      ...(shot.thresh != null ? { threshold:Number(shot.thresh) } : {}),
      ...(shot.pct != null ? { pct:Number(shot.pct) } : {}), side:shot.side },
    expiry:shot.expiry,
    oracle:[first, ...(second ? [second] : [])],
    selectionEvidence:{ authority:'ratchet-server-hash-chain',
      rule:shot.settleRule,
      benchmarkUpdateWasEarliestPublished:first.publishTime === earliest.publishTime,
      note:'Pyth authenticates the selected update; the public hash chain records which valid update Ratchet first observed.' },
    statedProbability:Number.isFinite(probability) ? probability : null,
    ratchetSettlement:shot.result,
    verifierSettlement,
    brierScore:brier == null ? null : +brier.toFixed(6),
    result:matched ? 'MATCH' : 'DIVERGENCE',
    reason:matched
      ? 'Pyth price/time and the shared versioned outcome rule reproduce the recorded result'
      : 'the authenticated Pyth update produces a different result under the recorded rule',
  };
}

async function fetchPublicShot(shotUrl, fetchFn=fetch) {
  const parsed = new URL(shotUrl);
  const id = parsed.searchParams.get('id');
  if (!/^[A-Za-z0-9:_-]{1,80}$/.test(id || '')) throw new Error('proof URL has no valid shot id');
  let after = 0;
  for (let page=0; page<100; page++) {
    const url = `${parsed.origin}/api/record?format=json&limit=1000&after=${after}`;
    const res = await fetchFn(url);
    if (!res.ok) throw new Error(`Ratchet record HTTP ${res.status}`);
    const body = await res.json();
    const shot = (body.rows || []).find(row => row.id === id);
    if (shot) return shot;
    const next = Number(body.cursor);
    if (!Number.isFinite(next) || next <= after || !(body.rows || []).length) break;
    after = next;
  }
  throw new Error('shot not found in the public settled record');
}

async function verifyShot(shotUrl, options={}) {
  try {
    const shot = await fetchPublicShot(shotUrl, options.fetchFn || fetch);
    return verifyEvidence(shot, options);
  } catch (e) {
    return { result:'INSUFFICIENT_EVIDENCE', reason:String(e.message || e) };
  }
}

module.exports = { verifyShot, verifyEvidence, fetchPublicShot, fetchBenchmarkUpdates };
