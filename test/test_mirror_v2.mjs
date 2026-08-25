import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const { parseMirrorSeal } = require('../api/game.js');
const source = fs.readFileSync(new URL('../api/game.js', import.meta.url), 'utf8');
const ui = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8') + fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const disc = Buffer.from('66caaba31b9869f2', 'hex');
const nonce = Buffer.alloc(8); nonce.writeBigUInt64LE(123456789n);
const commit = Buffer.alloc(32, 0xab);
const str = value => {
  const bytes = Buffer.from(value, 'utf8');
  const len = Buffer.alloc(4); len.writeUInt32LE(bytes.length);
  return Buffer.concat([len, bytes]);
};
const shotId = 'abc123xy';
const feed = 'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d';
const expiry = Buffer.alloc(8); expiry.writeBigInt64LE(1_788_000_000n);
const threshold = Buffer.alloc(8); threshold.writeBigInt64LE(123_456_789_012_345_678n);
const encoded = Buffer.concat([disc, nonce, commit, str(shotId), str(feed), expiry, Buffer.from([1]), threshold]);

const parsed = parseMirrorSeal(encoded);
assert.deepEqual(parsed, {
  nonce: 123456789n,
  commit: 'ab'.repeat(32),
  shotId,
  feed,
  expiry: 1_788_000_000,
  kind: 1,
  thresholdE12: 123_456_789_012_345_678n,
});
assert.equal(parseMirrorSeal(Buffer.concat([encoded, Buffer.from([0])])), null,
  'trailing bytes must invalidate the receipt');
const legacy = Buffer.concat([disc, nonce, commit, str(feed), expiry, Buffer.from([1]), threshold]);
assert.equal(parseMirrorSeal(legacy), null, 'legacy seal data without shot_id must be rejected');
const uppercaseId = Buffer.concat([disc, nonce, commit, str('ABC'), str(feed), expiry, Buffer.from([1]), threshold]);
assert.equal(parseMirrorSeal(uppercaseId), null, 'non-canonical shot ids must be rejected');
assert.match(source, /priceToE12\(shot\.thresh\)/, 'thresholds use the v2 e12 converter');
assert.doesNotMatch(source, /p\.xp \+= 100|bumpLadder\(w, 100/, 'sealing cannot buy ladder XP');
assert.match(source, /seal\.shotId !== shot\.id/, 'confirmation binds the receipt to the game shot id');
assert.match(source, /accounts\[1\] !== w/, 'confirmation binds the instruction player account');
assert.match(source, /shot\.mirrorSig === sig/, 'same confirmed signature is idempotent');
assert.match(source, /prior\.sig !== sig/, 'interrupted saves can repair only the same verified receipt');
assert.match(ui, /const targetRows=Object\.entries\(s\.targets\)\.sort/, 'eligible beta target is surfaced without changing the board');
assert.match(ui, /class="mirrorRow"/, 'seal control renders in its own chamber row');
assert.doesNotMatch(ui, /rows\[i\] = rows\[i\]\.replace/, 'seal control is not injected into an arbitrary nested div');
assert.match(ui, /for\(let attempt=0;attempt<6;attempt\+\+\)/, 'wallet confirmation retries boundedly while RPC catches up');
console.log('MIRROR V2 ADAPTER OK');