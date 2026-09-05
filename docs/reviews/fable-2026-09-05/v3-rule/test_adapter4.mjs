// node --test test_adapter4.mjs — adapter 4 (certified first-after-T) over adapter 3, with the residual made explicit
import test from 'node:test';
import assert from 'node:assert/strict';
import { pythnetStream, sponsoredStream, mulberry32, strictBracket } from './model.mjs';
import { KIND, validCert, openNeed4, submit4, finalize4, rootsFrom } from './adapter4.mjs';

const FEED = 'ef0d8b6f-sol';
const T0 = 1_788_576_000;
const SPEC = { feed_id: FEED, max_post_target_lag_seconds: 30, window_seconds: 120, min_exponent: -12, max_exponent: 2, max_confidence_bps: 200 };
function world(seed = 7) {
  const global = pythnetStream({ feed_id: FEED, from_ts: T0 - 120, to_ts: T0 + 900, rng: mulberry32(seed) });
  const sponsored = sponsoredStream(global, { period_s: 5, phase_s: 2 });
  const roots = rootsFrom(new Map([[FEED, global]]));
  return { global, sponsored, roots };
}
const msg = m => ({ kind: KIND.MESSAGE, m });
const certP = m => ({ kind: KIND.CERT, form: 'predecessor', m });
const certR = (m, seq) => ({ kind: KIND.CERT, form: 'roots', m, seq });
const seqOf = (roots, m) => [...roots.values()].find(r => r.timestamp === m.publish_time && r.leaves.has(m.hash))?.seq;

test('A1 the two certificate forms name the same unique message: the strict-bracket message is exactly the leaf in the first root at/after T', () => {
  const { global, roots } = world();
  for (let T = T0; T <= T0 + 600; T += 60) {
    const need = openNeed4(SPEC, T);
    const sb = strictBracket(global, SPEC, { target_ts: T });
    assert.ok(sb && sb !== 'AMBIGUOUS');
    assert.equal(validCert(certP(sb), need, roots).ok, true);
    const seq = seqOf(roots, sb);
    assert.equal(validCert(certR(sb, seq), need, roots).ok, true);
    // any other message fails both forms
    const other = global.find(m => m.publish_time === sb.publish_time + 1);
    assert.equal(validCert(certP(other), need, roots).ok, false);
    assert.equal(validCert(certR(other, seqOf(roots, other)), need, roots).ok, false);
  }
});

test('A2 SAFETY: once a valid certificate is submitted the winner is fixed, whatever else is submitted before or after, in any order', () => {
  const { global, sponsored, roots } = world(3);
  const rng = mulberry32(11);
  const T = T0 + 120;
  const sb = strictBracket(global, SPEC, { target_ts: T });
  const pool = global.filter(m => m.publish_time >= T && m.publish_time <= T + 30).map(msg)
    .concat(sponsored.filter(m => m.publish_time >= T && m.publish_time <= T + 30).map(msg));
  for (let i = 0; i < 300; i++) {
    const need = openNeed4(SPEC, T);
    const order = pool.slice().sort(() => rng() - 0.5);
    const at = Math.floor(rng() * (order.length + 1));
    order.splice(at, 0, certP(sb));
    order.forEach((ev, k) => submit4(need, ev, 'p' + k, T + 1 + k % 100, SPEC, roots));
    assert.equal(need.winner.message.hash, sb.hash);
    assert.equal(need.certified, true);
    assert.equal(finalize4(need, T + 120).certified, true);
  }
});

test('A3 uniqueness: a second certificate for a different message is rejected; the same message is a duplicate', () => {
  const { global, roots } = world();
  const T = T0 + 180;
  const sb = strictBracket(global, SPEC, { target_ts: T });
  const need = openNeed4(SPEC, T);
  assert.equal(submit4(need, certP(sb), 'a', T + 5, SPEC, roots).certified, true);
  assert.equal(submit4(need, certP(sb), 'b', T + 6, SPEC, roots).duplicate, true);
  const fake = { ...sb, hash: 'forged', publish_time: sb.publish_time, prev_publish_time: sb.prev_publish_time };
  assert.equal(submit4(need, certP(fake), 'c', T + 7, SPEC, roots).reason, 'SECOND_CERT_CONTRADICTS');
});

test('A4 LIVENESS floor without any certificate: the replayable sponsored minimum decides (adapter 3), never EXPIRED while one crank exists', () => {
  const { sponsored, roots } = world();
  for (let T = T0; T <= T0 + 600; T += 60) {
    const need = openNeed4(SPEC, T);
    for (const m of sponsored.filter(x => x.publish_time >= T && x.publish_time <= T + 30)) submit4(need, msg(m), 'crank', m.publish_time + 1, SPEC, roots);
    const r = finalize4(need, T + 120);
    assert.equal(r.ok, true); assert.equal(r.certified, false);
    assert.equal(r.winner.publish_time - T, 2);
  }
});

test('A5 THE RESIDUAL, stated as a counterexample not hidden: with no certificate submitted, a keyed party holding a never-posted earlier message decides between two outcomes by submitting or withholding', () => {
  const { global, sponsored, roots } = world(21);
  const T = T0 + 240;
  const P = sponsored.find(m => m.publish_time >= T);                 // sponsor's first post, T+2
  const Q = global.find(m => m.publish_time === T + 1);                // never posted, keyed only
  const withhold = openNeed4(SPEC, T); submit4(withhold, msg(P), 'crank', T + 3, SPEC, roots);
  const reveal = openNeed4(SPEC, T); submit4(reveal, msg(P), 'crank', T + 3, SPEC, roots); submit4(reveal, msg(Q), 'keyed', T + 50, SPEC, roots);
  assert.equal(withhold.winner.message.hash, P.hash);
  assert.equal(reveal.winner.message.hash, Q.hash);
  assert.notEqual(withhold.winner.message.price, reveal.winner.message.price, 'two different prices reachable by the keyed party\'s choice => adapter 3 alone is NOT payout-deterministic');
  // and the closure: anyone submitting the certificate ends the choice
  const sb = strictBracket(global, SPEC, { target_ts: T });
  const closed = openNeed4(SPEC, T); submit4(closed, msg(P), 'crank', T + 3, SPEC, roots); submit4(closed, msg(Q), 'keyed', T + 50, SPEC, roots);
  submit4(closed, certP(sb), 'honest-keyed', T + 60, SPEC, roots);
  assert.equal(closed.winner.message.hash, sb.hash);
  assert.equal(submit4(closed, msg(Q), 'keyed', T + 70, SPEC, roots).ignored, true);
});

test('A6 a certificate is never a choice: the keyed party cannot certify a favourable non-first message, and a certificate for the true first can only make the keyed party\'s own position worse or equal', () => {
  const { global, roots } = world(5);
  const T = T0 + 300;
  const need = openNeed4(SPEC, T);
  const candidates = global.filter(m => m.publish_time >= T && m.publish_time <= T + 10);
  const valid = candidates.filter(m => validCert(certP(m), need, roots).ok);
  assert.equal(valid.length, 1, 'exactly one certifiable message exists per target');
  const seqs = candidates.map(m => seqOf(roots, m)).filter(Boolean);
  const validR = candidates.filter(m => validCert(certR(m, seqOf(roots, m)), need, roots).ok);
  assert.equal(validR.length, 1);
  assert.equal(validR[0].hash, valid[0].hash);
  assert.ok(seqs.length >= 5);
});

test('A7 deadline and terminal discipline: certificate after D is refused; finalize before D refused; EXPIRED only with nothing', () => {
  const { global, roots } = world();
  const T = T0 + 360;
  const sb = strictBracket(global, SPEC, { target_ts: T });
  const need = openNeed4(SPEC, T);
  assert.equal(finalize4(need, T + 200).reason, 'NO_CANDIDATE');
  assert.equal(submit4(need, certP(sb), 'a', T + 120, SPEC, roots).reason, 'WINDOW_CLOSED');
  const need2 = openNeed4(SPEC, T);
  assert.equal(submit4(need2, certP(sb), 'a', T + 119, SPEC, roots).certified, true);
  assert.equal(finalize4(need2, T + 119).reason, 'WINDOW_OPEN');
  assert.equal(finalize4(need2, T + 120).ok, true);
  assert.equal(submit4(need2, certP(sb), 'a', T + 121, SPEC, roots).reason, 'TERMINAL');
});

test('A8 root form depends on the inclusion guarantee: if a root omits an unchanged feed leaf, the root certificate fails while the predecessor certificate still holds', () => {
  const { global, roots } = world();
  const T = T0 + 420;
  const sb = strictBracket(global, SPEC, { target_ts: T });
  const seq = seqOf(roots, sb);
  const need = openNeed4(SPEC, T);
  const pruned = new Map(roots);
  pruned.set(seq, { ...roots.get(seq), leaves: new Set() });      // a root that dropped the leaf
  assert.equal(validCert(certR(sb, seq), need, pruned).ok, false);
  assert.equal(validCert(certP(sb), need, pruned).ok, true, 'the message-level certificate needs no root guarantee');
});
