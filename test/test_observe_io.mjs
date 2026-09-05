// The observer's IO half: the two things in it that can be proved without a
// network, and both are refusals.
//
// The Needs being watched are NAMED in a file, never discovered by scanning.
// getProgramAccounts filters over a layout no deployed program has confirmed is
// exactly what ops/g2-crank/crank.mjs refuses to guess at, and an observer is
// not the place to start guessing.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readNeeds, observeOnce } from '../ops/g2-devnet/observe.mjs';

let checks = 0;
const ok = (c, msg) => { checks += 1; assert.ok(c, msg); };
const eq = (a, b, msg) => { checks += 1; assert.equal(a, b, msg); };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'observe-'));
const write = (name, data) => {
  const p = path.join(tmp, name);
  fs.writeFileSync(p, typeof data === 'string' ? data : JSON.stringify(data));
  return p;
};

try {
  // ---- readNeeds ------------------------------------------------------------
  checks += 1;
  assert.throws(() => readNeeds(null), /named, not discovered/,
    'the observer accepted no Need file and would have had to discover them by scanning');

  const good = [{ key: 'entry', targetTs: 100, captureDeadlineTs: 459, maxPostTargetLagSeconds: 299 }];
  eq(readNeeds(write('a.json', good)).length, 1, 'a valid Need array did not load');
  eq(readNeeds(write('b.json', { needs: good })).length, 1, 'the {needs:[...]} shape did not load');

  checks += 1;
  assert.throws(() => readNeeds(write('c.json', { nope: 1 })), /does not contain a Need array/,
    'a file with no Need array loaded as an empty watch list, which is the silence this project keeps refusing');

  // A Need missing any field it is watched by is a Need that cannot be watched.
  // Defaulting one would produce a plausible deadline and a wrong one.
  for (const missing of ['key', 'targetTs', 'captureDeadlineTs', 'maxPostTargetLagSeconds']) {
    const partial = { ...good[0] };
    delete partial[missing];
    checks += 1;
    assert.throws(() => readNeeds(write(`m-${missing}.json`, [partial])), new RegExp(missing),
      `a Need with no ${missing} was accepted; a defaulted deadline is a plausible wrong one`);
  }

  // ---- observeOnce: an unreadable price account is not "no price" -----------
  const web3 = { PublicKey: function (a) { return { toBase58: () => a }; } };
  const needs = [{ key: 'entry', targetTs: 100, captureDeadlineTs: 459, maxPostTargetLagSeconds: 299, candidate: null }];

  {
    const lines = [];
    const r = await observeOnce({
      connection: { getAccountInfo: async () => null },
      web3, priceAccount: 'Price111', needs, now: 120, sent: new Set(),
      log: m => lines.push(m),
    });
    eq(r.print, null, 'a missing account produced a decoded price');
    eq(r.tick.actions.length, 0, 'a capture was submitted with no price read at all');
    ok(lines.some(l => /no price at all/.test(l)),
      'AN UNREADABLE PRICE ACCOUNT WAS REPORTED AS "no admissible price". Those look identical downstream '
      + 'and only one of them means the observer is working.');
  }

  // ---- and a real decode drives a real decision ----------------------------
  {
    // 134 bytes in the layout ops/g2-crank/pyth.mjs pins, with publish_time at
    // the target. If the layout ever shifts, this stops being an admissible
    // print and the test says so - which is the point.
    const { OFFSETS, PRICE_UPDATE_V2_LAYOUT_LEN } = await import('../ops/g2-crank/pyth.mjs');
    const data = Buffer.alloc(PRICE_UPDATE_V2_LAYOUT_LEN);
    data.writeBigInt64LE(100n, OFFSETS.publish_time);
    data.writeBigInt64LE(7n, OFFSETS.posted_slot);
    const r = await observeOnce({
      connection: { getAccountInfo: async () => ({ data }) },
      web3, priceAccount: 'Price111', needs, now: 120, sent: new Set(), log: () => {},
    });
    // BigInt, not Number, and that is worth pinning rather than papering over:
    // the decoder returns i64 fields as BigInt while a Need's targetTs arrives
    // from JSON as a Number. JavaScript permits < > <= >= across the two but NOT
    // === or arithmetic, so shouldCapture's comparisons are correct today and a
    // future `===` in that path would be silently always-false. This assertion
    // is where that fact is written down.
    eq(typeof r.print.publishTime, 'bigint', 'the decoder stopped returning i64 fields as BigInt');
    ok(r.print.publishTime === 100n, 'the decoded publish_time did not come from the pinned offset');
    ok(r.print.publishTime >= needs[0].targetTs,
      'a BigInt publish_time no longer compares against a Number targetTs, which is what shouldCapture does');
    eq(r.tick.actions.length, 1, 'an admissible print at the target was not captured');
    eq(r.tick.actions[0].instruction, 'capture_first', 'the first admissible print used the wrong instruction');
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`ok - Needs are named not discovered, and an unreadable account is not an empty one (${checks} checks)`);
