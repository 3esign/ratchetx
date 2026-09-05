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
import { readFileSync, readdirSync, statSync } from 'node:fs';
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

// The law is a .gitattributes law, so it governs TRACKED files. Ignored
// directories are skipped, and the ignore list is READ rather than copied - a
// hardcoded skip list would either miss a new one or, worse, quietly stop
// covering a directory somebody added to .gitignore for an unrelated reason.
// backups/ is the one that matters today: it holds 30-odd .cmd files that are
// deliberately not tracked and not subject to anything.
const ignore = readFileSync(join(ROOT, '.gitignore'), 'utf8');
const IGNORED = ignore
  .split('\n')
  .map(line => line.trim())
  .filter(line => line && !line.startsWith('#') && !line.includes('*'))
  .map(line => line.replace(/\/$/, ''));
// Matched by BASENAME at any depth: a nested node_modules is still node_modules,
// and walking one on this mount takes longer than the whole rest of the tree.
const ALWAYS_SKIP = ['.git', 'node_modules', 'target', 'dist', '.vercel'];
const skipped = relativePath => ALWAYS_SKIP.includes(relativePath.split('/').pop())
  || IGNORED.includes(relativePath);
checks += 1;
assert.ok(IGNORED.includes('backups') && IGNORED.includes('node_modules')
  && IGNORED.includes('onchain/core-passport-benchmark/mpl-core'),
  'the .gitignore reader stopped finding directories it must skip; without ' +
  'them this test reports on files git does not track, including a vendored ' +
  `third-party crate. Read ${IGNORED.length} ignore paths.`);

const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (skipped(relative(ROOT, path).split(sep).join('/'))) continue;
    let info;
    try { info = statSync(path); } catch { continue; }
    if (info.isDirectory()) walk(path, out);
    else if (info.isFile()) out.push(path);
  }
  return out;
};
const files = walk(ROOT);
checks += 1;
assert.ok(files.length > 200,
  `only ${files.length} files walked; the walker is broken and this test is ` +
  'passing by not looking');

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
// 109 LF-mandated files currently contain CRLF. That is pre-existing h69 damage
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

const lfViolations = [];
for (const path of files) {
  if (!LF_EXTENSIONS.includes(extname(path))) continue;
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
checks += 1;
assert.ok(lfViolations.length >= KNOWN_LF_VIOLATIONS - 20,
  `only ${lfViolations.length} violations found against a known ${KNOWN_LF_VIOLATIONS}. ` +
  'Either somebody did a large normalisation pass - in which case lower the ' +
  'number here and say so - or this test stopped looking at most of the tree.');

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
