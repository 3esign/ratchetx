// The Warden is the house's own stated probability, on the front page, with a
// public record. The version this replaced emitted one of three constants
// forever and went 6-for-30. These tests exist so that never silently returns.
import assert from 'node:assert';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

let fails = 0;
const ok = (c, n) => { console.log((c ? 'PASS  ' : 'FAIL  ') + n); if (!c) fails++; };

// ---- 1. THE OLD MODEL REALLY WAS A CONSTANT ----
{
  const TH = { SOL: 0.0075, BTC: 0.0045, ETH: 0.0065 };
  const old = (pct, feed, mins) => {
    const zed = pct / (TH[feed] * Math.sqrt(mins / 60));
    return Math.round(100 / (1 + Math.exp(1.7 * zed)));
  };
  const ps = [old(0.006,'SOL',360), old(0.004,'BTC',360), old(0.008,'ETH',720)];
  ok(ps.every(p => p < 50), `every old value leaned the same way: ${ps.join(', ')}`);
  ok(new Set(ps).size <= 2, 'and there were only ever two distinct numbers');
}

// ---- 2. MEASURED VOLATILITY MOVES THE PROBABILITY ----
// The whole point: the same question in a calm market and a violent one must
// not produce the same number.
{
  for (const k of Object.keys(require.cache)) delete require.cache[k];
  globalThis.__ratchet_mem = new Map();
  const kv = require('../lib/kv.js');
  const { bucketKey } = require('../lib/pxlog.js');
  const vol = require('../lib/vol.js');

  const seed = async (feed, movePct) => {
    const now = Date.now(), by = {};
    let px = 100;
    for (let i = 200; i >= 0; i--) {
      const t = now - i * 60_000;
      px *= (1 + (i % 2 ? movePct : -movePct));
      (by[bucketKey(t)] ||= []).push({ t, src: 'pyth-onchain', [feed]: px });
    }
    for (const [k2, v] of Object.entries(by)) await kv.setJSONEx(k2, v.sort((a,b)=>a.t-b.t), 9999);
  };

  await seed('SOL', 0.0002);                    // calm
  const calm = await vol.realisedVol('SOL', 24);
  globalThis.__ratchet_mem = new Map();
  await seed('BTC', 0.004);                     // violent, 20x the moves
  const wild = await vol.realisedVol('BTC', 24);

  ok(calm.ok && wild.ok, 'volatility measured in both regimes');
  ok(wild.sigmaPerRootMs > calm.sigmaPerRootMs * 5,
    `the violent market measures much higher vol (${wild.hourlyPct.toFixed(2)}%/h vs ${calm.hourlyPct.toFixed(3)}%/h)`);

  const win = 6 * 3600e3;
  const pCalm = vol.probAbove(100, 100 * 1.006, vol.sigmaOver(calm, win));
  const pWild = vol.probAbove(100, 100 * 1.006, vol.sigmaOver(wild, win));
  ok(Math.abs(pCalm - pWild) > 0.15,
    `the SAME question gets different answers: ${(pCalm*100).toFixed(0)}% calm vs ${(pWild*100).toFixed(0)}% volatile`);
  ok(pWild > pCalm, 'and a more volatile market makes a distant line MORE reachable');
  ok(pCalm < 0.5 && pCalm > 0, 'a line above spot in a calm market is unlikely but not impossible');
}

// ---- 3. IT MUST BE ABLE TO LEAN BOTH WAYS ----
// The old one never could, which is why its record was so lopsided.
{
  const vol = require('../lib/vol.js');
  const sig = 0.02;
  const above = vol.probAbove(100, 100 * 1.006, sig);   // line above spot
  const below = vol.probAbove(100, 100 * 0.995, sig);   // line below spot
  ok(above < 0.5, `a line above spot reads under 50% (${(above*100).toFixed(0)}%)`);
  ok(below > 0.5, `a line below spot reads over 50% (${(below*100).toFixed(0)}%)`);

  const game = require('fs').readFileSync('../api/game.js', 'utf8');
  const pool = game.slice(game.indexOf('const WPOOL'), game.indexOf('const VOL_LOOKBACK_H'));
  const pcts = [...pool.matchAll(/pct:\s*(-?[\d.]+)/g)].map(m => Number(m[1]));
  ok(pcts.some(p => p > 0) && pcts.some(p => p < 0),
    `the rotation includes lines both above and below spot (${pcts.join(', ')})`);
}

// ---- 4. IT DECLINES RATHER THAN INVENTS ----
{
  for (const k of Object.keys(require.cache)) delete require.cache[k];
  globalThis.__ratchet_mem = new Map();
  const vol = require('../lib/vol.js');
  const v = await vol.realisedVol('SOL', 24);
  ok(v.ok === false, 'with no price history there is no estimate');
  ok(/need/.test(v.reason), `and a stated reason: "${v.reason}"`);
  ok(vol.probAbove(100, 101, 0) === null, 'zero volatility yields null, not a divide-by-zero');
  ok(vol.probAbove(0, 101, 0.02) === null, 'and a zero spot yields null');
}

// ---- 5. THE QUESTION MUST MATCH THE SETTLEMENT ----
// It used to ask "trades above $X WITHIN 6 hours" (a touch) and settle on the
// price at expiry (terminal). Touching is strictly easier, so it was graded on
// a harder event than the one it was asked.
{
  const game = require('fs').readFileSync('../api/game.js', 'utf8');
  const wl = game.slice(game.indexOf('async function wardenLine'), game.indexOf('async function wardenTick'));
  ok(/at the \$\{c\.mins \/ 60\}-hour mark/.test(wl), 'the question is now terminal, not a touch');
  ok(!/within \$\{c\.mins/.test(wl), 'and the "within N hours" wording is gone');
  ok(/const outcome = px > s\.thresh/.test(game), 'settlement still compares the price at expiry');
}

// ---- 6. it publishes the inputs, so the number is checkable ----
{
  const game = require('fs').readFileSync('../api/game.js', 'utf8');
  const wl = game.slice(game.indexOf('async function wardenLine'), game.indexOf('async function wardenTick'));
  for (const field of ['sigmaPct', 'volHourlyPct', 'volPairs'])
    ok(wl.includes(field), `the line publishes ${field} so the probability can be recomputed`);
  ok(/backward-looking volatility/.test(wl), 'and states the weakness of its own estimate');
  ok(!/typical realised volatility/.test(wl),
    'the old claim about "typical realised volatility" — which measured nothing — is gone');
}

console.log(fails ? `\n${fails} FAILED` : '\nWARDEN OK');
process.exit(fails ? 1 : 0);
