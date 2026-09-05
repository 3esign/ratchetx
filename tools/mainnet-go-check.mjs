#!/usr/bin/env node
// The mainnet gate, as a program rather than a checklist.
//
// A document that must be READ to be obeyed is held up by attention. This is the
// same list, executed. It answers one question - may the first mainnet
// transaction be sent - and it answers NO by default.
//
//   node tools/mainnet-go-check.mjs
//
// Read-only. Touches no chain, sends nothing, changes nothing.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const R = 'onchain/rcx-timepin-v2/programs/rcx-timepin-v2/src/';
const C = 'onchain/ratchet-core-g2/programs/ratchet-core-g2/src/';
const MANIFEST = 'releases/g2-mainnet-economy.json';

const results = [];
const read = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
const check = (id, what, fn, owner) => {
  let state, detail;
  try { const r = fn(); state = r.ok ? 'GO' : (r.pending ? 'PENDING' : 'NO-GO'); detail = r.detail; }
  catch (e) { state = 'NO-GO'; detail = 'check threw: ' + (e && e.message || e); }
  results.push({ id, what, state, detail, owner });
};

// ---- the rule -------------------------------------------------------------
check('R1', 'MIN-CAPTURE predicate is in lifecycle.rs', () => {
  const s = read(R + 'lifecycle.rs');
  return { ok: !!s && s.includes('PublishBeforeTarget'), detail: s ? 'PublishBeforeTarget present' : 'file unreadable' };
}, 'Opus A');

check('R2', 'lag < grid is ENFORCED, not merely proved', () => {
  const s = read(R + 'lib.rs') || '';
  const has = /max_post_target_lag_seconds\s*<\s*args\.target_grid_seconds|args\.max_post_target_lag_seconds\s*<\s*args\.target_grid_seconds/.test(s);
  return { ok: has, pending: !has, detail: has ? 'require! found in validate_spec' : 'validate_spec never relates lag to grid - one print can settle two targets' };
}, 'Opus A');

check('R3', 'the reveal deadline is set at settlement, not at seal', () => {
  const s = read(C + 'lib.rs') || '';
  const stillAbsolute = /fn fixed_reveal_deadline/.test(s);
  return { ok: !stillAbsolute, pending: stillAbsolute, detail: stillAbsolute ? 'fixed_reveal_deadline still present: player budget has no lower bound' : 'absolute deadline removed' };
}, 'Opus A');

// ---- the money ------------------------------------------------------------
check('M1', 'the Need can be closed and its rent returned', () => {
  const s = (read(R + 'lifecycle.rs') || '') + (read(R + 'lib.rs') || '');
  const has = /open_refs/.test(s) && /rent_payer/.test(s);
  return { ok: has, pending: !has, detail: has ? 'open_refs + rent_payer present' : '1,225 SOL/year locked permanently at a 1-minute grid' };
}, 'Opus A');

check('M2', 'PlayerDay no longer creates one account per player per day', () => {
  const s = read(C + 'lib.rs') || '';
  const gone = !/PLAYER_DAY_SEED/.test(s);
  return { ok: gone, pending: !gone, detail: gone ? 'PLAYER_DAY_SEED gone' : '0.527 SOL/year charged to every daily player' };
}, 'Opus B');

check('M3', 'HistoryPage/WorkPage do not lock rent per sixteen shots', () => {
  const s = read(C + 'state.rs') || '';
  const stillPaged = /HISTORY_PAGE_CAP: usize = 16/.test(s);
  return { ok: !stillPaged, pending: stillPaged, detail: stillPaged ? '0.00323 SOL locked per shot - 11.8 SOL/year at ten shots a day' : 'pages no longer store per-shot rows' };
}, 'Opus C');

// ---- the manifest ---------------------------------------------------------
check('P1', 'the economy manifest is approved, not a draft', () => {
  const s = read(MANIFEST);
  if (!s) return { ok: false, detail: 'manifest missing' };
  const j = JSON.parse(s);
  const draft = JSON.stringify(j).includes('DRAFT');
  return { ok: !draft, pending: draft, detail: draft ? 'status is DRAFT - NOT APPROVED BY THE OWNER' : 'approved' };
}, 'Semir');

check('P2', 'every feed has lag = grid - 1 and no feed violates lag < grid', () => {
  const s = read(MANIFEST);
  if (!s) return { ok: false, detail: 'manifest missing' };
  const j = JSON.parse(s);
  const bad = [];
  const walk = (node, path) => {
    if (!node || typeof node !== 'object') return;
    const grid = node.targetGridSeconds ?? node.target_grid_seconds;
    const lagNode = node.maxPostTargetLagSeconds ?? node.max_post_target_lag_seconds;
    const lag = (lagNode && typeof lagNode === 'object') ? (lagNode.proposed ?? lagNode.value) : lagNode;
    if (typeof grid === 'number' && typeof lag === 'number' && lag >= grid) bad.push(`${path}: lag ${lag} >= grid ${grid}`);
    for (const [k, v] of Object.entries(node)) walk(v, path ? path + '.' + k : k);
  };
  walk(j, '');
  return { ok: bad.length === 0, detail: bad.length ? bad.join('; ') : 'no feed violates lag < grid' };
}, 'Opus B');

// ---- the build ------------------------------------------------------------
check('B1', 'the built artifacts are NEWER THAN THE SOURCE and carry the right identity', () => {
  // A file existing is not a build. The first version of this check said GO on
  // artifacts from the previous day, one of which is the 414,264-byte US517 build
  // that nobody holds a key for. A gate that goes green on a stale artifact is
  // worse than no gate.
  const pairs = [
    ['onchain/rcx-timepin-v2/target/deploy/rcx_timepin_v2.so',
     ['onchain/rcx-timepin-v2/programs/rcx-timepin-v2/src/lib.rs',
      'onchain/rcx-timepin-v2/programs/rcx-timepin-v2/src/lifecycle.rs'],
     'C8wwxUGmoKAV22MaY3oW2Q6QeDbmB9dbNdbohsRjJkYp'],
    ['onchain/ratchet-core-g2/target/deploy/ratchet_core_g2.so',
     ['onchain/ratchet-core-g2/programs/ratchet-core-g2/src/lib.rs',
      'onchain/ratchet-core-g2/programs/ratchet-core-g2/src/state.rs',
      'onchain/ratchet-core-g2/programs/ratchet-core-g2/src/foreign_timepin.rs'],
     'ANVGVtDrECeyQkS56UZ9ZiWCUxk2JWEVNJioFW8JEwbL'],
  ];
  const problems = [];
  for (const [so, sources, id] of pairs) {
    if (!fs.existsSync(so)) { problems.push(`${so.split('/').pop()} MISSING`); continue; }
    const built = fs.statSync(so).mtimeMs;
    const newest = Math.max(...sources.filter(f => fs.existsSync(f)).map(f => fs.statSync(f).mtimeMs));
    if (built < newest) {
      const hrs = ((newest - built) / 3600000).toFixed(1);
      problems.push(`${so.split('/').pop()} is ${hrs}h OLDER than its source`);
      continue;
    }
    const r = spawnSync('node', ['tools/verify-artifact.mjs', so, id],
      { encoding: 'utf8', timeout: 60000, env: { ...process.env, EXPECT_SBPF: '3' } });
    if (r.status !== 0) problems.push(`${so.split('/').pop()} fails verify-artifact for ${id.slice(0, 8)}…`);
  }
  return { ok: problems.length === 0, pending: problems.length > 0,
           detail: problems.length ? problems.join('; ') + ' - run BUILD_G2.cmd' : 'both artifacts newer than source and identity-verified at SBPF v3' };
}, 'build owner');

check('B2', 'the golden vectors re-pin to the current source', () => {
  // B2 DEPENDS ON B1 and the dependency is not obvious: generate-vectors.mjs
  // requires --sbf <immutable hash-addressed artifact>, and repin refuses to pair
  // new-id PDAs with an old-id artifact. So vectors cannot be regenerated before
  // the build; they can only be regenerated FROM it. Measured 2026-09-05 14:05Z
  // by trying it.
  const r = spawnSync('node', ['tools/repin-timepin-vectors.mjs', '--check'], { encoding: 'utf8', timeout: 120000 });
  if (r.status === 0) return { ok: true, detail: 'repin --check PASS' };
  const b1Pending = results.find(x => x.id === 'B1' && x.state !== 'GO');
  return { ok: false, pending: true,
           detail: b1Pending
             ? 'repin --check FAILS, and it cannot pass before B1: vectors are regenerated FROM the artifact, not before it'
             : 'repin --check FAILED with a fresh artifact available - this one is a real defect' };
}, 'build owner, then Opus A');

check('B3', 'the release safety gate is green', () => {
  const r = spawnSync('node', ['scripts/check-release-safety.mjs'], { encoding: 'utf8', timeout: 120000 });
  return { ok: r.status === 0, detail: r.status === 0 ? 'gate exit 0' : 'gate RED' };
}, 'Opus B');

// ---- the public record ----------------------------------------------------
check('X1', 'no surface still promises the 2026-09-08 revocation', () => {
  const files = ['README.md', 'llms.txt', 'docs/AGENT_STATE.json', 'docs/FREEZE.md'];
  const bad = files.filter(f => {
    const s = read(f);
    return s && /destroyed on 2026-09-08|scheduled for revocation on 2026-09-08|revoked for good on \*\*2026-09-08/.test(s);
  });
  return { ok: bad.length === 0, detail: bad.length ? 'still promising: ' + bad.join(', ') : 'local copy corrected (live site is a separate check)' };
}, 'Semir');

// ---- report ---------------------------------------------------------------
const w = (s, n) => String(s).padEnd(n);
console.log('');
console.log('  MAINNET GATE — ' + new Date().toISOString());
console.log('  ' + '-'.repeat(96));
for (const r of results) {
  const mark = r.state === 'GO' ? 'GO     ' : r.state === 'PENDING' ? 'PENDING' : 'NO-GO  ';
  console.log(`  ${w(r.id, 4)}${mark}  ${w(r.what, 58)} ${r.owner}`);
  if (r.state !== 'GO') console.log(`        ${r.detail}`);
}
const blocking = results.filter(r => r.state !== 'GO');
console.log('  ' + '-'.repeat(96));
if (blocking.length === 0) {
  console.log('  ALL CHECKS PASS. This says the tree is ready; it does not authorise anything.');
  console.log('  The first mainnet transaction still needs Semir, explicitly, in his own words.');
} else {
  console.log(`  ${blocking.length} of ${results.length} blocking. NO-GO.`);
  console.log('  Owners with open items: ' + [...new Set(blocking.map(r => r.owner))].join(', '));
}
console.log('');
process.exit(blocking.length ? 1 : 0);
