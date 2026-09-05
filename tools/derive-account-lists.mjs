#!/usr/bin/env node
// The ordered account list of every instruction, PARSED FROM THE PROGRAM.
//
// A client sends accounts in the order Anchor declared them, with the right mut
// and signer flags. Get one wrong and the transaction fails on chain in a way
// that is miserable to diagnose from the outside. Transcribing thirty-five of
// those lists by hand is exactly the "copied arithmetic" that produced 8 + 124
// against a 276-byte account and cost this project a day.
//
// So they are derived. This reads the #[derive(Accounts)] structs, pairs each
// with the handler that takes it, and emits one table. test_account_lists.mjs
// re-runs it and fails if the checked-in table differs, so the table cannot rot.
//
//   node tools/derive-account-lists.mjs            # print
//   node tools/derive-account-lists.mjs --write    # update the checked-in table
import fs from 'node:fs';
import path from 'node:path';

// EVERY SOURCE FILE OF THE CRATE, not just lib.rs. Timepin declares
// OpenWorkManifest, CaptureFirst, CaptureConflict and the rest in lifecycle.rs
// while the #[program] block that names them lives in lib.rs, so a lib.rs-only
// corpus reports them as missing. That is the THIRD time today a tool read one
// file and answered a question about a crate: test_core_reads_what_timepin_writes
// did it about CandidateV2 and produced a false P0 that sent the ABI down the
// wrong branch, and this tool did it on its first run. Read the crate.
export const CRATES = [
  { name: 'ratchet-core-g2',
    program: 'onchain/ratchet-core-g2/programs/ratchet-core-g2/src/lib.rs',
    src: ['onchain/ratchet-core-g2/programs/ratchet-core-g2/src/lib.rs',
          'onchain/ratchet-core-g2/programs/ratchet-core-g2/src/state.rs',
          'onchain/ratchet-core-g2/programs/ratchet-core-g2/src/foreign_timepin.rs'] },
  { name: 'rcx-timepin-v2',
    program: 'onchain/rcx-timepin-v2/programs/rcx-timepin-v2/src/lib.rs',
    src: ['onchain/rcx-timepin-v2/programs/rcx-timepin-v2/src/lib.rs',
          'onchain/rcx-timepin-v2/programs/rcx-timepin-v2/src/lifecycle.rs'] },
];
export const OUT = 'onchain/ratchet-core-g2/client/accounts.generated.json';

// Anchor's context type for each instruction: `pub fn name(ctx: Context<Struct>`
// possibly with a lifetime generic on the fn, and possibly wrapped across lines.
function handlerContexts(source) {
  const at = source.indexOf('#[program]');
  if (at < 0) throw new Error('no #[program] block');
  const body = source.slice(at);
  const out = new Map();
  // Context may be fully lifetime-qualified: reload_rcx is declared
  // `ctx: Context<'_, '_, '_, 'info, ReloadRcx<'info>>`. The first version of
  // this regex expected the struct name immediately after the angle bracket and
  // silently dropped that one instruction - the SAME instruction that the
  // discriminator test dropped an hour ago for the SAME reason, a lifetime in a
  // place the pattern did not expect. Leading lifetimes are consumed here.
  const re = /pub fn ([a-z_][a-z0-9_]*)\s*(?:<[^>]*>)?\s*\(\s*ctx:\s*Context<\s*(?:'[a-z_][a-z0-9_]*\s*,\s*)*([A-Za-z0-9_]+)/g;
  for (const m of body.matchAll(re)) out.set(m[1], m[2]);
  if (out.size === 0) throw new Error('the #[program] block yielded no handlers');
  return out;
}

// One #[derive(Accounts)] struct: fields in declaration order, with their flags.
// Attributes may span several lines, so the attribute text is accumulated until
// the field it decorates appears.
function accountStructs(source) {
  const out = new Map();
  const re = /#\[derive\(Accounts\)\][\s\S]*?pub struct ([A-Za-z0-9_]+)<'info>\s*\{/g;
  for (const m of source.matchAll(re)) {
    const name = m[1];
    let i = m.index + m[0].length, depth = 1, end = i;
    while (i < source.length && depth > 0) {
      const c = source[i];
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) { end = i; break; } }
      i++;
    }
    const body = source.slice(m.index + m[0].length, end);
    const fields = [];
    let attr = '';
    for (const raw of body.split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('///') || line.startsWith('//')) continue;
      if (line.startsWith('#[')) { attr += ' ' + line; continue; }
      const f = /^pub ([a-z_][a-z0-9_]*)\s*:\s*(.+?),?$/.exec(line);
      if (!f) { if (attr && !line.endsWith(')]')) attr += ' ' + line; continue; }
      const ty = f[2];
      fields.push({
        name: f[1],
        mut: /\bmut\b/.test(attr) || /\binit\b/.test(attr) || /\binit_if_needed\b/.test(attr)
             || /\bclose\s*=/.test(attr),
        signer: /Signer<'info>/.test(ty) || /\bsigner\b/.test(attr),
      });
      attr = '';
    }
    if (fields.length) out.set(name, fields);
  }
  return out;
}

export function derive(root = '.') {
  const table = {};
  for (const crate of CRATES) {
    const programSource = fs.readFileSync(path.join(root, crate.program), 'utf8');
    const corpus = crate.src.map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
    const ctxs = handlerContexts(programSource);
    const structs = accountStructs(corpus);
    // A corpus that parsed to nothing is not evidence that a crate has no
    // accounts. No structs, no verdict.
    if (structs.size === 0) throw new Error(`${crate.name}: the corpus yielded zero #[derive(Accounts)] structs`);
    const per = {};
    for (const [ix, structName] of ctxs) {
      const fields = structs.get(structName);
      if (!fields) throw new Error(`${crate.name}.${ix}: no #[derive(Accounts)] struct ${structName}`);
      per[ix] = { context: structName, accounts: fields };
    }
    table[crate.name] = per;
  }
  return table;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const table = derive();
  const json = JSON.stringify(table, null, 2) + '\n';
  if (process.argv.includes('--write')) {
    fs.writeFileSync(OUT, json);
    console.log(`[wrote] ${OUT}`);
  } else {
    for (const [crate, ixs] of Object.entries(table)) {
      console.log(`${crate}: ${Object.keys(ixs).length} instructions`);
      for (const [ix, v] of Object.entries(ixs))
        console.log(`  ${ix} <- ${v.context}: ${v.accounts.map(a =>
          a.name + (a.signer ? '(s)' : '') + (a.mut ? '(w)' : '')).join(', ')}`);
    }
  }
}
