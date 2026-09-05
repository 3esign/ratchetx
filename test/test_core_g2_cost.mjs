import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const state = readFileSync(new URL(
  '../onchain/ratchet-core-g2/programs/ratchet-core-g2/src/state.rs',
  import.meta.url,
), 'utf8');
const costDoc = readFileSync(new URL('../docs/ONCHAIN_COST.md', import.meta.url), 'utf8');

let checks = 0;
const check = (actual, expected, message) => {
  checks++;
  assert.equal(actual, expected, message);
};
const match = (value, pattern, message) => {
  checks++;
  assert.match(value, pattern, message);
};
const notMatch = (value, pattern, message) => {
  checks++;
  assert.doesNotMatch(value, pattern, message);
};

// Freeze the source ABI that the rent snapshot prices. If these fail, rerun the
// cluster queries and update the evidence instead of silently changing a quote.
match(state, /pub const HISTORY_PAGE_CAP: usize = 16;/, 'history capacity');
match(state, /pub const WORK_PAGE_CAP: usize = HISTORY_PAGE_CAP \* WORK_KINDS_PER_SHOT;/,
  'work capacity derives from the shot page');
match(state, /pub const WORK_KINDS_PER_SHOT: usize = 3;/, 'three sponsored work kinds');
match(state, /pub const WORK_PAGE_VEC_LENGTH_OFFSET: usize = 83;/, 'Vec length offset');
match(state, /pub const WORK_PAGE_RECORDS_OFFSET: usize = 87;/, 'record zero offset');
match(state, /impl Shot \{\s*pub const LEN: usize = 772;/, 'transient Shot payload');
match(state, /impl ShotResult \{\s*pub const LEN: usize = 32 \+ 32 \+ 1 \+ 1 \+ 8 \+ 8 \+ 8 \+ 8 \+ 1 \+ 2 \+ 32 \+ 32;/,
  'compact result remains 165 bytes');
match(state, /impl WorkRecord \{\s*pub const LEN: usize = 32 \+ 1 \+ 1 \+ 32 \+ 32 \+ 8;/,
  'packed work record remains 106 bytes');
match(state, /pub const RELOAD_HISTORY_PAGE_CAP: usize = 32;/,
  'reload page capacity');
match(state, /impl ReloadRecord \{\s*pub const LEN: usize = 8 \+ 32 \+ 8 \+ PODIUM_SEAT_COUNT;/,
  'packed reload record remains 51 bytes');
match(state, /impl ReloadHistoryPage \{\s*pub const BASE_LEN: usize = 2 \+ 1 \+ 32 \+ 32 \+ 8 \+ 4;/,
  'reload page base payload remains 79 bytes');

// M3 CHANGED THE PAGE AND THIS FILE DID NOT NOTICE, because the HistoryPage
// bytes below used to be JavaScript arithmetic on literals - 8 + 79, and
// 8 + 79 + 16 * (1 + 165) - while ReloadHistoryPage above was genuinely read
// out of the source. A cost snapshot that prices a layout it does not read is
// a snapshot that ages silently and stays green. Every size below is now
// DERIVED, so the next layout change fails here instead of aging.
const sumOfTerms = expression => expression
  .split('+').map(term => Number(term.trim()))
  .reduce((total, term) => {
    assert.ok(Number.isFinite(term),
      `constant is not a plain sum of literals: ${expression}`);
    return total + term;
  }, 0);
const implConst = (type, name) => {
  const found = state.match(new RegExp(
    `impl ${type} \\{[\\s\\S]{0,400}?pub const ${name}: usize = ([^;]+);`,
  ));
  assert.ok(found, `${type}::${name} is gone from state.rs`);
  checks++;
  return sumOfTerms(found[1]);
};

// The page is a FIXED-SIZE COMMITMENT after M3: no Vec, no 4-byte length
// prefix, no growth. BASE and MAX are aliases of LEN, and their being equal is
// the statement - a page whose base and max differ again is a page that grows.
match(state, /impl HistoryPage \{[\s\S]{0,300}?pub const LEN: usize = 2 \+ 1 \+ 32 \+ 32 \+ 8 \+ 1 \+ 2 \+ 32;/,
  'HistoryPage is a fixed 110-byte commitment');
match(state, /pub const BASE_LEN: usize = Self::LEN;/, 'BASE_LEN aliases LEN');
match(state, /pub const MAX_LEN: usize = Self::LEN;/, 'MAX_LEN aliases LEN');
notMatch(state, /pub slots: Vec<Option<ShotResult>>/,
  'the page no longer stores rows at all');
const HISTORY_PAGE_LEN = implConst('HistoryPage', 'LEN');
check(HISTORY_PAGE_LEN, 110, 'HistoryPage payload derived from state.rs');
const WORK_PAGE_BASE_LEN = implConst('WorkPage', 'BASE_LEN');
const RELOAD_PAGE_BASE_LEN = implConst('ReloadHistoryPage', 'BASE_LEN');
const SHOT_RESULT_LEN = implConst('ShotResult', 'LEN');
const WORK_RECORD_LEN = implConst('WorkRecord', 'LEN');
const SHOT_LEN = implConst('Shot', 'LEN');
notMatch(state, /pub struct ReloadReceipt\b/,
  'standalone permanent reload receipt was removed');
notMatch(state, /pub struct LegacyClaim\b/,
  'ledger fields are the sole legacy replay tombstone');

const DISCRIMINATOR = 8;
// ONE number for the page, in every state it can be in. That is M3.
const historyPage = DISCRIMINATOR + HISTORY_PAGE_LEN;
check(historyPage, 118, 'HistoryPage account bytes, empty or full');

// What it cost BEFORE M3, kept so the saving is arithmetic rather than prose.
// These are deliberately literals: they describe a layout that is GONE, so
// deriving them from a source that no longer contains it would be a lie.
const preM3Empty = DISCRIMINATOR + 79;
const preM3One = preM3Empty + 1 + SHOT_RESULT_LEN;
const preM3Full = preM3Empty + 16 * (1 + SHOT_RESULT_LEN);
check(preM3Empty, 87, 'pre-M3 empty page account bytes');
check(preM3One, 253, 'pre-M3 one compact result account bytes');
check(preM3Full, 2743, 'pre-M3 full compact history account bytes');
check(preM3Full - historyPage, 2625, 'M3 removes 2,625 bytes per full page');

// WorkPage was priced off the HistoryPage constant because both bases happened
// to be 79. That coincidence ended with M3. It reads its own now.
const workOne = DISCRIMINATOR + WORK_PAGE_BASE_LEN + WORK_RECORD_LEN;
const workFull = DISCRIMINATOR + WORK_PAGE_BASE_LEN + 48 * WORK_RECORD_LEN;
const transientShot = DISCRIMINATOR + SHOT_LEN;
const reloadEmpty = DISCRIMINATOR + RELOAD_PAGE_BASE_LEN;
const reloadOne = reloadEmpty + 51;
const reloadFull = reloadEmpty + 32 * 51;

check(workOne, 193, 'one work record account bytes');
check(workFull, 5175, 'full work page account bytes');
check(transientShot, 780, 'transient shot account bytes');
check(reloadEmpty, 87, 'empty ReloadHistoryPage account bytes');
check(reloadOne, 138, 'one packed reload record account bytes');
check(reloadFull, 1719, 'full packed reload page account bytes');

// Dated 2026-09-04 RPC observations. These are evidence snapshots, not timeless
// protocol constants. Query the target cluster again before a funded release.
const devnet = bytes => 650_240 + bytes * 5_080;
const mainnet = bytes => 810_624 + bytes * 6_333;

check(devnet(historyPage), 1_249_680, 'devnet HistoryPage rent, any contents');
check(devnet(preM3Empty), 1_092_200, 'devnet pre-M3 empty page rent');
check(devnet(preM3Full), 14_584_680, 'devnet pre-M3 full history rent');
check(devnet(workFull), 26_939_240, 'devnet full work rent');
check(devnet(transientShot), 4_612_640, 'devnet transient Shot rent');
check(devnet(reloadEmpty), 1_092_200, 'devnet empty reload page rent');
check(devnet(reloadOne), 1_351_280, 'devnet one packed reload rent');
check(devnet(reloadFull), 9_382_760, 'devnet full reload page rent');

check(mainnet(historyPage), 1_557_918, 'mainnet HistoryPage rent, any contents');
check(mainnet(preM3Empty), 1_361_595, 'mainnet pre-M3 empty page rent');
check(mainnet(preM3One), 2_412_873, 'mainnet pre-M3 one-result page rent');
check(mainnet(preM3Full), 18_182_043, 'mainnet pre-M3 full history rent');
check(mainnet(workOne), 2_032_893, 'mainnet one-work page rent');
check(mainnet(workFull), 33_583_899, 'mainnet full work rent');
check(mainnet(transientShot), 5_750_364, 'mainnet transient Shot rent');
check(mainnet(reloadEmpty), 1_361_595, 'mainnet empty reload page rent');
check(mainnet(reloadOne), 1_684_578, 'mainnet one packed reload rent');
check(mainnet(reloadFull), 11_697_051, 'mainnet full reload page rent');

// THE HEADLINE M3 NUMBER, and it is the one docs/ONCHAIN_COST.md quotes.
// Archiving a shot used to add 166 bytes of PERMANENT rent to the page:
// 1,051,278 lamports, 0.001051278 SOL, per shot, never returned. The page does
// not grow now, so the marginal cost of one more archived shot is not smaller,
// it is ZERO - and the whole page, for sixteen shots, costs less than ONE
// pre-M3 marginal slot did.
check(mainnet(preM3One) - mainnet(preM3Empty), 1_051_278,
  'mainnet pre-M3 marginal history slot including Option tag');
// The marginal cost is zero because the size is a constant, and the MECHANISM
// is what is pinned here rather than a subtraction of a number from itself:
// serialized_len_for still takes and validates its arguments, and returns LEN.
match(state, /pub fn serialized_len_for[\s\S]{0,600}?Ok\(Self::LEN\)/,
  'the page length does not depend on how much the page holds');
// A page that has archived SIXTEEN shots now costs less than a pre-M3 page
// that had archived ONE. It does NOT cost less than a single marginal slot -
// the per-account overhead is 810,624 lamports before a byte is stored - and
// that is worth stating precisely rather than rounding in our own favour.
check(mainnet(historyPage) < mainnet(preM3One), true,
  'a full page now costs less than a pre-M3 page holding one row');
check(mainnet(historyPage) > mainnet(preM3One) - mainnet(preM3Empty), true,
  'but NOT less than one marginal slot: the per-account overhead dominates');
check(mainnet(preM3Full) - mainnet(historyPage), 16_624_125,
  'mainnet rent M3 frees on a full page');
check(mainnet(workOne) - mainnet(DISCRIMINATOR + WORK_PAGE_BASE_LEN), 671_298,
  'mainnet marginal packed work record');
check(mainnet(DISCRIMINATOR + WORK_PAGE_BASE_LEN + 2 * WORK_RECORD_LEN) <
  2 * mainnet(125), true,
  'packed work crosses below standalone receipts at two records');
check(mainnet(workOne) > mainnet(125), true,
  'do not hide that one isolated packed record costs more');
check(mainnet(reloadOne) - mainnet(reloadEmpty), 322_983,
  'mainnet marginal packed reload record');
const removedReloadReceipt = 294;
check(mainnet(removedReloadReceipt), 2_672_526,
  'removed standalone reload receipt mainnet rent');
check(mainnet(reloadOne) < mainnet(removedReloadReceipt), true,
  'even the first packed reload is cheaper than its removed receipt');
check(mainnet(reloadFull) < 32 * mainnet(removedReloadReceipt), true,
  'full packed page removes repeated per-account rent overhead');

const rejectedFull = preM3Empty + 16 * (1 + 496);
check(rejectedFull, 8039, 'discarded full history bytes');
check(mainnet(rejectedFull), 51_721_611, 'discarded mainnet full page rent');
check(mainnet(rejectedFull) > mainnet(preM3Full) * 2.8, true,
  'the compact row was already materially cheaper than the rejected design');
check(mainnet(rejectedFull) > mainnet(historyPage) * 33, true,
  'and storing no rows at all is another order of magnitude below that');

match(costDoc, /official devnet and mainnet-beta RPC/, 'cost doc names both clusters');
match(costDoc, /1,051,278 lamports \(0\.001051278 SOL\)/,
  'cost doc still states the pre-M3 marginal it is comparing against');
match(costDoc, /M3/,
  'cost doc names the change that removed the per-shot history rent');
match(costDoc, /118/, 'cost doc reports the fixed page size');
match(costDoc, /one-shot, normal-repeat and full-page cases separately/,
  'cost doc refuses to hide first-player overhead');

console.log(`PASS  Core G2 compact cost snapshot: ${checks} checks`);
