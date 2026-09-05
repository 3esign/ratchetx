// The release gate's judgement about one test suite, in one place, so it can be
// tested without running 127 suites.
//
// Why this is not inlined in run-tests.mjs: on 2026-09-05 the runner counted
// only its own two skip branches and exited on `failed ? 1 : 0`, so two
// different kinds of dark suite were reported green -- a suite that skipped
// itself inside its own process, and a suite that ran a case and asserted
// nothing (`# tests 1 # pass 0`). Neither was visible to the runner and neither
// was testable, because the decision lived inside a script that also serves
// HTTP, launches a browser and spawns 127 children on import.

// node:test prints its own counters in TAP. A suite that is not a node:test
// suite prints none, and returns null for every key -- that is not a failure,
// it just means the exit code is all we know about it.
export const tapCount = (out, key) => {
  const m = String(out).match(new RegExp(`^# ${key} (\\d+)$`, 'm'));
  return m ? Number(m[1]) : null;
};

// 'pass'  proved something, nothing dark
// 'fail'  non-zero exit
// 'empty' exited 0 having asserted nothing -- a green report of coverage it does not have
// 'dark'  exited 0 but some cases skipped themselves inside the child process
export function verdictFor({ code, out }) {
  const cases = tapCount(out, 'tests');
  const passed = tapCount(out, 'pass');
  const dark = (tapCount(out, 'skipped') || 0) + (tapCount(out, 'todo') || 0);
  if (code !== 0) return { status: 'fail', cases, passed, dark };
  if (cases !== null && cases > 0 && passed === 0) return { status: 'empty', cases, passed, dark };
  if (dark > 0) return { status: 'dark', cases, passed, dark };
  return { status: 'pass', cases, passed, dark };
}

// A skipped suite catches nothing, so it fails the gate. RATCHET_ALLOW_SKIPS is
// for a stranger on a fresh clone with no browser installed; DEPLOY.cmd must
// never set it, and test_run_tests_gate.mjs asserts that it does not.
export const gateExit = ({ failed, skipped, allowSkips }) =>
  (failed || (skipped && !allowSkips)) ? 1 : 0;
