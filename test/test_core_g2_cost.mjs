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
notMatch(state, /pub struct ReloadReceipt\b/,
  'standalone permanent reload receipt was removed');
notMatch(state, /pub struct LegacyClaim\b/,
  'ledger fields are the sole legacy replay tombstone');

const historyEmpty = 8 + 79;
const historyOne = historyEmpty + 1 + 165;
const historyFull = historyEmpty + 16 * (1 + 165);
const workOne = historyEmpty + 106;
const workFull = historyEmpty + 48 * 106;
const transientShot = 8 + 772;
const reloadEmpty = 8 + 79;
const reloadOne = reloadEmpty + 51;
const reloadFull = reloadEmpty + 32 * 51;

check(historyEmpty, 87, 'empty page account bytes');
check(historyOne, 253, 'one compact result account bytes');
check(historyFull, 2743, 'full compact history account bytes');
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

check(devnet(historyEmpty), 1_092_200, 'devnet empty page rent');
check(devnet(historyOne), 1_935_480, 'devnet one-result page rent');
check(devnet(historyFull), 14_584_680, 'devnet full history rent');
check(devnet(workFull), 26_939_240, 'devnet full work rent');
check(devnet(transientShot), 4_612_640, 'devnet transient Shot rent');
check(devnet(reloadEmpty), 1_092_200, 'devnet empty reload page rent');
check(devnet(reloadOne), 1_351_280, 'devnet one packed reload rent');
check(devnet(reloadFull), 9_382_760, 'devnet full reload page rent');

check(mainnet(historyEmpty), 1_361_595, 'mainnet empty page rent');
check(mainnet(historyOne), 2_412_873, 'mainnet one-result page rent');
check(mainnet(historyFull), 18_182_043, 'mainnet full history rent');
check(mainnet(workOne), 2_032_893, 'mainnet one-work page rent');
check(mainnet(workFull), 33_583_899, 'mainnet full work rent');
check(mainnet(transientShot), 5_750_364, 'mainnet transient Shot rent');
check(mainnet(reloadEmpty), 1_361_595, 'mainnet empty reload page rent');
check(mainnet(reloadOne), 1_684_578, 'mainnet one packed reload rent');
check(mainnet(reloadFull), 11_697_051, 'mainnet full reload page rent');

check(mainnet(historyOne) - mainnet(historyEmpty), 1_051_278,
  'mainnet marginal history slot including Option tag');
check(mainnet(workOne) - mainnet(historyEmpty), 671_298,
  'mainnet marginal packed work record');
check(mainnet(87 + 2 * 106) < 2 * mainnet(125), true,
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

const rejectedFull = 87 + 16 * (1 + 496);
check(rejectedFull, 8039, 'discarded full history bytes');
check(mainnet(rejectedFull), 51_721_611, 'discarded mainnet full page rent');
check(mainnet(rejectedFull) > mainnet(historyFull) * 2.8, true,
  'compact full page is materially cheaper');

match(costDoc, /official devnet and mainnet-beta RPC/, 'cost doc names both clusters');
match(costDoc, /1,051,278 lamports \(0\.001051278 SOL\)/,
  'cost doc reports the measured mainnet marginal result');
match(costDoc, /one-shot, normal-repeat and full-page cases separately/,
  'cost doc refuses to hide first-player overhead');

console.log(`PASS  Core G2 compact cost snapshot: ${checks} checks`);
