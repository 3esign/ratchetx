import assert from 'node:assert';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { anchorFreshness } = require('../lib/anchor-health.js');

const now = 1_800_000_000_000;
const head = { i:3000 };
assert.equal(anchorFreshness({ anchor:null, head, nowMs:now }).status, 'grey');
assert.equal(anchorFreshness({ anchor:{ i:2800, t:now-3600_000 }, head, nowMs:now }).status, 'green');
assert.equal(anchorFreshness({ anchor:{ i:2400, t:now-25*3600_000 }, head, nowMs:now }).status, 'grey');
assert.equal(anchorFreshness({ anchor:{ i:999, t:now-3600_000 }, head, nowMs:now }).status, 'red');
assert.equal(anchorFreshness({ anchor:{ i:2999, t:now-73*3600_000 }, head, nowMs:now }).status, 'red');
console.log('anchor freshness: missing, green, warning, and red thresholds pass');
