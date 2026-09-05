// Everything about tracker 2.2 that can be true before the build exists.
//
// 2.2 needs a deployed program implementing MIN-CAPTURE, so its receipts cannot
// be produced today. Its *arithmetic* and its *honesty* can be: the void rate
// that decides GATE 2, the Need decoder that measures it, and the fact that the
// two steps whose on-chain shape is about to change are marked blocked rather
// than wired against a predicate nobody intends to ship.
//
// Evidence tier: host.

import assert from 'node:assert/strict';
import { Keypair } from '@solana/web3.js';
import {
  STEPS, plan, voidRate, decodeTimepinNeedV2, NEED_STATE, VOID_STATES, TERMINAL_STATES,
  loadReceipt,
} from '../onchain/rcx-timepin-v2/scripts/devnet-2-2.mjs';
import {
  encodeTimepinNeedV2, TIMEPIN_NEED_V2_ACCOUNT_LEN,
} from '../onchain/rcx-timepin/model-v2.mjs';

let checks = 0;
const check = (fn, label) => { fn(); checks += 1; };

// --- the decoder, round-tripped against the model's own encoder -----------------
//
// model-v2.mjs exports exactly ONE decoder (decodePriceUpdateV2) and cannot read
// a Need at all, so 2.2 has to carry its own. A second implementation of a wire
// format is a liability unless it is pinned to the first — this pins it.

check(() => {
  const need = {
    schema: 2, bump: 253, state: 'Candidate',
    evidenceSpecHash: Buffer.alloc(32, 0xa1),
    targetTs: 1788609000n, sourceDeadlineTs: 1788609120n, captureDeadlineTs: 1788609180n,
    candidateAHash: Buffer.alloc(32, 0xb2), candidateBHash: Buffer.alloc(32, 0xc3),
  };
  const encoded = encodeTimepinNeedV2(need);
  assert.equal(encoded.length, TIMEPIN_NEED_V2_ACCOUNT_LEN, 'the model encodes a 132-byte account');
  const back = decodeTimepinNeedV2(encoded);
  assert.equal(back.schema, 2);
  assert.equal(back.bump, 253);
  assert.equal(back.stateName, 'CANDIDATE', 'state byte 1 is CANDIDATE');
  assert.ok(back.evidenceSpecHash.equals(need.evidenceSpecHash), 'spec hash survives');
  assert.equal(back.targetTs, need.targetTs);
  assert.equal(back.sourceDeadlineTs, need.sourceDeadlineTs);
  assert.equal(back.captureDeadlineTs, need.captureDeadlineTs);
  assert.ok(back.candidateAHash.equals(need.candidateAHash), 'candidate A survives');
  assert.ok(back.candidateBHash.equals(need.candidateBHash), 'candidate B survives');
}, 'the Need decoder round-trips the model encoder');

check(() => {
  for (const [name, byte] of [['Open', 0], ['Candidate', 1], ['Final', 2], ['Ambiguous', 3], ['Expired', 4]]) {
    const encoded = encodeTimepinNeedV2({
      schema: 2, bump: 1, state: name, evidenceSpecHash: Buffer.alloc(32),
      targetTs: 60n, sourceDeadlineTs: 120n, captureDeadlineTs: 180n,
      candidateAHash: Buffer.alloc(32), candidateBHash: Buffer.alloc(32),
    });
    const back = decodeTimepinNeedV2(encoded);
    assert.equal(back.state, byte, `${name} is byte ${byte}`);
    assert.equal(back.stateName, NEED_STATE[byte], `and decodes back to ${NEED_STATE[byte]}`);
  }
  assert.throws(() => decodeTimepinNeedV2(Buffer.alloc(64)), /expected 132/,
    'a short account is refused rather than read as a Need');
}, 'every Need state byte matches lib.rs:45-49');

// --- the void rate, which is the whole of GATE 2 --------------------------------

const targetsWith = states => Object.fromEntries(states.map((s, i) => [String(i), { stateName: s }]));

check(() => {
  const r = voidRate(targetsWith(Array(60).fill('FINAL')));
  assert.equal(r.terminal, 60);
  assert.equal(r.voids, 0);
  assert.equal(r.rate, 0);
  assert.equal(r.meetsGate2, true, '60 terminal targets, no voids, passes');
}, 'a clean run passes GATE 2');

check(() => {
  // 3/60 = 5.0 % exactly. GATE 2 says "< 5 %", so exactly 5 % must FAIL.
  const at5 = voidRate(targetsWith([...Array(57).fill('FINAL'), ...Array(3).fill('EXPIRED')]));
  assert.equal(at5.rate, 0.05);
  assert.equal(at5.meetsGate2, false, 'exactly 5 % is not below 5 %');
  const under = voidRate(targetsWith([...Array(78).fill('FINAL'), ...Array(2).fill('EXPIRED')]));
  assert.ok(under.rate < 0.05);
  assert.equal(under.meetsGate2, true);
}, 'the 5 % boundary is exclusive');

check(() => {
  // The failure that would be easiest to ship by accident: stop the run early,
  // count the Needs that never resolved as if they had, and report a clean rate.
  const r = voidRate(targetsWith([...Array(30).fill('FINAL'), ...Array(30).fill('OPEN')]));
  assert.equal(r.opened, 60, 'sixty Needs were opened');
  assert.equal(r.terminal, 30, 'but only thirty reached a terminal state');
  assert.equal(r.inFlight, 30, 'thirty are still in flight');
  assert.equal(r.voids, 0);
  assert.equal(r.rate, 0, 'the rate over what resolved is genuinely 0');
  assert.equal(r.meetsGate2, false,
    'and it still FAILS, because 30 terminal targets is not the 60 GATE 2 asks for');
}, 'an early stop cannot pass by counting unresolved Needs');

check(() => {
  const r = voidRate(targetsWith([...Array(50).fill('FINAL'), ...Array(8).fill('EXPIRED'),
    ...Array(4).fill('AMBIGUOUS')]));
  assert.equal(r.voids, 12, 'AMBIGUOUS counts as a void, not as a hit');
  assert.ok(r.rate > 0.05);
  assert.equal(r.meetsGate2, false);
  assert.deepEqual([...VOID_STATES].sort(), ['AMBIGUOUS', 'EXPIRED']);
  assert.deepEqual([...TERMINAL_STATES].sort(), ['AMBIGUOUS', 'EXPIRED', 'FINAL']);
  assert.equal(voidRate({}).rate, null, 'no targets is not a zero void rate');
  assert.equal(voidRate({}).meetsGate2, false, 'and it is not a pass');
}, 'AMBIGUOUS is a void and an empty run is not a measurement');

check(() => {
  // The denominator is the thing to get wrong, and it hides: with no voids, or
  // with no in-flight Needs, both denominators agree. This fixture has BOTH, so
  // the two differ — 3/63 if you divide by what resolved, 3/100 if you divide by
  // what you opened. The second flatters the run by a third and is the number a
  // tired reader would accept.
  const r = voidRate(targetsWith([...Array(60).fill('FINAL'), ...Array(3).fill('EXPIRED'),
    ...Array(37).fill('OPEN')]));
  assert.equal(r.opened, 100);
  assert.equal(r.terminal, 63);
  assert.equal(r.inFlight, 37);
  assert.ok(Math.abs(r.rate - 3 / 63) < 1e-12,
    'the void rate is over what RESOLVED (3/63 = 4.76 %), not over what was opened (3/100 = 3 %)');
  assert.ok(Math.abs(r.rate - 3 / 100) > 1e-3, 'and those two are genuinely different numbers');
  assert.equal(r.meetsGate2, true, '63 terminal targets at 4.76 % passes');
}, 'the void-rate denominator is resolved Needs, not opened ones');

// --- the steps ------------------------------------------------------------------

check(() => {
  const ids = STEPS.map(s => s.id);
  assert.deepEqual(ids,
    ['preflight', 'register_spec', 'open_needs', 'capture', 'finalize', 'expire', 'report'],
    'the sequence is the one tracker 2.2 asks for, in order');
  for (const s of STEPS) {
    assert.ok(s.accounts?.length, `${s.id} names the accounts it touches`);
    assert.ok(s.assertions?.length, `${s.id} names what it will prove`);
  }
}, 'every step names its accounts and its assertions');

check(() => {
  const blocked = STEPS.filter(s => s.blocked).map(s => s.id);
  assert.deepEqual(blocked, ['capture', 'finalize'],
    'exactly the two steps MIN_CAPTURE_SPEC section 3 changes are blocked');
  for (const s of STEPS.filter(x => x.blocked))
    assert.match(s.blocked, /1\.1|MIN_CAPTURE_SPEC/,
      `${s.id} says WHICH tracker item unblocks it, not just that it is blocked`);
  assert.ok(!STEPS.find(s => s.id === 'expire').blocked,
    'expire is NOT blocked — MIN_CAPTURE_SPEC section 3 states it is unchanged');
}, 'the blocked set is exactly the rule-dependent steps');

check(() => {
  const text = plan({ targets: 60, grid: 60 });
  assert.match(text, /Nothing is sent/, 'plan says plainly that it sends nothing');
  assert.match(text, /1\.00 h of wall clock/, 'and how long the real run costs');
  assert.match(text, /5 of 7 steps are ready; 2 are blocked/, 'and the honest ready count');
  assert.match(text, /BLOCKED   tracker 1\.1/, 'and why');
  for (const s of STEPS) assert.ok(text.includes(s.id), `${s.id} appears in the plan`);
  const long = plan({ targets: 120, grid: 300 });
  assert.match(long, /10\.00 h of wall clock/, '120 targets on a 300 s grid is ten hours');
}, 'plan() is reviewable, and honest about what it is not');

check(() => {
  const fresh = loadReceipt(`/nonexistent-${process.pid}.json`);
  assert.deepEqual(fresh.steps, {}, 'a fresh receipt has no completed steps');
  assert.deepEqual(fresh.sends, [], 'and no signatures');
  assert.equal(fresh.schema, 1);
}, 'a missing receipt starts empty rather than throwing');

console.log(`devnet 2.2 plan: ${checks} checks passed (host tier; no cluster contacted)`);
