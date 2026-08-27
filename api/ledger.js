// ============================================================
//  api/ledger.js — THE COINFLIP LEDGER
//
//  GET  /api/ledger            the board
//  GET  /api/ledger?action=tick   observe + resolve (idempotent; cron/crank)
//
//  The claim this endpoint makes, in full:
//
//    On questions their own crowd priced between 0.35 and 0.65 — the ones
//    that were actually in doubt — here is how each venue scored, resolved
//    by Pyth on Solana under the same settlement rule that decides a shot
//    on this site, with every dropped observation counted.
//
//  It does not claim the venues were asked identical questions. They were
//  not. The band is the control, and it is stated everywhere the numbers are.
// ============================================================
const { getJSON, setJSON, hall, hincrMany } = require('../lib/kv.js');
const L = require('../lib/ledger.js');

const VERSION = 'ldg2-2026-08-27';
const TICK_MIN_MS = 4 * 60e3;

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

async function tick(now) {
  const guard = (await getJSON('ldg:tick')) || 0;
  if (now - num(guard) < TICK_MIN_MS) return { skipped: 'too-soon' };
  await setJSON('ldg:tick', now);

  // ---- observe
  const [k, pm] = await Promise.all([L.fromKalshi(now), L.fromPolymarket(now)]);
  const open = (await getJSON(L.K_OPEN)) || [];
  // Collapse strike ladders BEFORE anything else: one event, one observation.
  const collapsed = L.collapseLadders([...k.obs, ...pm.obs]);
  const seen = new Set(open.map(o => `${o.venue}:${o.id}:${o.exp}`));
  // An event already observed must not be observed again at a different rung —
  // that would smuggle the ladder back in one tick at a time.
  const seenEvents = new Set(open.map(o => o.event
    ? `${o.venue}:${o.event}` : `${o.venue}:${o.feed}:${o.dir}:${o.exp}`));
  let added = 0, ladder = collapsed.dropped;
  for (const o of collapsed.kept) {
    const key = `${o.venue}:${o.id}:${o.exp}`;
    const ev = o.event ? `${o.venue}:${o.event}` : `${o.venue}:${o.feed}:${o.dir}:${o.exp}`;
    if (seen.has(key) || seenEvents.has(ev)) { ladder++; continue; }
    seen.add(key); seenEvents.add(ev);    // one observation per market, ever:
    open.push(o); added++;                // re-pricing later would let us pick
  }                                       // the entry that flatters the score
  if (ladder) await hincrMany(L.K_DROP, { 'ladder-sibling': ladder });

  const drops = (await hall(L.K_DROP)) || {};
  const dd = {};
  for (const [r, n] of Object.entries({ ...k.drops })) dd[`kalshi:${r}`] = n;
  for (const [r, n] of Object.entries({ ...pm.drops })) dd[`polymarket:${r}`] = n;
  if (Object.keys(dd).length) await hincrMany(L.K_DROP, dd);

  // ---- resolve
  const scores = (await getJSON(L.K_SCORE)) || {};
  const recent = (await getJSON(L.K_RECENT)) || [];
  const still = [];
  let resolved = 0, voided = 0;
  for (const o of open) {
    if (now < o.exp) { still.push(o); continue; }
    const r = await L.outcomeOf(o, now);
    if (r.status === 'wait') { still.push(o); continue; }
    if (r.status === 'void') {
      voided++;
      await hincrMany(L.K_DROP, { [`${o.venue}:void:${r.reason}`]: 1 });
      continue;
    }
    const sc = scores[o.venue] || L.emptyScore();
    L.addScore(sc, o.p, r.hit);
    scores[o.venue] = sc;
    recent.unshift({ v: o.venue, feed: o.feed, strike: o.strike,
      ...(o.strike2 ? { strike2: o.strike2 } : {}), dir: o.dir,
      p: o.p, hit: r.hit, price: r.price, exp: o.exp, at: o.at });
    resolved++;
  }
  await setJSON(L.K_SCORE, scores);
  await setJSON(L.K_RECENT, recent.slice(0, 120));
  await setJSON(L.K_OPEN, still.slice(-L.MAX_OPEN));

  return { added, resolved, voided, ladder, pending: still.length,
    errors: { kalshi: k.error, polymarket: pm.error },
    drops: Object.keys(dd).length ? dd : null, prevDrops: Object.keys(drops).length };
}

module.exports = async (req, res) => {
  const send = (code, body) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.status(code).json(body);
  };
  try {
    const now = Date.now();
    const action = (req.query && req.query.action) || '';
    let ticked = null;
    if (action === 'tick') ticked = await tick(now);
    else {
      // Safety net AND the fallback mechanism. The ledger is normally advanced
      // by whoever runs the public crank — tools/crank.mjs, which anyone may
      // run against this or any mirror. There is deliberately no platform cron
      // behind it: the hosting plan allows two, both already spent on the game
      // and the proof page, and a scoreboard that only advances when WE pay a
      // scheduler is not the kind of scoreboard this one claims to be.
      const last = num(await getJSON('ldg:tick'));
      if (now - last > 6 * 3600e3) ticked = await tick(now);
    }

    const [scores, recent, open, drops, rx] = await Promise.all([
      getJSON(L.K_SCORE), getJSON(L.K_RECENT), getJSON(L.K_OPEN),
      hall(L.K_DROP), hall('ldg:rx'),
    ]);
    const sc = scores || {};

    // RatchetX's own row is built from the same band, from the players'
    // sealed stated probabilities. It is not exempt from anything and it is
    // allowed to lose — the house fleet already does, in public.
    let rxRow = null;
    if (rx && num(rx.n) > 0) {
      const n = num(rx.n), brier = num(rx.sum) / n;
      rxRow = { n, brier: Math.round(brier * 1e4) / 1e4,
        brierIndex: Math.round((1 - Math.sqrt(Math.min(1, brier))) * 100),
        hitRate: Math.round((num(rx.hits) / n) * 1000) / 10,
        bins: Array.from({ length: 10 }, (_, i) => ({ n: num(rx[`b${i}n`]), hits: num(rx[`b${i}h`]) })) };
    }

    const rows = [];
    for (const [id, label] of Object.entries(L.VENUES)) {
      const s = id === 'rx_stated' ? rxRow
              : id === 'rx_crowd'  ? null
              : L.summarise(sc[id]);
      rows.push({ id, label, ...(s || { n: 0, brier: null, brierIndex: null, hitRate: null, bins: null }),
        why: s ? null : (id === 'rx_crowd'
          ? 'the sealed-side split is not scored yet — it ships with the on-chain crank, and it is listed empty rather than quietly omitted'
          : 'no observation in this band has settled yet') });
    }
    rows.sort((a, b) => (a.brier == null) - (b.brier == null) || (a.brier - b.brier));

    send(200, {
      ok: true, v: VERSION, now,
      band: { lo: L.BAND_LO, hi: L.BAND_HI },
      rule: `only questions the venue's own crowd priced between ${L.BAND_LO} and ${L.BAND_HI} at observation — the ones actually in doubt`,
      groundTruth: 'Pyth read off Solana: the first recorded sample published at or after expiry, inside a 15-minute grace window — the identical predicate that settles a shot on this site',
      horizon: { maxHours: L.MAX_HORIZON_MS / 3600e3,
        note: 'oracle samples are retained four days, so the ledger is a short-horizon instrument and says so' },
      kinds: 'a question may be one threshold (above / below) or a RANGE (between two strikes). Both resolve on the same oracle sample; a range is inclusive of both ends.',
      sampling: `one observation per EVENT, not per strike: a venue listing a ladder of strikes for one event is asking one question, and the rung kept is the one closest to a coin flip. A market without a live two-sided book is not scored at all — a last-traded print is not a crowd belief — and a bid/ask spread wider than ${L.MAX_SPREAD} is refused for the same reason.`,
      caveat: 'these venues are NOT asked identical questions — their strikes and expiries never line up. Each is scored on its own questions, restricted to the same difficulty band. The band is the control.',
      scale: 'brier is the mean squared error (lower is better). brierIndex is (1 - sqrt(brier)) * 100 on the Forecasting Research Institute scale: 100 clairvoyant, 50 is what "always say 50%" scores, 0 is confidently wrong.',
      rows,
      pending: (open || []).length,
      excluded: drops || {},
      excludedNote: `every observation we could not read or could not settle is counted here rather than dropped silently. Cumulative since ${L.DROP_SINCE} — these counters are reset whenever the sampling rules change, because a count collected under older rules describes an older instrument.`,
      recent: (recent || []).slice(0, 40),
      reproduce: 'https://github.com/3esign/ratchetx/blob/main/lib/ledger.js',
      ...(ticked ? { ticked } : {}),
    });
  } catch (e) {
    send(500, { ok: false, reason: String((e && e.message) || e).slice(0, 200) });
  }
};
