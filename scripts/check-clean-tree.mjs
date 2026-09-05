// Does the deploy publish bytes that are in no commit?
//
// A folder deploy uploads the directory as it is on disk, so "what went live"
// and "what is in a commit" are only the same thing if somebody checks. If they
// differ, the live release cannot be reviewed in a diff, reproduced from
// history or rolled back to, and `productionCodeCommit` becomes a claim nobody
// can check. That gap ran for two days in the other direction: the cancelled-
// freeze correction sat in this tree unstaged while the deployed site kept
// announcing the ceremony (fixed in d7c9162).
//
// WHY THIS IS NOT "IS THE TREE DIRTY". The first version of this gate was, and
// it was wrong: this tree is permanently dirty while G2 is built, so a
// tree-level stop would have blocked every deploy Semir makes, including the one
// that brings ratchetx.xyz back. Measured 2026-09-05: 110 dirty paths, of which
// exactly 12 are in the deploy set. The other 98 are onchain/, docs/, scripts/,
// test/ — none of them ship, so none of them can put unreviewed bytes live.
// The deploy set is the hard stop; the rest is a warning. (Lead's ruling, room
// 11:13Z; the gate is a hard stop only where it can name real exposure.)
//
// This is deliberately a node script and not batch inside DEPLOY.cmd: batch is
// the one language nobody working on this repository can run, so a gate written
// there is a gate nobody tests. test/test_clean_tree_gate.mjs covers it.
//
// Escape hatch, loud and on purpose: RATCHET_DEPLOY_DIRTY=1. It is set nowhere
// in this repository and must stay that way.
import { spawnSync } from 'node:child_process';
import { inspectDeployInput } from './check-deploy-input.mjs';

const bypass = !!process.env.RATCHET_DEPLOY_DIRTY;
const finish = (code, why) => {
  if (code !== 0 && bypass) {
    console.error(`[WARN] RATCHET_DEPLOY_DIRTY is set - ${why}, deploying anyway on purpose`);
    process.exit(0);
  }
  process.exit(code);
};

const git = spawnSync('git', ['status', '--porcelain', '--untracked-files=normal'],
  { encoding: 'utf8', timeout: 60000, maxBuffer: 16_000_000 });

if (git.error || git.status !== 0) {
  // Cannot compare the upload to a commit, so we do not get to claim it matches.
  console.error('[FAIL] cannot check the upload against a commit (git unavailable or not a repository)');
  console.error('       install git, or deploy on purpose with RATCHET_DEPLOY_DIRTY=1');
  finish(1, 'the tree could not be checked against a commit');
}

let deploySet;
try {
  deploySet = new Set(inspectDeployInput(process.cwd()).files);
} catch (e) {
  // Fail closed: an unknown deploy set means every dirty file is a suspect.
  console.error(`[FAIL] cannot enumerate the deployment input (${e.message})`);
  finish(1, 'the deployment input could not be enumerated');
}

const dirty = git.stdout.split('\n')
  .map(l => l.replace(/\r$/, ''))
  .filter(Boolean)
  .map(l => ({ code: l.slice(0, 2), path: l.slice(3) }));

// Renames print "old -> new"; the uploaded path is the new one.
const uploaded = e => deploySet.has(e.path.includes(' -> ') ? e.path.split(' -> ')[1] : e.path);
const shipping = dirty.filter(uploaded);
const local = dirty.length - shipping.length;

if (!shipping.length) {
  console.log(`[OK] every file in the deploy set matches a commit (${deploySet.size} files)`);
  if (local) console.log(`     ${local} uncommitted path(s) outside the deploy set - none of them ship`);
  process.exit(0);
}

console.error(`[FAIL] ${shipping.length} file(s) would be PUBLISHED with bytes that are in no commit:`);
for (const e of shipping.slice(0, 40)) console.error(`       ${e.code} ${e.path}`);
if (shipping.length > 40) console.error(`       ... and ${shipping.length - 40} more`);
if (local) console.error(`       (${local} other uncommitted path(s) do not ship and are not the problem)`);
console.error('       commit these, then run this again;');
console.error('       to publish uncommitted bytes deliberately: set RATCHET_DEPLOY_DIRTY=1');
finish(1, `${shipping.length} shipping file(s) are in no commit`);
