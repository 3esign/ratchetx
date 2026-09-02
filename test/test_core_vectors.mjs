// Golden vectors: the Core v1 program (Rust) and the server (JS) must give one
// answer for every rule. `onchain/ratchet-core/vectors/core-rules-v1.json` is
// printed by the program's own test
// (`cargo test print_golden_vectors -- --ignored --nocapture` in
// onchain/ratchet-core); this file checks lib/core_rules.js against it, checks
// that api/game.js actually routes XP and payout through lib/core_rules.js,
// and that the v3 commit preimage hashes the same in Node.
import assert from 'node:assert';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { test } from 'node:test';
const require = createRequire(import.meta.url);
const R = require('../lib/core_rules.js');
const V = JSON.parse(fs.readFileSync(new URL('../onchain/ratchet-core/vectors/core-rules-v1.json', import.meta.url), 'utf8'));

test('vectors were printed by the frozen program id', () => {
  assert.equal(V.program, '6sJn9CfSwD3Jt8V6vYyHq5hYmLKdDmaTgqwHY5czpPBv');
});

test('constants match the program', () => {
  assert.deepEqual([V.stake.min, V.stake.max, V.stake.xpCapStake], [R.STAKE_MIN, R.STAKE_MAX, R.XP_CAP_STAKE]);
  assert.deepEqual(V.hitPayout, [R.HIT_PAYOUT_NUM, R.HIT_PAYOUT_DEN]);
  assert.equal(V.settleXp, R.SETTLE_XP);
  assert.deepEqual(V.rankXp, R.RANK_XP);
  assert.equal(V.maxConfBps, R.MAX_CONF_BPS);
  assert.equal(V.settleDeadlineSecs, R.SETTLE_DEADLINE_SECS);
  assert.equal(V.revealDeadlineSecs, R.REVEAL_DEADLINE_SECS);
  assert.equal(V.burnPerMille, R.BURN_PER_MILLE);
  assert.deepEqual(V.podiumPerMille, R.PODIUM_PER_MILLE);
  assert.deepEqual(V.horizons.map(h => [h.minutes, h.baseXp]), R.HORIZONS);
  for (const h of V.horizons) {
    assert.equal(R.maxSealAge(h.minutes), h.maxSealAge, `maxSealAge(${h.minutes})`);
    assert.equal(R.baseXpFor(h.minutes), h.baseXp);
  }
  assert.equal(R.baseXpFor(7), null);
});

test('sealXp, skillXp, hitPayout, rank and chambers reproduce every vector', () => {
  for (const [b, st, xp] of V.sealXp) assert.equal(R.sealXp(b, st), xp, `sealXp(${b},${st})`);
  for (const [x, k, xp] of V.skillXp) assert.equal(R.skillXp(x, k), xp, `skillXp(${x},${k})`);
  for (const [st, back] of V.hitPayoutVectors) assert.equal(R.hitPayout(st), back, `hitPayout(${st})`);
  for (const [xp, rank, ch] of V.rank) {
    assert.equal(R.rankOf(xp), rank, `rankOf(${xp})`);
    assert.equal(R.chambersFor(xp), ch, `chambersFor(${xp})`);
  }
  assert.equal(V.sealXp.length, 7 * 22);
  assert.equal(V.skillXp.length, 9 * 13);
});

test('exact rounding is the float rule everywhere it agreed, and half-up where floats drifted', () => {
  // The old float formulas, kept here only as the reference they were.
  const floatSeal = (b, st) => Math.max(1, Math.round(b * Math.min(20, Math.sqrt(st / 100))));
  const floatSkill = (x, k) => Math.max(1, Math.round(x * Math.min(2, 1 + Math.max(0, k) * 0.15)));
  for (const [, b] of R.HORIZONS) {
    for (let st = 100; st <= 60_000; st += 7) assert.equal(R.sealXp(b, st), floatSeal(b, st), `sealXp(${b},${st})`);
    assert.equal(R.sealXp(b, 1e9), b * 20);
  }
  // Ties: 50 * 1.15 = 57.5 exactly; floats said 57 (1.15 is 1.1499999999999999).
  assert.equal(floatSkill(50, 1), 57);
  assert.equal(R.skillXp(50, 1), 58);
  let drift = 0;
  for (let x = 1; x <= 600; x++) for (let k = 0; k <= 12; k++) {
    const a = R.skillXp(x, k), f = floatSkill(x, k);
    if (a !== f) { drift++; assert.equal(a, f + 1, 'only exact ties differ, always by one, always up'); assert.equal((x * (20 + 3 * k)) % 20, 10, 'and only when the true value ends in .5'); }
  }
  assert.ok(drift > 0 && drift < 30, `float drift cases: ${drift}`);
  assert.equal(R.hitPayout(101), 171);
  assert.equal(R.hitPayout(999_999_999), 1_699_999_998);
});

test('the v3 commit preimage hashes the same in Node', () => {
  const c = V.commit;
  assert.equal(c.preimage, `RATCHET|v3|${c.wallet}|${c.nonce}|${c.side}|${c.pBps}|${c.salt}`);
  assert.equal(crypto.createHash('sha256').update(c.preimage).digest('hex'), c.sha256);
});

test('the referee table is the seven live feeds with their shard-0 push accounts', () => {
  assert.equal(V.feeds.length, 7);
  assert.equal(V.feeds[0].feedId, 'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d');
  assert.equal(V.feeds[0].pushAccount, '7AviUf9nL62mcxNbQGKm4nKDQnPjswo6c5MX4D57HmyE');
  assert.equal(new Set(V.feeds.map(f => f.pushAccount)).size, 7);
});

test('api/game.js computes seal XP, skill XP and the hit payout through lib/core_rules.js', () => {
  const src = fs.readFileSync(new URL('../api/game.js', import.meta.url), 'utf8');
  assert.match(src, /require\('\.\.\/lib\/core_rules\.js'\)/);
  assert.match(src, /skillXp\(s\.xp, p\.streak\)/, 'HIT skill XP');
  assert.match(src, /s\.back = coreRules\.hitPayout\(s\.stake\)/, 'HIT payout');
  assert.match(src, /coreRules\.sealXp\(t\.baseXp, stake\)/, 'directional seal XP');
  assert.doesNotMatch(src, /Math\.floor\(s\.stake \* HIT_PAYOUT\)/, 'no float payout left');
});
