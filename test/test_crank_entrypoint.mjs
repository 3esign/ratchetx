// The crank's CLI guard, and the silent no-op it used to be on Windows.
//
// ops/g2-crank/crank.mjs decided whether it had been RUN by comparing
//
//     import.meta.url === `file://${process.argv[1]}`
//
// On POSIX that is accidentally correct. On Windows argv[1] is
// D:\Work\...\crank.mjs, so the glued string is file://D:\Work\...\crank.mjs
// while node's import.meta.url is file:///D:/Work/.../crank.mjs. They never
// match, and the failure is not an error: the command runs, prints NOTHING, and
// EXITS 0.
//
// This project has spent a whole day removing exactly that shape - a check that
// silently did not happen and reported success. crank.mjs itself refuses to
// return an empty account list for the same reason, in readState: a crank with
// nothing to do and a crank that cannot see anything look identical from
// outside. A crank that never started looks like both.
//
// The converter is injected so BOTH platforms' path shapes are proved from
// either platform. Nothing here touches a network, a key, or a chain.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { isCliEntrypoint } from '../ops/g2-crank/crank.mjs';

let checks = 0;
const ok = (cond, msg) => { checks += 1; assert.ok(cond, msg); };

// A stand-in for node's own Windows conversion, enough for this predicate:
// backslashes become forward slashes and the drive gets the third slash.
const windowsToFileUrl = p => {
  if (!/^[A-Za-z]:[\\/]/.test(p)) throw new TypeError(`not an absolute Windows path: ${p}`);
  return new URL('file:///' + p.replace(/\\/g, '/'));
};
const WIN_PATH = 'D:\\Work\\Software_Projects\\pumpmind\\ratchetx\\ratchet_phase_a_clean\\ops\\g2-crank\\crank.mjs';
const WIN_URL = 'file:///D:/Work/Software_Projects/pumpmind/ratchetx/ratchet_phase_a_clean/ops/g2-crank/crank.mjs';

// ---- the bug, pinned --------------------------------------------------------
ok(WIN_URL !== `file://${WIN_PATH}`,
  'the old expression is claimed to be broken on Windows, but it matched. If this ever passes, the '
  + 'reason for this whole file is gone and it should be deleted rather than weakened.');

// ---- the fix ----------------------------------------------------------------
ok(isCliEntrypoint(WIN_URL, WIN_PATH, windowsToFileUrl),
  'crank.mjs run directly on Windows is NOT recognised as the entrypoint, so it would exit 0 having '
  + 'done nothing');

const POSIX_PATH = '/home/claude/ratchet/ops/g2-crank/crank.mjs';
ok(isCliEntrypoint(pathToFileURL(POSIX_PATH).href, POSIX_PATH, pathToFileURL),
  'crank.mjs run directly on POSIX is not recognised as the entrypoint');

// ---- and it must still say NO when it is imported ---------------------------
ok(!isCliEntrypoint(WIN_URL, 'D:\\Work\\other\\runner.mjs', windowsToFileUrl),
  'a DIFFERENT script was run, but crank.mjs claimed to be the entrypoint - importing it would '
  + 'start a crank nobody asked for');
ok(!isCliEntrypoint(pathToFileURL(POSIX_PATH).href, '/home/claude/ratchet/test/some_test.mjs', pathToFileURL),
  'a test importing crank.mjs would run the crank');

// A path node cannot convert is not this module, and must not throw out of the
// guard: an unparseable argv[1] would otherwise crash every importer.
for (const bad of [undefined, null, '', 42, {}, 'relative/path.mjs']) {
  ok(isCliEntrypoint(WIN_URL, bad, windowsToFileUrl) === false,
    `argv[1] of ${JSON.stringify(bad)} did not return a plain false`);
}

console.log(`ok - the crank knows whether it was run, on both path shapes (${checks} checks)`);
