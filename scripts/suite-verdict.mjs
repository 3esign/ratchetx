// The release gate's judgement about one test suite -- and how it runs one --
// in one place, so both can be tested without running 127 suites.
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

// 'hung'  never finished; the runner killed it at the timeout
// 'pass'  proved something, nothing dark
// 'fail'  non-zero exit
// 'empty' exited 0 having asserted nothing -- a green report of coverage it does not have
// 'dark'  exited 0 but some cases skipped themselves inside the child process
export function verdictFor({ code, out, timedOut }) {
  const cases = tapCount(out, 'tests');
  const passed = tapCount(out, 'pass');
  const dark = (tapCount(out, 'skipped') || 0) + (tapCount(out, 'todo') || 0);
  // A gate that never returns is not a gate. On 2026-09-05 a full run sat past
  // test_settle.mjs for over ten minutes with no child alive and never came
  // back, while DEPLOY.cmd was waiting on exactly that command. A suite that
  // will not finish is a failure with a name, not a hang.
  if (timedOut) return { status: 'hung', cases, passed, dark };
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

// Running one suite is part of the judgement, because the timeout is: the same
// child that is judged has to be the one that gets killed. Kept here so a test
// can drive it against a deliberately sleeping script in milliseconds instead of
// waiting out a real release-gate timeout.
export function runSuite(file, { execPath, cwd, timeoutMs, spawn, graceMs = 5000 }) {
  return new Promise(res => {
    const p = spawn(execPath, [file], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', timedOut = false, done = false;
    const finish = (code, note) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearTimeout(grace);
      res({ file, code, out: note ? out + note : out, timedOut });
    };
    // SIGKILL is not always prompt: a process blocked in uninterruptible I/O --
    // measured here on a network-backed mount, where one repo-walking suite
    // spent 26.9 s of wall time against 0.5 s of user time -- stays alive until
    // that read returns, and `close` never fires. Killing and then WAITING for
    // the close we asked for is how a timeout becomes the hang it was added to
    // prevent, so the grace timer resolves regardless.
    let grace;
    const timer = setTimeout(() => {
      timedOut = true;
      p.kill('SIGKILL');
      grace = setTimeout(() => finish(null,
        `\n[runner] killed after ${timeoutMs} ms and still had not exited ${graceMs} ms later\n`), graceMs);
    }, timeoutMs);
    p.stdout.on('data', d => out += d);
    p.stderr.on('data', d => out += d);
    p.on('error', e => finish(null, `\n[runner] could not run it: ${e.message}\n`));
    p.on('close', code => finish(code,
      timedOut ? `\n[runner] killed after ${timeoutMs} ms without finishing\n` : ''));
  });
}
