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
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { verdictFor, gateExit, tapCount, runSuite, confirmationNote } from '../scripts/suite-verdict.mjs';

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
  const { scripts } = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.match(deploy, /^call npm run test:release(?:[ \t]+>>[^\r\n]*)?\r?\nif errorlevel 1 goto :testfail$/m,
    'DEPLOY.cmd must run the complete release gate and stop if it fails');
  assert.equal(scripts['test:release'], 'npm test && npm run test:private-restore',
    'the release gate must require CI checks before the mandatory private restore');
  assert.match(scripts['test:private-restore'],
    /^node --test --test-reporter=tap test\/private\/test_supabase_final_snapshot_restore\.mjs$/,
    'private restore must execute the actual historical-backup test');
  assert.ok(!/RATCHET_ALLOW_SKIPS/.test(deploy),
    'DEPLOY.cmd must never set RATCHET_ALLOW_SKIPS: a release may not ship on suites that did not run');
});

// A gate that never returns is not a gate. On 2026-09-05 a full run sat past
// test_settle.mjs for over ten minutes and never came back, with DEPLOY.cmd
// waiting on that very command and no output naming the file. Driven against a
// real sleeping child so the kill path itself is exercised, not just the label.
test('a suite that will not finish is killed and named, not waited on', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ratchetx-hang-'));
  const file = path.join(dir, 'test_sleeper.mjs');
  fs.writeFileSync(file, 'setInterval(() => {}, 1000); console.log("started and never ends");\n');
  const started = Date.now();
  const r = await runSuite(file, { execPath: process.execPath, cwd: dir, timeoutMs: 400, spawn });
  const elapsed = Date.now() - started;
  fs.rmSync(dir, { recursive: true });
  assert.equal(r.timedOut, true);
  assert.equal(verdictFor(r).status, 'hung');
  assert.ok(/killed after 400 ms/.test(r.out), 'the output says why it stopped');
  assert.ok(elapsed < 10_000, `the runner returned in ${elapsed} ms instead of waiting forever`);
});

test('a suite that finishes in time is not called hung', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ratchetx-quick-'));
  const file = path.join(dir, 'test_quick.mjs');
  fs.writeFileSync(file, 'console.log("done");\n');
  const r = await runSuite(file, { execPath: process.execPath, cwd: dir, timeoutMs: 30_000, spawn });
  fs.rmSync(dir, { recursive: true });
  assert.equal(r.timedOut, false);
  assert.equal(r.code, 0);
  assert.equal(verdictFor(r).status, 'pass');
});

test('a hang outranks every other reading of the same run', () => {
  // Killed mid-suite, the child may still have printed a clean-looking TAP tail.
  const out = 'TAP version 13\n# tests 3\n# pass 3\n# fail 0\n# skipped 0\n# todo 0\n';
  assert.equal(verdictFor({ code: 0, out, timedOut: true }).status, 'hung');
  assert.equal(verdictFor({ code: null, out: '', timedOut: true }).status, 'hung');
});

// The timeout must not become the hang. SIGKILL is not prompt against a process
// blocked in uninterruptible I/O -- measured on the network-backed mount this
// repository is worked through, where one repo-walking suite spent 26.9 s of
// wall time against 0.5 s of user time -- and a runner that kills and then waits
// for the `close` it asked for waits forever. Driven with a child whose kill
// lands on nothing, exactly as it would against an unfinished read.
test('a child that will not die still does not stall the run', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ratchetx-unkillable-'));
  const file = path.join(dir, 'deaf.mjs');
  fs.writeFileSync(file, 'setInterval(() => {}, 1000);\n');
  let child = null;
  const started = Date.now();
  const r = await runSuite(file, {
    execPath: process.execPath, cwd: dir, timeoutMs: 300, graceMs: 200,
    spawn: (cmd, args, opts) => {
      child = spawn(cmd, args, opts);
      child.kill = () => {};   // the kill lands on nothing
      return child;
    },
  });
  const elapsed = Date.now() - started;
  // The runner is free of it; this test still has to bury its own child, or the
  // orphan's pipes keep THIS process alive and the demonstration becomes the bug.
  try { process.kill(child.pid, 'SIGKILL'); } catch {}
  child.stdout?.destroy();
  child.stderr?.destroy();
  child.unref?.();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  assert.equal(r.timedOut, true);
  assert.equal(verdictFor(r).status, 'hung');
  assert.ok(/still had not exited/.test(r.out), 'the output says the kill did not take');
  assert.ok(elapsed < 10_000, `the runner returned in ${elapsed} ms instead of waiting on a child that cannot die`);
});

// A second opinion is information, never leniency. Six agents edit this one
// checkout, so a sweep that reads a half-saved file reports a red that is not
// one -- measured 2026-09-05 on test_client_model_parity.mjs, FAIL then 14/14
// green seconds later. The runner now says which of the two it saw.
test('a failing suite is re-run once and the reader is told which run to trust', () => {
  assert.match(confirmationNote('fail', 'fail'), /confirmed by an immediate re-run/);
  assert.match(confirmationNote('fail', 'pass'), /may have been mid-edit/);
  assert.match(confirmationNote('fail', 'pass'), /still FAIL/);
  assert.match(confirmationNote('fail', 'hung'), /HUNG/);
  // Only a failure earns a second opinion; nothing else is annotated.
  for (const s of ['pass', 'dark', 'empty', 'hung'])
    assert.equal(confirmationNote(s, 'pass'), '', s + ' must not be annotated');
});

test('no note ever changes what the gate returns', () => {
  // The note is a string printed for a person. gateExit takes counters only, so
  // there is no path by which a re-run can turn a red gate green -- this pins
  // that the retry stayed on the reporting side of the line.
  assert.equal(gateExit({ failed: 1, skipped: 0, allowSkips: false }), 1);
  assert.equal(gateExit({ failed: 1, skipped: 0, allowSkips: true }), 1);
  assert.equal(gateExit({ failed: 0, skipped: 0, allowSkips: false }), 0);
});
