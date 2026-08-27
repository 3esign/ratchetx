// ============================================================
//  api/log.js — THE EVENT LOG, one page at a time.
//
//  WHY THIS EXISTS. The Black Box promise is that anyone can export the whole
//  state and rebuild the machine. That promise was carried entirely by
//  /api/snapshot, which returns everything in one response — and as the log
//  grew, that response stopped arriving. Clients time out on it today.
//
//  A guarantee that quietly stops being exercisable is worse than one never
//  made, because the page still says green. So the log is now walkable in
//  pages: fetch a few hundred entries, verify them, ask for the next few
//  hundred. No key, no signup, no rate deal, CORS open.
//
//  Entries are returned EXACTLY as stored — same fields, same values, nothing
//  reshaped — because the point is that you can recompute the hashes yourself.
//  Key ORDER, however, is whatever the storage layer hands back; if you are
//  verifying pre-canonical entries, see docs/CHAIN_GAP.md and
//  lib/legacy_chain.js for why that matters and how to replay it.
//
//  GET /api/log                     → { entries, head, issued, next }
//  GET /api/log?after=<i>&limit=<n> → the page starting after index <i>
//  GET /api/log?i=<i>               → exactly one entry, by index
//    limit defaults to 500, capped at 2000
// ============================================================
const { getManyJSON, getJSON } = require('../lib/kv.js');
const { logCount } = require('../lib/log.js');

const VERSION = 'log1-2026-08-27';
const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2000;
const SITE = (process.env.PUBLIC_ORIGIN || 'https://ratchetx.xyz').replace(/\/$/, '');

/** Read a contiguous window of entries by their immutable per-index keys.
 *  Missing indices are simply absent from the result — the caller compares
 *  against `issued` to see that, which is exactly how the gap at 345 is
 *  discoverable rather than hidden. */
async function window_(from, to) {
  const out = [];
  for (let start = from; start <= to; start += 500) {
    const stop = Math.min(to, start + 499);
    const keys = Array.from({ length: stop - start + 1 }, (_, n) => `g:log:e:${start + n}`);
    const rows = await getManyJSON(keys);
    rows.forEach(e => { if (e) out.push(e); });
  }
  return out;
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=30');
  try {
    const q = req.query || {};
    const issued = await logCount();
    const head = (await getJSON('g:log:head')) || null;

    // single-entry lookup — the cheapest way to check one claim
    const one = Number(q.i);
    if (Number.isFinite(one) && one > 0) {
      const [entry] = await getManyJSON([`g:log:e:${Math.floor(one)}`]);
      return res.status(200).json({
        ok: true, v: VERSION, issued, head,
        i: Math.floor(one), entry: entry || null,
        ...(entry ? {} : { note: 'no entry stored at that index — compare with `issued`; see docs/CHAIN_GAP.md' }),
      });
    }

    const after = Math.max(0, Math.floor(Number(q.after) || 0));
    const limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(Number(q.limit) || DEFAULT_LIMIT)));
    const from = after + 1;
    const to = Math.min(issued, after + limit);
    const entries = from > to ? [] : await window_(from, to);
    const next = to < issued ? to : null;

    res.status(200).json({
      ok: true, v: VERSION,
      issued, head,
      range: { from, to },
      count: entries.length,
      // count < (to - from + 1) means indices in this window were issued but
      // never stored. That is a real fact about the log and it is left visible.
      missingInRange: Math.max(0, (to - from + 1) - entries.length),
      next,
      entries,
      verify: `${SITE}/api/proof`,
      howTo: 'walk with ?after=<next>&limit=<n>; each entry is returned exactly as stored so you can recompute h = sha256(prev + json(entry)) yourself. Pre-canonical entries need their written key order replayed — lib/legacy_chain.js does it, docs/CHAIN_GAP.md explains why.',
    });
  } catch (e) {
    res.status(500).json({ ok: false, reason: String((e && e.message) || e).slice(0, 200) });
  }
};
