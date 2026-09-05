import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { selectSuites, spawnWithTap } from '../scripts/test-suite-selection.mjs';
import { verdictFor, gateExit } from '../scripts/suite-verdict.mjs';

const portable = ['test_z.mjs', 'fixture.mjs', 'test_a.mjs', 'windows', 'private/test_hidden.mjs'];
const windows = ['test_deploy_cmd.mjs', 'fixture.mjs', 'test_other.mjs'];

test('Linux and macOS run portable suites without claiming native Windows coverage', () => {
  for (const platform of ['linux', 'darwin'])
    assert.deepEqual(selectSuites(portable, windows, platform), ['test_a.mjs', 'test_z.mjs']);
});

test('Windows adds every native suite and retains every portable suite', () => {
  assert.deepEqual(selectSuites(portable, windows, 'win32'), [
    'test_a.mjs', 'test_z.mjs', 'windows/test_deploy_cmd.mjs', 'windows/test_other.mjs',
  ]);
});

test('missing Windows deployment coverage fails selection instead of silently passing', () => {
  assert.throws(() => selectSuites(portable, [], 'win32'), /missing.*test_deploy_cmd/);
});

test('real child TAP exposes passing, skipped, and empty suites to the strict gate', () => {
  for (const [code, expected] of [
    ["test('pass', () => {});", 'pass'],
    ["test('pass', () => {}); test.skip('skip', () => {});", 'dark'],
    ["test.skip('skip', () => {});", 'empty'],
  ]) {
    const child = spawnWithTap(spawnSync, process.execPath,
      ['--input-type=module', '-e', "import test from 'node:test'; " + code],
      { encoding: 'utf8', windowsHide: true, timeout: 10_000 });
    assert.equal(child.status, 0, child.stderr);
    assert.match(child.stdout, /^TAP version 13/m);
    const verdict = verdictFor({ code: child.status, out: child.stdout });
    assert.equal(verdict.status, expected);
    assert.equal(gateExit({ failed: expected === 'empty' ? 1 : 0,
      skipped: verdict.dark, allowSkips: false }), expected === 'pass' ? 0 : 1);
  }
});
