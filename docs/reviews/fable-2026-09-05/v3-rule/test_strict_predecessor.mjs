// node --test test_strict_predecessor.mjs — STRICT_PREDECESSOR_ONLY with terminal policies A / B / C1 / C2 (Sol 04:09Z)
import test from 'node:test';
import assert from 'node:assert/strict';
import { pythnetStream, sponsoredStream, mulberry32 } from './model.mjs';
import { POLICY, STATE, bracket, openSPO, submitSPO, expireSPO, silenceOption, terminalOf } from './strict_predecessor.mjs';

const FEED = 'ef0d8b6f-sol';
const T0 = 1_788_576_000;
const SPEC = { feed_id: FEED, max_post_target_lag_seconds: 30, window_seconds: 120, min_exponent: -12, max_exponent: 2, max_confidence_bps: 200 };
const world = (seed = 7) => {
  const global = pythnetStream({ feed_id: FEED, from_ts: T0 - 120, to_ts: T0 + 1900, rng: mulberry32(seed) });
  return { global, sponsored: sponsoredStream(global, { period_s: 5, phase_s: 2 }) };
};

test('S1 SAFETY is absolute: exactly one bracket print per target; every later print and every earlier print is rejected; the first submission is final at once', () => {
  const { global } = world();
  for (let T = T0; T < T0 + 1800; T += 60) {
    const b = global.filter(m => bracket(m, T));
    assert.equal(b.length, 1);
    for (const policy of Object.values(POLICY)) {
      const need = openSPO(SPEC, T, policy);
      for (const m of global.filter(m => m.publish_time >= T - 5 && m.publish_time <= T + 30 && m !== b[0])) {
        const r = submitSPO(need, m, 'x', T + 3, SPEC);
        assert.equal(r.accepted, false); assert.ok(['NOT_BRACKET', 'BEFORE_TARGET'].includes(r.reason), r.reason);
      }
      assert.equal(submitSPO(need, b[0], 'y', T + 3, SPEC).final, true);
      assert.equal(need.state, STATE.FINAL);
      assert.equal(submitSPO(need, global.find(m => m.publish_time === T + 1), 'z', T + 4, SPEC).reason, 'TERMINAL');
    }
  }
});

test('S2 the bracket print is on the sponsored PDA on a minority of minute targets (phase drift), and only for one post life: unkeyed liveness is rare', () => {
  let onPda = 0, targets = 0;
  for (const phase of [0, 1, 2, 3, 4]) {
    const { global, sponsored } = world(3);
    const sp = sponsoredStream(global, { period_s: 5, phase_s: phase });
    for (let T = T0; T < T0 + 1800; T += 60) { targets++; if (sp.some(m => bracket(m, T))) onPda++; }
  }
  console.log(`S2: bracket print posted by the sponsor on ${onPda}/${targets} minute targets across the 5 phases (= 1/5 on average; 0/25 measured tonight at phase 2)`);
  assert.equal(onPda, targets / 5);
});

test('S3 emission gap: when the bracket print is in no root, NO evidence can ever exist; the Need is decided by the terminal policy alone', () => {
  const { global } = world(11);
  const T = T0 + 300;
  const b = global.find(m => bracket(m, T));
  const E = global.filter(m => m !== b);                                   // never emitted
  for (const policy of Object.values(POLICY)) {
    const need = openSPO(SPEC, T, policy);
    for (const m of E.filter(m => m.publish_time >= T && m.publish_time <= T + 30)) assert.equal(submitSPO(need, m, 'anyone', T + 5, SPEC).accepted, false);
    if (policy === POLICY.A) { assert.equal(expireSPO(need, T + 1e9).reason, 'WINDOW_OPEN'); assert.equal(need.state, STATE.OPEN); }   // locked forever
    else { assert.equal(expireSPO(need, T + 119).reason, 'WINDOW_OPEN'); assert.equal(expireSPO(need, T + 120).state, terminalOf(policy)); }
  }
});

test('S4 who profits from silence — the option value of withholding for an exclusive holder, per policy and role (printed as the matrix Sol asked for)', () => {
  const shot = { gain: 700, lose: 1000 };          // player: stake 1000, hit pays 1700 (17/10); house mirror: gain 1000, lose 700
  const house = { gain: 1000, lose: 700 };
  const rows = [];
  for (const policy of Object.values(POLICY)) {
    for (const [role, s] of [['player-holder', shot], ['house-holder', house]]) {
      for (const outcome of ['WIN', 'LOSE']) {
        const r = silenceOption(policy, role === 'house-holder' && policy === POLICY.C1 ? 'poster' : 'holder', outcome, s);
        rows.push({ policy, role, outcome, submit: r.submit, withhold: r.withhold, option: r.option });
      }
    }
  }
  console.table(rows);
  const opt = (p, role, o) => rows.find(r => r.policy === p && r.role === role && r.outcome === o).option;
  // A: an EXCLUSIVE holder who would lose gains its whole loss by never submitting — "forever" is a refund in effect plus a lock on the
  //    counterparty's capital; A removes the option only if the print is obtainable by someone else (public archive / keyed crank)
  assert.equal(opt('A', 'player-holder', 'LOSE'), 1000); assert.equal(opt('A', 'house-holder', 'LOSE'), 700);
  // B: the losing side gains its whole loss by silence — refund is a free option for whoever holds the print exclusively
  assert.equal(opt('B', 'player-holder', 'LOSE'), 1000); assert.equal(opt('B', 'house-holder', 'LOSE'), 700);
  // C1: the poster (house) never gains by silence (charged as if it lost) — submitting is dominant for the poster;
  //     a PLAYER who is the exclusive holder gains 1700 by silence, i.e. C1 is incentive-compatible ONLY if the poster obtains the
  //     print on its own (H1 on the poster), never if the poster depends on players or on the sponsored PDA
  assert.equal(opt('C1', 'house-holder', 'LOSE'), 0); assert.equal(opt('C1', 'house-holder', 'WIN'), 0);
  assert.equal(opt('C1', 'player-holder', 'LOSE'), 1700);
  // C2: the loser is indifferent (loses either way), the winner strictly prefers to post — liveness comes from the winner, silence never pays
  assert.equal(opt('C2', 'player-holder', 'LOSE'), 0); assert.equal(opt('C2', 'player-holder', 'WIN'), 0);
});

test('S5 C1 is incentive-compatible only if the poster can obtain the print: the poster is charged for Pyth emission gaps and for its own misses alike', () => {
  const { global } = world(5);
  let charged = 0, settled = 0;
  for (let T = T0; T < T0 + 1800; T += 60) {
    const need = openSPO(SPEC, T, POLICY.C1);
    const b = global.find(m => bracket(m, T));
    const emitted = (T / 60) % 10 !== 0;           // model: one target in ten has its bracket print unemitted
    if (emitted) { submitSPO(need, b, 'poster', T + 20, SPEC); settled++; } else { expireSPO(need, T + 120); charged++; }
    assert.ok(need.state === STATE.FINAL || need.state === STATE.BOND_LOSS);
  }
  console.log(`S5: poster settled ${settled}, charged ${charged} — the bond pays for every gap whatever its cause; P(gap) must be measured from Pyth history before C1 is priced`);
  assert.equal(settled + charged, 30);
});
