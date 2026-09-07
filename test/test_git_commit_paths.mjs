// A commit must contain exactly the files its author named, in a checkout that
// several agents share.
//
// Three collisions on 2026-09-05, one cause: `git add <paths>` does not scope
// `git commit`. A bare commit writes the whole index, so it carries whatever
// another agent staged a second earlier. 1e9c13a swept two files belonging to
// somebody who was mid-commit; the same thing happened to a set of parity tests;
// and it happened again at 13:38. The four COMMIT_*.cmd helpers in this
// repository all still do it, and being batch, no agent here can run them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { commitPaths, sweepStaleLocks, filesInCommit } from '../tools/git-commit-paths.mjs';

function repo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ratchetx-commit-'));
  t.after(() => { try { fs.rmSync(root, { recursive: true, force: true }); } catch {} });
  execFileSync('git', ['init', '-q', root]);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'a@b.c']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 't']);
  const put = (name, body = 'x') => {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), body);
  };
  put('seed.txt'); execFileSync('git', ['-C', root, 'add', '-A']);
  execFileSync('git', ['-C', root, 'commit', '-qm', 'seed']);
  return { root, put, git: (...a) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8' }) };
}

test('a colleague staged mid-commit does not ride along', t => {
  const r = repo(t);
  r.put('mine.js', 'mine');
  r.put('docs/theirs.md', 'theirs');
  // Exactly the situation that lost work three times: someone else is staged.
  r.git('add', '--', 'docs/theirs.md');
  commitPaths(r.root, ['mine.js'], { message: 'only mine', log: () => {} });
  assert.deepEqual(filesInCommit(r.root), ['mine.js'], 'the commit is exactly what was named');
  // And their work is untouched, still staged, still theirs to commit.
  assert.match(r.git('diff', '--cached', '--name-only'), /docs\/theirs\.md/);
});

test('it refuses to guess when no path is named', t => {
  const r = repo(t);
  r.put('mine.js', 'mine');
  assert.throws(() => commitPaths(r.root, [], { message: 'x' }), /never guesses/);
});

test('a stale lock is moved aside and a fresh one is left alone', t => {
  const r = repo(t);
  const lock = path.join(r.root, '.git', 'index.lock');
  // A killed commit leaves a FULL lock, so size is not the test -- age is.
  fs.writeFileSync(lock, 'partial index bytes');
  const old = Date.now() - 5 * 60_000;
  fs.utimesSync(lock, new Date(old), new Date(old));
  const swept = sweepStaleLocks(r.root, { staleMs: 60_000 });
  assert.equal(swept.swept.length, 1);
  assert.equal(fs.existsSync(lock), false, 'the stale lock is gone from .git');
  const q = fs.readdirSync(path.join(r.root, '.git', 'ratchet-lock-quarantine'));
  assert.ok(q.length === 1 && q[0].startsWith('index.lock.') && q[0].endsWith('.bak'), 'moved, never deleted');

  fs.writeFileSync(lock, 'someone is writing right now');
  const held = sweepStaleLocks(r.root, { staleMs: 60_000, observeMs: 0 });
  assert.equal(held.swept.length, 0);
  assert.equal(held.held.length, 1, 'a lock inside the age floor is left alone');
  assert.equal(held.held[0].why, 'too new');
  assert.equal(fs.existsSync(lock), true);
  fs.rmSync(lock);
});

test('it commits several named paths together and nothing else', t => {
  const r = repo(t);
  r.put('a.js'); r.put('lib/b.js'); r.put('stray.txt');
  r.git('add', '--', 'stray.txt');
  const out = commitPaths(r.root, ['a.js', 'lib/b.js'], { message: 'two files', log: () => {} });
  assert.deepEqual(out.files, ['a.js', 'lib/b.js']);
  assert.match(r.git('diff', '--cached', '--name-only'), /stray\.txt/);
});

test('dry run changes nothing', t => {
  const r = repo(t);
  r.put('mine.js');
  const before = r.git('rev-parse', 'HEAD').trim();
  commitPaths(r.root, ['mine.js'], { message: 'x', dryRun: true, log: () => {} });
  assert.equal(r.git('rev-parse', 'HEAD').trim(), before, 'no commit was made');
});

// Age alone was the wrong test and the real tree proved it: several agents commit
// here every minute and this mount cannot unlink, so EVERY git command leaves its
// locks behind and a fresh lock is usually litter, not a writer. The tool refused
// to run at all under a 60 s age rule. What separates litter from a live writer
// is whether the lock is still moving.
test('a lock that is still being written is never taken', t => {
  const r = repo(t);
  const lock = path.join(r.root, '.git', 'index.lock');
  fs.writeFileSync(lock, 'start');
  const old = Date.now() - 5 * 60_000;
  fs.utimesSync(lock, new Date(old), new Date(old));
  // Past the age floor, but it grows while we watch it. The writer has to be
  // another PROCESS: sweepStaleLocks blocks this thread while it observes, which
  // is exactly what it does in real use, so a timer here would never fire.
  const writer = spawn(process.execPath, ['-e',
    `setTimeout(() => require('fs').appendFileSync(${JSON.stringify(lock)}, ' more'), 60)`],
    { stdio: 'ignore' });
  const out = sweepStaleLocks(r.root, { staleMs: 1, observeMs: 600 });
  writer.kill('SIGKILL');
  assert.equal(out.swept.length, 0, 'a growing lock stays put');
  assert.equal(out.held[0].why, 'still being written');
  fs.rmSync(lock);
});

test('a motionless lock past the age floor is litter and is taken', t => {
  const r = repo(t);
  const lock = path.join(r.root, '.git', 'index.lock');
  fs.writeFileSync(lock, 'abandoned by a killed commit');
  const old = Date.now() - 10_000;
  fs.utimesSync(lock, new Date(old), new Date(old));
  const out = sweepStaleLocks(r.root, { staleMs: 3_000, observeMs: 200 });
  assert.equal(out.swept.length, 1);
  assert.equal(fs.existsSync(lock), false);
});
