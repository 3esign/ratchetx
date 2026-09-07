// P2 asks whether every feed has lag = grid - 1 and no feed violates lag < grid.
//
// The gate's own P2 row compares ZERO pairs. It walks the manifest and relates a
// lag to a grid only when both are numbers on the SAME node; in
// releases/g2-mainnet-economy.json the grid lives on evidenceSpecTemplate and
// rulesetTemplate and the lag lives on each feed. Instrumented 2026-09-05:
// compared 0, lagOnly 7, gridOnly 2. Setting WIF's lag to 6000 against a grid of
// 60 -- a spec R2 refuses outright -- still returns GO. And the equality the row
// is named after is not in that code at all, only the inequality.
//
// So this reads the grid ONCE from the template and then asks the question of
// every feed by name. A missing value is a FAILURE here, never a pass: the whole
// defect above is a comparison that silently did not happen.
//
// Why grid - 1 and not merely less: admissibility for target T is [T, T+lag], so
// coverage is monotonically non-decreasing in lag, and lag < grid is necessary
// and sufficient for a print to belong to at most one target (rcx-timepin-v2
// lib.rs::validate_spec, R2). grid - 1 is therefore the coverage optimum for
// every feed without knowing its cadence. A smaller lag is a legitimate
// quality-versus-liveness preference and this test would have to be told about
// it on purpose.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const manifest = JSON.parse(
  fs.readFileSync(new URL('../_to_delete/opusb-scratch/manifest-big.json', import.meta.url), 'utf8'));

let checks = 0;
const ok = (cond, msg) => { checks += 1; assert.ok(cond, msg); };
const eq = (a, b, msg) => { checks += 1; assert.equal(a, b, msg); };

// The manifest tags undecided numbers as {tag, proposed, derivation}.
const value = (v) => (v && typeof v === 'object' && !Array.isArray(v)
  ? (v.proposed ?? v.value) : v);

const grids = [
  ['evidenceSpecTemplate', value(manifest.evidenceSpecTemplate?.targetGridSeconds)],
  ['rulesetTemplate', value(manifest.rulesetTemplate?.targetGridSeconds)],
].filter(([, g]) => g !== undefined);

ok(grids.length > 0,
  'no targetGridSeconds anywhere in the manifest templates. The grid is the one parameter the manifest '
  + 'itself calls "the only lever left"; a manifest without it cannot be checked and must not pass.');
for (const [where, g] of grids) {
  ok(Number.isInteger(g) && g > 0, `${where}.targetGridSeconds is ${g}, which is not a positive integer`);
}
// If two templates both name a grid they must agree, or "the grid" means two things.
if (grids.length === 2) {
  eq(grids[0][1], grids[1][1],
    `evidenceSpecTemplate.targetGridSeconds is ${grids[0][1]} but rulesetTemplate.targetGridSeconds is `
    + `${grids[1][1]}. One economy, one grid - a feed's lag cannot be grid - 1 for two different grids.`);
}
const grid = grids[0][1];

const feeds = manifest.feeds ?? [];
ok(Array.isArray(feeds) && feeds.length > 0,
  'the manifest lists no feeds. An empty list would satisfy "every feed" vacuously, which is exactly the '
  + 'failure mode this file exists to stop.');

for (const feed of feeds) {
  const name = feed.symbol ?? feed.feedId?.slice(0, 8) ?? '<unnamed feed>';
  const lag = value(feed.maxPostTargetLagSeconds ?? feed.max_post_target_lag_seconds);
  ok(lag !== undefined,
    `feed ${name} carries no maxPostTargetLagSeconds. A missing lag is not a passing lag - the gate's P2 row `
    + 'skipped every feed for exactly this kind of silence.');
  ok(Number.isInteger(lag), `feed ${name} has a non-integer lag: ${JSON.stringify(lag)}`);
  ok(lag < grid,
    `feed ${name} has lag ${lag} >= grid ${grid}. R2 (rcx-timepin-v2 lib.rs::validate_spec) refuses this spec `
    + 'at registration: one print would settle two consecutive targets.');
  eq(lag, grid - 1,
    `feed ${name} has lag ${lag}, but grid - 1 = ${grid - 1}. Coverage is monotonically non-decreasing in lag `
    + 'and grid - 1 is the maximum lag < grid, so any smaller value gives up coverage for no stated reason. '
    + 'If that is deliberate for this feed, this assertion has to be told so on purpose.');
}

console.log(`PASS  manifest lag is grid - 1: ${checks} checks over ${feeds.length} feeds `
  + `at grid ${grid}s - every feed compared by name, no value allowed to go unread`);
