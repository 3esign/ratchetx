// The gate that decides whether mainnet may be touched must not say GO about a
// file it could not read.
//
// tools/mainnet-go-check.mjs answers one question -- may the first mainnet
// transaction be sent -- and answers NO by default. That default has a hole:
// every check phrased as a NEGATIVE assertion reads its input as
// `read(f) || ''` and then asks whether a pattern is ABSENT, so an unreadable
// file turns "I could not look" into "I looked and it is clean".
//
// Measured 2026-09-05: run from an empty directory, where nothing it inspects
// exists at all, the gate printed GO for R3 (the reveal deadline), M2 (PlayerDay
// rent), M3 (page rent) and X1 (the public promise). Four GO verdicts about
// source files that were not there. The positive checks were already correct --
// R1 requires the file to be readable, R2 and M1 require their pattern to be
// FOUND -- so only the inverted ones inverted.
//
// This is the p6-canary class, which cost this project seven false greens, and
// it landed on the three most expensive rows on the board. So the property is
// pinned here rather than remembered: against an empty tree, NOTHING is GO.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const GATE = path.resolve(new URL('../tools/mainnet-go-check.mjs', import.meta.url).pathname);
const runIn = cwd => spawnSync(process.execPath, [GATE], { cwd, encoding: 'utf8', timeout: 120_000 });
// "  R3  GO       the reveal deadline ..." -> the id, for any row that says GO.
const goRows = out => [...out.matchAll(/^\s{2}(\w+)\s+GO\s/gm)].map(m => m[1]);

test('a tree it can enter but not read yields no GO at all', t => {
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'ratchetx-gate-'));
  t.after(() => { try { fs.rmSync(bare, { recursive: true, force: true }); } catch {} });
  // Enough for the gate to accept the directory as a repository root, and
  // nothing else: no lib.rs, no state.rs, no manifest, no README. Every check
  // then faces a file it cannot read, which is the exact condition that used to
  // produce GO for R3, M2, M3 and X1.
  fs.writeFileSync(path.join(bare, 'package.json'), '{"name":"bare"}');
  fs.writeFileSync(path.join(bare, 'AGENT_ONBOARD.md'), '# bare');
  const r = runIn(bare);
  assert.ok(r.stdout.includes('MAINNET GATE'), 'it accepted the directory and ran its checks');
  assert.deepEqual(goRows(r.stdout), [],
    'a check that cannot read its input must not report GO. These rows said GO about files that '
    + 'do not exist: ' + (goRows(r.stdout).join(', ') || '(none)')
    + '. The positive checks never had this bug: a pattern cannot be FOUND in a file that is not '
    + 'there. Only the checks phrased as "this pattern is gone" can answer "gone" by not looking.');
  assert.notEqual(r.status, 0, 'and it exits non-zero');
});

test('the gate refuses to be run from outside the repository', t => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'ratchetx-gate-cwd-'));
  t.after(() => { try { fs.rmSync(empty, { recursive: true, force: true }); } catch {} });
  const r = runIn(empty);
  // An empty-directory run should be an ERROR, not a report: every path in that
  // file is relative to the caller's directory, so the wrong cwd silently
  // rewrites what the gate is looking at.
  assert.match(r.stdout + r.stderr, /not (the|a) repository root|cannot find|run this from/i,
    'the gate should assert a known file exists before any check runs, and say so, rather than '
    + 'producing a full report about a directory that contains none of its inputs');
});

test('in the real tree the gate still answers, and answers about all of its rows', () => {
  const repo = path.resolve(new URL('..', import.meta.url).pathname);
  const r = runIn(repo);
  assert.ok(r.stdout.includes('MAINNET GATE'), 'it runs where it is meant to run');
  const rows = [...r.stdout.matchAll(/^\s{2}(\w+)\s+(GO|PENDING|NO-GO)\s/gm)].map(m => m[1]);
  assert.ok(rows.length >= 12, `every row reports a state (saw ${rows.length})`);
  // No verdict is asserted here on purpose: this suite pins the gate's honesty,
  // never its answer. The answer is allowed to change every few minutes.
});
