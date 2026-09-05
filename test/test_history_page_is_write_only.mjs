// M3's load-bearing claim - FLIPPED, because M3 has landed (e016ca8).
//
// Until e016ca8 this file pinned an OBSERVED property: nothing on chain ever
// read a stored HistoryPage row, which is why the commitment form was available
// at all. That property is no longer observed, it is ENFORCED BY THE TYPE -
// there are no stored rows to read. So the checks invert: what used to assert
// "exactly one read, and it is a self-check" now asserts ZERO, and asserts that
// the storage it read is gone.
//
// This is deliberate and it is the honest direction. A structural test that
// still passed after the shape it describes was replaced would be worse than no
// test: it would report GREEN on a premise that had quietly become vacuous.
// docs/reviews/opusc-2026-09-05/M3_THE_PAGES.md is the document these pin.
//
// This is a STRUCTURAL test in the shape of MIN_CAPTURE_SPEC section 7: it reads
// Rust as text and pins facts about its shape. That makes it fragile in one
// specific way and honest about it — a rename or a reformat can break it without
// anything being wrong. Every failure message therefore says what to do if the
// change was deliberate. What it must never do is pass while the premise is gone.
//
// Evidence tier: host.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CORE = join(here, '..', 'onchain', 'ratchet-core-g2', 'programs', 'ratchet-core-g2', 'src');
const LIB = join(CORE, 'lib.rs');
const STATE = join(CORE, 'state.rs');

// Rust unit tests live behind #[cfg(test)] and are not the program. Everything
// below reads only what actually runs on chain.
const withoutTests = source => {
  const at = source.indexOf('#[cfg(test)]');
  return at < 0 ? source : source.slice(0, at);
};

const lib = withoutTests(readFileSync(LIB, 'utf8'));
const state = withoutTests(readFileSync(STATE, 'utf8'));

let checks = 0;
const check = (fn, label) => { fn(); checks += 1; };
const DELIBERATE = 'If this change was deliberate, M3_THE_PAGES.md rests on the old shape: ' +
  'update the document and say so in the room, do not just fix the test.';

// --- 1. every HistoryPage binding is a WRITER --------------------------------

check(() => {
  const lines = lib.split('\n');
  const bindings = [];
  lines.forEach((line, i) => {
    if (/pub\s+history_page\s*:\s*Box<Account<'info,\s*HistoryPage>>/.test(line)) bindings.push(i);
  });
  assert.ok(bindings.length >= 10,
    `expected the eleven-ish HistoryPage bindings, found ${bindings.length}. ${DELIBERATE}`);

  for (const at of bindings) {
    // Walk back to the opening of this field's #[account(...)] attribute.
    let open = -1;
    for (let i = at - 1; i >= 0 && i > at - 25; i -= 1) {
      if (/#\[account\(/.test(lines[i])) { open = i; break; }
      // A blank line or another field's declaration means this binding has no
      // attribute at all, which is a read-only binding by definition.
      if (/pub\s+\w+\s*:/.test(lines[i])) break;
    }
    assert.ok(open >= 0,
      `the HistoryPage binding at lib.rs:${at + 1} has no #[account(...)] attribute, so it is a ` +
      `READ-ONLY binding. M3 says every one is a writer. ${DELIBERATE}`);
    const attr = lines.slice(open, at).join(' ');
    // mut, init and init_if_needed are all WRITE bindings; Anchor implies mut for
    // the init forms. A binding with none of the three is a reader.
    assert.match(attr, /\bmut\b|\binit\b|\binit_if_needed\b/,
      `the HistoryPage binding at lib.rs:${at + 1} carries no mut/init marker, so some instruction ` +
      `now takes the page to READ it. ${DELIBERATE}`);
  }
}, 'every HistoryPage account binding is mut, so no instruction takes it to read');

// --- 2. there is no stored row left to read, and none is read ----------------

check(() => {
  const hits = [...lib.matchAll(/\.slots\[/g)].map(m => lib.slice(0, m.index).split('\n').length);
  assert.deepEqual(hits.length, 0,
    `expected ZERO '.slots[' in the program after M3; found ${hits.length} at lines ` +
    `${hits.join(', ')}. HistoryPage has no rows to index, so this cannot compile - and if it ` +
    `does, the Vec came back. ${DELIBERATE}`);

  assert.ok(!/pub\s+slots\s*:\s*Vec<Option<ShotResult>>/.test(state),
    'HistoryPage.slots is back. The whole of M3 is the removal of that field; if it returned, ' +
    `the page grows again and every rent figure in M3_THE_PAGES.md is wrong. ${DELIBERATE}`);

  // What replaced it. Not a rename: a rolling commitment plus the two facts an
  // off-chain reader needs to detect omission.
  for (const field of [/pub\s+pending_count\s*:\s*u8/,
                       /pub\s+terminal_mask\s*:\s*u16/,
                       /pub\s+results_root\s*:\s*\[u8;\s*32\]/]) {
    assert.match(state, field,
      `HistoryPage lost a field M3 depends on (${field}). ${DELIBERATE}`);
  }
  for (const dom of ['HISTORY_ROW_DOMAIN', 'HISTORY_CHAIN_DOMAIN']) {
    assert.match(state, new RegExp(`${dom}: &\\[u8\\] = b"rcx-core:history-`),
      `${dom} is gone. Two domains is what stops a row hash being replayed as a chain hash. ` +
      DELIBERATE);
  }
}, 'no stored rows remain, and the commitment fields that replaced them are present');

// --- 2b. the ordering M3 bought: verify BEFORE commit ------------------------

check(() => {
  const fnAt = lib.indexOf('fn archive_terminal_shot');
  assert.ok(fnAt >= 0, `archive_terminal_shot is gone. ${DELIBERATE}`);
  // Bound the body at the function's own closing brace, not a character count.
  // A fixed window is how a test ends up asserting about the NEXT function -
  // which is exactly what a 2,400-char window did on the first run of this file.
  const close = lib.indexOf('\n}\n', fnAt);
  assert.ok(close > fnAt, `cannot find the end of archive_terminal_shot. ${DELIBERATE}`);
  const body = lib.slice(fnAt, close);
  const verifyAt = body.indexOf('verify_game_result(');
  const commitAt = body.indexOf('commit_terminal(');
  assert.ok(verifyAt >= 0, `verify_game_result no longer runs in archive_terminal_shot. ${DELIBERATE}`);
  assert.ok(commitAt >= 0, `commit_terminal is not called. ${DELIBERATE}`);
  assert.ok(verifyAt < commitAt,
    'verify_game_result must run BEFORE commit_terminal. It used to run after, on the row read ' +
    'back, so a bad row was written and then rejected by the same instruction. That ordering is ' +
    `the one thing M3 made strictly better rather than merely smaller. ${DELIBERATE}`);

  // The row is committed once and only once per call: two commit_terminal calls
  // in one function would fold two roots for one shot.
  const calls = [...body.matchAll(/commit_terminal\(/g)].length;
  assert.equal(calls, 1, `commit_terminal is called ${calls} times here; expected 1. ${DELIBERATE}`);

  // Rent funding is gone with the growth. A resize here means the page grows
  // again, which is the defect M3 removed.
  assert.ok(!/realloc|fund_rent_growth|archive_funding_plan/.test(body),
    'archive_terminal_shot still carries a resize or a rent-funding block. The page is a fixed ' +
    `size now; if it grows, M3 did not land. ${DELIBERATE}`);
}, 'the row is verified before it is committed, once, with no growth');

// --- 3. the WorkPage read that disqualifies IT from the same treatment --------

check(() => {
  // M3 section 3: WorkPage rows ARE read, so the commitment form does not apply
  // to it. If that read ever disappears, the recommendation changes and the
  // document should be revisited - which is worth failing over in both directions.
  assert.match(lib, /records\[index\]\.disposition\s*==\s*RECEIPT_PENDING/,
    'the WorkPage disposition read (lib.rs:368) is gone. M3 section 3 says that read is exactly ' +
    `why WorkPage cannot take the commitment form; if it is gone, revisit that. ${DELIBERATE}`);
}, 'the WorkPage row read still exists, so section 3 still stands');

// --- 4. WorkPage is optional, and "absent" is defined safely ------------------

check(() => {
  assert.match(lib, /fn load_optional_work_page/,
    `load_optional_work_page is gone; WorkPage may no longer be optional. ${DELIBERATE}`);
  const fnAt = lib.indexOf('fn is_logically_uninitialized');
  assert.ok(fnAt >= 0, `is_logically_uninitialized is gone. ${DELIBERATE}`);
  const body = lib.slice(fnAt, fnAt + 400);
  // The definition is the security-relevant part: a predictable PDA can be
  // pre-funded by anyone, so lamports must NOT define absence. Three conditions,
  // and none of them is a balance.
  assert.match(body, /data_len\(\)\s*==\s*0/, `absence must require zero DATA. ${DELIBERATE}`);
  assert.match(body, /owner\s*==\s*anchor_lang::system_program::ID/,
    `absence must require system ownership. ${DELIBERATE}`);
  assert.match(body, /!account\.executable/, `absence must exclude executables. ${DELIBERATE}`);
  assert.ok(!/lamports/.test(body),
    'absence must NOT be defined by lamports: a predictable PDA can be pre-funded by anybody, and ' +
    `a dust sender would then hold a permanent veto over every shot. ${DELIBERATE}`);
}, 'WorkPage absence is defined by data and ownership, never by lamports');

// --- 5. the numbers M3 quotes, from the constants ------------------------------

check(() => {
  const number = (source, name) => {
    const m = source.match(new RegExp(`${name}[^=]*=\\s*([0-9_]+)`));
    assert.ok(m, `${name} is gone. ${DELIBERATE}`);
    return Number(m[1].replace(/_/g, ''));
  };

  // HISTORY_PAGE_CAP SURVIVES M3 and must: nonce/CAP is the page index, which is
  // a PDA seed, and nonce%CAP is the slot. It stopped being a Vec bound; it did
  // not stop being the page geometry.
  const cap = number(state, 'HISTORY_PAGE_CAP');
  assert.equal(cap, 16, `HISTORY_PAGE_CAP changed; every per-shot figure in M3 moves. ${DELIBERATE}`);
  assert.ok(cap <= 16,
    `HISTORY_PAGE_CAP is ${cap}, but terminal_mask is a u16: a cap above 16 cannot be represented ` +
    `and the mask would silently drop slots. ${DELIBERATE}`);

  // ShotResult::LEN still matters - it sizes the buffer commit_terminal hashes,
  // and it is what the OLD page cost was built from.
  const lenLine = state.match(/impl ShotResult \{[\s\S]{0,200}?LEN: usize = ([^;]+);/);
  assert.ok(lenLine, `ShotResult::LEN is gone. ${DELIBERATE}`);
  const shotResultLen = lenLine[1].split('+').reduce((a, t) => a + Number(t.trim()), 0);
  assert.equal(shotResultLen, 165, `ShotResult::LEN is now ${shotResultLen}, not 165. ${DELIBERATE}`);

  // THE NEW NUMBER, derived the same way the old one was: schema 2, bump 1,
  // economy_hash 32, player 32, page_index 8, pending_count 1, terminal_mask 2,
  // results_root 32.
  const pageLen = state.match(/impl HistoryPage \{[\s\S]{0,400}?LEN: usize = ([^;]+);/);
  assert.ok(pageLen, `HistoryPage::LEN is gone. ${DELIBERATE}`);
  const declared = pageLen[1].split('+').reduce((a, t) => a + Number(t.trim()), 0);
  assert.equal(declared, 2 + 1 + 32 + 32 + 8 + 1 + 2 + 32,
    `HistoryPage::LEN sums to ${declared}; M3 quotes 110 data bytes. ${DELIBERATE}`);
  assert.equal(declared, 110, `HistoryPage::LEN is ${declared}, not 110. ${DELIBERATE}`);
  assert.equal(declared + 8, 118,
    'M3 quotes 118 bytes for the account including the 8-byte discriminator. ' + DELIBERATE);

  // AND THE SAVING M3 IS ARGUED ON, stated as arithmetic rather than as prose:
  // the old form was BASE_LEN + cap*(1 + ShotResult::LEN) = 79 + 16*166 = 2,735.
  const oldForm = (2 + 1 + 32 + 32 + 8 + 4) + cap * (1 + shotResultLen);
  assert.equal(oldForm, 2735, 'the pre-M3 page size no longer follows from the constants. ' + DELIBERATE);
  assert.ok(oldForm - declared > 2600,
    `M3 claims it removes ~2.6 KB per page; the constants now say ${oldForm - declared} B. ` +
    DELIBERATE);

  // The size must not depend on the contents any more. serialized_len_for still
  // takes its two arguments - callers pass them and they are still validated -
  // but it must not compute a length from them.
  const fnAt = state.indexOf('pub fn serialized_len_for');
  assert.ok(fnAt >= 0, `serialized_len_for is gone. ${DELIBERATE}`);
  const body = state.slice(fnAt, fnAt + 700);
  assert.ok(!/checked_add|slot_count \*|terminal_count \*/.test(body),
    'serialized_len_for computes a length from its arguments again. The page is fixed; a length ' +
    `that moves with the contents means the account grows. ${DELIBERATE}`);
  assert.match(body, /Ok\(Self::LEN\)/,
    `serialized_len_for must return the constant. ${DELIBERATE}`);
}, 'the fixed page size and the saving M3 quotes both follow from the constants');

console.log(`history page stores no rows: ${checks} checks passed (host tier; structural)`);
