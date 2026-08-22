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
//  The on-chain program never had this problem. It pins the exit to the
//  first Pyth update at or after expiry — prev_publish_time < expiry <=
//  publish_time — so every honest settler produces the same number and it
//  does not matter who cranks or when.
//
//  Off-chain we cannot ask a Pyth push account for a past update; it only
//  holds the latest. So we keep our own record of what the oracle said, and
//  settle from THAT: the first sample at or after expiry. Same rule, same
//  property — the exit price stops depending on who triggers the settle.
//
//  It is also publishable. Anyone can read the bucket for an hour and
//  recompute any settlement inside it.
// ============================================================
const { getJSONStrict, setJSONEx, acquireLease, releaseLease } = require('./kv.js');

const SAMPLE_MS  = 60_000;          // the sponsored feeds heartbeat at 60s
// How often we pay for an INDEPENDENT second opinion (Coinbase spot) purely
// to measure divergence. Not used for settlement — ever. It exists so the
// observatory can answer "is the oracle telling the truth?" with a number
// instead of an assurance. Ten minutes keeps it ~144 calls/day.
const CROSS_MS   = 10 * 60_000;
const MIN_GAP_MS = 45_000;          // don't stack samples from parallel instances
const BUCKET_TTL = 4 * 24 * 3600;   // 4 days: the longest chamber is 24h + grace

// How long after expiry we will accept a sample as "the settlement price".
// Past this, the shot VOIDS and the stake comes back. This bound is what
// removes the incentive to wait: patience cannot win a shot, it can only
// refund one.
const SETTLE_GRACE_MS = 15 * 60_000;

const bucketKey = ts => {
  const d = new Date(ts);
  return `px:${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${String(d.getUTCHours()).padStart(2, '0')}`;
};

const FEEDS = ['SOL', 'BTC', 'ETH', 'BONK', 'WIF', 'JUP', 'PUMP'];

// Per-instance throttle so a busy minute costs one write, not one per request.
const gate = globalThis.__ratchet_pxgate || (globalThis.__ratchet_pxgate = { t: 0, x: 0 });

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

/** The unique Pyth update whose publish interval crosses `ts`.
 *
 * Local observation time (`row.t`) is not oracle time.  A server can read an
 * account after expiry while the price inside it was still published before
 * expiry; settling on that row would silently give a pre-expiry exit.  Pyth's
 * deterministic rule is `prev_publish_time < expiry <= publish_time`, and a
 * later update whose `prev_publish_time >= expiry` proves the crossing update
 * was missed rather than providing a permissible substitute. */
async function priceCrossing(feed, ts, now = Date.now(), source = 'pyth-onchain') {
  const deadline = ts + SETTLE_GRACE_MS;
  let missed = false;
  for (let h = ts - 3600e3; h <= deadline + 3600e3; h += 3600e3) {
    const rows = await getJSONStrict(bucketKey(h));
    if (!rows || !rows.length) continue;
    for (const r of rows) {
      if (source && r.src !== source) continue;
      const pub = Number(r.pt && r.pt[feed]) * 1000;
      const prev = Number(r.pp && r.pp[feed]) * 1000;
      const conf = Number(r.cf && r.cf[feed]);
      const price = r[feed];
      if (!Number.isFinite(pub) || !Number.isFinite(prev)) continue;
      if (prev < ts && ts <= pub) {
        if (pub > deadline) return { expired: true, reason: 'crossing-outside-window' };
        if (!Number.isFinite(price) || !Number.isFinite(conf) || conf > 200)
          return { expired: true, reason: 'crossing-unusable' };
        return { row: r, price, publishTime: pub, prevPublishTime: prev, confBps: conf };
      }
      if (prev >= ts && pub >= ts) missed = true;
    }
  }
  if (missed) return { expired: true, reason: 'crossing-update-missed' };
  return now > deadline ? { expired: true, reason: 'no-crossing-in-window' } : { wait: true };
}

/** Every sample we recorded for one feed between two times, oldest first.
 *  This is the same record settlement reads — so a player looking at the path
 *  of their shot is looking at the evidence, not an illustration of it. */
async function pathFor(feed, from, to) {
  const out = [];
  for (let h = from; h <= to + 3600e3; h += 3600e3) {
    const rows = await getJSONStrict(bucketKey(h));
    if (!rows) continue;
    for (const r of rows) {
      if (r.t < from || r.t > to) continue;
      const v = r[feed];
      if (Number.isFinite(v)) out.push([r.t, v]);
    }
    if (h > to) break;
  }
  out.sort((a, b) => a[0] - b[0]);
  return out;
}

module.exports = { sample, priceAt, priceCrossing, pathFor, bucketKey, SETTLE_GRACE_MS, SAMPLE_MS, FEEDS };
