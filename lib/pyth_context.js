'use strict';

const { ACCOUNTS, MAX_AGE_S, MAX_CONF_BPS } = require('./onchain_px.js');
const { FEEDS, evidencePointCompare } = require('./pxlog.js');

const PATH_MAX_MS = 26 * 3600e3;
const PATH_MAX_POINTS = 500;
const PATH_DEFAULT_POINTS = 240;
const SOURCE_MAP = Object.freeze({
  all:null,
  stream:'pyth-onchain-stream',
  poll:'pyth-onchain',
});

function cleanFeed(value, optional = true) {
  const feed = String(value || '').trim().toUpperCase();
  if (!feed && optional) return null;
  if (!FEEDS.includes(feed)) throw new Error('feed must be one of ' + FEEDS.join(', '));
  return feed;
}

function cleanHours(value) {
  let hours = Math.floor(Number(value));
  if (!Number.isFinite(hours) || hours < 1) hours = 24;
  return Math.min(72, hours);
}

function finite(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function buildContext({ snapshot, health, targets, feed = null, now = Date.now() }) {
  const selected = cleanFeed(feed);
  const wanted = selected ? [selected] : FEEDS;
  const activeTargets = Array.isArray(targets) ? targets : [];
  const rows = [];
  for (const symbol of wanted) {
    const current = snapshot && snapshot.feeds && snapshot.feeds[symbol] || null;
    const measured = health && health.feeds && health.feeds[symbol] || null;
    const account = ACCOUNTS[symbol] || [];
    const ageNowS = current ? finite(current.ageNowS) : null;
    const emaPrice = current ? finite(current.emaPrice) : null;
    const price = current ? finite(current.price) : null;
    const emaDeltaBps = price != null && emaPrice != null && emaPrice !== 0
      ? +((price - emaPrice) / emaPrice * 10000).toFixed(3) : null;
    const publishTime = current ? finite(current.publishTime) : null;
    const prevPublishTime = current ? finite(current.prevPublishTime) : null;
    rows.push({
      feed:symbol,
      status:!current ? 'unavailable' : ageNowS != null && ageNowS > MAX_AGE_S
        ? 'stale' : measured && measured.thin ? 'current-thin-window' : 'current',
      account:account[0] || null,
      feedId:account[1] || null,
      current:current ? {
        price,
        confidenceBps:finite(current.confidenceBps),
        emaPrice,
        emaConfidenceBps:finite(current.emaConfidenceBps),
        priceVsEmaBps:emaDeltaBps,
        publishTime,
        prevPublishTime,
        publishIntervalS:publishTime != null && prevPublishTime != null
          ? publishTime - prevPublishTime : null,
        ageNowS,
        observedAt:finite(current.observedAt),
        rpcSlot:finite(current.rpcSlot),
        postedSlot:finite(current.postedSlot),
        capturePath:current.source || null,
      } : null,
      observedWindow:measured ? {
        samples:measured.samples,
        misses:measured.misses,
        coveragePct:measured.coverage,
        telemetry:measured.telemetry,
        distributionsWithheld:!!measured.thin,
        minObservations:measured.minObs,
        updates:measured.updates,
        blindWindows:measured.blindWindows,
        rewinds:measured.rewinds,
        gapSeconds:{ median:measured.gapMedS, p95:measured.gapP95S, max:measured.gapMaxS },
        ageSeconds:{ median:measured.ageMedS, p95:measured.ageP95S, max:measured.ageMaxS },
        confidenceBps:{ median:measured.confMedBps, p95:measured.confP95Bps,
          max:measured.confMaxBps },
        staleWindows:measured.staleWindows,
      } : null,
      settlementImpact:health && health.settle ? health.settle[symbol] || null : null,
      activeTargets:activeTargets.filter(t => t.feed === symbol || t.feed2 === symbol)
        .map(t => ({ id:t.id, kind:t.kind, feed:t.feed, feed2:t.feed2 || null,
          horizonMinutes:t.mins, label:t.label })),
    });
  }
  return {
    ok:true,
    schema:'ratchetx-pyth-context-v1',
    generatedAt:now,
    windowHours:health ? health.windowHours : null,
    pyth:{
      provider:'Pyth Network',
      product:'Pyth Price Feeds',
      network:'Solana mainnet',
      accountType:'PriceUpdateV2',
      fields:['aggregate price','confidence interval','EMA price','EMA confidence',
        'publish time','previous publish time','RPC observation slot','Pyth posted slot'],
      documentation:'https://docs.pyth.network/price-feeds',
    },
    access:{
      mode:'shared-read',
      requestTriggeredOracleRead:false,
      snapshotMeaning:'Latest accepted observation, not a continuous oracle archive or a live admission quote. The game revalidates oracle admissibility at seal time.',
      ordering:snapshot && snapshot.projection || null,
      explanation:'Ratchet capture validates Pyth account updates once; agents read the same shared snapshot and telemetry.',
    },
    validation:{
      fullVerificationRequired:true,
      maxAgeS:MAX_AGE_S,
      maxConfidenceBps:MAX_CONF_BPS,
      ownerFeedIdAndDiscriminatorChecked:true,
    },
    measurement:{
      ourDutyPct:health ? health.ourDutyPct : null,
      samples:health ? health.samples : null,
      expectedSamples:health ? health.expectedSamples : null,
      note:'Ratchet measurements describe what its capture paths observed. Missing observations are not attributed to Pyth when Ratchet was blind.',
    },
    feeds:rows,
    notASignal:'Price-vs-EMA and feed-health fields are context, not a direction, probability, or trading recommendation.',
    naturalOrder:['ratchet_pyth_context','ratchet_board',
      'ratchet_demo_shot or ratchet_ranked_prepare','ratchet_demo_state','ratchet_proof'],
    next:'Read ratchet_board, choose an exact live target, then state your own probability.',
  };
}

function parsePathRequest(input = {}, now = Date.now()) {
  const cursor = input.cursor == null || input.cursor === '' ? null : String(input.cursor);
  let decoded = null;
  if (cursor) {
    try {
      if (cursor.length > 4096) throw new Error('too long');
      decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
      const bound = decoded && decoded.request;
      const observedAt = Number(decoded && decoded.point && decoded.point.observedAt);
      if (!decoded || decoded.v !== 1 || !decoded.point || !bound
          || !Number.isSafeInteger(observedAt)
          || !Number.isSafeInteger(bound.from) || !Number.isSafeInteger(bound.to)
          || observedAt < bound.from || observedAt > bound.to)
        throw new Error('missing cursor point or bounds');
    } catch { throw new Error('cursor is invalid'); }
  }
  const feed = cleanFeed(input.feed, false);
  const from = Number(input.from);
  // Resolve the moving default once. A continuation with unchanged omitted
  // `to` must use the first page's window, not the clock at this second request.
  const to = input.to == null ? (decoded ? decoded.request.to : now) : Number(input.to);
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || to <= from)
    throw new Error('from and to must be Unix milliseconds with to > from');
  if (to - from > PATH_MAX_MS) throw new Error('path window cannot exceed 26 hours');
  const source = String(input.source || 'all').toLowerCase();
  if (!Object.hasOwn(SOURCE_MAP, source))
    throw new Error('source must be all, stream, or poll');
  let limit = Math.floor(Number(input.limit));
  if (!Number.isFinite(limit) || limit < 1) limit = PATH_DEFAULT_POINTS;
  limit = Math.min(PATH_MAX_POINTS, limit);
  let cursorPoint = null;
  if (decoded) {
    const bound = decoded.request;
    if (bound.feed !== feed || bound.from !== from || bound.to !== to
        || bound.source !== source) throw new Error('cursor is invalid');
    cursorPoint = decoded.point;
  }
  return { feed, from, to, source, sourceValue:SOURCE_MAP[source], limit,
    cursor, cursorPoint };
}

function pathResponse(request, points) {
  const total = points.length;
  const remaining = request.cursorPoint
    ? points.filter(point => evidencePointCompare(point, request.cursorPoint) > 0)
    : points;
  const kept = remaining.slice(0, request.limit);
  const account = ACCOUNTS[request.feed] || [];
  const truncated = remaining.length > kept.length;
  const nextCursor = truncated && kept.length
    ? Buffer.from(JSON.stringify({ v:1,
      request:{ feed:request.feed, from:request.from, to:request.to, source:request.source },
      point:kept[kept.length - 1],
    })).toString('base64url') : null;
  return {
    ok:true,
    schema:'ratchetx-pyth-path-v1',
    feed:request.feed,
    account:account[0] || null,
    feedId:account[1] || null,
    from:request.from,
    to:request.to,
    source:request.source,
    total,
    remaining:remaining.length,
    returned:kept.length,
    truncated,
    nextCursor,
    nextRequest:nextCursor ? {feed:request.feed,from:request.from,to:request.to,
      source:request.source,limit:request.limit,cursor:nextCursor} : null,
    points:kept,
    pagination:'When nextRequest is present, pass it unchanged to ratchet_pyth_path. Alternatively repeat the same request with cursor=nextCursor; an omitted to stays frozen to the first page. Explicitly changing feed/from/to/source is rejected. The composite cursor preserves distinct transitions captured in the same millisecond.',
    retention:'raw capture evidence is retained for four days; each request is limited to a 26-hour window',
    attribution:{ provider:'Pyth Network', product:'Pyth Price Feeds',
      documentation:'https://docs.pyth.network/price-feeds' },
    limitation:'This is the path Ratchet observed, not an independently complete history of every Pyth publication.',
  };
}

module.exports = { buildContext, cleanFeed, cleanHours, parsePathRequest,
  pathResponse, PATH_MAX_MS, PATH_MAX_POINTS };
