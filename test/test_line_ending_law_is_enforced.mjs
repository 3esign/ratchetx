// .gitattributes states a line-ending law. Nothing enforced it, and git cannot.
//
// The law, in the repo's own words at .gitattributes:3 - "Windows batch files
// MUST stay CRLF or cmd.exe silently misparses them." Code is eol=lf, *.cmd is
// eol=crlf.
//
// THE PROBLEM THIS FILE EXISTS FOR: git status CANNOT SEE A VIOLATION. With
// eol=crlf, git normalises the worktree file to LF before comparing it with the
// index, so a .cmd file that has been converted to LF compares EQUAL and reports
// CLEAN. The file is broken for the only program that runs it, and every tool we
// have says the tree is fine.
//
// That is not hypothetical. On 2026-09-05 three tracked .cmd files were in
// violation and all three were invisible: REHEARSE_CEREMONY_DEVNET.cmd was
// entirely LF, DEPLOY.cmd had 12 mixed lines, STOCK_CADENCE.cmd had 2. Two of
// them are on the release path. I converted a fourth, BUILD_G2.cmd, myself, with
// a mutation harness that read the file as text and wrote it back - and git
// showed me a modified file with an EMPTY diff, which reads as noise.
//
// Any agent editing from Linux does this by default. Python's open() in text
// mode translates CRLF to LF on read and writes LF on write. So does most
// tooling. The law needs an enforcer that looks at bytes.
//
// Evidence tier: host.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let checks = 0;

// --- the law, read from .gitattributes rather than copied out of it ----------
// If somebody changes the policy, this test follows it. If somebody DELETES the
// policy, this test fails rather than quietly enforcing nothing.

const attributes = readFileSync(join(ROOT, '.gitattributes'), 'utf8');
const ruleFor = eol => attributes
  .split('\n')
  .filter(line => !line.trimStart().startsWith('#'))
  .map(line => line.match(new RegExp(`^\\s*\\*(\\.\\w+)\\s+text\\s+eol=${eol}\\s*$`)))
  .filter(Boolean)
  .map(match => match[1]);

const CRLF_EXTENSIONS = ruleFor('crlf');
const LF_EXTENSIONS = ruleFor('lf');

checks += 1;
assert.deepEqual(CRLF_EXTENSIONS, ['.cmd'],
  'the set of CRLF-mandated extensions changed. If that was deliberate, this ' +
  'test now covers a different set of files and the change is worth saying out ' +
  `loud. Found: ${CRLF_EXTENSIONS.join(', ') || '(none)'}`);
checks += 1;
assert.ok(LF_EXTENSIONS.length >= 8,
  `only ${LF_EXTENSIONS.length} LF-mandated extensions found; the .gitattributes ` +
  'reader is probably broken rather than the policy');

// --- the files ---------------------------------------------------------------

// The law governs tracked files. Ask Git for that exact inventory; a filesystem
// walk can include untracked scratch files and miss tracked ignored files.
const inventory = spawnSync('git', ['--no-optional-locks', 'ls-files', '--cached', '-z'], {
  cwd: ROOT,
  encoding: 'utf8',
  windowsHide: true,
  maxBuffer: 8 * 1024 * 1024,
});
checks += 1;
assert.ifError(inventory.error);
checks += 1;
assert.equal(inventory.status, 0,
  'Git could not enumerate tracked files: ' + (inventory.stderr || inventory.signal || 'unknown error'));
const trackedPaths = inventory.stdout.split('\0').filter(Boolean);
const files = trackedPaths.map(path => join(ROOT, path));
checks += 1;
assert.ok(files.length > 200,
  'only ' + files.length + ' tracked files found; this test is passing by not looking');
checks += 1;
for (const path of files) {
  assert.ok(statSync(path).isFile(), 'tracked path is not a regular file: ' + path);
}

// --- 1. every CRLF file is CRLF on EVERY line, not most of them --------------
// Mixed endings are the dangerous state and the one a careless repair leaves
// behind: DEPLOY.cmd was 139 CRLF lines and 12 LF ones, which no tool reported.

const crlfViolations = [];
for (const path of files) {
  if (!CRLF_EXTENSIONS.includes(extname(path))) continue;
  const bytes = readFileSync(path);
  let lone = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    if (bytes[i] === 0x0a && (i === 0 || bytes[i - 1] !== 0x0d)) lone += 1;
  }
  if (lone > 0) {
    const total = bytes.filter(b => b === 0x0a).length;
    crlfViolations.push(
      `${relative(ROOT, path)}: ${lone} of ${total} lines end LF, not CRLF`);
  }
}

checks += 1;
assert.deepEqual(crlfViolations, [],
  '\n\nLINE-ENDING LAW VIOLATED, AND GIT CANNOT SEE IT.\n\n' +
  `${crlfViolations.join('\n')}\n\n` +
  '.gitattributes:3 says these MUST stay CRLF or cmd.exe silently misparses\n' +
  'them. Because the attribute normalises the worktree to LF before comparing,\n' +
  'git status reports these files CLEAN. There is no other check.\n\n' +
  'To repair without touching content, rewrite lone \\n as \\r\\n in place. Do\n' +
  'NOT edit the file with anything that reads it as text and writes it back -\n' +
  'that is how they got this way.\n');

// --- 2. the LF direction: a ratchet, and a hard line where it matters -------
// The existing allowance is 109 LF-mandated files with CRLF: pre-existing h69 damage
// - the exact thing the comment at .gitattributes:2 was written about, a
// 5,328-line no-op diff burying a real change - and normalising all of them now
// would produce the very diff the law exists to prevent, on the day of a source
// freeze. So this is deliberately TWO checks of different strengths.
//
// A count ratchet is weaker than a list of paths: fixing one file and breaking
// another leaves it green. It is chosen anyway because a 109-path list would go
// red on every routine edit and get deleted within a week, and a check people
// delete is worth less than a weak one they keep. The hard line below is where
// the strength is.

const lfFiles = files.filter(path => LF_EXTENSIONS.includes(extname(path)));
const lfViolations = [];
for (const path of lfFiles) {
  const bytes = readFileSync(path);
  let crlf = 0;
  for (let i = 1; i < bytes.length; i += 1) {
    if (bytes[i] === 0x0a && bytes[i - 1] === 0x0d) crlf += 1;
  }
  if (crlf > 0) lfViolations.push(relative(ROOT, path).split(sep).join('/'));
}
lfViolations.sort();

const KNOWN_LF_VIOLATIONS = 109;
checks += 1;
assert.ok(lfViolations.length <= KNOWN_LF_VIOLATIONS,
  `LF-mandated files containing CRLF went from ${KNOWN_LF_VIOLATIONS} to ` +
  `${lfViolations.length}. Something was edited on Windows and written back ` +
  'with CRLF, which is the h69 defect: the next real change to that file will ' +
  `be buried in a whole-file diff.\n\n${lfViolations.join('\n')}\n\n` +
  'To repair: rewrite \\r\\n as \\n in place. Then LOWER the number in this ' +
  'file, so the ratchet only ever tightens.');
// A clean checkout follows eol=lf and may have zero violations. Coverage must
// count inspected files, not require pre-existing line-ending damage.
checks += 1;
assert.ok(lfFiles.length > 200,
  'only ' + lfFiles.length + ' LF-mandated tracked files inspected; coverage is incomplete');
checks += 1;
for (const entry of [
  'onchain/ratchet-core-g2/programs/ratchet-core-g2/src/lib.rs',
  'onchain/rcx-timepin-v2/programs/rcx-timepin-v2/src/lib.rs',
]) {
  assert.ok(lfFiles.includes(join(ROOT, entry)),
    'live program entry point is missing from LF coverage: ' + entry);
}

// THE HARD LINE. The two crates that are actually being built and frozen carry
// ZERO violations today, and that is worth keeping as an absolute rather than a
// ratchet: a CRLF flip inside a program source is a diff nobody can review on
// the day the ELF hash gets locked.
const LIVE_CRATES = [
  'onchain/ratchet-core-g2/programs/',
  'onchain/rcx-timepin-v2/programs/',
];
const inLiveCrate = lfViolations.filter(
  file => LIVE_CRATES.some(crate => file.startsWith(crate)),
);
checks += 1;
assert.deepEqual(inLiveCrate, [],
  'CRLF has appeared inside a program crate that is being built and frozen:\n' +
  `${inLiveCrate.join('\n')}\n` +
  'Fix this before any build. A whole-file ending flip in a source file is a ' +
  'diff nobody can review, on the day the ELF hash is locked to it.');

console.log(
  `line-ending law is enforced: ${checks} checks passed (host tier; ` +
  `${files.length} files, ${CRLF_EXTENSIONS.join(' ')} must be CRLF)`,
);
