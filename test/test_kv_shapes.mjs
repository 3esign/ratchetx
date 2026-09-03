// The Redis type of every key is declared in one place, and both the
// application and the importer read that one place.
//
// This exists because they did not. tools/kv_import.mjs inferred types from key
// names -- h:* a hash, z:* a sorted set, everything else a string -- and five
// hash families never followed that convention. They imported as strings. Every
// HGETALL against them threw WRONGTYPE, /api/game?action=pyth-context returned
// 500, and the Bankr skill reported RELEASE_MISMATCH, because a dead endpoint
// has no version string and the version check runs first.
//
// Three separate things had to be true for that to reach a player, and this
// file pins all three: the declaration is complete, lib/kv.js enforces it, and
// nothing in the codebase uses a hash or sorted-set key the declaration has
// never heard of.
import assert from 'node:assert';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
const require = createRequire(import.meta.url);
const shapes = require('../lib/kv_shapes.js');
const kv = require('../lib/kv.js');
const at = p => new URL('../' + p, import.meta.url);
const read = p => fs.readFileSync(at(p), 'utf8');

test('every key family the code actually uses is declared', () => {
  // The literal keys, and the constants that hold them, as of ruleset h113.
  // A new one added without a declaration fails the enforcement test below the
  // first time it is exercised; this list is the record of what was audited.
  const HASHES = ['h:stats', 'g:fh', 'ldg:rx', 'ldg4:dropped',
    'odds:2026-09-03T10', 'funnel_daily:2026-09-03'];
  const ZSETS = ['z:lb:2026-s3', 'z:lbd:2026-09-03', 'z:lba:all'];
  for (const k of HASHES) assert.equal(shapes.shapeOf(k), 'hash', `${k} must be declared a hash`);
  for (const k of ZSETS) assert.equal(shapes.shapeOf(k), 'zset', `${k} must be declared a sorted set`);
});

test('everything else is a string, including the families that look close', () => {
  for (const k of ['u:HXFDabc', 'px:2026-09-03T10', 'pxu:2026-09-03T10',
    'g:warden:rec', 'g:fh:live:24', 'g:log:c:1', 'lease:x', 'odds', 'zoo:1', 'hats:1']) {
    assert.equal(shapes.shapeOf(k), 'string', `${k} must not be treated as a hash or a sorted set`);
  }
  // g:fh is a hash; g:fh:live:24 is a JSON string cache. One character apart,
  // and the difference is the whole bug -- so it is a test, not a comment.
  assert.equal(shapes.shapeOf('g:fh'), 'hash');
  assert.equal(shapes.shapeOf('g:fh:live:24'), 'string');
});

test('lib/kv.js refuses an undeclared key rather than creating one', async () => {
  const cases = [
    ['zincr', () => kv.zincr('made-up-ladder', 1, 'alice')],
    ['zmax', () => kv.zmax('made-up-ladder', 1, 'alice')],
    ['ztop', () => kv.ztop('made-up-ladder', 3)],
    ['hincr', () => kv.hincr('made-up-counters', 'a', 1)],
    ['hincrMany', () => kv.hincrMany('made-up-counters', { a: 1 })],
    ['hall', () => kv.hall('made-up-counters')],
    ['hseed', () => kv.hseed('made-up-counters', { a: 1 })],
    ['applyOnce', () => kv.applyOnce('gate:1', {}, { hashKey: 'made-up-counters', deltas: { a: 1 } })],
    ['zincrManyOnce', () => kv.zincrManyOnce('gate:2', {}, [['made-up-ladder', 'alice', 1]])],
  ];
  for (const [name, run] of cases) {
    await assert.rejects(async () => run(),
      e => e.code === 'KV_SHAPE_UNDECLARED',
      `${name} must refuse a key whose shape is not declared`);
  }
  // And a declared one still works, so the guard is a filter and not a wall.
  await kv.hincr('h:stats', 'shapecheck', 1);
  assert.equal((await kv.hall('h:stats')).shapecheck, 1);
});

test('the importer decides types from the declaration, not from key names', () => {
  const src = read('tools/kv_import.mjs');
  assert.ok(/require\(['"]\.\.\/lib\/kv_shapes\.js['"]\)/.test(src),
    'kv_import must read lib/kv_shapes.js');
  assert.ok(/shapeOf\(key\)/.test(src), 'kv_import must classify with shapeOf');
  assert.ok(!/key\.startsWith\(['"]h:['"]\)/.test(src) && !/key\.startsWith\(['"]z:['"]\)/.test(src),
    'kv_import must not infer a Redis type from a key prefix -- that is the bug this file exists for');
});

test('the repair tool rebuilds from the store and asks before it writes', () => {
  const src = read('tools/kv_repair_shapes.mjs');
  assert.ok(/require\(['"]\.\.\/lib\/kv_shapes\.js['"]\)/.test(src),
    'the repair tool must use the same declaration as everything else');
  assert.ok(/'SCAN'/.test(src), 'it must SCAN a live store, never KEYS');
  assert.ok(/go !== 'REPAIR'/.test(src), 'it must not write without an explicit REPAIR');
  assert.ok(/GET/.test(src) && !/readFileSync/.test(src),
    'values must come from the store being repaired, never from a file');
});

test('a health report survives counters it cannot read', async () => {
  // The 500 that reached a player was a telemetry hash taking down the endpoint
  // that gameplay reads. A missing statistic must report itself missing.
  const src = read('lib/feedhealth.js');
  assert.ok(/settleUnavailable/.test(src), 'the report must be able to say the counters were unreadable');
  assert.ok(/let settle = null/.test(src), 'settle must be null when unknown, never a fabricated zero');
});
