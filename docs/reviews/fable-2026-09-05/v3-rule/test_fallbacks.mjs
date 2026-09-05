// node --test test_fallbacks.mjs — executable companion to PAYOUT_DETERMINISM_LEGACY_PYTH.md
// L1  Lemma 2: emission is indistinguishable from the verifiable statements about any other message
// T2  the trichotomy on the measured world: (a) strict bracket refunds, (b) adapters 2/3 have a decisive chooser, (c) EMA is choice-invariant
// F1  bonded poster + audit: a challenge exists iff the settled winner is not min E (sound and complete)
// F2  EMA-settled: the EMA spread across any choice set is below half the strike grid; flips are counted, not hidden
// F3  posted-print: the first write after T is a ledger fact; a capture reproduces it iff it lands in that write's life, else the next post
import test from 'node:test';
import assert from 'node:assert/strict';
import { pythnetStream, sponsoredStream, mulberry32, strictBracket, compareKey, admissible, openNeed, submit, finalize } from './model.mjs';
import { rootsFrom } from './adapter4.mjs';

const FEED = 'ef0d8b6f-sol', OTHER = '2f95862b-eth';
const T0 = 1_788_576_000;                                   // a minute boundary (T0 % 60 === 0)
const SPEC = { feed_id: FEED, max_post_target_lag_seconds: 120, window_seconds: 120, min_exponent: -12, max_exponent: 2, max_confidence_bps: 200 };
const LAG30 = { ...SPEC, max_post_target_lag_seconds: 30, target_grid_seconds: 60, min_open_lead_seconds: 30, challenge_window_seconds: 120 };

/** Pyth-style EMA over the 1 Hz stream: 5921-slot window on Pythnet, modelled as alpha = 2/(5921+1) per aggregate (approximation, stated). */
function withEma(stream) {
  const alpha = 2 / 5922; let ema = stream[0].price;
  return stream.map(m => { ema = ema + alpha * (m.price - ema); return { ...m, ema_price: Math.round(ema) }; });
}
function world(seed = 7, from = T0 - 7200, to = T0 + 1800) {
  const global = withEma(pythnetStream({ feed_id: FEED, from_ts: from, to_ts: to, rng: mulberry32(seed) }));
  const other = pythnetStream({ feed_id: OTHER, from_ts: from, to_ts: to, rng: mulberry32(seed + 100) });
  const sponsored = sponsoredStream(global, { period_s: 5, phase_s: 2 });
  return { global, other, sponsored };
}
/** Everything a verifier can state about m from V1..V3: its fields, its root's public payload, its membership, the previous root's payload. */
function verifiable(m, roots) {
  const r = [...roots.values()].find(x => x.timestamp === m.publish_time && x.leaves.has(m.hash));
  const p = r && roots.get(r.seq - 1);
  return JSON.stringify({ fields: { ...m }, root: r && { seq: r.seq, timestamp: r.timestamp }, member: !!r, prev_root: p && { seq: p.seq, timestamp: p.timestamp } });
}

test('L1 Lemma 2: removing U1 (the bracket message) from every root leaves every verifiable statement about U2 identical; min E differs', () => {
  const { global, other } = world();
  const T = T0 + 60;
  const U1 = global.find(m => m.publish_time === T), U2 = global.find(m => m.publish_time === T + 1);
  assert.ok(U1.prev_publish_time < T && T <= U1.publish_time, 'U1 is the bracket message');
  const W1 = rootsFrom(new Map([[FEED, global], [OTHER, other]]));
  const W2 = rootsFrom(new Map([[FEED, global.filter(m => m !== U1)], [OTHER, other]]));   // U1 never emitted; the slot-T root still exists (other feeds)
  assert.equal(verifiable(U2, W1), verifiable(U2, W2), 'no verifier predicate on U2 can tell the two worlds apart');
  const E1 = global.filter(m => m.publish_time >= T), E2 = E1.filter(m => m !== U1);
  assert.equal(E1.sort(compareKey)[0].hash, U1.hash);
  assert.equal(E2.sort(compareKey)[0].hash, U2.hash);
  assert.ok(U2.prev_publish_time >= T, 'min E in W2 carries no predecessor certificate: prev >= T');
  // and ROOT_SUCCESSOR is answered by the root layer only through completeness, which is not in V (Sol 03:54Z NO-GO)
  const rT = [...W2.values()].find(x => x.timestamp === T);
  assert.ok(rT && !rT.leaves.has(U1.hash), 'the slot-T root exists in W2 and simply lacks the leaf; nothing in its payload says so');
});

test('T2(a) strict bracket under sponsored delivery refunds on every minute target (0 admissible of 30)', () => {
  const { sponsored } = world();
  let admissibleCount = 0;
  for (let T = T0; T < T0 + 1800; T += 60) {
    const need = { target_ts: T };
    const hit = sponsored.find(m => m.prev_publish_time < T && T <= m.publish_time && admissible(m, LAG30, need).ok);
    if (hit) admissibleCount++;
  }
  assert.equal(admissibleCount, 0);
});

test('T2(b) adapter 3: a keyed holder has a decisive choice; adapter 2: a capturer (timing) and the sponsor (selection) each have one', () => {
  const { global, sponsored } = world(21);
  const T = T0 + 240;
  const P = sponsored.find(m => m.publish_time >= T), Q = global.find(m => m.publish_time === T + 1);
  // adapter 3 (model.mjs submit): submit-or-withhold Q
  const a = openNeed(LAG30, T, T - 60); submit(a, P, 'crank', T + 3, LAG30);
  const b = openNeed(LAG30, T, T - 60); submit(b, P, 'crank', T + 3, LAG30); submit(b, Q, 'keyed', T + 50, LAG30);
  assert.notEqual(finalize(a, T + 120, 0).winner.price, finalize(b, T + 120, 0).winner.price);
  // adapter 2: capture landing at T+3 reads post T+2; landing at T+8 reads post T+7
  const live = t => sponsored.filter(m => m.publish_time <= t).at(-1);
  assert.notEqual(live(T + 3).price, live(T + 8).price);
  // sponsor: posting phase 2 vs phase 3 gives different first-after-T prints
  const alt = sponsoredStream(global, { period_s: 5, phase_s: 3 }).find(m => m.publish_time >= T);
  assert.notEqual(P.price, alt.price);
});

test('T2(c)/F2 EMA-settled: across every 52-second choice set the EMA spread is below half a 0.1% strike grid; strike crossings are counted and printed', () => {
  const { global } = world(9);
  const GRID = 0.001; let maxSpreadBps = 0, crossings = 0, targets = 0;
  const rng = mulberry32(5);
  for (let T = T0; T < T0 + 1800; T += 3) {
    const set = global.filter(m => m.publish_time >= T && m.publish_time < T + 52);
    const emas = set.map(m => m.ema_price), lo = Math.min(...emas), hi = Math.max(...emas);
    const spread = (hi - lo) / lo; maxSpreadBps = Math.max(maxSpreadBps, spread * 1e4);
    assert.ok(spread < GRID / 2, `spread ${spread} exceeds half grid at T=${T}`);
    const ref = set[0].ema_price;
    const strike = Math.round(ref * (1 + (Math.floor(rng() * 21) - 10) * GRID));   // a strike on the grid within ±1% of the EMA
    if (strike >= lo && strike <= hi) crossings++;
    targets++;
  }
  console.log(`F2: max EMA spread over a 52 s choice set = ${maxSpreadBps.toFixed(3)} bps; strike inside the spread on ${crossings}/${targets} targets (these are the only targets a chooser can move, and only by <= the spread)`);
  assert.ok(crossings < targets * 0.2);
});

test('F1 bonded poster + audit: a challenge exists iff the settled winner is not min E; an honest poster is never slashed', () => {
  const { global, sponsored } = world(13);
  const archive = global;                                                   // what any full-stream auditor holds
  let audited = 0, honest = 0;
  for (let T = T0; T < T0 + 600; T += 60) {
    const minE = archive.filter(m => m.publish_time >= T).sort(compareKey)[0];
    const P = sponsored.find(m => m.publish_time >= T);
    // world 1: poster submits min E (honest) — no challenge possible
    const n1 = openNeed(LAG30, T, T - 60); submit(n1, P, 'crank', T + 3, LAG30); submit(n1, minE, 'poster', T + 10, LAG30);
    const w1 = finalize(n1, T + 120, 0).winner;
    const challenge1 = archive.find(m => admissible(m, LAG30, n1).ok && compareKey(m, w1) < 0);
    assert.equal(w1.hash, minE.hash); assert.equal(challenge1, undefined); honest++;
    // world 2: poster withholds — the settled print is P and the auditor finds the earlier print
    const n2 = openNeed(LAG30, T, T - 60); submit(n2, P, 'crank', T + 3, LAG30);
    const w2 = finalize(n2, T + 120, 0).winner;
    const challenge2 = archive.find(m => admissible(m, LAG30, n2).ok && compareKey(m, w2) < 0);
    assert.ok(challenge2, 'deviation is provable from the archive'); assert.equal(challenge2.hash, minE.hash); audited++;
  }
  assert.equal(honest, 10); assert.equal(audited, 10);
});

test('F3 posted-print: the first write after T is a ledger fact; a capture reproduces it iff it lands in that write\'s life, otherwise the next post — never a price outside the posted set', () => {
  const { global, sponsored } = world(17);
  const rng = mulberry32(3);
  let hits = 0, misses = 0;
  for (let T = T0; T < T0 + 1800; T += 60) {
    const firstWrite = sponsored.find(m => m.publish_time >= T);           // the ledger fact (sponsor-only writes)
    const posted = new Set(sponsored.map(m => m.hash));
    for (let k = 0; k < 20; k++) {
      const land = T + 1 + Math.floor(rng() * 12);                         // capture lands 1..12 s after T
      const seen = sponsored.filter(m => m.publish_time <= land).at(-1);
      assert.ok(posted.has(seen.hash));
      if (land < firstWrite.publish_time) continue;                        // landed before any post-T write: sees a pre-T post, inadmissible, retried
      if (land < firstWrite.publish_time + 5) { assert.equal(seen.hash, firstWrite.hash); hits++; }
      else { assert.ok(seen.publish_time >= firstWrite.publish_time + 5, 'a late capture sees a later post, never an earlier or unposted print'); misses++; }
    }
    // a keyed racer that lands an authentic earlier print before the sponsor changes the ledger fact by <= 2 s and only toward T
    const Q = global.find(m => m.publish_time === T);
    assert.ok(Q && Q.publish_time < firstWrite.publish_time && firstWrite.publish_time - Q.publish_time <= 2);
  }
  console.log(`F3: ${hits} captures reproduced the first write, ${misses} resolved to the next post (timing), 0 to any other price`);
  assert.ok(hits > 0 && misses > 0);
});
