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
import { CRATES, verifyCrate } from './compile-receipt.mjs';

const R = 'onchain/rcx-timepin-v2/programs/rcx-timepin-v2/src/';
const C = 'onchain/ratchet-core-g2/programs/ratchet-core-g2/src/';
const MANIFEST = 'releases/g2-mainnet-economy.json';

const results = [];
const read = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };

// A check that could not read its input has not verified anything, and the four
// checks below are phrased as NEGATIVE assertions -- "this pattern is gone" --
// so an unreadable file used to answer "gone" and print GO. Measured 2026-09-05
// by running this gate from an empty directory: R3, M2, M3 and X1 all reported
// GO about source files that were not there. The positive checks never had the
// bug, because a pattern cannot be FOUND in a file that is not there.
//
// mustRead makes the difference explicit: no text, no verdict.
class Unreadable extends Error {}
const mustRead = f => {
  const s = read(f);
  if (s === null) throw new Unreadable(`cannot read ${f} - no verdict is given rather than a wrong one`);
  return s;
};

// Every path in this file is relative to the caller's directory, so running it
// from the wrong place silently changes what it is looking at. It is a gate; it
// says so instead.
for (const anchor of ['package.json', 'AGENT_ONBOARD.md']) {
  if (read(anchor) === null) {
    console.error(`[FAIL] run this from the repository root: ${anchor} is not here, so every check `
      + 'below would be reading a directory that contains none of its inputs.');
    process.exit(2);
  }
}
const check = (id, what, fn, owner) => {
  let state, detail;
  try { const r = fn(); state = r.ok ? 'GO' : (r.pending ? 'PENDING' : 'NO-GO'); detail = r.detail; }
  catch (e) { state = 'NO-GO'; detail = 'check threw: ' + (e && e.message || e); }
  results.push({ id, what, state, detail, owner });
};

// ---- the compiler ---------------------------------------------------------
// Added 2026-09-05 15:0xZ after this gate reported GO on M3 while the Core crate
// was six errors red. Every row under "the rule" and "the money" reads SOURCE
// TEXT. Source text that does not compile is not a program, so those rows were
// describing something that could not exist. The gate now asks a compiler first,
// and refuses to call any source row GO while the answer is no (see the
// downgrade pass before the report).
//
// The evidence is a hash-bound receipt rather than a live compile, because the
// machine agents run this on has no Rust toolchain and no network to install one
// (measured 2026-09-05). tools/compile-receipt.mjs explains the bridge. Set
// GATE_LIVE_CARGO=1 to compile here instead, when a toolchain is present.
const compileEvidence = (() => {
  let cached = null;
  return () => {
    if (cached) return cached;
    const live = process.env.GATE_LIVE_CARGO === '1'
      && spawnSync('cargo', ['--version'], { encoding: 'utf8' }).status === 0;
    const out = { crates: [], live };
    for (const c of CRATES) {
      if (live) {
        const chk = spawnSync('cargo', ['check', '--lib'], { cwd: c.workspace, encoding: 'utf8', timeout: 900000 });
        const tst = spawnSync('cargo', ['test', '--lib'], { cwd: c.workspace, encoding: 'utf8', timeout: 900000 });
        const o = (tst.stdout || '') + (tst.stderr || '');
        const m = /test result: \w+\. (\d+) passed; (\d+) failed/.exec(o);
        out.crates.push({ name: c.name, fresh: true,
          check: { exit: chk.status },
          test: { exit: tst.status, passed: m ? +m[1] : null, failed: m ? +m[2] : null,
                  failing: [...o.matchAll(/^---- (\S+) stdout ----$/gm)].map(x => x[1]) } });
      } else {
        const v = verifyCrate(c);
        out.crates.push(v.ok
          ? { name: c.name, fresh: true, check: v.receipt.check, test: v.receipt.test, at: v.receipt.generatedAt }
          : { name: c.name, fresh: false, reason: v.reason });
      }
    }
    cached = out;
    return out;
  };
})();

check('C1', 'both programs COMPILE from the source in this tree', () => {
  const e = compileEvidence();
  const stale = e.crates.filter(c => !c.fresh);
  if (stale.length) return { ok: false, pending: true,
    detail: stale.map(c => `${c.name}: ${c.reason}`).join('; ')
      + ' - run: CORE_ROOT=<crate> TIMEPIN_ROOT=<crate> node tools/compile-receipt.mjs where a toolchain exists' };
  const red = e.crates.filter(c => c.check?.exit !== 0);
  return { ok: red.length === 0, pending: red.length > 0,
    detail: red.length ? red.map(c => `${c.name} does not compile`).join('; ')
                       : `cargo check exit 0 for both (${e.live ? 'compiled here' : 'receipt: ' + e.crates[0].at})` };
}, 'whoever last touched a .rs file');

check('C2', 'the host test suites are green, ABI pins included', () => {
  const e = compileEvidence();
  const stale = e.crates.filter(c => !c.fresh);
  if (stale.length) return { ok: false, pending: true, detail: 'no fresh compile evidence - see C1' };
  const red = e.crates.filter(c => (c.test?.failed ?? 1) !== 0);
  if (red.length === 0) return { ok: true, detail: 'every host test passes in both crates' };
  return { ok: false, pending: true,
    detail: red.map(c => `${c.name}: ${c.test.failed} failing (${(c.test.failing || []).join(', ')})`).join('; ') };
}, 'Opus A (Timepin pins), Opus C (Core pins)');

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
  // Corrected 2026-09-05 15:0xZ. The first version tested that
  // `fn fixed_reveal_deadline` had DISAPPEARED - the same defect the old M3 row
  // had, and I wrote both. That function must survive: it is still the projection
  // the four seal paths use, and score_day is derived from it (the deadline moves,
  // the day does not). So the old condition could only be satisfied by deleting
  // something the program needs.
  //
  // The thing whose presence IS the fix is the ASSIGNMENT at settlement. Verified
  // against lib.rs:1806 - shot.reveal_deadline_ts = max(now + reveal_window,
  // projected), written before resolution_hash so the hash covers the value the
  // player is actually held to. max() is what makes it monotone: it can only ever
  // give more time than the seal-time projection, never less.
  const s = mustRead(C + 'lib.rs');
  const assign = /shot\.reveal_deadline_ts\s*=\s*core::cmp::max\(([\s\S]{0,400}?)\)\s*;/.exec(s);
  const fromNow = !!assign && /unix_timestamp/.test(assign[1]) && /reveal_window_seconds/.test(assign[1]);
  if (!assign) return { ok: false, pending: true,
    detail: 'settle_final never assigns shot.reveal_deadline_ts - the deadline is still the seal-time projection, so a late crank leaves the player no budget' };
  if (!fromNow) return { ok: false, pending: true,
    detail: 'shot.reveal_deadline_ts is assigned but not from clock.unix_timestamp + reveal_window_seconds - the lower bound is not the settlement time' };
  return { ok: true, detail: 'set at settlement as max(now + reveal_window, projection)' };
}, 'Opus A');

// ---- the money ------------------------------------------------------------
check('M1', 'the permanent Need rent is DECLARED, since it cannot be refunded', () => {
  // REWRITTEN 2026-09-05 18:2xZ. I specified this row as "close_need exists,
  // guarded by open_refs == 0". Opus C proved the guard is 0 == 0 before he
  // stood down, and he is right: open_refs occurs four times in the repository -
  // the declaration, the `= 0` in open_need, and two test fixtures. Nothing
  // increments it. No Timepin instruction knows a shot exists, and Core reads
  // Needs read-only, so nothing ever could.
  //
  // A Need is SHARED - one per (spec, target_ts) however many shots point at it -
  // and closing deletes the account settle_final and the void path both read. On
  // a vacuous guard, one permissionless close strands every shot on that target
  // permanently. A retention timer is not a substitute: R3 sets
  // shot.reveal_deadline_ts = max(now + reveal_window, projection) AT SETTLEMENT,
  // so after R3 a shot's life has no upper bound computable from the Need. I made
  // that worse today myself.
  //
  // So M1 does not ship in this generation, and this row stops asking for the
  // instruction and starts refusing SILENCE about the cost. The rent is real,
  // permanent, and payable by whoever opens the Need. It must be written where a
  // player can find it before the first mainnet transaction, not discovered
  // afterwards.
  //
  // The number is derived, not typed: the account is 8 + 160 = 168 bytes, and
  // Solana rent exemption is (128 + data_len) * 3480 * 2 = 296 * 6960 =
  // 2,060,160 lamports. Needs are init_if_needed with payer = actor, so this is
  // charged per target ACTUALLY PLAYED, not per grid slot - the 1,083 SOL/year
  // figure for one feed at a 60-second grid is the fully played upper bound.
  const NEED_ACCOUNT_BYTES = 168;
  const LAMPORTS = (128 + NEED_ACCOUNT_BYTES) * 3480 * 2;
  const src = (read(R + 'lifecycle.rs') || '') + (read(R + 'lib.rs') || '');
  if (/pub fn close_need/.test(src)) {
    return { ok: false, detail: 'close_need EXISTS. It must not, while open_refs is never incremented: '
      + 'one permissionless close strands every shot on that target. If a real hold/release counter '
      + 'landed, delete this row and write one that tests the counter.' };
  }
  const m = read(MANIFEST);
  if (!m) return { ok: false, detail: 'manifest missing' };
  const j = JSON.parse(m);
  const flat = JSON.stringify(j);
  const declared = flat.includes(String(LAMPORTS));
  return { ok: declared, pending: !declared,
    detail: declared
      ? `permanent Need rent declared as ${LAMPORTS} lamports per target played`
      : `the manifest does not state the permanent Need rent. It is ${LAMPORTS} lamports `
        + `((128 + ${NEED_ACCOUNT_BYTES}) * 3480 * 2) per target played, it is never refunded in this `
        + `generation, and a player pays it. Put the exact number in the manifest.` };
}, 'Opus A');

check('M2', 'a finished PlayerDay can be closed and its rent returned', () => {
  // Corrected 2026-09-05 15:1xZ, on Opus B's refutation, and this is the fourth
  // and last row of mine with this shape. The old condition was !/PLAYER_DAY_SEED/
  // - it asked for the SEED to disappear, and the seed must survive: Shot.score_day
  // is frozen at seal and authenticated on every late path, so deleting the per-day
  // account makes every shot that crosses midnight permanently unrevealable. The
  // row could only go green by breaking the program, exactly like the old M3 and
  // the old R3.
  //
  // The TITLE was wrong too, not only the check. The rent was the defect; the
  // account never was. So the condition is the one I already applied to M1 once I
  // stopped believing two field names: can lamports actually leave? Verified in
  // lib.rs - close_player_day requires accepted > 0 && terminal == accepted, and
  // ClosePlayerDay carries close = rent_payer with address = player_day.rent_payer,
  // so the refund can only ever reach whoever paid it. Nobody privileged has to
  // call it.
  //
  // 0.600 SOL/year is derived, not typed: PlayerDay::LEN 132 + 8 discriminator
  // = 140 bytes, (128 + 140) * 6333 = 1,697,244 lamports per account per day.
  const s = mustRead(C + 'lib.rs');
  const canClose = /pub fn close_player_day/.test(s);
  const refundsPayer = /close\s*=\s*rent_payer/.test(s) && /address\s*=\s*player_day\.rent_payer/.test(s);
  if (!canClose) return { ok: false, pending: true,
    detail: 'no close_player_day instruction - the day account is funded once and never returns its rent' };
  if (!refundsPayer) return { ok: false, pending: true,
    detail: 'close_player_day exists but the close recipient is not pinned to player_day.rent_payer - the refund can be steered' };
  return { ok: true, detail: 'close_player_day closes to the recorded rent_payer once every accepted shot is terminal' };
}, 'Opus B');

check('M3', 'HistoryPage/WorkPage do not lock rent per sixteen shots', () => {
  // Corrected 2026-09-05 14:15Z after Opus C showed this row could NEVER go
  // green. It tested for the disappearance of HISTORY_PAGE_CAP - but that
  // constant must SURVIVE the fix: it is the paging arithmetic
  // (history_page_index = nonce / CAP, history_page_slot = nonce % CAP) and
  // page_index is a PDA seed. The only way to satisfy the old condition was to
  // delete something the program needs.
  // The thing whose presence costs 165 bytes a shot, and whose absence IS the
  // fix, is the stored rows.
  const s = read(C + 'state.rs') || '';
  const storesRows = /pub slots:\s*Vec<Option<ShotResult>>/.test(s);
  return { ok: !storesRows, pending: storesRows,
           detail: storesRows ? '0.00323 SOL locked per shot - 11.8 SOL/year at ten shots a day' : 'pages no longer store per-shot rows' };
}, 'Opus C');

// ---- the manifest ---------------------------------------------------------
check('P1', 'the economy manifest is approved, not a draft', () => {
  const s = read(MANIFEST);
  if (!s) return { ok: false, detail: 'manifest missing' };
  const j = JSON.parse(s);
  const draft = JSON.stringify(j).includes('DRAFT');
  return { ok: !draft, pending: draft, detail: draft ? 'status is DRAFT - NOT APPROVED BY THE OWNER' : 'approved' };
}, 'Semir');

check('P2', 'every feed has lag = grid - 1, asked of every feed by name', () => {
  // Rewritten 2026-09-05 17:0xZ. Opus B proved the old row could not fail: it
  // flagged a node only when grid and lag were numbers ON THE SAME NODE, and in
  // this manifest the grid lives on the templates while the lag lives on each
  // feed. NO NODE CARRIES BOTH. He instrumented the walker - 0 comparisons over 7
  // feeds - then set WIF to lag 6000 against grid 60, a hundred times the legal
  // maximum, and the row still printed 'no feed violates lag < grid'. The row's
  // own title also promised an EQUALITY to grid - 1 that appeared nowhere in its
  // code. It was correct all day for no reason, which is indistinguishable from
  // working until the manifest changes - and this is the row guarding the one
  // parameter the manifest itself calls the only lever left.
  //
  // It is now a spawned test, which is the only row shape that has survived
  // today. That test was verified RED on four mutated manifests (lag 6000, lag 30,
  // lag deleted, grid deleted) before it was believed green, and a MISSING value
  // fails there rather than passing.
  const r = spawnSync('node', ['test/test_manifest_lag_is_grid_minus_one.mjs'], { encoding: 'utf8', timeout: 60000 });
  const tail = ((r.stdout || '') + (r.stderr || '')).trim().split('\n').slice(-2).join(' ').slice(0, 300);
  return { ok: r.status === 0, detail: r.status === 0 ? 'lag = grid - 1 for every feed, grid read once from the templates' : tail };
}, 'Opus B');

// ---- what the gate did not know -------------------------------------------
// Added 2026-09-05 20:2xZ after an INDEPENDENT AUDIT (Codex, GPT-6 Astra,
// read-only, against commit e249dbc) found three defects this gate had no row
// for. It was reporting 4 of 16 while all three were live. I verified every one
// in source before writing a row for it; two of them are in decisions I made
// today and one of those I caused.
//
// A gate that does not know about a defect is not a gate. That is the same shape
// as the six false greens of this morning, one level up - at the instrument.

check('S1', 'MIN-CAPTURE actually SELECTS the minimum, rather than declaring ambiguity', () => {
  // The canonical rule is: the admissible price for target T is the SMALLEST
  // publish_time >= T among candidates submitted before capture_deadline. That
  // rule is in the spec, in the docs, and in the host tests.
  //
  // It is not in the handler. Verified at lifecycle.rs:935-975: capture_conflict
  // takes ANY second distinct message hash, writes candidate_b, sets
  // need.state = NEED_AMBIGUOUS and stores both hashes sorted BY HASH. It never
  // compares publish_time. So an honest capture at T+1 followed by an ordinary
  // Pyth update at T+5 cancels the target and refunds the round - and a player
  // facing a loss can cause that with no forged data at all.
  //
  // This row is deliberately crude: it demands that the conflict path mention
  // publish_time at all. A handler that decides between two candidates without
  // ever reading the field the rule is defined on cannot be implementing the
  // rule. When the real selection lands, replace this with a named host test.
  const s = mustRead(R + 'lifecycle.rs');
  const conflict = /pub fn capture_conflict_handler[\s\S]*?\n}/.exec(s)
                || /fn capture_conflict[\s\S]*?\n}/.exec(s);
  if (!conflict) return { ok: false, pending: true, detail: 'capture_conflict handler not found - cannot verify the selection rule' };
  const body = conflict[0]
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
  const selects = /publish_time/.test(body);
  const declaresAmbiguous = /NEED_AMBIGUOUS/.test(body);
  if (!selects && declaresAmbiguous) {
    return { ok: false, pending: true,
      detail: 'capture_conflict sets NEED_AMBIGUOUS without ever reading publish_time: a later ordinary '
        + 'oracle update cancels the target. MIN-CAPTURE is specified but not implemented (lifecycle.rs:935-975)' };
  }
  return { ok: selects, pending: !selects,
    detail: selects ? 'the conflict path reads publish_time, so it can implement minimum selection'
                    : 'the conflict path never reads publish_time' };
}, 'lead');

check('S2', 'a shot cannot be stranded by settling across midnight', () => {
  // authenticate_shot_kernel requires shot.score_day == utc_day(shot.reveal_deadline_ts)
  // at lib.rs:4404, on EVERY path. R3 - my ruling today - assigns
  // shot.reveal_deadline_ts = max(now + reveal_window, projection) AT SETTLEMENT
  // while score_day stays frozen from seal. Settle late enough to cross a UTC day
  // boundary and that require! fails forever: reveal, forfeit and refund all
  // reject the shot and the credits are locked.
  //
  // The conjunct is REDUNDANT, which is why deleting it is the fix rather than
  // reverting R3. score_day is already authenticated at lib.rs:4223 against
  // player_day.day and rank_shard.day, and PlayerDay's PDA is seeded with the
  // day - a wrong score_day cannot find its account. The clause protects nothing
  // that is not already protected, and it is the only thing stranding the shot.
  const s = mustRead(C + 'lib.rs');
  const src = s.replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
  const ties = /score_day\s*==\s*utc_day\(\s*shot\.reveal_deadline_ts\s*\)/.test(src);
  const bindsAccounts = /shot\.score_day\s*==\s*player_day\.day/.test(src);
  if (ties) return { ok: false, pending: true,
    detail: 'the kernel still ties score_day to utc_day(reveal_deadline_ts) while R3 moves that deadline at '
      + 'settlement: any settle that crosses midnight strands the shot permanently on every later path' };
  if (!bindsAccounts) return { ok: false,
    detail: 'the midnight clause is gone but score_day is no longer bound to player_day.day either - '
      + 'removing BOTH leaves score_day unauthenticated. Restore the account binding.' };
  return { ok: true, detail: 'score_day is bound to its accounts and not to the moving deadline' };
}, 'lead');

check('S3', 'a PlayerDay cannot be closed while its day can still accept shots', () => {
  // close_player_day requires accepted > 0 && terminal == accepted. That is
  // satisfiable MID-DAY: every shot so far is terminal, more are still allowed.
  // The account closes, the next shot recreates it with zero XP, and a player who
  // earned 100 then 20 stays ranked at 100 - which is podium money.
  // My M2 row asked whether lamports could leave. They can. That was the wrong
  // question on its own.
  const s = mustRead(C + 'lib.rs');
  const fn = /pub fn close_player_day[\s\S]*?\n    }/.exec(s);
  if (!fn) return { ok: false, pending: true, detail: 'close_player_day not found' };
  const body = fn[0].replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
  const guardsDay = /day\s*<|utc_day|day_is_closed|finalized|DayFinal/.test(body);
  return { ok: guardsDay, pending: !guardsDay,
    detail: guardsDay
      ? 'closure is gated on the scoring day being over, not merely on the shots so far'
      : 'close_player_day is guarded only by accepted > 0 && terminal == accepted, which holds MID-DAY: '
        + 'anyone can close a live day and the next shot recreates it with zero XP (podium money)' };
}, 'lead');

// ---- the seam -------------------------------------------------------------
// Added 2026-09-05 17:0xZ, and these are the two most important rows on this
// board. Both programs compile. Both host suites pass. C1 and C2 can read GO
// while NO SHOT CAN BE SEALED OR SETTLED AT ALL, because nothing anywhere was
// comparing the two crates to each other. Opus B proved both at exact-SBF tier on
// real transactions (docs/reviews/opusb-2026-09-05/EXACT_SBF_FIRST_RUN.md); I
// re-read both in source before writing these rows.
//
// A gate that says "9 of 14 green" about two programs that cannot exchange a
// single account is worse than no gate. That is what this one said at 16:51.

check('I1', 'Core can actually READ a Need that a real Timepin writes', () => {
  // Core: NEED_ACCOUNT_LEN = 8 + 124 = 132 (foreign_timepin.rs:26), and
  // decode_exact requires an EQUAL length (:115-117), with payload.is_empty()
  // below it forbidding a longer account even if the length passed. Timepin:
  // TimepinNeedV2::LEN = 268, so the account is 276. Seven Core paths load a
  // Need - seal at lib.rs:920 :926 :1078 :1084 :1250 :1425, settle at :1725 -
  // and on chain every one of them fails with BadTimepinLength (6002).
  const r = spawnSync('node', ['test/test_foreign_timepin_abi.mjs'], { encoding: 'utf8', timeout: 60000 });
  const out = (r.stdout || '') + (r.stderr || '');
  const why = /CROSS-CRATE ABI DRIFT: [^\n]*/.exec(out);
  return { ok: r.status === 0, pending: r.status !== 0,
           detail: r.status === 0 ? 'the cross-crate account ABI agrees in every checked class'
                                  : (why ? why[0].slice(0, 400) : 'test/test_foreign_timepin_abi.mjs is RED') };
}, 'Opus A + Opus B (one seam, two owners - agree who moves)');

check('I2', 'Core admits the canonical adapter - asked of a compiler, not of text', () => {
  // REWRITTEN 2026-09-05 17:1xZ because the row I wrote at 17:00 went FALSE RED
  // within the hour. Opus C fixed validate_spec_shape in 96a21df; my row grepped
  // for 'spec.adapter == 1' and found it - inside the COMMENT that explains what
  // the line USED to say. It also flagged 'max_pre_target_gap_seconds > 0', which
  // is now correctly guarded inside the adapter branch. Two false reds from one
  // regex, on a fix that had already landed.
  //
  // Text matching cannot tell a program from a description of a program. That is
  // the same failure as the six false GREENS today, wearing the other colour, and
  // it is my third row to fall to it. So this row no longer reads the file at all.
  // It asks whether a COMPILER RAN A NAMED TEST OVER THESE EXACT BYTES and it
  // passed - the receipt carries the passing names, hash-bound to the source.
  //
  // The test is Opus C's, landed with the fix:
  // the_registration_gate_admits_both_adapters_and_crosses_neither. Its name is
  // the whole assertion - both adapters admitted, neither allowed to carry the
  // other's pre-gap - which is exactly what Timepin pins at lib.rs:573-583.
  const NAME = 'foreign_timepin::tests::the_registration_gate_admits_both_adapters_and_crosses_neither';
  const core = CRATES.find(c => c.name === 'ratchet-core-g2');
  const v = verifyCrate(core);
  if (!v.ok) return { ok: false, pending: true, detail: 'no compile evidence for these bytes: ' + v.reason };
  const passing = v.receipt.test?.passing;
  if (!Array.isArray(passing)) return { ok: false, pending: true,
    detail: 'the receipt predates passing-test names - regenerate it with tools/compile-receipt.mjs' };
  if (!passing.includes(NAME)) return { ok: false, pending: true,
    detail: `${NAME} did not pass. Until it does, no economy can register on ADAPTER_PYTH_MIN_CAPTURE_V2 and Core's own MIN-CAPTURE branch is unreachable` };
  return { ok: true, detail: 'the registration gate admits both adapters and crosses neither, per a compiler over these bytes' };
}, 'Opus C (landed 96a21df)');

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
  // 'gate RED' was all this row could say, and at 17:08 it said it once and then
  // went green twice with nothing changed in between. A row that fails without
  // saying why is a row nobody can act on, and an intermittent one is worse than a
  // red one: it teaches people to re-run until it agrees with them. So it now
  // carries the failing lines out, and it reports a spawn that never ran
  // (timeout, or no node) as DIFFERENT from a gate that ran and refused.
  const r = spawnSync('node', ['scripts/check-release-safety.mjs'], { encoding: 'utf8', timeout: 120000 });
  if (r.error || r.status === null) {
    return { ok: false, pending: true,
             detail: 'check-release-safety.mjs did not complete (' + (r.error ? r.error.message : 'killed or timed out')
                   + ') - this is NOT a refusal, the check never finished' };
  }
  if (r.status === 0) return { ok: true, detail: 'gate exit 0' };
  const out = ((r.stdout || '') + (r.stderr || '')).split('\n').filter(l => /FAIL|Error/.test(l));
  return { ok: false,
           detail: out.length ? out.slice(0, 4).join(' | ').slice(0, 500) + (out.length > 4 ? ` (+${out.length - 4} more)` : '')
                              : 'gate exited ' + r.status + ' with no FAIL line - read its output directly' };
}, 'Opus B');

// ---- the public record ----------------------------------------------------
check('X1', 'no surface still promises the 2026-09-08 revocation', () => {
  const files = ['README.md', 'llms.txt', 'docs/AGENT_STATE.json', 'docs/FREEZE.md'];
  // A file this list names and cannot read is not evidence that the promise is
  // gone from it. Missing counts against, never for.
  const bad = files.filter(f => {
    const s = read(f);
    if (s === null) return true;
    return /destroyed on 2026-09-08|scheduled for revocation on 2026-09-08|revoked for good on \*\*2026-09-08/.test(s);
  });
  return { ok: bad.length === 0, detail: bad.length ? 'still promising: ' + bad.join(', ') : 'local copy corrected (live site is a separate check)' };
}, 'Semir');

// ---- the downgrade --------------------------------------------------------
// A row that reads source text cannot be GO while that source does not compile.
// This is the rule I owed the room after M3 reported GO on a red crate: the gate
// may not say GO on anything that depends on the program existing, until the
// program exists. The rows below all assert something about compiled behaviour.
const SOURCE_ROWS = ['R1', 'R2', 'R3', 'M1', 'M2', 'M3'];
const c1 = results.find(r => r.id === 'C1');
if (c1 && c1.state !== 'GO') {
  for (const r of results) {
    if (SOURCE_ROWS.includes(r.id) && r.state === 'GO') {
      r.state = 'PENDING';
      r.detail = 'the source text says yes, but C1 is not GO, so this text is not yet a program: ' + r.detail;
    }
  }
}

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
