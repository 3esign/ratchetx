#!/usr/bin/env node
// Commit exactly the files you named, in a checkout several agents share.
//
//   node tools/git-commit-paths.mjs -m "subject" -- path [path...]
//   node tools/git-commit-paths.mjs -F - -- path [path...]      # message on stdin
//   --dry-run   say what it would do and stop
//
// Three things went wrong in this repository on 2026-09-05 and they were all the
// same thing. `git add <paths>` does not scope `git commit`: a bare commit writes
// THE WHOLE INDEX, including whatever another agent staged a second earlier.
// COMMIT_PENDING.cmd:43-49, COMMIT_CORE.cmd:43-49, COMMIT_V2_LAYER.cmd:34-37 and
// COMMIT_CADENCE_FIX.cmd:35-36 all do exactly that, and 1e9c13a swept two files
// belonging to somebody who was mid-commit. Those helpers are also batch, which
// no agent here can run, so the fix cannot live in them.
//
// `git commit --only -- <paths>` is the whole answer, and this wraps it with the
// two other lessons the same day taught:
//
//   * Stale locks. This mount denies unlink, so git cannot remove its own
//     .git/index.lock and the NEXT command dies on it. Moving one aside works --
//     but a killed commit leaves a FULL lock, so emptiness is not the test. AGE
//     is: a lock younger than the threshold may be a teammate writing right now,
//     and this refuses to touch it.
//   * Read back what landed. The commit is inspected afterwards and the run
//     FAILS if its file set is not exactly what you asked for. If something does
//     go wrong, it says so instead of burying a colleague's work in your commit.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Age alone is the wrong test on this mount, and measuring it said so.
//
// The first version refused any lock younger than 60 s, on the reasoning that a
// fresh lock means a live writer. Run against the real tree it refused every
// time: several agents commit here every minute, and because this filesystem
// denies unlink, EVERY git command leaves its locks behind. A fresh lock is
// therefore almost always litter from a command that already finished, not a
// writer. So the test is whether the lock is still MOVING: sampled twice, a lock
// whose mtime does not change is nobody's. The age floor stays as the second
// half of the AND, because a commit that writes its lock once at the end would
// otherwise look motionless for its whole run.
const STALE_LOCK_MS = Number(process.env.RATCHET_GIT_LOCK_STALE_MS) || 3_000;
const OBSERVE_MS = Number(process.env.RATCHET_GIT_LOCK_OBSERVE_MS) || 1_200;
// A real blocking wait, not a spin: this runs inside a synchronous path and a
// busy loop would burn a core and, worse, starve anything else on this thread.
const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const git = (root, args, input) => spawnSync('git', ['-C', root, ...args],
  { encoding: 'utf8', input, timeout: 120_000, maxBuffer: 32_000_000 });

// Only a lock nobody can still be holding. Reported, never silent: a lock is a
// symptom, and a tool that hides symptoms is how the next hour gets lost.
export function sweepStaleLocks(root, { now = Date.now(), staleMs = STALE_LOCK_MS, observeMs = OBSERVE_MS, quarantine } = {}) {
  const swept = [], held = [];
  // Every lock git writes directly in .git/, not a fixed list of two. `git commit
  // --only` builds a temporary index and leaves next-index-<pid>.lock behind on
  // this mount, which then blocks the NEXT --only commit -- found by running this
  // tool on itself, which is the only reason it is here.
  let names = [];
  try {
    names = fs.readdirSync(path.join(root, '.git')).filter(n => n.endsWith('.lock'));
  } catch { names = []; }
  for (const name of names) {
    const lock = path.join(root, '.git', name);
    let st;
    try { st = fs.statSync(lock); } catch { continue; }
    const age = now - st.mtimeMs;
    if (age < staleMs) { held.push({ name, ageMs: age, bytes: st.size, why: 'too new' }); continue; }
    // Still moving? Then somebody is writing it and it is not ours to take.
    if (observeMs > 0) {
      sleep(observeMs);
      let after;
      try { after = fs.statSync(lock); } catch { continue; }
      if (after.mtimeMs !== st.mtimeMs || after.size !== st.size) {
        held.push({ name, ageMs: age, bytes: after.size, why: 'still being written' });
        continue;
      }
    }
    // QUARANTINE LIVES UNDER .git, WITH A .bak SUFFIX, AND BOTH HALVES MATTER.
    //
    // It used to be <root>/_to_delete/stale-git-locks. That is inside the repo
    // and therefore inside the DEPLOY INPUT: on 2026-09-05 an earlier version of
    // this same idea put .git_lock_backups/ at the repo root and turned B3 red
    // with twenty untracked files - a lock-safety workaround that broke a
    // release-safety gate. Under .git it is invisible to every scanner that
    // matters, and it also renames within one directory, which is the only move
    // this mount reliably permits (the _to_delete form failed EACCES).
    //
    // The .bak suffix is not decoration either: a file still ending in .lock
    // inside .git is read by some git versions as a live lock.
    const dir = quarantine ?? path.join(root, '.git', 'ratchet-lock-quarantine');
    fs.mkdirSync(dir, { recursive: true });
    // Moved, not deleted: this mount denies unlink, and a lock is evidence.
    fs.renameSync(lock, path.join(dir, `${name}.${st.mtimeMs}.bak`));
    swept.push({ name, ageMs: age, bytes: st.size });
  }
  return { swept, held };
}

// The set of files a commit actually contains, straight from the object store.
export const filesInCommit = (root, rev = 'HEAD') => {
  const run = git(root, ['show', '--name-only', '--pretty=format:', rev]);
  if (run.status !== 0) throw new Error('could not read back the commit: ' + (run.stderr || '').trim());
  return run.stdout.split('\n').map(s => s.trim()).filter(Boolean).sort();
};

export const sameSet = (a, b) =>
  a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);

export function commitPaths(root, paths, { message, messageFile, dryRun = false, log = console.log } = {}) {
  if (!paths?.length) throw new Error('name the paths to commit; this tool never guesses');
  const locks = sweepStaleLocks(root);
  for (const l of locks.swept)
    log(`[lock] moved stale .git/${l.name} aside (${Math.round(l.ageMs / 1000)}s old, ${l.bytes} bytes)`);
  for (const l of locks.held)
    log(`[lock] .git/${l.name} left alone (${l.why}, ${Math.round(l.ageMs / 1000)}s old, ${l.bytes} bytes)`);
  if (dryRun) { log(`[dry-run] would commit exactly: ${paths.join(', ')}`); return { dryRun: true, paths }; }

  const added = git(root, ['add', '--', ...paths]);
  if (added.status !== 0) throw new Error('git add failed: ' + (added.stderr || '').trim());

  // --only is the point of this tool. Without it the commit takes the whole
  // index, and somebody else's staged work rides along under your message.
  const args = ['commit', '--only', ...(messageFile ? ['-F', messageFile] : ['-m', message]), '--', ...paths];
  const done = git(root, args, messageFile === '-' ? message : undefined);
  if (done.status !== 0) throw new Error('git commit failed: ' + ((done.stderr || done.stdout) || '').trim());

  const landed = filesInCommit(root);
  const asked = [...paths].map(p => p.replace(/\\/g, '/')).sort();
  if (!sameSet(landed, asked)) {
    const extra = landed.filter(f => !asked.includes(f));
    throw new Error('THE COMMIT IS NOT WHAT YOU ASKED FOR. It contains '
      + `${landed.length} file(s) and you named ${asked.length}.`
      + (extra.length ? ` Not yours: ${extra.join(', ')}.` : '')
      + ' Tell the room before doing anything else — this is how a colleague loses work.');
  }
  const head = git(root, ['rev-parse', '--short', 'HEAD']).stdout.trim();
  log(`[ok] ${head} contains exactly the ${landed.length} file(s) you named`);
  return { head, files: landed };
}

const invokedDirectly = process.argv[1]
  // fileURLToPath, not URL.pathname: on Windows the pathname is "/D:/..." and path.resolve
  // turned it into "D:\D:\...", so this guard was false on every Windows body and the tool
  // exited 0 having committed nothing (found 2026-09-08, three commits that never happened).
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  const argv = process.argv.slice(2);
  const sep = argv.indexOf('--');
  const paths = sep === -1 ? [] : argv.slice(sep + 1);
  const head = sep === -1 ? argv : argv.slice(0, sep);
  const dryRun = head.includes('--dry-run');
  const mi = head.indexOf('-m'), fi = head.indexOf('-F');
  const message = mi !== -1 ? head[mi + 1] : (fi !== -1 ? fs.readFileSync(0, 'utf8') : null);
  if (!paths.length || (!message && !dryRun)) {
    console.error('usage: node tools/git-commit-paths.mjs -m "subject" -- path [path...]');
    console.error('       node tools/git-commit-paths.mjs -F - -- path [path...]   (message on stdin)');
    process.exit(2);
  }
  try {
    commitPaths(process.cwd(), paths, { message, messageFile: fi !== -1 ? '-' : undefined, dryRun });
  } catch (e) { console.error('[FAIL] ' + e.message); process.exit(1); }
}
