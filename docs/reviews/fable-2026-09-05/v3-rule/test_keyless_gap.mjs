// node --test test_keyless_gap.mjs — the keyless incentive/gap claims, made falsifiable (Sol 04:41Z)
import test from 'node:test';
import assert from 'node:assert/strict';
import { pythnetStream, mulberry32 } from './model.mjs';
import { POLICY, STATE, bracket } from './strict_predecessor.mjs';
import { silenceProbability, play, decisiveChoiceExists, gapBearer } from './keyless_gap.mjs';

const FEED = 'ef0d8b6f-sol';
const T0 = 1_788_576_000;
const SPEC = { feed_id: FEED, max_post_target_lag_seconds: 30, window_seconds: 120, min_exponent: -12, max_exponent: 2, max_confidence_bps: 200 };
const stream = pythnetStream({ feed_id: FEED, from_ts: T0 - 60, to_ts: T0 + 600, rng: mulberry32(7) });
const msgFor = T => stream.find(m => bracket(m, T));
const crew = (n, opts = {}) => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, fails: false, withholds: false, ...opts }));

test('K1 G1 needs unanimity: the unsettled probability is q^n, strictly decreasing in n', () => {
  const q = 0.05;
  const p1 = silenceProbability(1, q), p2 = silenceProbability(2, q), p3 = silenceProbability(3, q);
  assert.ok(p1 > p2 && p2 > p3);
  assert.ok(Math.abs(p2 - 0.0025) < 1e-12, 'two independent cranks at q=0.05 leave 2.5e-3');
  assert.ok(silenceProbability(4, q) < 1e-5);
  assert.equal(silenceProbability(3, 0), 0);
});

test('K2 NO CHOOSER: no single party has a decisive choice while any other party can post', () => {
  for (let T = T0; T < T0 + 300; T += 60) {
    const base = { spec: SPEC, target_ts: T, policy: POLICY.B, posters: crew(3), emitted: true, bracketMessage: msgFor(T) };
    assert.equal(decisiveChoiceExists(base), null, `a party could move the outcome at T=${T}`);
    // and an adversary withholding only changes WHO pays the fee, never the price
    const honest = play(base);
    const withAdversary = play({ ...base, posters: [{ id: 'adv', fails: false, withholds: true }, ...crew(2)] });
    assert.equal(withAdversary.state, STATE.FINAL);
    assert.equal(withAdversary.price, honest.price);
    assert.notEqual(withAdversary.poster, 'adv');
  }
});

test('K3 the last honest party still settles it: only UNANIMOUS silence leaves the Need open, and that is G1 not G2', () => {
  const T = T0 + 120;
  const base = { spec: SPEC, target_ts: T, policy: POLICY.B, emitted: true, bracketMessage: msgFor(T) };
  const oneAlive = play({ ...base, posters: [...crew(3, { withholds: true }), { id: 'last', fails: false, withholds: false }] });
  assert.equal(oneAlive.state, STATE.FINAL);
  assert.equal(oneAlive.poster, 'last');
  const allSilent = play({ ...base, posters: crew(4, { withholds: true }) });
  assert.equal(allSilent.state, STATE.VOID);
  assert.equal(allSilent.cause, 'G1');
});

test('K4 G2 is untouchable by incentives: with the leaf unemitted, no crew size and no policy produces a settlement', () => {
  const T = T0 + 180;
  for (const policy of Object.values(POLICY)) {
    for (const n of [1, 2, 5, 50]) {
      const r = play({ spec: SPEC, target_ts: T, policy, posters: crew(n), emitted: false, bracketMessage: msgFor(T) });
      assert.notEqual(r.state, STATE.FINAL);
      assert.equal(r.cause, 'G2');
      assert.equal(r.price, null);
    }
  }
});

test('K5 the two causes are indistinguishable on-chain, so the terminal policy is an ALLOCATION of the gap, and each policy names a different bearer', () => {
  const T = T0 + 240;
  const g1 = play({ spec: SPEC, target_ts: T, policy: POLICY.B, posters: crew(3, { withholds: true }), emitted: true, bracketMessage: msgFor(T) });
  const g2 = play({ spec: SPEC, target_ts: T, policy: POLICY.B, posters: crew(3), emitted: false, bracketMessage: msgFor(T) });
  assert.equal(g1.state, g2.state, 'the chain sees the same terminal state for both causes');
  assert.notEqual(g1.cause, g2.cause, 'but the causes differ, and only measurement can tell them apart');
  const bearers = new Set(Object.values(POLICY).map(gapBearer));
  assert.equal(bearers.size, 4, 'each policy allocates the gap to a different party');
  assert.match(gapBearer(POLICY.B), /nobody/);
  assert.match(gapBearer(POLICY.C1), /poster/);
});

test('K6 accidents compose with silence exactly as q^n predicts: simulated failure rates track the closed form', () => {
  const T = T0 + 300, rng = mulberry32(99), q = 0.3, n = 3, N = 20000;
  let unsettled = 0;
  for (let i = 0; i < N; i++) {
    const posters = Array.from({ length: n }, (_, k) => ({ id: 'p' + k, fails: rng() < q, withholds: false }));
    if (play({ spec: SPEC, target_ts: T, policy: POLICY.B, posters, emitted: true, bracketMessage: msgFor(T) }).state !== STATE.FINAL) unsettled++;
  }
  const observed = unsettled / N, expected = silenceProbability(n, q);
  assert.ok(Math.abs(observed - expected) < 0.005, `observed ${observed} vs expected ${expected}`);
});
