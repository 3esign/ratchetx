// M2: the per-player-per-day account, and the invariant that makes the obvious
// fix wrong.
//
// The gate row M2 is a grep for PLAYER_DAY_SEED. A grep cannot tell the
// difference between "the rent went away" and "the day went away", and those are
// not the same change: Shot.score_day is frozen at seal (state.rs) and
// authenticate_shot_score_accounts requires shot.score_day == player_day.day on
// the LATE paths -- settle, reveal, close. A shot sealed on day D must therefore
// still find a PlayerDay for day D when it is revealed, which is days later.
// Folding the counters into one PlayerLedger with a daily reset loses day D the
// moment day D+1 begins, and every shot in flight across midnight becomes
// unrevealable, permanently, for that economy. That change would have turned the
// M2 grep green.
//
// So this pins the two halves TOGETHER. Either both the per-day account and the
// per-day authentication are present, or neither is. Whoever removes one has to
// face the other in the same commit.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const G2 = new URL('../onchain/ratchet-core-g2/programs/ratchet-core-g2/src/', import.meta.url);
const read = f => fs.readFileSync(new URL(f, G2), 'utf8');
const lib = read('lib.rs');
const state = read('state.rs');

let checks = 0;
const ok = (cond, msg) => { checks += 1; assert.ok(cond, msg); };
const eq = (a, b, msg) => { checks += 1; assert.equal(a, b, msg); };

// --- 1. the coupling ---------------------------------------------------------
const perDayAccount = /PLAYER_DAY_SEED/.test(lib);
const perDayAuth = /shot\.score_day\s*==\s*player_day\.day/.test(lib);
eq(perDayAccount, perDayAuth,
  'PlayerDay and the score_day authentication must be removed together or kept together: '
  + `per-day account ${perDayAccount ? 'present' : 'gone'}, per-day authentication `
  + `${perDayAuth ? 'present' : 'gone'}. A shot authenticates its FROZEN score_day on the late `
  + 'paths, so removing the account while the check remains makes every shot that crosses '
  + 'midnight unrevealable.');

if (perDayAccount) {
  // While it exists, its day must still be the seal-time day, not "today".
  ok(/pub score_day: i64/.test(state), 'Shot still carries the day it was sealed on');
  ok(/authenticate_shot_score_accounts/.test(lib),
    'the late paths still authenticate the shot against its own day');
}

// --- 2. the number, read from the source, never retyped ----------------------
// Solana's own rent: (128 + bytes) * 3480 lamports per byte-year * 2 years.
const LAMPORTS_PER_BYTE_YEAR = 3480, ACCOUNT_STORAGE_OVERHEAD = 128, EXEMPTION_THRESHOLD = 2;
const rentExempt = bytes =>
  (ACCOUNT_STORAGE_OVERHEAD + bytes) * LAMPORTS_PER_BYTE_YEAR * EXEMPTION_THRESHOLD;

const declared = state.match(/impl PlayerDay \{\s*pub const LEN: usize = (\d+);/);
ok(declared, 'PlayerDay::LEN is declared in state.rs and is read from there, not retyped here');
const onChain = Number(declared[1]) + 8;          // Anchor allocates 8 + LEN
const perDay = rentExempt(onChain);
const perYear = perDay * 365;

// A player who plays on 365 days funds 365 of these. This is the M2 headline and
// it is derived here rather than quoted, so it cannot drift from the struct.
ok(perYear / 1e9 > 0.4 && perYear / 1e9 < 0.7,
  `a daily player funds ${(perYear / 1e9).toFixed(3)} SOL of PlayerDay rent per year `
  + `(${onChain} bytes on chain, ${perDay} lamports each) - if this moved, the struct changed`);

// --- 3. permanent or refundable, stated plainly ------------------------------
// The shape that turns this charge into a deposit is a recorded funder plus a
// close that refunds exactly that address. Until it is there, this test records
// that the rent does not come back, so nobody can claim M2 is closed by a grep.
//
// Corrected 2026-09-05 by its author: this condition used to require `open_refs`
// in Core's lib.rs. open_refs is a TIMEPIN field (M1's counter) and has never
// existed in Core - Core's reference count is `accepted - terminal`, and
// state.rs:418 says so on purpose. So the condition was false forever and this
// file printed "M2 OPEN: the rent is permanent" for hours AFTER close_player_day
// landed in c8cf429. A test that reports the wrong state of a row it owns is the
// same defect as a gate row that greps for a proxy - I have spent the afternoon
// finding those in other people's work and shipped one here.
const refundable = /pub fn close_player_day/.test(lib) && /close\s*=\s*rent_payer/.test(lib);
if (!refundable) {
  console.log(`  M2 OPEN: PlayerDay rent is permanent - ${(perYear / 1e9).toFixed(3)} SOL/year `
    + 'per daily player, never returned. The M1 shape (open_refs + rent_payer + a close that '
    + 'refunds) is what makes it a deposit instead of a charge.');
} else {
  ok(/rent_payer/.test(lib), 'a closable PlayerDay must refund a recorded rent_payer, not the caller');
}

// --- 4. the guard, which the gate's M2 row does not check --------------------
// M2 greps for `pub fn close_player_day`, `close = rent_payer` and
// `address = player_day.rent_payer`. All three can be present while the
// PRECONDITION is gone, and the precondition is the safety: without it anyone
// could close a day that still has shots in flight, taking the rent out from
// under an account the late paths (settle, reveal, close) still authenticate
// against. The refund would go to the right person and the day would still be
// destroyed. Reviewed and landed as commit c8cf429; pinned here because a grep
// for three names cannot tell a safe close from an unsafe one.
const closeFn = /pub fn close_player_day[\s\S]*?\n    }/.exec(lib);
ok(closeFn, 'close_player_day is gone - M2 is not closed, whatever the gate row says');
const body = closeFn[0];
ok(/player_day\.accepted\s*>\s*0/.test(body),
  'close_player_day no longer requires accepted > 0. A day that never accepted a shot would be closable, '
  + 'and terminal == accepted is trivially true at 0 == 0 - the same shape as a counter nobody increments.');
ok(/player_day\.terminal\s*==\s*player_day\.accepted/.test(body),
  'close_player_day no longer requires terminal == accepted. Anyone could close a day with shots still in '
  + 'flight: the rent goes to the recorded payer and the account the late paths authenticate against is gone.');
ok(/PlayerDayStillReferenced/.test(body) && /PlayerDayStillReferenced,/.test(lib),
  'the PlayerDayStillReferenced error no longer guards close_player_day. Anchor numbers errors by position, '
  + 'so it must also still exist in the enum - a removed variant renumbers every error after it.');

console.log(`PASS  player day rent: ${checks} checks - the per-day account and the per-day `
  + 'authentication are pinned together, and the number is read from the struct');
