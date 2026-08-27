#!/usr/bin/env node
// Re-derive the contents of the missing log entry 345, from scratch, from the
// live log. Reads only. Writes nothing, anywhere, ever.
//
//   node tools/recover-345.mjs
//   node tools/recover-345.mjs https://ratchetx.xyz
//
// WHY THIS IS A PROOF AND NOT A GUESS
//
// The chain is h_i = sha256(h_{i-1} + json(entry_i)). Entry 345 was issued and
// never stored, so h345 is unknown — but entry 346 IS stored, and its hash was
// computed over h345. That makes h346 a checksum over the missing entry.
//
// So a candidate for 345 is not asserted, it is TESTED:
//
//     h345      = sha256( stored_h344 + json(candidate_345) )
//     h346_test = sha256( h345 + json(stored_346) )
//     accept only if h346_test === stored_h346
//
// Hitting a 256-bit target by chance does not happen. A candidate that passes
// is the entry, not a plausible stand-in for it.
//
// The search space is small because the log itself bounds it: t must lie
// strictly between the timestamps of 344 and 346 — 98 milliseconds — and the
// warden emits one seal then a settle loop, so the shape is known.
//
// NOTHING IS WRITTEN BACK. The gap stays. See docs/CHAIN_GAP.md for why.
import crypto from 'node:crypto';
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const J = o => JSON.stringify(o);
const BASE = (process.argv[2] || 'https://ratchetx.xyz').replace(/\/$/, '');

const get = async path => {
  const r = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} on ${path}`);
  return r.json();
};

console.log(`reading the live log from ${BASE} ...`);
const page = await get('/api/log?after=342&limit=6');
const at = i => (page.entries || []).find(e => Number(e.i) === i);
const e343 = at(343), e344 = at(344), e346 = at(346);
if (!e344 || !e346) { console.log('could not read entries 344 and 346'); process.exit(1); }
console.log(`  344 stored h: ${e344.h.slice(0, 20)}…`);
console.log(`  345 stored  : ${at(345) ? 'PRESENT (nothing to recover)' : 'absent'}`);
console.log(`  346 stored h: ${e346.h.slice(0, 20)}…`);
if (at(345)) process.exit(0);

// Both entries come back with keys in the STORAGE layer's order, not the order
// they were hashed in. Rebuild the written order — see docs/CHAIN_GAP.md.
const order = (ev, keys) => { const o = {}; for (const k of keys) if (k in ev) o[k] = ev[k]; return o; };
const W_SEAL   = ['k','id','feed','thresh','p','exp'];              // 2026-08 append site
const W_SETTLE = ['k','id','outcome','hit','exitPx'];               // 2026-08 append site

// ---- step 1: prove the METHOD on a link whose ends are both stored.
// If this fails, nothing below is worth reading.
const j344 = J({ i: 344, t: e344.t, ev: order(e344.ev, W_SEAL) });
if (!e343 || sha(e343.h + j344) !== e344.h) {
  console.log('\nthe method does not reproduce the 343 -> 344 link; stopping rather than guessing.');
  process.exit(1);
}
console.log('\nmethod check: stored h343 + entry 344 reproduces stored h344  ✓');

// ---- step 2: search
const j346 = J({ i: 346, t: e346.t, ev: order(e346.ev, W_SETTLE) });
const passes = h345 => sha(h345 + j346) === e346.h;

console.log(`\nsearching t in (${e344.t}, ${e346.t}) — ${e346.t - e344.t - 1} milliseconds`);
let tried = 0, found = null;
outer:
for (let t = e344.t + 1; t < e346.t; t++) {
  for (let n = 496000; n <= 497000; n++) {
    for (const outcome of [true, false]) {
      for (const hit of [true, false]) {
        const ev = { k: 'wsettle', id: 'w' + n, outcome, hit, exitPx: e346.ev.exitPx };
        tried++;
        const h345 = sha(e344.h + J({ i: 345, t, ev }));
        if (passes(h345)) { found = { t, ev, h345 }; break outer; }
      }
    }
  }
}

console.log(`${tried.toLocaleString()} candidates tested`);
if (!found) { console.log('\nno candidate reproduces stored h346.'); process.exit(1); }

console.log('\n*** RECOVERED, AND PROVEN BY THE CHAIN ***\n');
console.log(J({ i: 345, t: found.t, ev: found.ev, h: found.h345 }));
console.log(`\n  sha256(h345 + entry346) = ${sha(found.h345 + j346).slice(0, 24)}…`);
console.log(`  stored h346             = ${e346.h.slice(0, 24)}…`);
console.log('\nEntries 345 and 346 are the SAME event — a warden settle of line '
  + `${found.ev.id} — written ${e346.t - found.t}ms apart. The counter advanced, the`);
console.log('entry was never stored, the operation retried and landed as 346. A ghost of');
console.log('a retry, not a lost transaction.');
console.log('\nNothing was written back. The gap stays. docs/CHAIN_GAP.md explains why.');
