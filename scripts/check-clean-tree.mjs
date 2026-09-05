// A folder deploy ships the WORKING TREE, not a commit.
//
// Vercel uploads the directory as it is on disk. If that tree has uncommitted
// changes, the bytes that go live exist in no commit: they cannot be reviewed in
// a diff, reproduced from history, or rolled back to, and `productionCodeCommit`
// becomes a claim nobody can check. On 2026-09-05 the freeze correction sat in
// this tree, unstaged, for two days while the deployed site kept promising a
// ceremony that had been cancelled -- the same gap in the other direction.
//
// This is deliberately a separate node script rather than batch inside
// DEPLOY.cmd: batch cannot be run by the agents and CI that touch this repo, so
// a gate written there is a gate nobody tests. `node scripts/check-clean-tree.mjs`
// runs anywhere.
//
// Escape hatch, on purpose and loudly: RATCHET_DEPLOY_DIRTY=1. It is set nowhere
// in this repository and must stay that way.
import { spawnSync } from 'node:child_process';

const bypass = !!process.env.RATCHET_DEPLOY_DIRTY;

const git = spawnSync('git', ['status', '--porcelain', '--untracked-files=normal'],
  { encoding: 'utf8', timeout: 60000, maxBuffer: 16_000_000 });

if (git.error || git.status !== 0) {
  // No git, or not a work tree: we cannot tell whether the upload matches a
  // commit, so we do not get to claim it does.
  console.error('[FAIL] cannot check the working tree against a commit (git unavailable or not a repository)');
  if (bypass) { console.error('[WARN] RATCHET_DEPLOY_DIRTY is set - continuing anyway'); process.exit(0); }
  console.error('       install git, or deploy on purpose with RATCHET_DEPLOY_DIRTY=1');
  process.exit(1);
}

const entries = git.stdout.split('\n').map(l => l.replace(/\r$/, '')).filter(Boolean);
if (!entries.length) {
  console.log('[OK] working tree is clean - the upload matches a commit');
  process.exit(0);
}

console.error(`[FAIL] working tree has ${entries.length} uncommitted change(s); a folder deploy would publish bytes that are in no commit`);
for (const line of entries.slice(0, 20)) console.error(`       ${line}`);
if (entries.length > 20) console.error(`       ... and ${entries.length - 20} more`);
if (bypass) { console.error('[WARN] RATCHET_DEPLOY_DIRTY is set - deploying an uncommitted tree on purpose'); process.exit(0); }
console.error('       commit or stash them, then run this again;');
console.error('       to deploy a dirty tree deliberately: set RATCHET_DEPLOY_DIRTY=1');
process.exit(1);
