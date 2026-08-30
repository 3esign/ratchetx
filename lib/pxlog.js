// ============================================================
//  lib/pxlog.js — the observed price record.
//
//  WHY THIS EXISTS.
//  Settlement used to read the CURRENT price at the moment someone happened
//  to trigger it. Since nothing settles a shot except a request naming that
//  wallet, and that request needs no signature, an expired shot was not a
//  resolved bet — it was a free option. Hold it, watch the market, and fire
//  the settle when the price suits you. Price is recurrent, so patience won
//  nearly every shot.
//
//  The future on-chain program pins the exit with a Hermes-posted historical
//  crossing update. The live off-chain game reads mutable sponsored accounts,
//  where prev_publish_time is frequently equal to publish_time. It therefore
//  pins the exit to the first fully validated transition our automatic stream
//  observed with oracle publish_time at or after expiry. The player and the
//  request that triggers settlement never choose the price.
//
//  Off-chain we cannot ask a Pyth push account for a past update; it only
//  holds the latest. So we keep our own record of what the oracle said, and
//  settle from THAT: the first sample at or after expiry. Same rule, same
//  property — the exit price stops depending on who triggers the settle.
//
//  It is also publishable. Anyone can read the bucket for an hour and
//  recompute any settlement inside it.
// ============================================================
const { getJSONStrict, getManyJSON, setJSONEx, setJSONIfNewer, acquireLease, releaseLease } = require('./kv.js');
const { compareOrder } = require('./kv_order.js');

// How often we poll the sponsored accounts ourselves. 60s was chosen because
// the majors publish far faster than that, so a minute is cheap and always has
// something new. It is NOT a claim that every feed heartbeats at 60s -- see the
// measurement above streamHealth().
const SAMPLE_MS  = 60_000;
// How often we pay for an INDEPENDENT second opinion (Coinbase spot) purely
// to measure divergence. Not used for settlement — ever. It exists so the
// observatory can answer "is the oracle telling the truth?" with a number
// instead of an assurance. Ten minutes keeps it ~144 calls/day.
const CROSS_MS   = 10 * 60_000;
const MIN_GAP_MS = 45_000;          // don't stack samples from parallel instances
const BUCKET_TTL = 4 * 24 * 3600;   // 4 days: the longest chamber is 24h + grace
const LATEST_TTL = 3600;             // shared agent reads; freshness is carried in the value
const LATEST_POLL_KEY = 'g:pyth:latest';
const LATEST_PREFIX = 'g:pyth:latest:v2:';
const LATEST_ORDER = Object.freeze(['publishTime','postedSlot','rpcSlot','observedAt']);
const initializedFeeds = new Set();

// How long after expiry we will accept a sample as "the settlement price".
// Past this, the shot VOIDS and the stake comes back. This bound is what
// removes the incentive to wait: patience cannot win a shot, it can only
// refund one.
const SETTLE_GRACE_MS = 15 * 60_000;

const bucketKey = ts => {
  const d = new Date(ts);
  return `px:${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${String(d.getUTCHours()).padStart(2, '0')}`;
};
const updateBucketKey = ts => `pxu:${bucketKey(ts).slice(3)}`;

const FEEDS = ['SOL', 'BTC', 'ETH', 'BONK', 'WIF', 'JUP', 'PUMP'];

// Number(null) and Number('') are both zero. Oracle evidence must preserve the
// difference between an actual zero (valid for confidence) and an absent field.
const optionalNumber = value => {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

function legacyCandidates(feed, poll, stream) {
  const candidates = [];
  const at = map => optionalNumber(map && map[feed]);
  const price = at(poll && poll.prices);
  if (price != null && price > 0 && at(poll.publishTimes) > 0) candidates.push({
    observedAt:optionalNumber(poll.observedAt), source:'pyth-onchain-poll', price,
    publishTime:at(poll.publishTimes), prevPublishTime:at(poll.prevPublishTimes),
    confidenceBps:at(poll.confidenceBps), ageAtObservationS:at(poll.ages),
    rpcSlot:at(poll.rpcSlots), postedSlot:at(poll.postedSlots),
    emaPrice:at(poll.emaPrices), emaConfidenceBps:at(poll.emaConfidenceBps),
  });
  if (stream && optionalNumber(stream.price) > 0 && optionalNumber(stream.publishTime) > 0)
    candidates.push(stream);
  return candidates.sort((a,b) => compareOrder(b,a,LATEST_ORDER));
}

async function publishLatest(feed, point) {
  const key = LATEST_PREFIX + feed;
  // Bootstrap once per process from the best legacy observation. A versioned
  // key prevents an in-flight old deployment from undoing the new CAS rule.
  // Competing cold starts are safe: bootstrap itself is an ordered atomic write.
  if (!initializedFeeds.has(feed)) {
    const [poll, stream] = await getManyJSON([LATEST_POLL_KEY, 'pxlatest:' + feed]);
    const [legacy] = legacyCandidates(feed, poll, stream);
    if (legacy) await setJSONIfNewer(key, legacy, LATEST_ORDER, LATEST_TTL);
    initializedFeeds.add(feed);
  }
  return setJSONIfNewer(key, point, LATEST_ORDER, LATEST_TTL);
}

// Per-instance throttle so a busy minute costs one write, not one per request.
const gate = globalThis.__ratchet_pxgate || (globalThis.__ratchet_pxgate = { t: 0, x: 0 });

/** Persist one fully validated Pyth account transition. Pyth timestamps have
 * one-second precision, so distinct transitions can share publish_time. The
 * durable idempotency key therefore covers every settlement-relevant field,
 * not the timestamp alone. */
async function ingestUpdate(feed, update) {
  if (!FEEDS.includes(feed)) throw new Error('unknown feed');
  const price = Number(update && update.price);
  const publishTime = Number(update && update.publishTime);
  const prevPublishTime = Number(update && update.prevPublishTime);
  const confBps = Number(update && update.confBps);
  const receivedAt = Number(update && update.receivedAt) || Date.now();
  const slot = Number(update && update.slot) || 0;
  const postedSlot = Number(update && update.postedSlot) || 0;
  const emaPrice = optionalNumber(update && update.emaPrice);
  const emaConfidenceBps = optionalNumber(update && update.emaConfidenceBps);
  if (!Number.isFinite(price) || price <= 0 ||
      !Number.isSafeInteger(publishTime) || !Number.isSafeInteger(prevPublishTime) ||
      !Number.isSafeInteger(slot) || slot < 0 ||
      !Number.isSafeInteger(postedSlot) || postedSlot < 0 ||
      prevPublishTime > publishTime || !Number.isFinite(confBps) ||
      confBps < 0 || confBps > 200)
    throw new Error('invalid update');

  // Pyth timestamps have one-second precision. Consecutive publishes may
  // legitimately share a second, so equality is valid evidence even though
  // only a strictly earlier prev_publish_time can satisfy a crossing.
  const key = updateBucketKey(publishTime * 1000);
  let lease = null;
  try {
    lease = await acquireLease(`lock:${key}`, 30);
    if (!lease) return false;
    const rows = (await getJSONStrict(key)) || [];
    const duplicate = rows.some(r => r && r.pt
      && Number(r.pt[feed]) === publishTime
      && Number(r.pp && r.pp[feed]) === prevPublishTime
      && Number(r[feed]) === price
      && Number(r.cf && r.cf[feed]) === confBps
      && Number(r.postedSlot) === postedSlot
      && (Number.isFinite(emaPrice) ? Number(r.em && r.em[feed]) === emaPrice : true)
      && (Number.isFinite(emaConfidenceBps)
        ? Number(r.ec && r.ec[feed]) === emaConfidenceBps : true));
    if (!duplicate) {
      rows.push({ t:receivedAt, src:'pyth-onchain-stream', slot, postedSlot,
        [feed]:price, pt:{[feed]:publishTime}, pp:{[feed]:prevPublishTime},
        cf:{[feed]:confBps},
        ...(Number.isFinite(emaPrice) ? { em:{[feed]:emaPrice} } : {}),
        ...(Number.isFinite(emaConfidenceBps) ? { ec:{[feed]:emaConfidenceBps} } : {}) });
      rows.sort((a, b) => Number(a.t) - Number(b.t));
      await setJSONEx(key, rows, BUCKET_TTL);
    }
    // Refresh health even on a duplicate: if the evidence write succeeded but
    // the prior health write failed, an overlapping worker repairs the signal.
    await setJSONIfNewer(`pxstream:${feed}`,
      { t:receivedAt, slot, postedSlot, publishTime, prevPublishTime },
      ['publishTime','postedSlot','slot','t'], 24 * 3600);
    await publishLatest(feed, {
      observedAt:receivedAt, source:'pyth-onchain-stream', price,
      publishTime, prevPublishTime, confidenceBps:confBps,
      rpcSlot:slot, postedSlot,
      emaPrice:Number.isFinite(emaPrice) ? emaPrice : null,
      emaConfidenceBps:Number.isFinite(emaConfidenceBps)
        ? emaConfidenceBps : null,
    });
    return !duplicate;
  } finally {
    if (lease) { try { await releaseLease(`lock:${key}`, lease); } catch {} }
  }
}

/** Record what the oracle says right now. Cheap, throttled, best-effort:
 *  a failed sample must never fail the request that triggered it. */
async function sample(prices) {
  const now = Date.now();
  if (now - gate.t < SAMPLE_MS) return false;
  gate.t = now;
  let lease = null;
  try {
    const key = bucketKey(now);
    // Buckets are shared JSON arrays.  Two serverless instances used to read
    // the same tail, append independently and let the last write erase the
    // other sample.  That is not telemetry loss: this is the evidence human
    // shots settle from.  Serialize the read/append/write and release only
    // when we still own the lease.
    lease = await acquireLease(`lock:${key}`, 30);
    if (!lease) return false;
    const rows = (await getJSONStrict(key)) || [];
    const last = rows[rows.length - 1];
    if (last && now - last.t < MIN_GAP_MS) return false;   // another instance just did it
    const row = { t: now };
    for (const f of FEEDS) if (Number.isFinite(prices[f])) row[f] = prices[f];
    row.src = prices.src;
    // TELEMETRY. Keys are two-letter and lowercase so they can never collide
    // with a feed symbol — priceAt/pathFor keep reading row[FEED] untouched,
    // and every old row without them still settles exactly as before.
    //   ag = age in seconds when we read the account
    //   cf = publisher confidence band, in basis points of price
    //   pt = the oracle's own publish_time (what the heartbeat is measured on)
    if (prices.ages)  row.ag = prices.ages;
    if (prices.confs) row.cf = prices.confs;
    if (prices.pubs)  row.pt = prices.pubs;
    if (prices.prevPubs) row.pp = prices.prevPubs;
    if (prices.slots) row.sl = prices.slots;
    if (prices.postedSlots) row.ps = prices.postedSlots;
    if (prices.emaPrices) row.em = prices.emaPrices;
    if (prices.emaConfs) row.ec = prices.emaConfs;
    // Every CROSS_MS, one independent quote. This is the only reason the
    // observatory can publish a divergence figure that is not self-graded.
    if (now - gate.x >= CROSS_MS) {
      gate.x = now;
      try {
        const { coinbase } = require('./prices.js');
        const cb = await coinbase();
        const q = {};
        for (const f of FEEDS) if (Number.isFinite(cb[f])) q[f] = cb[f];
        if (Object.keys(q).length) row.cb = q;
      } catch { gate.x = now - CROSS_MS + 60_000; }   // try again next minute, not next request
    }
    rows.push(row);
    await setJSONEx(key, rows, BUCKET_TTL);
    // One shared poll snapshot. MCP readers consume this O(1) projection; they
    // do not trigger a new Solana RPC read merely by asking for context.
    const pollSnapshot = {
      observedAt:now, source:'pyth-onchain-poll',
      prices:Object.fromEntries(FEEDS.filter(f => Number.isFinite(prices[f]))
        .map(f => [f, prices[f]])),
      ages:prices.ages || {}, confidenceBps:prices.confs || {},
      publishTimes:prices.pubs || {}, prevPublishTimes:prices.prevPubs || {},
      rpcSlots:prices.slots || {}, postedSlots:prices.postedSlots || {},
      emaPrices:prices.emaPrices || {}, emaConfidenceBps:prices.emaConfs || {},
    };
    // Both capture paths advance the SAME per-feed projection. The old global
    // poll blob is compatibility/bootstrap data, never an unconditional winner.
    // A display fallback may remain in history but cannot impersonate Pyth.
    if (prices.src === 'pyth-onchain') {
      await Promise.all(FEEDS.map(async feed => {
        const [point] = legacyCandidates(feed, pollSnapshot, null);
        if (point) await publishLatest(feed, point);
      }));
      await setJSONEx(LATEST_POLL_KEY, pollSnapshot, LATEST_TTL);
    }
    return true;
  } catch {
    gate.t = now - SAMPLE_MS + 5000;   // retry shortly, but do not spin
    return false;
  } finally {
    if (lease) { try { await releaseLease(`lock:${bucketKey(now)}`, lease); } catch {} }
  }
}

/** The first sample at or after `ts`, searching forward across hour buckets
 *  for as long as the grace window allows.
 *
 *  Returns:
 *    { row }           the settlement sample — use row[feed]
 *    { wait: true }    no sample yet, but we are still inside the grace
 *                      window; leave the shot open and look again later
 *    { expired: true } the grace window closed with no sample: VOID
 */
async function priceAt(ts, now = Date.now(), source = null) {
  const deadline = ts + SETTLE_GRACE_MS;
  for (let h = ts; h <= deadline + 3600e3; h += 3600e3) {
    // A store outage must defer settlement, never masquerade as an empty
    // bucket and turn a valid shot into a VOID.
    const rows = await getJSONStrict(bucketKey(h));
    if (rows && rows.length) {
      for (const r of rows) {
        if (r.t < ts || (source && r.src !== source)) continue;
        return r.t <= deadline ? { row: r } : { expired: true };
      }
    }
    if (h > deadline) break;
  }
  return now > deadline ? { expired: true } : { wait: true };
}

/** First fully validated Pyth transition observed at or after `ts`.
 *
 * Local observation time alone is not enough: a server can read after expiry
 * while the price inside the account was published before it. Oracle
 * `publish_time >= ts` is therefore mandatory. Sponsored accounts frequently
 * report prev_publish_time == publish_time, so that field remains evidence but
 * is not an admissibility gate for the live off-chain game. Exact historical
 * first-crossing proof belongs to Ratchet Seal v2's Hermes-posted path. */
async function priceCrossing(feed, ts, now = Date.now(), source = 'pyth-onchain') {
  const deadline = ts + SETTLE_GRACE_MS;
  let unusable = false, outside = false, indicative = null;
  const candidates = [];
  for (let h = ts - 3600e3; h <= deadline + 3600e3; h += 3600e3) {
    const [sampleRows, updateRows] = await Promise.all([
      getJSONStrict(bucketKey(h)), getJSONStrict(updateBucketKey(h)),
    ]);
    const rows = [...(sampleRows || []), ...(updateRows || [])];
    if (!rows.length) continue;
    for (const r of rows) {
      if (source && r.src !== source &&
          !(source === 'pyth-onchain' && r.src === 'pyth-onchain-stream')) continue;
      const pub = Number(r.pt && r.pt[feed]) * 1000;
      const prev = Number(r.pp && r.pp[feed]) * 1000;
      const conf = Number(r.cf && r.cf[feed]);
      const price = r[feed];
      if (!Number.isFinite(pub) || !Number.isFinite(prev)) continue;
      // Preserve the closest observed print as diagnostics only. It is never
      // admissible for settlement unless the crossing predicate below passes.
      if (Number.isFinite(price) && Number.isFinite(conf)) {
        const gapMs = pub - ts;
        if (!indicative || Math.abs(gapMs) < Math.abs(indicative.gapMs))
          indicative = { price, publishTime:pub, gapMs, confBps:conf };
      }
      if (ts <= pub) {
        const observedAt = Number(r.t);
        if (pub > deadline || !Number.isFinite(observedAt) ||
            observedAt < ts || observedAt > deadline) {
          outside = true; continue;
        }
        if (!Number.isFinite(price) || !Number.isFinite(conf) || conf > 200) {
          unusable = true; continue;
        }
        candidates.push({ row:r, price, publishTime:pub, prevPublishTime:prev,
          confBps:conf, orderSlot:Number(r.postedSlot)||Number(r.slot)||Number.MAX_SAFE_INTEGER,
          observedAt });
      }
    }
  }
  if (candidates.length) {
    candidates.sort((a, b) => a.publishTime - b.publishTime
      || a.orderSlot - b.orderSlot || b.prevPublishTime - a.prevPublishTime
      || a.observedAt - b.observedAt || a.price - b.price);
    const { orderSlot, observedAt, ...winner } = candidates[0];
    return winner;
  }
  if (unusable) return { expired:true, reason:'crossing-unusable', indicative };
  if (outside) return { expired:true, reason:'crossing-outside-window', indicative };
  return now > deadline
    ? { expired:true, reason:'no-observed-update-in-window', indicative }
    : { wait:true };
}

/** Every sample we recorded for one feed between two times, oldest first.
 *  This is the same record settlement reads — so a player looking at the path
 *  of their shot is looking at the evidence, not an illustration of it. */
async function pathFor(feed, from, to, source = null) {
  const out = [];
  const keys = [];
  for (let h = from; h <= to + 3600e3; h += 3600e3) {
    keys.push(bucketKey(h), updateBucketKey(h));
    if (h > to) break;
  }
  const buckets = await getManyJSON(keys);
  for (const rows of buckets) {
    if (!rows) continue;
    for (const r of rows) {
      if (r.t < from || r.t > to) continue;
      if (source && r.src !== source) continue;
      const v = r[feed];
      if (Number.isFinite(v)) out.push([r.t, v]);
    }
  }
  out.sort((a, b) => a[0] - b[0]);
  return out.filter((p, i) => !i || p[0] !== out[i-1][0] || p[1] !== out[i-1][1]);
}

/** The same retained path with every Pyth field Ratchet actually kept.
 * Missing fields remain null for legacy rows; absence is never represented as
 * zero. Stream and polling observations are both retained because comparing
 * their capture paths is part of the product value. */
async function evidencePathFor(feed, from, to, source = null) {
  if (!FEEDS.includes(feed)) throw new Error('unknown feed');
  const out = [];
  const keys = [];
  for (let h = from; h <= to + 3600e3; h += 3600e3) {
    keys.push(bucketKey(h), updateBucketKey(h));
    if (h > to) break;
  }
  const buckets = await getManyJSON(keys);
  for (const rows of buckets) {
    if (!rows) continue;
    for (const r of rows) {
      if (!r || r.t < from || r.t > to) continue;
      if (source && r.src !== source) continue;
      const price = optionalNumber(r[feed]);
      if (price == null || price <= 0) continue;
      const value = (map, scalar = null) => {
        const n = optionalNumber(map && map[feed]);
        if (n != null) return n;
        const s = optionalNumber(scalar);
        return s != null && s > 0 ? s : null;
      };
      out.push({
        observedAt:Number(r.t),
        source:String(r.src || 'unknown'),
        price,
        publishTime:value(r.pt),
        prevPublishTime:value(r.pp),
        confidenceBps:value(r.cf),
        ageAtObservationS:value(r.ag),
        rpcSlot:value(r.sl, r.slot),
        postedSlot:value(r.ps, r.postedSlot),
        emaPrice:value(r.em),
        emaConfidenceBps:value(r.ec),
      });
    }
  }
  out.sort(evidencePointCompare);
  return out.filter((p, i) => !i || JSON.stringify(p) !== JSON.stringify(out[i - 1]));
}

/** A complete, stable order for path pagination. observedAt is not unique:
 * multiple valid Pyth transitions can be captured in the same millisecond. */
function evidencePointCompare(a, b) {
  const number = (value, missing = Number.MAX_SAFE_INTEGER) => {
    const n = optionalNumber(value);
    return n == null ? missing : n;
  };
  return number(a.observedAt, 0) - number(b.observedAt, 0)
    || number(a.postedSlot) - number(b.postedSlot)
    || String(a.source || '').localeCompare(String(b.source || ''))
    || number(a.publishTime) - number(b.publishTime)
    || number(a.prevPublishTime) - number(b.prevPublishTime)
    || number(a.price) - number(b.price)
    || number(a.confidenceBps) - number(b.confidenceBps)
    || number(a.rpcSlot) - number(b.rpcSlot)
    || number(a.emaPrice) - number(b.emaPrice)
    || number(a.emaConfidenceBps) - number(b.emaConfidenceBps)
    || JSON.stringify(a).localeCompare(JSON.stringify(b));
}

/** Latest validated Pyth state from the two shared capture paths.
 * The newest Pyth publication wins; posted slot and local observation time
 * break same-second ties deterministically. This function only reads KV. */
async function latestSnapshot(now = Date.now()) {
  const currentRows = await getManyJSON(FEEDS.map(f => LATEST_PREFIX + f));
  const missing = FEEDS.filter((feed,i) => !currentRows[i]);
  const [poll, ...streamRows] = missing.length ? await getManyJSON(
    [LATEST_POLL_KEY, ...missing.map(f => `pxlatest:${f}`)]) : [];
  const feeds = {};
  for (let i = 0; i < FEEDS.length; i++) {
    const feed = FEEDS[i];
    const candidates = currentRows[i] ? [currentRows[i]]
      : legacyCandidates(feed, poll, streamRows[missing.indexOf(feed)]);
    if (!candidates.length) continue;
    const best = { ...candidates[0] };
    best.ageNowS = best.publishTime != null && Number.isFinite(Number(best.publishTime))
      ? Math.max(0, Math.floor(now / 1000 - Number(best.publishTime))) : null;
    for (const key of ['publishTime','prevPublishTime','confidenceBps','ageAtObservationS',
      'rpcSlot','postedSlot','emaPrice','emaConfidenceBps'])
      best[key] = optionalNumber(best[key]);
    feeds[feed] = best;
  }
  return { observedAt:now, feeds, projection:{version:2, order:LATEST_ORDER,
    atomicFeeds:FEEDS.filter((feed,i) => !!currentRows[i]), legacyFeeds:missing,
    meaning:'latest accepted observation; not a live admission quote', retentionS:LATEST_TTL} };
}

// Two bounds, because a stream gap raises two different questions.
//
//   FRESH  (120s) -- is the capture stream keeping up? Kept as `active` so
//                   nothing reading this shape breaks.
//   USABLE (SETTLE_GRACE) -- could this gap change an outcome? Below it, no: a
//                   shot voids only if nothing lands inside the settle window,
//                   minute polling writes into the same log by an independent
//                   path, and the on-chain program has no staleness bound at
//                   all. Past this bound is what deserves a banner.
//
// MEASURED 2026-08-28, and it is not what the page was implying. Sampling
// /api/game?action=stream-health and /api/feeds together, same moment:
//
//     feed   stream gap   account's own last publish (minute polling)
//     JUP        323s                 80s
//     WIF        197s                120s
//
// The accounts were being written the whole time. Our capture stream missed the
// notifications. Over five samples the laggards rotated -- WIF+PUMP, then PUMP
// alone, then BONK+JUP -- while SOL and BTC were never behind. So this is not
// Pyth's cadence for thin feeds, and the old label "5/7 sponsored accounts
// current" pointed at the oracle for a defect of ours.
//
// Two consequences that pull opposite ways, on purpose:
//   1. Settlement is not at risk, so this must stop painting the page amber
//      during normal operation. An amber that is always on gets ignored.
//   2. It is still a real defect -- one of two independent settlement paths is
//      silently losing events -- so it must not be smoothed into green either.
//      It is reported as what it is, with the feeds named.
const STREAM_FRESH_S = 120;

async function streamHealth(now = Date.now()) {
  const rows = await getManyJSON(FEEDS.map(f => `pxstream:${f}`));
  const usableS = SETTLE_GRACE_MS / 1000;
  const feeds = {};
  const lagging = [];   // past FRESH, still inside the settle window
  const beyond  = [];   // past USABLE -- settlement could notice
  let active = 0, usable = 0;
  FEEDS.forEach((feed, i) => {
    const r = rows[i];
    if (!r) { feeds[feed] = { active:false, usable:false, ageS:null }; beyond.push(feed); return; }
    const ageS = Math.max(0, Math.floor((now - Number(r.t)) / 1000));
    const isActive = ageS <= STREAM_FRESH_S;
    const isUsable = ageS <= usableS;
    if (isActive) active++;
    if (isUsable) usable++;
    if (!isActive && isUsable) lagging.push(feed);
    if (!isUsable) beyond.push(feed);
    feeds[feed] = { active:isActive, usable:isUsable, ageS, slot:Number(r.slot)||0,
      postedSlot:Number(r.postedSlot)||0,
      publishTime:Number(r.publishTime)||null,
      prevPublishTime:Number(r.prevPublishTime)||null };
  });
  return { active, usable, total:FEEDS.length, ok:active === FEEDS.length,
    degraded:beyond.length > 0, lagging, beyond, usableS, feeds };
}

module.exports = { sample, ingestUpdate, priceAt, priceCrossing, pathFor, evidencePathFor,
  latestSnapshot, evidencePointCompare, streamHealth, bucketKey, updateBucketKey, SETTLE_GRACE_MS,
  SAMPLE_MS, FEEDS, LATEST_POLL_KEY };
