// M3's load-bearing claim, made enforceable instead of asserted in prose.
//
// docs/reviews/opusc-2026-09-05/M3_THE_PAGES.md says the commitment-hash form is
// available for HistoryPage BECAUSE nothing on chain ever reads a stored row. A
// proposal that rests on a property of the source should fail the moment that
// property stops holding, not the moment somebody re-reads the source.
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

// --- 2. exactly one read of a stored row, and it is the self-check ------------

check(() => {
  const hits = [...lib.matchAll(/\.slots\[/g)].map(m => lib.slice(0, m.index).split('\n').length);
  assert.deepEqual(hits.length, 1,
    `expected exactly ONE '.slots[' in the program (the read-back inside ` +
    `archive_terminal_shot); found ${hits.length} at lines ${hits.join(', ')}. A second one is a ` +
    `read of stored history and M3's premise is gone. ${DELIBERATE}`);

  // And it must be inside archive_terminal_shot, reading back what that same
  // function inserted - not a lookup of some other shot's row.
  const fnAt = lib.indexOf('fn archive_terminal_shot');
  assert.ok(fnAt >= 0, `archive_terminal_shot is gone. ${DELIBERATE}`);
  const fnLine = lib.slice(0, fnAt).split('\n').length;
  assert.ok(hits[0] > fnLine && hits[0] < fnLine + 40,
    `the single '.slots[' read is at line ${hits[0]}, outside archive_terminal_shot ` +
    `(line ${fnLine}). ${DELIBERATE}`);

  const body = lib.slice(fnAt, fnAt + 2400);
  const insertAt = body.indexOf('insert_terminal');
  const readAt = body.indexOf('.slots[');
  assert.ok(insertAt >= 0 && insertAt < readAt,
    'the read must follow the insert in the same function - that is what makes it a self-check ' +
    `on the row just written rather than a lookup. ${DELIBERATE}`);
}, 'the one row read is a self-check on the row just inserted');

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
  const cap = number(state, 'HISTORY_PAGE_CAP');
  assert.equal(cap, 16, `HISTORY_PAGE_CAP changed; every per-shot figure in M3 moves. ${DELIBERATE}`);

  // ShotResult::LEN = 32+32+1+1+8+8+8+8+1+2+32+32 = 165, and the page is
  // BASE_LEN + cap*(1 + LEN) = 79 + 16*166 = 2735 bytes.
  const lenLine = state.match(/impl ShotResult \{[\s\S]{0,200}?LEN: usize = ([^;]+);/);
  assert.ok(lenLine, `ShotResult::LEN is gone. ${DELIBERATE}`);
  const shotResultLen = lenLine[1].split('+').reduce((a, t) => a + Number(t.trim()), 0);
  assert.equal(shotResultLen, 165, `ShotResult::LEN is now ${shotResultLen}, not 165. ${DELIBERATE}`);

  const base = 2 + 1 + 32 + 32 + 8 + 4;
  assert.equal(base + cap * (1 + shotResultLen), 2735,
    'the HistoryPage size in M3 (2,735 B) no longer follows from the constants. ' + DELIBERATE);
}, 'the HistoryPage size M3 quotes still follows from the constants');

console.log(`history page is write-only: ${checks} checks passed (host tier; structural)`);
