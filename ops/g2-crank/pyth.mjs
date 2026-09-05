#!/usr/bin/env node
// The sponsored price account, decoded, and the one operational fact about
// MIN-CAPTURE that nothing else in this repository says out loud.
//
// THE FEED HAS NO HISTORY. A Pyth push account holds ONE price - the latest -
// and every update overwrites it. capture_first passes that account to the
// program, which reads whatever it contains at that slot. So the earliest
// admissible print for a target is not something a crank can go and fetch after
// the fact: it is something somebody had to be WATCHING FOR and submit while it
// was still there.
//
// That is why MIN-CAPTURE needs a live observer rather than a periodic sweep,
// and why the lag budget is what makes it survivable: miss the first print and
// the next one is still admissible while publish_time <= target + lag. It is
// also why capture is permissionless and worth paying for - the protocol wants
// more than one pair of eyes, because whoever sees the earliest print wins the
// replacement and everybody else's transaction is refused by S1.
//
// A sweep-only crank would still work. It would just settle on later prices than
// the rule intends, quietly, and nobody reading its logs would know.
import { INSTRUCTION_ACCOUNTS } from '../../onchain/ratchet-core-g2/client/client-v2.mjs';

// PriceUpdateV2 as rcx-timepin-v2 reads it. Every width is named so the total
// can be checked against the program's own constant instead of trusted.
// THE TOTAL IS NOT THE LAYOUT, and I proved that on myself. The first version of
// this table gave verification_level TWO bytes, on the reasoning that a borsh
// enum is a tag plus a payload. It summed to 134, matched the program's constant
// exactly, and was WRONG: every field from feed_id onward would have been read
// one byte off, and the sum check said MATCH.
//
// The authority is the harness that builds the account
// (svm-tests/tests/core_g2_lifecycle.rs put_price_update): a single
// `data.push(1)` for verification_level - VerificationLevel::Full is a unit
// variant and lifecycle.rs:1326 requires exactly Full - then the message fields,
// which come to 133, and then `data.resize(134, 0)`. The 134th byte is PADDING.
//
// A checksum that can be satisfied two ways is not a check. The test now
// rebuilds the harness's bytes and reads the values back.
export const LAYOUT = Object.freeze([
  ['discriminator', 8],
  ['write_authority', 32],
  ['verification_level', 1],   // VerificationLevel::Full, a unit variant: one tag byte
  ['feed_id', 32],
  ['price', 8],
  ['conf', 8],
  ['exponent', 4],
  ['publish_time', 8],
  ['prev_publish_time', 8],
  ['ema_price', 8],
  ['ema_conf', 8],
  ['posted_slot', 8],
  ['padding', 1],              // the account is resized to 134; this byte is not read
]);

// rcx-timepin-v2 lifecycle.rs: PRICE_UPDATE_V2_LAYOUT_LEN = 134, and the program
// REQUIRES the account to be exactly that long before it reads a byte.
export const PRICE_UPDATE_V2_LAYOUT_LEN = 134;

export const OFFSETS = Object.freeze(LAYOUT.reduce((acc, [name, width]) => {
  acc.map[name] = acc.at;
  acc.at += width;
  return acc;
}, { map: {}, at: 0 }).map);

export const LAYOUT_TOTAL = LAYOUT.reduce((n, [, w]) => n + w, 0);

export function decodePriceUpdate(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (data.length !== PRICE_UPDATE_V2_LAYOUT_LEN)
    throw new RangeError(`sponsored price account is ${data.length} bytes, and the program requires `
      + `exactly ${PRICE_UPDATE_V2_LAYOUT_LEN}. It refuses to read a byte otherwise, so neither do we.`);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const at = name => OFFSETS[name];
  return {
    feedId: [...data.slice(at('feed_id'), at('feed_id') + 32)]
      .map(b => b.toString(16).padStart(2, '0')).join(''),
    price: view.getBigInt64(at('price'), true),
    conf: view.getBigUint64(at('conf'), true),
    exponent: view.getInt32(at('exponent'), true),
    publishTime: view.getBigInt64(at('publish_time'), true),
    prevPublishTime: view.getBigInt64(at('prev_publish_time'), true),
    emaPrice: view.getBigInt64(at('ema_price'), true),
    emaConf: view.getBigUint64(at('ema_conf'), true),
    postedSlot: view.getBigUint64(at('posted_slot'), true),
  };
}

// Is this account, RIGHT NOW, worth a capture transaction for this need?
//
// The answer is deliberately conservative: send only when the print is
// admissible AND it would win. After S1 a print that is not strictly earlier
// than the standing candidate is REFUSED, so sending one costs a failed
// transaction and changes nothing. A crank that ignores that burns fees on every
// pass while looking busy.
export function shouldCapture(need, print, { now }) {
  if (now < need.targetTs) return { send: false, why: 'target not reached' };
  if (now >= need.captureDeadlineTs) return { send: false, why: 'capture window closed' };
  if (print.publishTime < need.targetTs)
    return { send: false, why: 'print is before the target - inadmissible under MIN-CAPTURE' };
  if (print.publishTime > need.targetTs + need.maxPostTargetLagSeconds)
    return { send: false, why: 'print is past target + lag - inadmissible, and this target will void '
      + 'unless an earlier one is still visible somewhere' };
  if (!need.candidate)
    return { send: true, instruction: 'capture_first', why: 'first admissible print seen' };
  const a = [print.publishTime, print.postedSlot, print.messageHash];
  const b = [need.candidate.publishTime, need.candidate.postedSlot, need.candidate.messageHash];
  for (let i = 0; i < 3; i++) {
    if (a[i] < b[i]) return { send: true, instruction: 'capture_conflict', why: 'strictly earlier than the standing candidate' };
    if (a[i] > b[i]) return { send: false, why: 'not strictly earlier - S1 would refuse it with CaptureIsNotEarlier' };
  }
  return { send: false, why: 'identical to the standing candidate' };
}

// The account list capture_first and capture_conflict need, so plan.mjs can stop
// deferring them once a caller supplies the sponsored account address.
export const CAPTURE_ACCOUNTS = Object.freeze({
  capture_first: INSTRUCTION_ACCOUNTS['rcx-timepin-v2'].capture_first.accounts.map(a => a.name),
  capture_conflict: INSTRUCTION_ACCOUNTS['rcx-timepin-v2'].capture_conflict.accounts.map(a => a.name),
});
