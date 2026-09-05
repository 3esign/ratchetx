// What the WorkPage actually costs, read out of the source rather than guessed.
//
// Fable's B6.5 said void_pending_entry calls complete_optional_work three times
// over an O(n^2) validation of 48 records and that no SBF test fills a page. That
// is right about Core and it is NOT right about Timepin, which caps its page at 2 —
// so a reduction proposal aimed at Timepin's work market would delete the cheap one
// and leave the expensive one. This test pins both numbers so nobody argues from
// memory again, and it fails the moment either program changes its shape.
//
// It is a COST MODEL, not a compute measurement: it counts comparisons and bytes,
// which are facts, and deliberately does not claim a CU figure, which would need
// LiteSVM and a filled page. Filling a page on SBF is still unwritten and still the
// only way to close B6.5.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const CORE = 'onchain/ratchet-core-g2/programs/ratchet-core-g2/src/';
const TIMEPIN = 'onchain/rcx-timepin-v2/programs/rcx-timepin-v2/src/';

const read = f => fs.readFileSync(f, 'utf8');
const num = (src, re, what) => {
  const m = src.match(re);
  assert.ok(m, `could not read ${what} from source`);
  return Number(m[1]);
};

// --- the two caps, from the two programs -----------------------------------
const coreState = read(CORE + 'state.rs');
const coreLib = read(CORE + 'lib.rs');
const timepinLifecycle = read(TIMEPIN + 'lifecycle.rs');

const historyCap = num(coreState, /HISTORY_PAGE_CAP:\s*usize\s*=\s*(\d+)/, 'HISTORY_PAGE_CAP');
const kindsPerShot = num(coreState, /WORK_KINDS_PER_SHOT:\s*usize\s*=\s*(\d+)/, 'WORK_KINDS_PER_SHOT');
const coreCap = historyCap * kindsPerShot;
assert.match(coreLib, /assert_eq!\(WORK_PAGE_CAP,\s*48\)/,
  'Core still asserts its own cap is 48; if that changed, this model must be re-derived');
assert.equal(coreCap, 48, 'Core WORK_PAGE_CAP = HISTORY_PAGE_CAP * WORK_KINDS_PER_SHOT');

const timepinCap = num(timepinLifecycle, /WORK_PAGE_CAP:\s*usize\s*=\s*(\d+)/, 'Timepin WORK_PAGE_CAP');
assert.equal(timepinCap, 2, 'Timepin caps its page at 2 records, which is why it is cheap');

// --- record size, from the same source -------------------------------------
const recordLen = read(CORE + 'state.rs')
  .match(/impl WorkRecord \{\s*pub const LEN: usize = ([^;]+);/);
assert.ok(recordLen, 'WorkRecord::LEN not found');
const LEN = recordLen[1].split('+').map(s => Number(s.trim())).reduce((a, b) => a + b, 0);
assert.equal(LEN, 106, 'WorkRecord is 106 bytes (32 subject + 1 + 1 + 32 + 32 + 8)');

// --- the shape of the cost -------------------------------------------------
// validate_contents compares every record against every prior record:
//   sum(0..n-1) = n(n-1)/2 subject+kind comparisons, each over a 32-byte Pubkey.
const pairs = n => (n * (n - 1)) / 2;
assert.equal(pairs(coreCap), 1128, 'a full Core page costs 1128 comparisons per validation');
assert.equal(pairs(timepinCap), 1, 'a full Timepin page costs one');

// and lookup_optional_index calls validate_contents on every lookup, so the cost
// is paid per ACCESS, not once per load.
assert.match(coreState, /pub fn lookup_optional_index[\s\S]{0,200}self\.validate_contents\(\)\?;/,
  'lookup_optional_index still re-validates the whole page on every lookup');

// --- how many times the worst path pays it ---------------------------------
// void_pending_entry issues three completions back to back.
const voidBody = coreLib.slice(coreLib.indexOf('pub fn void_pending_entry'));
const firstFn = voidBody.slice(0, voidBody.indexOf('\n    pub fn ', 10));
const completions = (firstFn.match(/complete_optional_work\(/g) || []).length;
assert.ok(completions >= 3, `void_pending_entry makes ${completions} completions, expected at least 3`);

const bytesPerPass = coreCap * LEN;
console.log('OK  work page cost model');
console.log(`    Core     cap ${coreCap}  -> ${pairs(coreCap)} comparisons per validation, ${bytesPerPass} record bytes per pass`);
console.log(`    Timepin  cap ${timepinCap}   -> ${pairs(timepinCap)} comparison per validation`);
console.log(`    void_pending_entry: ${completions} completions => >= ${completions * pairs(coreCap)} comparisons and`);
console.log(`    ${completions * 2 * bytesPerPass} bytes of (de)serialisation on the failure path, before any CU is counted.`);
console.log('    No SBF test fills a page. Until one does, the CU ceiling on this path is unknown.');
