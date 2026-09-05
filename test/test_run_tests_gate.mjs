// The release gate's own honesty, asserted without running 127 suites.
//
// This exists because of two measured false greens on 2026-09-05 (OpusB, host
// tier). `npm test` reported `ok` for:
//   test_supabase_final_snapshot_restore.mjs   # tests 1 # pass 0 # skipped 1   exit 0
//   test_deploy_input.mjs                      # tests 10 # pass 9 # skipped 1  exit 0
// The first asserted nothing at all. The second kept a DEPLOY.cmd release-gate
// assertion dark on every machine that is not Windows. The runner's `skipped`
// counter could see neither, because both happened inside the child process.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { verdictFor, gateExit, tapCount } from '../scripts/suite-verdict.mjs';

const tap = ({ tests = 1, pass = 1, fail = 0, skipped = 0, todo = 0 }) =>
  `TAP version 13\n1..${tests}\n# tests ${tests}\n# suites 0\n# pass ${pass}\n` +
  `# fail ${fail}\n# cancelled 0\n# skipped ${skipped}\n# todo ${todo}\n`;

test('a suite that proves something passes', () => {
  assert.equal(verdictFor({ code: 0, out: tap({ tests: 9, pass: 9 }) }).status, 'pass');
});

test('a non-zero exit is a failure whatever it printed', () => {
  assert.equal(verdictFor({ code: 1, out: tap({ tests: 4, pass: 3, fail: 1 }) }).status, 'fail');
  assert.equal(verdictFor({ code: 7, out: 'crashed before TAP' }).status, 'fail');
});

test('exit 0 with zero assertions passed is a failure, not a pass', () => {
  // The exact shape of test_supabase_final_snapshot_restore.mjs.
  const v = verdictFor({ code: 0, out: tap({ tests: 1, pass: 0, skipped: 1 }) });
  assert.equal(v.status, 'empty');
  assert.equal(v.cases, 1);
});

test('a case that skips itself inside the suite is counted, not hidden', () => {
  // The exact shape of test_deploy_input.mjs on a non-Windows machine.
  const v = verdictFor({ code: 0, out: tap({ tests: 10, pass: 9, skipped: 1 }) });
  assert.equal(v.status, 'dark');
  assert.equal(v.dark, 1);
  // todo counts the same way: a case that announces it is not really testing.
  assert.equal(verdictFor({ code: 0, out: tap({ tests: 3, pass: 2, todo: 1 }) }).status, 'dark');
});

test('a suite that prints no TAP counters is judged by its exit code alone', () => {
  assert.equal(verdictFor({ code: 0, out: 'all good\n' }).status, 'pass');
  assert.equal(tapCount('no counters here', 'pass'), null);
});

test('skips fail the gate unless a human accepts the gap', () => {
  assert.equal(gateExit({ failed: 0, skipped: 0, allowSkips: false }), 0);
  assert.equal(gateExit({ failed: 0, skipped: 6, allowSkips: false }), 1);
  assert.equal(gateExit({ failed: 0, skipped: 6, allowSkips: true }), 0);
  assert.equal(gateExit({ failed: 2, skipped: 0, allowSkips: false }), 1);
  // Accepting skips never forgives a real failure.
  assert.equal(gateExit({ failed: 2, skipped: 6, allowSkips: true }), 1);
});

test('DEPLOY.cmd never accepts the gap on the release path', () => {
  // Readable on any platform; this is a text assertion, not a Windows one.
  const deploy = fs.readFileSync(new URL('../DEPLOY.cmd', import.meta.url), 'utf8');
  assert.ok(/npm test/.test(deploy), 'DEPLOY.cmd must still run the full release gate');
  assert.ok(!/RATCHET_ALLOW_SKIPS/.test(deploy),
    'DEPLOY.cmd must never set RATCHET_ALLOW_SKIPS: a release may not ship on suites that did not run');
});
