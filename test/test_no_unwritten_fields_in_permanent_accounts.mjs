// A FIELD THAT NOTHING WRITES IS NOT A FIELD. IT IS RENT.
//
// This is the gate for the defect the lead ruled on at 2026-09-05T17:00Z, in
// commit a82b171, and it is a gate I am writing against my OWN commit: fe0f8e6
// appended eleven `obs_` fields to TimepinNeedV2, 108 bytes in a PERMANENT
// per-target account, and the lifecycle that would have written them was never
// built. Every compile passed. Every host suite passed. Every gate row stayed
// green. The cost was measured at 395 SOL a year and nothing in this repository
// could see it, because a struct field is syntactically complete the moment it
// is declared.
//
// THE RULE, and it is narrower than "unused" on purpose:
//   For every #[account] struct - the ones that become permanent rent-paying
//   accounts on chain - every field must be written at least once in
//   PRODUCTION code with something other than a constant zero.
//
// Constant-zero-only is the interesting half and the half that catches real
// defects. A field initialised to 0 at open and never assigned again cannot
// ever hold anything else, so it is indistinguishable on chain from 108 bytes
// of padding - but it LOOKS alive to a grep, to a reviewer, and to a decoder in
// another crate that dutifully mirrors it. That is precisely how Core came to
// carry obs_ fields it could only ever read as zeros.
//
// WHAT THIS FILE DOES NOT DO: it does not fail on today's findings. A red gate
// costs six agents more than it costs the one person who can decide, and the
// findings below are ABI decisions - removing a field moves every offset after
// it - which belong to the lead and to Semir, not to a test. So today's set is
// written down as a BASELINE with a reason and a row for each entry.
//
// THE BASELINE CANNOT ROT, because it is checked in BOTH directions:
//   - a dead field that is NOT in the baseline fails the suite (the gate), and
//   - a baseline entry whose field HAS since been written also fails the suite,
//     telling you to delete the stale entry (the ratchet).
// So the list can only ever get shorter, and it cannot be quietly ignored.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const R = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');

const PROGRAMS = {
  'rcx-timepin-v2': [
    'onchain/rcx-timepin-v2/programs/rcx-timepin-v2/src/lib.rs',
    'onchain/rcx-timepin-v2/programs/rcx-timepin-v2/src/lifecycle.rs',
  ],
  'ratchet-core-g2': [
    'onchain/ratchet-core-g2/programs/ratchet-core-g2/src/lib.rs',
    'onchain/ratchet-core-g2/programs/ratchet-core-g2/src/state.rs',
    'onchain/ratchet-core-g2/programs/ratchet-core-g2/src/foreign_timepin.rs',
  ],
};

// Every entry: why it is dead, and what retires it. No entry without a row.
const BASELINE = {
  'rcx-timepin-v2 TimepinNeedV2.candidate_b_hash': 'Branch B deferred',
  // The lead's Branch B ruling, 17:00Z, a82b171: "the fields shipped, the
  // lifecycle that writes them did not". These eleven come OUT in I1 - this
  // baseline exists so that the gate is honest between the ruling and the edit,
  // and every one of these lines should be deleted in the same commit.
  // The lead ruled open_refs STAYS because M1 needs it. That ruling is about
  // the FUTURE: as of this commit the field is set to 0 at open and nothing
  // increments or decrements it, so close_need built on it today would find
  // every Need at zero references and delete evidence a live shot still needs -
  // which is OpusC's M1 P0 at 15:49Z, stated as a property of the bytes rather
  // than of the design. This entry is what M1 deletes.
  'rcx-timepin-v2 TimepinNeedV2.open_refs': 'M1 - close_need writes the counter',
  // NOT mine, NOT today's, and I am not proposing a fix: PlayerLedger carries
  // streak and best, 8 bytes in a permanent per-player account, and neither is
  // written anywhere on chain. The pair is maintained OFF chain in
  // api/game.js:1749 - `p.streak++; p.best = Math.max(p.best, p.streak)` - and
  // the only on-chain function that ever consumed streak is skill_xp, which is
  // #[deprecated] at state.rs:2386 with the note "streak-dependent XP is
  // non-consensus" and has zero callers. So the consensus half was removed and
  // the storage half was left behind. Two ways out and they are opposite:
  // WRITE them (the leaderboard becomes on-chain fact) or REMOVE them
  // (PlayerLedger::LEN 277 -> 269, which moves every offset after streak and is
  // a bigger ABI move than the Need). That is a decision, not a cleanup.
  'ratchet-core-g2 PlayerLedger.streak': 'undecided - write it or drop it, lead/Semir',
  'ratchet-core-g2 PlayerLedger.best': 'undecided - write it or drop it, lead/Semir',
};

// --- parsing ----------------------------------------------------------------
// Production code only: every one of these files puts its unit tests behind a
// single `#[cfg(test)]` at the tail, and a fixture that sets a field is exactly
// the thing that makes a dead field look alive.
const productionOnly = (src) => {
  const i = src.indexOf('\n#[cfg(test)]');
  return i === -1 ? src : src.slice(0, i);
};

const accountStructs = (src) => {
  const found = [];
  const re = /#\[account\][\s\S]*?pub struct (\w+) \{([\s\S]*?)\n\}/g;
  let m;
  while ((m = re.exec(src))) {
    const fields = [];
    for (const line of m[2].split('\n')) {
      const f = /^\s*pub (\w+)\s*:/.exec(line);
      if (f) fields.push(f[1]);
    }
    found.push({ name: m[1], fields, block: m[0] });
  }
  return found;
};

// A function signature's parameter list looks exactly like a struct literal:
// `fn skill_xp(xp_base: u64, streak: u32)` made `streak` look written for as
// long as it took to check it by hand. It is not a write; it is a binding.
const stripSignatures = (src) => src.replace(/\bfn\s+\w+\s*(<[^>]*>)?\s*\([^)]*\)/g, ' fn () ');

const CONSTANT_ZERO =
  /^(0|0u8|0u16|0u32|0u64|0u128|0i8|0i16|0i32|0i64|0i128|false|None|Pubkey::default\(\)|\[0(?:u8)?;\s*\d+\]|Default::default\(\))$/;

// Every place `field` is written, with the value written. Three write forms,
// and missing any one of them turns this gate into noise:
//   `x.field = v`      plain assignment - the value is read and classified
//   `x.field += v`     compound assignment - a NON-constant write even when the
//                      operand is a literal, because `count += 1` really moves
//   `Struct { field }` FIELD-INIT SHORTHAND, which has no colon at all. This
//                      one cost me a red suite: Economy.args, Ruleset.args and
//                      four DelegateGrant fields are ALL written by shorthand,
//                      and a detector that only knows `field:` calls every one
//                      of them dead.
// The shorthand branch is the loosest of the three and it is loose in the SAFE
// direction only for the two checks below it - a stray bare identifier reads as
// "alive", never as "dead". That is why section 4 pins the known-dead set by
// name: a scanner that has quietly stopped finding anything must fail.
const writesOf = (body, field) => {
  const values = [];
  const re = new RegExp(
    '(?:\\.' + field + '\\s*(?<op>[-+*/|&^]|<<|>>)?=(?!=)'
    + '|(?:^|[\\s{(,])' + field + '\\s*:'
    + '|(?:^|[\\s{(,])(?<short>' + field + ')\\s*(?=[,}]))',
    'gm',
  );
  let m;
  while ((m = re.exec(body))) {
    if (m.groups?.op) { values.push('<compound>'); continue; }
    if (m.groups?.short) { values.push('<shorthand>'); continue; }
    let depth = 0;
    let value = '';
    for (let i = re.lastIndex; i < body.length; i += 1) {
      const c = body[i];
      if ('([{'.includes(c)) depth += 1;
      else if (')]}'.includes(c)) { if (depth === 0) break; depth -= 1; }
      else if ((c === ',' || c === ';') && depth === 0) break;
      value += c;
    }
    values.push(value.trim().replace(/\s+/g, ' '));
  }
  return values;
};

export function scan() {
  const dead = new Map();
  for (const [program, files] of Object.entries(PROGRAMS)) {
    const sources = files.map((f) => productionOnly(R(f)));
    const structs = sources.flatMap((s) => accountStructs(s));
    // The declarations themselves are removed before searching: `pub best: u32,`
    // in the struct body would otherwise read as a write of `best`.
    let body = sources.join('\n');
    for (const s of structs) body = body.split(s.block).join('\n');
    body = stripSignatures(body);
    for (const s of structs) {
      for (const field of s.fields) {
        const values = writesOf(body, field);
        const key = `${program} ${s.name}.${field}`;
        if (values.length === 0) dead.set(key, 'never written');
        else if (values.every((v) => CONSTANT_ZERO.test(v))) {
          dead.set(key, `only ever ${[...new Set(values)].join(' | ')}`);
        }
      }
    }
  }
  return dead;
}

let checks = 0;
const ok = (cond, message) => { checks += 1; assert.ok(cond, message); };

const dead = scan();

// --- 1. the gate: nothing dead that is not written down ----------------------
const unexpected = [...dead].filter(([k]) => !(k in BASELINE));
ok(
  unexpected.length === 0,
  'A field in a PERMANENT on-chain account is never written, or is only ever written as a constant '
  + 'zero. On chain that is indistinguishable from padding, and it is paid for in per-account rent '
  + 'forever once the ABI is frozen. Either write it or remove it - and if it is deliberately '
  + 'deferred, add it to BASELINE in this file WITH the row that retires it.\n'
  + unexpected.map(([k, why]) => `  ${k}  (${why})`).join('\n'),
);

// --- 2. the ratchet: the baseline cannot outlive its reason ------------------
const revived = Object.keys(BASELINE).filter((k) => !dead.has(k));
ok(
  revived.length === 0,
  'A BASELINE entry in this file names a field that IS now written. That is good news and the entry '
  + 'is now a lie: delete it, so the next dead field cannot hide behind a stale exemption.\n'
  + revived.map((k) => `  ${k}  (baselined as: ${BASELINE[k]})`).join('\n'),
);

// --- 3. every exemption carries a row, not just a name -----------------------
for (const [key, reason] of Object.entries(BASELINE)) {
  ok(
    typeof reason === 'string' && reason.trim().length > 12,
    `BASELINE entry ${key} has no reason. An exemption without the row that retires it is how a `
    + 'deferral becomes permanent.',
  );
}

// --- 4. the parser itself, because a scanner that finds nothing passes --------
// Three ways this test could be quietly useless: it could fail to see #[account]
// structs at all, it could count a declaration as a write, or it could count a
// test fixture as a write. Each is pinned against the real files.
const tpLib = productionOnly(R('onchain/rcx-timepin-v2/programs/rcx-timepin-v2/src/lib.rs'));
ok(
  accountStructs(tpLib).some((s) => s.name === 'TimepinNeedV2'),
  'the #[account] parser no longer finds TimepinNeedV2 - if the attribute or the struct moved, this '
  + 'whole suite silently checks nothing',
);
ok(
  accountStructs(tpLib).find((s) => s.name === 'TimepinNeedV2').fields.includes('target_ts'),
  'the field parser no longer reads TimepinNeedV2 fields',
);
ok(
  dead.size > 0,
  'the scanner found no dead fields at all in either program. Given the state of this tree on '
  + '2026-09-05 that means the scanner broke, not that the tree got clean',
);
ok(
  !dead.has('rcx-timepin-v2 TimepinNeedV2.target_ts'),
  'target_ts is written from validate_open in open_need and must never be reported dead - if it is, '
  + 'the write detector is broken and every finding above is noise',
);
ok(
  !dead.has('ratchet-core-g2 HistoryPage.terminal_mask'),
  'terminal_mask is written with `|=` at state.rs:1489 and must not be reported dead - compound '
  + 'assignment is a real write',
);
ok(
  !dead.has('ratchet-core-g2 HistoryPage.pending_count'),
  'pending_count is written with `+=` at state.rs:1437 and must not be reported dead',
);
ok(
  dead.has('ratchet-core-g2 PlayerLedger.streak'),
  'streak stopped being reported dead. If a write was added, delete its BASELINE entry; if the '
  + 'signature stripper broke, `fn skill_xp(xp_base: u64, streak: u32)` is being counted as a write '
  + 'again - it is a parameter, not an assignment',
);

console.log(`ok - permanent-account fields: ${checks} checks, ${dead.size} dead fields, all baselined`);
