#!/usr/bin/env node
// Read-only chain diagnostic. Downloads the public snapshot, replays the log,
// and reports EXACTLY where recomputation first diverges — and what that entry
// looks like — so a verdict about the log is made from the log, not from a
// guess. Touches nothing, pushes nothing, writes nothing.
//
//   node tools/chain-diag.mjs
//   node tools/chain-diag.mjs https://ratchetx.xyz/api/snapshot
import crypto from 'node:crypto';

const URL_ = process.argv[2] || 'https://ratchetx.xyz/api/snapshot';
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const GENESIS = 'ratchet-genesis';

console.log(`downloading ${URL_} ...`);
const res = await fetch(URL_, { signal: AbortSignal.timeout(120_000) });
if (!res.ok) { console.log(`HTTP ${res.status}`); process.exit(1); }
const snap = await res.json();

const state = snap.state || snap;
const log = state.log || state.events || snap.log || [];
const head = state.logHead || state.head || snap.logHead || null;
const issued = state.logIssued ?? state.issued ?? snap.issued ?? null;

console.log(`\nentries read : ${log.length}`);
console.log(`issued       : ${issued ?? '(not published)'}`);
console.log(`head         : ${head ? `i=${head.i} h=${String(head.h).slice(0, 16)}…` : '(none)'}`);

if (!log.length) { console.log('\nno log in the snapshot — nothing to check.'); process.exit(0); }

// ---- 1. index continuity
const idx = log.map(e => Number(e.i)).sort((a, b) => a - b);
const missing = [];
for (let i = 1; i <= idx[idx.length - 1]; i++) if (!idx.includes(i)) missing.push(i);
console.log(`index range  : ${idx[0]} .. ${idx[idx.length - 1]}`);
console.log(`missing      : ${missing.length ? missing.join(', ') : 'none'}`);

// ---- 2. what does entry 1 actually look like?
const first = log.find(e => Number(e.i) === idx[0]);
console.log(`\n--- first entry (i=${first.i}) verbatim ---`);
console.log(JSON.stringify(first));
console.log(`keys         : ${Object.keys(first).join(', ')}`);

// ---- 3. where does recomputation first diverge?
const rows = log.slice().sort((a, b) => Number(a.i) - Number(b.i));
let h = sha(GENESIS), firstBad = null, checked = 0;
for (const e of rows) {
  if (missing.includes(Number(e.i) - 1)) { h = String(e.h); continue; }  // segment restart
  const body = e.rebased ? { i: e.i, t: e.t, ev: e.ev, rebased: true } : { i: e.i, t: e.t, ev: e.ev };
  if (e.rebased) h = sha(`missing-link|${e.i - 1}`);
  const recomputed = sha(h + JSON.stringify(body));
  checked++;
  if (e.h && e.h !== recomputed && !firstBad) {
    firstBad = { i: e.i, stored: e.h, recomputed, body };
  }
  h = e.h ? String(e.h) : recomputed;      // keep walking on the STORED hash
}
console.log(`\nchecked      : ${checked} entries`);

if (!firstBad) {
  console.log('\nRESULT: every entry recomputes. The only defect is the missing index above.');
} else {
  console.log(`\nRESULT: first divergence at index ${firstBad.i}`);
  console.log(`  stored     : ${firstBad.stored}`);
  console.log(`  recomputed : ${firstBad.recomputed}`);
  console.log(`  body hashed: ${JSON.stringify(firstBad.body).slice(0, 300)}`);
  const bad = rows.filter(e => {
    const b = e.rebased ? { i:e.i, t:e.t, ev:e.ev, rebased:true } : { i:e.i, t:e.t, ev:e.ev };
    return e.h && e.h !== sha(String(rows[rows.indexOf(e) - 1]?.h ?? sha(GENESIS)) + JSON.stringify(b));
  }).length;
  console.log(`  entries that do not recompute off their predecessor's STORED hash: ${bad} / ${rows.length}`);
  console.log('\n  If that count is ~all of them, the stored hashes were computed over a');
  console.log('  DIFFERENT body shape than {i,t,ev} — a format change, not tampering.');
  console.log('  If it is one or two, those specific entries are the problem.');
}
