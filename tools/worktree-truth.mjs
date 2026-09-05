#!/usr/bin/env node
// What the compiler reads is not always what git contains. Say which.
//
// 2026-09-05, 15:35: Opus B compiled ratchet-core-g2 and found
// `self.terminal_mask >> self.pending_count` - the u16 overflow shift that had
// been fixed and committed three hours earlier. The commit was correct. THE
// WORKING TREE WAS NOT: that one expression had been reverted in place, while
// the six-line comment above it explaining the u32 fix was left untouched. It
// cost eleven blocking gate rows and three agents' attention, and the only
// reason it surfaced at all is that somebody happened to run a compiler.
//
// Nothing reported it because nothing was asking. `git status` said "M" - the
// same "M" that a hundred line-ending files say - and `git show HEAD` said the
// fix was there, which it was. Neither question is "does the file the compiler
// will read match the file git has".
//
// Uncommitted work is normal and this tool does not scold you for it. It just
// NAMES the divergence, so that a file differing from HEAD is a fact you know
// rather than a mystery you debug through a compiler.
//
// Run it before staging sources into a container, before regenerating a compile
// receipt, and after any edit that matters.
//
//   node tools/worktree-truth.mjs            # program sources
//   node tools/worktree-truth.mjs --all      # every tracked file
//
// Exit code is 0 when everything matches, 1 when anything diverges, 2 when the
// tool could not do its job - which is never reported as "everything matches".

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const all = process.argv.includes('--all');

// The default set is the two crates that are being built and frozen, plus the
// off-chain mirror and the manifest. A divergence in any of these means an
// artifact, a receipt or a registration would be built from something that is
// not in git.
const DEFAULT_PATHS = [
  'onchain/ratchet-core-g2/programs/ratchet-core-g2/src/lib.rs',
  'onchain/ratchet-core-g2/programs/ratchet-core-g2/src/state.rs',
  'onchain/ratchet-core-g2/programs/ratchet-core-g2/src/foreign_timepin.rs',
  'onchain/rcx-timepin-v2/programs/rcx-timepin-v2/src/lib.rs',
  'onchain/rcx-timepin-v2/programs/rcx-timepin-v2/src/lifecycle.rs',
  'onchain/ratchet-core-g2/model.mjs',
  'releases/g2-mainnet-economy.json',
  'BUILD_G2.cmd',
];

const sha = buffer => createHash('sha256').update(buffer).digest('hex');

// git stores text normalised to LF and applies eol= on checkout, so a blob read
// with `git show` is NOT what the worktree is supposed to contain. For a *.cmd
// under `text eol=crlf`, HEAD holds LF and the correct worktree holds CRLF -
// comparing the raw blob would flag every batch file in the repo as diverged
// and teach everyone to ignore this tool within a day.
//
// So HEAD is MATERIALISED the way checkout would write it, from the same
// .gitattributes the law lives in. That also means a .cmd somebody flattened to
// LF now shows up here as a real divergence, which is the second defect of the
// day and the reason this is worth getting right rather than special-casing.
const attributes = readFileSync(join(ROOT, '.gitattributes'), 'utf8');
const CRLF_EXTENSIONS = attributes
  .split('\n')
  .filter(line => !line.trimStart().startsWith('#'))
  .map(line => line.match(/^\s*\*(\.\w+)\s+text\s+eol=crlf\s*$/))
  .filter(Boolean)
  .map(match => match[1]);

const materialise = (blob, path) => {
  if (!CRLF_EXTENSIONS.some(extension => path.endsWith(extension))) return blob;
  return Buffer.from(blob.toString('binary').replace(/(?<!\r)\n/g, '\r\n'), 'binary');
};

// git ls-files and git show are READ-ONLY and take no index lock, which matters
// on this mount: a lock left behind blocks every writing command in the repo.
const git = args => execFileSync('git', args, { cwd: ROOT, maxBuffer: 1 << 28 });

let paths;
try {
  paths = all
    ? git(['ls-files', '-z']).toString('utf8').split('\0').filter(Boolean)
    : DEFAULT_PATHS;
} catch (error) {
  console.error(`worktree-truth: cannot list files: ${error.message}`);
  process.exit(2);
}

const diverged = [];
const missing = [];
let compared = 0;

for (const path of paths) {
  const full = join(ROOT, path);
  if (!existsSync(full)) { missing.push(path); continue; }
  let head;
  try {
    head = materialise(git(['show', `HEAD:${path}`]), path);
  } catch {
    // Untracked, or added but never committed. Not a divergence: there is
    // nothing to diverge FROM, and saying so is more useful than a warning.
    missing.push(`${path} (not in HEAD)`);
    continue;
  }
  compared += 1;
  const worktree = readFileSync(full);
  // Compared as BYTES. A line-ending flip is a real difference to cmd.exe and
  // to a hash, and normalising it away here would hide the second defect this
  // tool was written for.
  if (sha(worktree) !== sha(head)) {
    diverged.push({
      path,
      head: sha(head).slice(0, 12),
      worktree: sha(worktree).slice(0, 12),
      bytes: worktree.length - head.length,
    });
  }
}

if (compared === 0) {
  console.error('worktree-truth: compared nothing. That is a failure, not a pass.');
  process.exit(2);
}

for (const path of missing) console.log(`  absent   ${path}`);
for (const { path, head, worktree, bytes } of diverged) {
  const delta = bytes === 0 ? 'same length' : `${bytes > 0 ? '+' : ''}${bytes} bytes`;
  console.log(`  DIVERGED ${path}`);
  console.log(`           HEAD ${head}  worktree ${worktree}  (${delta})`);
}

if (diverged.length === 0) {
  console.log(
    `worktree matches HEAD: ${compared} file${compared === 1 ? '' : 's'} compared` +
    `${missing.length ? `, ${missing.length} absent` : ''}`,
  );
  process.exit(0);
}

console.log('');
console.log(`${diverged.length} of ${compared} files differ from HEAD.`);
console.log('If that is your own uncommitted work, this is just the inventory.');
console.log('If it is not, something edited the worktree under you: read the file,');
console.log('do not trust the last thing you wrote, and diff before you compile.');
console.log('A same-length divergence is the one to look at hardest - it is what an');
console.log('expression swapped in place looks like, and what a line-ending flip');
console.log('does NOT look like.');
process.exit(1);
