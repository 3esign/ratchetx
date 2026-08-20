// ============================================================
//  lib/supplylog.js — the supply record.
//
//  WHY THIS EXISTS.
//  $RCX launched on pump.fun, and the thing that makes it different from
//  almost every other launchpad token is not the launch — it is that playing
//  the game destroys the token. Seventy percent of every stake burns. The
//  supply is supposed to fall, forever, as a direct function of how much the
//  game is used.
//
//  A claim like that is worth exactly nothing as a sentence. It is worth
//  something as a CURVE: a daily reading of the mint's own supply field,
//  taken over months, next to the count of burns the game itself caused.
//  One number ("X burned") can be spun. A falling line with the transactions
//  under it cannot.
//
//  So we take one reading a day and keep it. That is the whole file.
//
//  WHAT WE DO NOT DO.
//  We do not compute the burn from our own counters and present it as supply.
//  The supply number here is the mint account's, read off Solana. Our own
//  counter appears beside it as a separate series, precisely so the two can
//  disagree in public if we ever get something wrong.
// ============================================================
const { getJSON, setJSON } = require('./kv.js');

const DAYS_KEY = 'g:sup:days';
const MAX_DAYS = 400;
const MIN_GAP_MS = 10 * 60_000;   // one instance re-reading is fine; ten a minute is not

const dayOf = ts => new Date(ts).toISOString().slice(0, 10);
const gate = globalThis.__ratchet_supgate || (globalThis.__ratchet_supgate = { t: 0 });

/** Record today's supply reading. Best effort: this must never break the page
 *  that called it, and a missed day is a gap in a chart, not a fault. */
async function snap({ supply, playerBurned, incinerated }, now = Date.now()) {
  if (!Number.isFinite(supply) || supply <= 0) return false;
  if (now - gate.t < MIN_GAP_MS) return false;
  gate.t = now;
  try {
    const d = dayOf(now);
    const key = `sup:${d}`;
    const prev = await getJSON(key);
    // first reading of the day is kept forever; later ones only update `last`,
    // so a day's delta is (first of next day) - (first of this day) and never
    // depends on what time of day a serverless instance happened to wake.
    const row = prev
      ? { ...prev, last: supply, lastT: now, playerBurned, incinerated }
      : { d, first: supply, firstT: now, last: supply, lastT: now, playerBurned, incinerated };
    await setJSON(key, row);
    if (!prev) {
      const days = (await getJSON(DAYS_KEY)) || [];
      if (!days.includes(d)) {
        days.push(d); days.sort();
        await setJSON(DAYS_KEY, days.slice(-MAX_DAYS));
      }
    }
    return true;
  } catch {
    gate.t = now - MIN_GAP_MS + 60_000;
    return false;
  }
}

/** The curve, oldest first. Each row carries the day's own destruction so a
 *  reader can see the rate, not just the level. */
async function series(days = 90) {
  const all = (await getJSON(DAYS_KEY)) || [];
  const want = all.slice(-Math.max(1, Math.min(MAX_DAYS, days)));
  const rows = [];
  for (const d of want) {
    const r = await getJSON(`sup:${d}`);
    if (r && Number.isFinite(r.first)) rows.push(r);
  }
  rows.sort((a, b) => (a.d < b.d ? -1 : 1));
  // A day's burn is measured against the NEXT day's opening reading where we
  // have one, so a partial day at the end is never drawn as a collapse.
  return rows.map((r, i) => {
    const nxt = rows[i + 1];
    const end = nxt ? nxt.first : r.last;
    return { d: r.d, supply: r.first, close: end,
      burned: Math.max(0, r.first - end),
      playerBurned: Number.isFinite(r.playerBurned) ? r.playerBurned : null,
      partial: !nxt };
  });
}

module.exports = { snap, series, dayOf, DAYS_KEY };
