// node --test test_pre_gap.mjs — makes CONTENT_PINS_ARE_VOID_SWITCHES finding A executable.
// Claim: the bracket message ALWAYS exists whenever the feed has aggregates on both sides of T
// (the predecessor chain is continuous, so exactly one edge crosses T, however long that edge is),
// it is ALWAYS unique for any max_pre_target_gap, and therefore a tight gap bound can only DELETE
// the sole admissible message — it can never select a different one. A gap bound is liveness, never safety.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pythnetStream, mulberry32 } from './model.mjs';
import { bracket } from './strict_predecessor.mjs';

const FEED = 'ef0d8b6f-sol';
const T0 = 1_788_576_000;
/** Drop aggregates and re-link the chain, exactly as Pythnet would if it skipped a publish. */
function withSkips(stream, dropFn) {
  const kept = stream.filter((m, i) => !dropFn(m, i));
  let prev = kept.length ? kept[0].prev_publish_time : 0;
  return kept.map((m, i) => { const out = { ...m, prev_publish_time: i === 0 ? prev : kept[i - 1].publish_time }; return out; });
}
const base = () => pythnetStream({ feed_id: FEED, from_ts: T0 - 30, to_ts: T0 + 600, rng: mulberry32(4) });

test('G1 with no skips the bracket message exists and is unique for every target, and pre_gap is always exactly 1', () => {
  const s = base();
  for (let T = T0; T <= T0 + 500; T++) {
    const hits = s.filter(m => bracket(m, T));
    assert.equal(hits.length, 1);
    assert.equal(T - hits[0].prev_publish_time, 1);
  }
});

test('G2 a skipped aggregate does NOT remove the bracket message — the crossing edge just gets longer, and it stays unique', () => {
  const s = withSkips(base(), m => m.publish_time % 7 === 0);        // Pythnet misses every 7th second
  for (let T = T0 + 10; T <= T0 + 500; T++) {
    const hits = s.filter(m => bracket(m, T));
    assert.equal(hits.length, 1, `T=${T} should still have exactly one bracket message`);
  }
});

test('G3 THE FINDING: with max_pre_target_gap = 1 a single skip VOIDS the target, while >= 2 settles it — same data, same rule, only the pin differs', () => {
  const s = withSkips(base(), m => m.publish_time % 7 === 0);
  const admissible = (T, maxGap) => {
    const m = s.find(x => bracket(x, T));
    return m && (T - m.prev_publish_time) <= maxGap ? m : null;
  };
  let voidedAt1 = 0, settledAt5 = 0, targets = 0;
  for (let T = T0 + 10; T <= T0 + 500; T++) {
    targets++;
    if (!admissible(T, 1)) voidedAt1++;
    if (admissible(T, 5)) settledAt5++;
  }
  assert.ok(voidedAt1 > 0, 'a tight gap bound really does void targets');
  assert.equal(settledAt5, targets, 'a bound of 5 settles every one of them');
  const rate = voidedAt1 / targets;
  console.log(`G3: with one skip every 7 seconds, max_pre_target_gap=1 voids ${voidedAt1}/${targets} targets (${(100 * rate).toFixed(1)}%); max_pre_target_gap=5 voids 0`);
  assert.ok(rate > 0.1);
});

test('G4 raising the bound can never introduce a second admissible message, at any bound, on any stream', () => {
  const rng = mulberry32(9);
  for (const density of [0, 0.1, 0.3, 0.6]) {
    const s = withSkips(base(), () => rng() < density);
    for (const maxGap of [1, 2, 5, 30, 3600]) {
      for (let T = T0 + 20; T <= T0 + 400; T += 3) {
        const hits = s.filter(m => bracket(m, T) && (T - m.prev_publish_time) <= maxGap);
        assert.ok(hits.length <= 1, 'the gap filter is a conjunction with a unique-satisfier predicate');
      }
    }
  }
});

test('G5 the only way to lose the bracket message entirely is to have no aggregate after T at all — i.e. a real Pyth outage, not a skip', () => {
  const s = base().filter(m => m.publish_time <= T0 + 100);          // the feed stops after T0+100
  assert.equal(s.filter(m => bracket(m, T0 + 50)).length, 1);
  assert.equal(s.filter(m => bracket(m, T0 + 150)).length, 0, 'past the last aggregate there is nothing to bracket with');
});
