// The deploy publishes the working tree, so this gate asks one question: would
// any file that ACTUALLY SHIPS go live with bytes that are in no commit?
//
// The distinction is the whole point and it is why the first version of this
// gate was wrong. "Is the tree dirty" is not the question: this repository is
// permanently dirty while G2 is built (110 uncommitted paths on 2026-09-05, of
// which 12 ship), so a tree-level stop blocks every deploy including the one
// that brings the site back, while saying nothing about exposure. The deploy
// set is the hard stop; everything else is a warning.
//
// It is tested here rather than trusted because the gate is invoked from
// DEPLOY.cmd, and batch is the one language nobody working here can run.
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

// A minimal repository shaped like this one: a file that ships (index.html is on
// check-deploy-input's ROOT_FILES allowlist) and a directory that does not.
function freshRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rx-cleantree-'));
  git(dir, 'init', '-q', '.');
  git(dir, 'config', 'user.email', 'gate@test.invalid');
  git(dir, 'config', 'user.name', 'gate');
  fs.writeFileSync(path.join(dir, '.vercelignore'), 'docs/\nonchain/\n');
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>ships</title>\n');
  fs.mkdirSync(path.join(dir, 'docs'));
  fs.writeFileSync(path.join(dir, 'docs', 'notes.md'), 'does not ship\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'init');
  return dir;
}

test('a tree whose deploy set matches a commit passes', () => {
  const { code, out } = runGate(freshRepo());
  assert.equal(code, 0);
  assert.match(out, /every file in the deploy set matches a commit/);
});

test('an uncommitted edit to a file that SHIPS is a hard stop', () => {
  const dir = freshRepo();
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>edited</title>\n');
  const { code, out } = runGate(dir);
  assert.equal(code, 1);
  assert.match(out, /would be PUBLISHED with bytes that are in no commit/);
  assert.match(out, /index\.html/);
});

test('an untracked file that ships is a hard stop, because it goes live unreviewed', () => {
  // merkle_tree.json is exactly this case in the real repository: on the root
  // allowlist, uploaded, and in no commit.
  const dir = freshRepo();
  fs.writeFileSync(path.join(dir, 'merkle_tree.json'), '{}\n');
  const { code, out } = runGate(dir);
  assert.equal(code, 1);
  assert.match(out, /merkle_tree\.json/);
});

test('a permanently dirty tree does NOT block the deploy when nothing dirty ships', () => {
  // The regression that matters: G2 work lives in ignored directories and must
  // never stand between Semir and a deploy.
  const dir = freshRepo();
  fs.writeFileSync(path.join(dir, 'docs', 'notes.md'), 'edited, still does not ship\n');
  fs.writeFileSync(path.join(dir, 'docs', 'brand_new.md'), 'untracked, still does not ship\n');
  fs.mkdirSync(path.join(dir, 'onchain'));
  fs.writeFileSync(path.join(dir, 'onchain', 'lib.rs'), 'fn main() {}\n');
  const { code, out } = runGate(dir);
  assert.equal(code, 0);
  assert.match(out, /outside the deploy set - none of them ship/);
});

test('RATCHET_DEPLOY_DIRTY publishes uncommitted bytes on purpose, and says so', () => {
  const dir = freshRepo();
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>edited</title>\n');
  const { code, out } = runGate(dir, { RATCHET_DEPLOY_DIRTY: '1' });
  assert.equal(code, 0);
  assert.match(out, /on purpose/);
});

test('outside a git work tree the gate fails closed rather than assuming', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rx-nogit-'));
  const { code, out } = runGate(dir);
  assert.equal(code, 1);
  assert.match(out, /cannot check the upload against a commit/);
});

test('an unenumerable deploy set fails closed, because then every dirty file is a suspect', () => {
  const dir = freshRepo();
  fs.rmSync(path.join(dir, '.vercelignore'));
  const { code, out } = runGate(dir);
  assert.equal(code, 1);
  assert.match(out, /cannot enumerate the deployment input/);
});

test('DEPLOY.cmd runs the gate before the deploy, and never sets the escape hatch', () => {
  const cmd = fs.readFileSync(path.join(repo, 'DEPLOY.cmd'), 'utf8');
  assert.match(cmd, /node scripts\/check-clean-tree\.mjs/);
  assert.match(cmd, /if errorlevel 1 goto :dirtytree/);
  assert.match(cmd, /^:dirtytree$/m);
  assert.ok(cmd.indexOf('check-clean-tree.mjs') < cmd.indexOf('vercel deploy'));
  // Setting it in the repository would silently disarm the gate for everyone.
  assert.doesNotMatch(cmd, /^\s*set\s+"?RATCHET_DEPLOY_DIRTY=/m);
});
