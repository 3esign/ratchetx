import assert from 'node:assert';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { hashCommit, verifyCommit } = require('../lib/commit.js');

const base = { version:2, wallet:'Wallet111111111111111111111111111111111',
  shotId:'shot123', side:'YES', salt:'ab'.repeat(16) };
const commit = hashCommit(base);
assert.equal(verifyCommit({ ...base, commit }).matches, true);
assert.equal(verifyCommit({ ...base, wallet:'Other111111111111111111111111111111111', commit }).matches, false);
assert.equal(verifyCommit({ ...base, shotId:'shot124', commit }).matches, false);
assert.equal(verifyCommit({ ...base, salt:'cd'.repeat(16), commit }).matches, false);
const legacy = { version:1, side:'NO', salt:'1234' };
assert.equal(verifyCommit({ ...legacy, commit:hashCommit(legacy) }).matches, true);
console.log('commit verifier: v2 binding and legacy v1 compatibility pass');
