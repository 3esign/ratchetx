#!/usr/bin/env node
// THE CLIENT MUST KNOW EVERY INSTRUCTION THE PROGRAMS EXPOSE.
//
// Written 2026-09-05 after measuring that it knew five of thirty-five. Core
// declares 26 instructions and Timepin 9; the client's table held
// register_evidence_spec, open_need, open_ledger, open_history_page and
// seal_forward. Every one of those is on the way IN. Nothing in this repository
// knew how to settle, reveal, forfeit, capture or finalize - so a player could
// enter a shot that nothing here could ever resolve, and no gate row noticed
// because every row was about the two Rust crates.
//
// Two independent things are checked, and neither can pass on silence:
//
//   1. EVERY VALUE IS RE-DERIVED FROM ITS OWN KEY. Anchor's discriminator is
//      sha256("global:" + name)[0..8]. A typo in the table cannot survive.
//   2. THE TABLE IS COMPARED TO THE #[program] BLOCK OF BOTH CRATES. An
//      instruction added to Rust without the client learning about it fails
//      here, and so does a name the client invents that no program exposes.
//
// The parser refuses to run if it cannot find a #[program] block or if a block
// yields no instructions, because "I found nothing" and "I could not look" must
// never produce the same verdict. That is the lesson of six false greens.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { CORE_INSTRUCTION, TIMEPIN_INSTRUCTION }
  from '../onchain/ratchet-core-g2/client/client-v2.mjs';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const derive = name =>
  createHash('sha256').update(`global:${name}`).digest().subarray(0, 8).toString('hex');

// The #[program] block, and only it. Instructions declared anywhere else in the
// file are not instructions.
function programInstructions(source, label) {
  const at = source.indexOf('#[program]');
  assert.ok(at >= 0, `${label}: no #[program] block - this test cannot answer anything about it`);
  const rest = source.slice(at);
  // The module body ends at the first line that closes it at column 0.
  const end = rest.search(/\n}\n/);
  const body = end > 0 ? rest.slice(0, end) : rest;
  // The generic parameter list is optional and it is not decoration: reload_rcx
  // is declared `pub fn reload_rcx<'info>(`, and the first version of this regex
  // required the paren to follow the name directly, so it silently dropped that
  // one instruction and accused the client of inventing it. The test found a
  // defect in itself on its first run, which is the only reason it is not now
  // asserting something false.
  const names = [...body.matchAll(/pub fn ([a-z_][a-z0-9_]*)\s*(?:<[^>]*>)?\s*\(/g)].map(m => m[1]);
  assert.ok(names.length > 0, `${label}: the #[program] block parsed to zero instructions`);
  return names.sort();
}

let checks = 0;
const crates = [
  ['ratchet-core-g2', CORE_INSTRUCTION,
   '../onchain/ratchet-core-g2/programs/ratchet-core-g2/src/lib.rs'],
  ['rcx-timepin-v2', TIMEPIN_INSTRUCTION,
   '../onchain/rcx-timepin-v2/programs/rcx-timepin-v2/src/lib.rs'],
];

for (const [label, table, path] of crates) {
  const declared = programInstructions(read(path), label);
  const known = Object.keys(table).sort();

  const missing = declared.filter(n => !known.includes(n));
  const invented = known.filter(n => !declared.includes(n));

  checks += 1;
  assert.deepEqual(missing, [],
    `${label} exposes ${missing.length} instruction(s) the client cannot build: ${missing.join(', ')}. ` +
    'A client that cannot name an instruction cannot send it, and a shot nothing can resolve is worse ' +
    'than a shot nobody can start.');

  checks += 1;
  assert.deepEqual(invented, [],
    `the client claims ${invented.length} instruction(s) ${label} does not expose: ${invented.join(', ')}. ` +
    'Sending one of these would be rejected on chain with an unknown discriminator.');

  for (const [name, hex] of Object.entries(table)) {
    checks += 1;
    assert.equal(hex, derive(name),
      `${label}.${name} is ${hex} but sha256("global:${name}")[0..8] is ${derive(name)}. ` +
      'Anchor will not route this instruction anywhere.');
  }

  console.log(`  ${label}: ${declared.length} instructions, all named and all derived`);
}

// The two programs share four instruction NAMES with identical discriminators -
// open_work_manifest, open_work_page, reserve_work, and their own finalize
// spellings differ. Identical names are not a collision: the discriminator is
// routed inside one program, so the same name in two programs is two different
// instructions and both tables must carry it.
const shared = Object.keys(CORE_INSTRUCTION).filter(n => n in TIMEPIN_INSTRUCTION);
for (const n of shared) {
  checks += 1;
  assert.equal(CORE_INSTRUCTION[n], TIMEPIN_INSTRUCTION[n],
    `${n} derives differently in the two tables, which is impossible - one of them is typed, not derived.`);
}

console.log(`ok - client covers every instruction: ${checks} checks, ` +
  `${Object.keys(CORE_INSTRUCTION).length} core + ${Object.keys(TIMEPIN_INSTRUCTION).length} timepin, ` +
  `${shared.length} names shared by both programs`);
