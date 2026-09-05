// node --test test.mjs   (plain node >= 20, no dependencies)
import test from 'node:test';
import assert from 'node:assert/strict';
import { STATE, compareKey, admissible, openNeed, submit, finalize, expire, minKey, strictBracket,
  pythnetStream, sponsoredStream, mulberry32 } from './fable-model.mjs';

const FEED = 'ef0d8b6f-sol';
const SPEC = Object.freeze({
  feed_id: FEED, target_grid_seconds: 60, min_open_lead_seconds: 30,
  max_post_target_lag_seconds: 30,        // SOL/BTC: measured first print at +2..3 s; ETH would use 120
  challenge_window_seconds: 900,          // absolute: D = T + 900
  min_exponent: -12, max_exponent: 2, max_confidence_bps: 200,
});
const T0 = 1_788_576_000;                 // a minute boundary
const BOUNTY = 50_000;

function world(seed = 7) {
  const global = pythnetStream({ feed_id: FEED, from_ts: T0 - 120, to_ts: T0 + 1000, rng: mulberry32(seed) });
  const sponsored = sponsoredStream(global, { period_s: 5, phase_s: 2 });
  return { global, sponsored };
}
const shuffle = (arr, rng) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const runAll = (msgs, need, who = 'x') => { for (const m of msgs) submit(need, m, who, m.publish_time + 1, SPEC); };

// ---------------------------------------------------------------- measured reality
test('R1 measured reality: a phase-2 sponsored stream never satisfies the strict bracket on any minute target', () => {
  const { sponsored } = world();
  let targets = 0, hits = 0;
  for (let T = T0; T <= T0 + 900; T += 60) {
    targets++;
    const need = { target_ts: T };
    const r = strictBracket(sponsored, SPEC, need);
    if (r && r !== 'AMBIGUOUS') hits++;
  }
  assert.equal(targets, 16);
  assert.equal(hits, 0, 'strict bracket must be 0/16 on a :02-phase stream');
  assert.ok(sponsored.every(m => m.publish_time - m.prev_publish_time === 1), 'publish - prev = 1 like on mainnet');
  assert.ok(sponsored.every(m => m.publish_time % 5 === 2));
});

test('R2 liveness floor: under V3 the same stream settles every minute target on the first print after T (+2 s)', () => {
  const { sponsored } = world();
  for (let T = T0; T <= T0 + 900; T += 60) {
    const need = openNeed(SPEC, T, T - 600);
    runAll(sponsored.filter(m => m.publish_time >= T && m.publish_time <= T + 30), need, 'crank');
    assert.equal(need.state, STATE.CANDIDATE);
    assert.equal(need.winner.message.publish_time - T, 2);
    assert.equal(finalize(need, need.deadline_ts, BOUNTY).ok, true);
    assert.equal(need.state, STATE.FINAL);
    assert.deepEqual(need.payout, { to: 'crank', lamports: BOUNTY, kind: 'WINNING_CAPTURE' });
  }
});

// ---------------------------------------------------------------- the limit
test('L1 the strict-bracket message is the global minimum under key (publish, prev, hash)', () => {
  const { global } = world();
  for (let T = T0; T <= T0 + 900; T += 60) {
    const need = { target_ts: T };
    const sb = strictBracket(global, SPEC, need);
    assert.ok(sb && sb !== 'AMBIGUOUS', 'the global stream always contains exactly one bracket message');
    const mk = minKey(global, SPEC, need);
    assert.equal(mk.hash, sb.hash, 'V3 over ALL messages == strict bracket');
  }
});

test('L2 anyone holding the bracket message can always finish the game at the old rule\'s answer', () => {
  const { global, sponsored } = world();
  const T = T0 + 300;
  const need = openNeed(SPEC, T, T - 600);
  runAll(sponsored.filter(m => m.publish_time >= T && m.publish_time <= T + 30), need, 'crank');   // keyless crank first
  const sb = strictBracket(global, SPEC, { target_ts: T });
  const r = submit(need, sb, 'keyed', T + 500, SPEC);                                                // a keyed party later
  assert.equal(r.replaced, true);
  assert.equal(need.winner.message.hash, sb.hash);
  assert.equal(finalize(need, need.deadline_ts, BOUNTY).ok, true);
  assert.equal(need.payout.to, 'keyed', 'the bounty goes to whoever supplied the winning evidence');
});

// ---------------------------------------------------------------- order independence and monotonicity
test('P1 order independence: any submission order yields the same winner (1000 random permutations)', () => {
  const { global } = world(3);
  const T = T0 + 120;
  const pool = global.filter(m => m.publish_time >= T - 5 && m.publish_time <= T + 40);
  const expected = minKey(pool, SPEC, { target_ts: T });
  const rng = mulberry32(99);
  for (let i = 0; i < 1000; i++) {
    const need = openNeed(SPEC, T, T - 600);
    runAll(shuffle(pool, rng), need, 'p' + i);
    assert.equal(need.winner.message.hash, expected.hash);
  }
});

test('P2 monotonicity: an adversary can never move the winner LATER than what honest submissions alone produce', () => {
  const { global, sponsored } = world(5);
  const rng = mulberry32(2026);
  for (let round = 0; round < 500; round++) {
    const T = T0 + 60 * (1 + Math.floor(rng() * 14));
    const honestSet = sponsored.filter(m => m.publish_time >= T && m.publish_time <= T + 30);
    const advSet = shuffle(global.filter(m => m.publish_time >= T - 3 && m.publish_time <= T + 40), rng).slice(0, 1 + Math.floor(rng() * 6));
    const needH = openNeed(SPEC, T, T - 600); runAll(honestSet, needH, 'honest');
    const needB = openNeed(SPEC, T, T - 600); runAll(shuffle([...honestSet, ...advSet], rng), needB, 'mixed');
    assert.ok(compareKey(needB.winner.message, needH.winner.message) <= 0,
      'adding submissions can only move the winner toward the global minimum');
  }
});

test('P3 withholding is worthless: whatever an adversary withholds, honest submissions still decide, and the adversary\'s only power is to ADD earlier evidence', () => {
  const { global, sponsored } = world(11);
  const T = T0 + 240;
  const honest = sponsored.filter(m => m.publish_time >= T && m.publish_time <= T + 30);
  const advAll = global.filter(m => m.publish_time >= T && m.publish_time <= T + 40);
  // adversary submits nothing: honest result stands
  const n1 = openNeed(SPEC, T, T - 600); runAll(honest, n1, 'h');
  // adversary submits everything it has: result is the global minimum (the strict-bracket message)
  const n2 = openNeed(SPEC, T, T - 600); runAll(honest, n2, 'h'); runAll(advAll, n2, 'a');
  const sb = strictBracket(global, SPEC, { target_ts: T });
  assert.equal(n2.winner.message.hash, sb.hash);
  // and the bound: whatever subset the adversary picks, the winner is between the global min and the honest min
  const rng = mulberry32(5);
  for (let i = 0; i < 300; i++) {
    const n3 = openNeed(SPEC, T, T - 600); runAll(honest, n3, 'h');
    runAll(shuffle(advAll, rng).slice(0, 1 + Math.floor(rng() * advAll.length)), n3, 'a');
    assert.ok(compareKey(sb, n3.winner.message) <= 0 && compareKey(n3.winner.message, n1.winner.message) <= 0);
  }
});

// ---------------------------------------------------------------- Astra's counterexample, closed by the challenge
test('C1 Astra 62/67: prompt capture vs omitted first print — with the challenge the earlier print wins regardless of who moved first', () => {
  const T = T0 + 60;
  const mk = (publish_time, prev, price, tag) => ({ authentic: true, feed_id: FEED, publish_time, prev_publish_time: prev, price, conf: 1000, exponent: -8, hash: tag });
  const m62 = mk(T + 2, T + 1, 90_000_000, 'h62');   // DOWN vs entry 100
  const m67 = mk(T + 7, T + 6, 110_000_000, 'h67');  // UP
  // attacker submits only 67 at T+8, honest challenger replays 62 at T+600
  const need = openNeed(SPEC, T, T - 600);
  assert.equal(submit(need, m67, 'attacker', T + 8, SPEC).accepted, true);
  assert.equal(need.winner.message.hash, 'h67');
  const r = submit(need, m62, 'challenger', T + 600, SPEC);
  assert.equal(r.replaced, true);
  assert.equal(need.winner.message.hash, 'h62');
  // a later print can never displace it
  assert.equal(submit(need, m67, 'attacker', T + 700, SPEC).later, true);
  assert.equal(need.winner.message.hash, 'h62');
  finalize(need, need.deadline_ts, BOUNTY);
  assert.equal(need.payout.to, 'challenger');
});

test('C2 no AMBIGUOUS is reachable: equal key means the same message; same-second different aggregates are ordered by prev then hash (uncontrollable, symmetric)', () => {
  const T = T0 + 120;
  const mk = (publish_time, prev, price, tag) => ({ authentic: true, feed_id: FEED, publish_time, prev_publish_time: prev, price, conf: 1000, exponent: -8, hash: tag });
  const first = mk(T, T - 1, 100_000_000, 'aaa');    // first aggregate of second T (prev < T)
  const second = mk(T, T, 100_400_000, 'zzz');       // later aggregate of the same second
  const third = mk(T, T, 99_600_000, 'mmm');
  assert.ok(compareKey(first, second) < 0 && compareKey(first, third) < 0, 'first-of-second wins by prev');
  assert.ok(compareKey(third, second) < 0, 'among prev-equal messages the hash decides, not the price');
  const need = openNeed(SPEC, T, T - 600);
  submit(need, second, 'a', T + 1, SPEC); submit(need, third, 'b', T + 2, SPEC); submit(need, second, 'a', T + 3, SPEC);
  assert.equal(need.winner.message.hash, 'mmm');
  assert.equal(submit(need, first, 'c', T + 4, SPEC).replaced, true);
  assert.equal(need.winner.message.hash, 'aaa');
});

// ---------------------------------------------------------------- deadlines and terminal discipline
test('D1 deadline is absolute and never extended by a challenge; finalize/expire only after D', () => {
  const T = T0 + 180;
  const { sponsored } = world();
  const need = openNeed(SPEC, T, T - 600);
  assert.equal(need.deadline_ts, T + 900);
  assert.equal(finalize(need, T + 899, BOUNTY).reason, 'WINDOW_OPEN');
  assert.equal(expire(need, T + 899).reason, 'WINDOW_OPEN');
  const late = sponsored.find(m => m.publish_time >= T);
  assert.equal(submit(need, late, 'x', T + 899, SPEC).accepted, true);      // last second is fine
  assert.equal(need.deadline_ts, T + 900, 'a challenge does not move the deadline');
  assert.equal(submit(need, late, 'x', T + 900, SPEC).reason, 'WINDOW_CLOSED');
  assert.equal(expire(need, T + 900).reason, 'HAS_CANDIDATE');
  assert.equal(finalize(need, T + 900, BOUNTY).ok, true);
  assert.equal(finalize(need, T + 901, BOUNTY).reason, 'TERMINAL');
  assert.equal(submit(need, late, 'x', T + 901, SPEC).reason, 'TERMINAL');
});

test('D2 silence: with zero submissions the Need expires exactly once and pays nobody', () => {
  const T = T0 + 240;
  const need = openNeed(SPEC, T, T - 600);
  assert.equal(expire(need, T + 900).ok, true);
  assert.equal(need.state, STATE.EXPIRED);
  assert.equal(need.payout, null);
  assert.equal(expire(need, T + 901).reason, 'TERMINAL');
});

test('D3 admissibility negatives: before target, beyond lag, wrong feed, unauthenticated, bad predecessor, wide confidence, non-positive price', () => {
  const T = T0 + 300;
  const need = openNeed(SPEC, T, T - 600);
  const base = { authentic: true, feed_id: FEED, publish_time: T + 5, prev_publish_time: T + 4, price: 1000, conf: 1, exponent: -8, hash: 'b' };
  const cases = [
    [{ ...base, publish_time: T - 1, prev_publish_time: T - 2 }, 'BEFORE_TARGET'],
    [{ ...base, publish_time: T + 31, prev_publish_time: T + 30 }, 'POST_TARGET_LAG_TOO_LARGE'],
    [{ ...base, feed_id: 'other' }, 'WRONG_FEED'],
    [{ ...base, authentic: false }, 'NOT_AUTHENTIC'],
    [{ ...base, prev_publish_time: T + 6 }, 'BAD_PREDECESSOR'],
    [{ ...base, conf: 21 }, 'CONFIDENCE_TOO_WIDE'],
    [{ ...base, price: 0 }, 'NON_POSITIVE_PRICE'],
    [{ ...base, exponent: 3 }, 'EXPONENT_OUT_OF_BOUNDS'],
  ];
  for (const [m, reason] of cases) assert.equal(submit(need, m, 'x', T + 6, SPEC).reason, reason);
  assert.equal(need.winner, null);
});

test('D4 exactly one bounty per Need, to the winning submitter, and duplicates never earn', () => {
  const T = T0 + 360;
  const { sponsored } = world();
  const need = openNeed(SPEC, T, T - 600);
  const m = sponsored.find(x => x.publish_time >= T);
  submit(need, m, 'first', T + 3, SPEC);
  assert.equal(submit(need, m, 'copycat', T + 4, SPEC).duplicate, true);
  assert.equal(need.winner.submitter, 'first');
  finalize(need, T + 900, BOUNTY);
  assert.equal(need.payout.to, 'first');
});

// ---------------------------------------------------------------- the residual, measured not hidden
test('X1 residual for keyed parties is bounded by the first sponsored print lag: they can only choose among aggregates in [T, first sponsored print)', () => {
  const { global, sponsored } = world(21);
  for (let T = T0 + 60; T <= T0 + 600; T += 60) {
    const firstSponsored = sponsored.find(m => m.publish_time >= T);
    const need = openNeed(SPEC, T, T - 600);
    submit(need, firstSponsored, 'crank', firstSponsored.publish_time + 1, SPEC);
    const choices = global.filter(m => m.publish_time >= T && compareKey(m, firstSponsored) < 0);
    // every choice a keyed party could impose lies inside [T, firstSponsored.publish_time]
    assert.ok(choices.every(m => m.publish_time <= firstSponsored.publish_time));
    assert.ok(firstSponsored.publish_time - T <= 4, 'on a 5 s cadence the keyed option spans at most one push interval');
  }
});
