// node --test test_live_capture.mjs — LIVE_CAPTURE_MIN properties (the rule without a keyed-submitter assumption)
import test from 'node:test';
import assert from 'node:assert/strict';
import { pythnetStream, sponsoredStream, mulberry32 } from './model.mjs';
import { liveStateAt, openLiveNeed, capture, finalizeLive, expireLive, crankLandings } from './live_capture.mjs';

const FEED = 'ef0d8b6f-sol';
const T0 = 1_788_576_000;
const LAG = 30, GRACE = 30;

// The pusher posts the sponsored message ~0.3 s after its publish_time; model post_time = publish_time (integer seconds).
function world(seed = 7, period = 5, phase = 2) {
  const global = pythnetStream({ feed_id: FEED, from_ts: T0 - 120, to_ts: T0 + 1000, rng: mulberry32(seed) });
  const posts = sponsoredStream(global, { period_s: period, phase_s: phase }).map(m => ({ message: m, post_time: m.publish_time }));
  return { global, posts };
}
const firstPostAfter = (posts, T) => posts.find(p => p.message.publish_time >= T).message;

test('LC1 first landed capture after T is the first sponsored post after T when any crank lands within the post lifetime (5 s)', () => {
  const { posts } = world();
  for (let T = T0; T <= T0 + 600; T += 60) {
    const need = openLiveNeed(T, LAG, GRACE);
    for (const land of crankLandings(T, need.capture_deadline_ts, 1, 3)) capture(need, posts, land, 'crank');
    assert.equal(need.winner.message.hash, firstPostAfter(posts, T).hash);
    assert.equal(need.winner.message.publish_time - T, 2);
  }
});

test('LC2 a keyed adversary has NO option: messages never posted to the PDA cannot be captured at all', () => {
  const { global, posts } = world();
  const T = T0 + 120;
  const need = openLiveNeed(T, LAG, GRACE);
  // the adversary "holds" the global first message at T; it is simply not on the PDA at any time
  const privateMsg = global.find(m => m.publish_time === T);
  assert.ok(privateMsg && !posts.some(p => p.message.hash === privateMsg.hash), 'the T message exists globally but was never posted');
  for (let c = T; c < need.capture_deadline_ts; c++) assert.notEqual(liveStateAt(posts, c)?.hash, privateMsg.hash);
  for (const land of crankLandings(T, need.capture_deadline_ts, 1, 2)) capture(need, posts, land, 'crank');
  assert.equal(need.winner.message.hash, firstPostAfter(posts, T).hash);
});

test('LC3 a withholding sole capturer can only delay to the NEXT post; any second honest crank landing within 5 s removes even that', () => {
  const { posts } = world();
  const T = T0 + 180;
  const first = firstPostAfter(posts, T), second = posts[posts.indexOf(posts.find(p => p.message.hash === first.hash)) + 1].message;
  // sole adversary crank skips the first post's lifetime and captures during the second
  const alone = openLiveNeed(T, LAG, GRACE);
  capture(alone, posts, second.publish_time + 1, 'adversary');
  assert.equal(alone.winner.message.hash, second.hash, 'residual when the adversary is the ONLY capturer: one post later');
  // with an honest crank landing at +4 s the first post wins and the adversary's later capture is refused
  const two = openLiveNeed(T, LAG, GRACE);
  capture(two, posts, first.publish_time + 2, 'honest');
  assert.equal(capture(two, posts, second.publish_time + 1, 'adversary').reason, 'LATER_THAN_WINNER');
  assert.equal(two.winner.message.hash, first.hash);
});

test('LC4 order of landing decides nothing an adversary can choose: 500 random honest landing patterns give the same winner as long as one landing hits each post lifetime', () => {
  const { posts } = world(3);
  const rng = mulberry32(42);
  const T = T0 + 240;
  const expected = firstPostAfter(posts, T).hash;
  for (let i = 0; i < 500; i++) {
    const need = openLiveNeed(T, LAG, GRACE);
    const landings = [];
    for (let k = 0; k < 12; k++) landings.push(T + Math.floor(rng() * 20));           // random landings in [T, T+20)
    landings.push(T + 2 + Math.floor(rng() * 5));                                       // at least one inside the first post's lifetime [T+2, T+7)
    for (const l of landings.sort((a, b) => a - b)) capture(need, posts, l, 'c' + i);
    assert.equal(need.winner.message.hash, expected);
  }
});

test('LC5 the honest failure mode is a timing accident, not a choice: if every crank lands later than one post lifetime, the winner is the first post that was live at the first landing', () => {
  const { posts } = world();
  const T = T0 + 300;
  const need = openLiveNeed(T, LAG, GRACE);
  for (const land of crankLandings(T, need.capture_deadline_ts, 5, 6)) capture(need, posts, land, 'slow-crank');   // first landing at T+6
  const liveAtFirstLanding = liveStateAt(posts, T + 6);
  assert.equal(need.winner.message.hash, liveAtFirstLanding.hash);
  assert.ok(need.winner.message.publish_time - T <= 7);
});

test('LC6 deadlines: no capture after capture_deadline, no finalize before it, expire only when nothing landed', () => {
  const { posts } = world();
  const T = T0 + 360;
  const need = openLiveNeed(T, LAG, GRACE);
  assert.equal(finalizeLive(need, T + 59).reason, 'NO_CANDIDATE');
  assert.equal(expireLive(need, T + 59).reason, 'WINDOW_OPEN');
  assert.equal(capture(need, posts, T + 60, 'x').reason, 'CAPTURE_WINDOW_CLOSED');
  assert.equal(expireLive(need, T + 60).ok, true);
  const need2 = openLiveNeed(T, LAG, GRACE);
  capture(need2, posts, T + 3, 'x');
  assert.equal(finalizeLive(need2, T + 59).reason, 'WINDOW_OPEN');
  assert.equal(finalizeLive(need2, T + 60).ok, true);
  assert.equal(capture(need2, posts, T + 61, 'x').reason, 'TERMINAL');
});

test('LC7 slow feeds are EASIER, not harder: on a 52 s cadence any crank polling every 10 s with 5 s inclusion catches the first post', () => {
  const { posts } = world(9, 52, 17);
  for (let T = T0; T <= T0 + 600; T += 60) {
    const need = openLiveNeed(T, 120, 30);
    for (const land of crankLandings(T, need.capture_deadline_ts, 10, 5)) capture(need, posts, land, 'crank');
    assert.equal(need.winner.message.hash, firstPostAfter(posts, T).hash);
  }
});
