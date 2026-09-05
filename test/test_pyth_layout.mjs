#!/usr/bin/env node
// The sponsored price account is decoded at the offsets the PROGRAM reads.
//
// This test exists because the first layout I wrote summed to 134, matched the
// program's PRICE_UPDATE_V2_LAYOUT_LEN exactly, and was wrong: verification_level
// had two bytes instead of one, so every field from feed_id onward was read one
// byte off. A checksum that can be satisfied two ways is not a check.
//
// So the bytes are REBUILT here the way the exact-SBF harness builds them
// (svm-tests/tests/core_g2_lifecycle.rs, put_price_update) and the decoder must
// read back the values that were written. A shifted field cannot survive that.
import assert from 'node:assert/strict';
import { decodePriceUpdate, OFFSETS, LAYOUT_TOTAL, PRICE_UPDATE_V2_LAYOUT_LEN, shouldCapture }
  from '../ops/g2-crank/pyth.mjs';

let checks = 0;
const eq = (a, b, m) => { checks += 1; assert.equal(a, b, m); };

checks += 1;
assert.equal(LAYOUT_TOTAL, PRICE_UPDATE_V2_LAYOUT_LEN,
  'the layout must sum to the length the program requires - necessary, and demonstrably not sufficient');

// --- rebuild the harness's account, byte for byte
function harnessAccount({ price, conf, exponent, publish, prev, emaPrice, emaConf, postedSlot, feedByte }) {
  const out = Buffer.alloc(PRICE_UPDATE_V2_LAYOUT_LEN, 0);
  let at = 0;
  const put = (buf) => { buf.copy(out, at); at += buf.length; };
  put(Buffer.alloc(8, 0xAA));                      // discriminator
  put(Buffer.alloc(32, 0xBB));                     // write_authority
  put(Buffer.from([1]));                           // verification_level: ONE byte
  put(Buffer.alloc(32, feedByte));                 // feed_id
  const n = (v, f) => { const b = Buffer.alloc(f === 'i32' ? 4 : 8);
    if (f === 'i32') b.writeInt32LE(v); else if (f === 'u64') b.writeBigUInt64LE(BigInt(v));
    else b.writeBigInt64LE(BigInt(v)); put(b); };
  n(price, 'i64'); n(conf, 'u64'); n(exponent, 'i32');
  n(publish, 'i64'); n(prev, 'i64'); n(emaPrice, 'i64'); n(emaConf, 'u64'); n(postedSlot, 'u64');
  // the harness then resizes to 134; the final byte stays zero
  eq(at, 133, 'the harness writes 133 bytes before the account is padded to 134');
  return new Uint8Array(out);
}

{
  const want = { price: -123456789, conf: 4242, exponent: -6, publish: 1800000059,
                 prev: 1800000000, emaPrice: 987654321, emaConf: 7, postedSlot: 555444333,
                 feedByte: 0x3c };
  const got = decodePriceUpdate(harnessAccount(want));
  eq(got.price, BigInt(want.price), 'price is read at the wrong offset');
  eq(got.conf, BigInt(want.conf), 'conf is read at the wrong offset');
  eq(got.exponent, want.exponent, 'exponent is read at the wrong offset');
  eq(got.publishTime, BigInt(want.publish), 'publish_time is read at the wrong offset - this is the field '
    + 'the whole settlement rule is defined on');
  eq(got.prevPublishTime, BigInt(want.prev), 'prev_publish_time is read at the wrong offset');
  eq(got.emaPrice, BigInt(want.emaPrice), 'ema_price is read at the wrong offset');
  eq(got.emaConf, BigInt(want.emaConf), 'ema_conf is read at the wrong offset');
  eq(got.postedSlot, BigInt(want.postedSlot), 'posted_slot is read at the wrong offset - it is the first '
    + 'MIN-CAPTURE tie-break');
  eq(got.feedId, '3c'.repeat(32), 'feed_id is read at the wrong offset');
}

// --- a one-byte shift must be caught, which is what the old layout would have done
{
  const bytes = harnessAccount({ price: 7, conf: 1, exponent: -2, publish: 1000, prev: 900,
                                 emaPrice: 7, emaConf: 1, postedSlot: 5, feedByte: 0x11 });
  const shifted = new Uint8Array(PRICE_UPDATE_V2_LAYOUT_LEN);
  shifted.set(bytes.subarray(0, OFFSETS.feed_id), 0);
  shifted.set(bytes.subarray(OFFSETS.feed_id, PRICE_UPDATE_V2_LAYOUT_LEN - 1), OFFSETS.feed_id + 1);
  checks += 1;
  assert.notEqual(decodePriceUpdate(shifted).publishTime, 1000n,
    'a one-byte shift of the message must change what publish_time reads - if it does not, this test '
    + 'cannot detect the mistake it was written for');
}

// --- the wrong length is refused rather than read
checks += 1;
assert.throws(() => decodePriceUpdate(new Uint8Array(133)), /requires\s+exactly 134/,
  'an account the program would refuse must be refused here too');

// --- shouldCapture: the conservative rule, in both directions
{
  const need = { targetTs: 1000, maxPostTargetLagSeconds: 299, captureDeadlineTs: 2200, candidate: null };
  const p = (publishTime, postedSlot = 5n, messageHash = '20') => ({ publishTime, postedSlot, messageHash });
  eq(shouldCapture(need, p(1005n), { now: 1010 }).instruction, 'capture_first', 'first admissible print');
  eq(shouldCapture(need, p(999n), { now: 1010 }).send, false, 'a print before the target');
  eq(shouldCapture(need, p(1300n), { now: 1400 }).send, false, 'a print past target + lag');
  eq(shouldCapture(need, p(1005n), { now: 900 }).send, false, 'before the target is reached');
  eq(shouldCapture(need, p(1005n), { now: 2200 }).send, false, 'after the capture window closed');
  const held = { ...need, candidate: p(1100n, 9n, '50') };
  eq(shouldCapture(held, p(1050n), { now: 1400 }).instruction, 'capture_conflict', 'strictly earlier');
  eq(shouldCapture(held, p(1200n), { now: 1400 }).send, false,
     'a LATER print must not be sent - S1 refuses it and the fee is spent for nothing');
  eq(shouldCapture(held, p(1100n, 7n, '50'), { now: 1400 }).instruction, 'capture_conflict', 'earlier slot wins');
  eq(shouldCapture(held, p(1100n, 9n, '60'), { now: 1400 }).send, false, 'larger hash loses');
  eq(shouldCapture(held, p(1100n, 9n, '50'), { now: 1400 }).send, false, 'identical is not resent');
}

console.log(`ok - pyth layout and capture rule: ${checks} checks, offsets proved against the harness bytes`);
