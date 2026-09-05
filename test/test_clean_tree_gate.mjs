// A folder deploy uploads the working tree, so "what went live" and "what is in
// a commit" are only the same thing if somebody checks. This is that check's
// test, and it exists because the gate it covers is invoked from DEPLOY.cmd --
// batch, which is the one language nobody working on this repository can run.
// The gate is therefore a node script, and this file is the reason we may say it
// works without deploying anything to find out.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const GATE = path.join(repo, 'scripts', 'check-clean-tree.mjs');

const runGate = (cwd, env = {}) => {
  const r = spawnSync(process.execPath, [GATE], {
    cwd, encoding: 'utf8', timeout: 60000,
    env: { ...process.env, RATCHET_DEPLOY_DIRTY: '', ...env },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 60000 });

function freshRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rx-cleantree-'));
  git(dir, 'init', '-q', '.');
  git(dir, 'config', 'user.email', 'gate@test.invalid');
  git(dir, 'config', 'user.name', 'gate');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'hi\n');
  git(dir, 'add', 'a.txt');
  git(dir, 'commit', '-qm', 'init');
  return dir;
}

test('a clean tree passes, because the upload matches a commit', () => {
  const dir = freshRepo();
  const { code, out } = runGate(dir);
  assert.equal(code, 0);
  assert.match(out, /working tree is clean/);
});

test('an untracked stray file fails the gate', () => {
  // The case the .vercelignore denylist cannot catch: a name nobody thought to
  // ignore. It would be uploaded, and it is in no commit.
  const dir = freshRepo();
  fs.writeFileSync(path.join(dir, 'stray_never_seen.js'), 'x\n');
  const { code, out } = runGate(dir);
  assert.equal(code, 1);
  assert.match(out, /stray_never_seen\.js/);
});

test('an uncommitted edit to a tracked file fails the gate', () => {
  const dir = freshRepo();
  fs.writeFileSync(path.join(dir, 'a.txt'), 'edited\n');
  const { code, out } = runGate(dir);
  assert.equal(code, 1);
  assert.match(out, /a\.txt/);
});

test('RATCHET_DEPLOY_DIRTY lets a human deploy a dirty tree on purpose, loudly', () => {
  const dir = freshRepo();
  fs.writeFileSync(path.join(dir, 'a.txt'), 'edited\n');
  const { code, out } = runGate(dir, { RATCHET_DEPLOY_DIRTY: '1' });
  assert.equal(code, 0);
  assert.match(out, /on purpose/);
});

test('outside a git work tree the gate fails closed rather than assuming', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rx-nogit-'));
  const { code, out } = runGate(dir);
  assert.equal(code, 1);
  assert.match(out, /cannot check the working tree/);
});

test('DEPLOY.cmd runs the gate before the release gate, and never sets the escape hatch', () => {
  const cmd = fs.readFileSync(path.join(repo, 'DEPLOY.cmd'), 'utf8');
  assert.match(cmd, /node scripts\/check-clean-tree\.mjs/);
  assert.match(cmd, /if errorlevel 1 goto :dirtytree/);
  assert.match(cmd, /^:dirtytree$/m);
  // The check must come before the deploy, not after it.
  assert.ok(cmd.indexOf('check-clean-tree.mjs') < cmd.indexOf('vercel deploy'));
  // Setting the variable in the repository would silently disarm the gate for
  // everyone; only a human at a prompt may opt in.
  assert.doesNotMatch(cmd, /^\s*set\s+"?RATCHET_DEPLOY_DIRTY=/m);
});
