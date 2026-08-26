#!/usr/bin/env node
// Read-only chain diagnostic. Downloads the public snapshot and measures
// exactly how much of the log verifies, under both rules:
//
//   canonical (c:1) — hashed over sorted bytes, immune to storage reordering
//   legacy          — hashed over insertion order, which Postgres jsonb
//                     re-sorted on its way into storage; recoverable by
//                     replaying the order the code actually wrote
//
// Writes nothing. Modifies nothing. Rewrites no hash, ever.
//
//   node tools/chain-diag.mjs
//   node tools/chain-diag.mjs https://ratchetx.xyz/api/snapshot
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
const require = createRequire(import.meta.url);
const { verifyLegacy } = require('../lib/legacy_chain.js');
const { canon } = require('../lib/canon.js');

// Accepts a URL or a LOCAL FILE. The snapshot grows with the log and can take
// longer to generate than any client is willing to wait, so the tool must not
// depend on that one connection: save the page in a browser and point this at
// the file instead. Same measurement either way.
//
//   node tools/chain-diag.mjs
//   node tools/chain-diag.mjs C:\path\to\snapshot.json
//   node tools/chain-diag.mjs https://ratchetx.xyz/api/snapshot
const fs = await import('node:fs/promises');
const SRC = process.argv[2] || 'https://ratchetx.xyz/api/snapshot';
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const GENESIS = sha('ratchet-genesis');

let snap;
if (/^https?:/i.test(SRC)) {
  console.log(`downloading ${SRC} (up to 5 minutes) ...`);
  let last = null;
  for (let attempt = 1; attempt <= 3 && !snap; attempt++) {
    try {
      const res = await fetch(SRC, { signal: AbortSignal.timeout(300_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      snap = await res.json();
    } catch (e) {
      last = e;
      console.log(`  attempt ${attempt} failed: ${String(e.message || e).slice(0, 80)}`);
      if (attempt < 3) console.log('  retrying — the first call also warms the server cache ...');
    }
  }
  if (!snap) {
    console.log(`\ncould not download it: ${String(last && last.message || last)}`);
    console.log('\nThe endpoint can take longer to build than a client will wait. Do this instead:');
    console.log('  1. open https://ratchetx.xyz/api/snapshot in Chrome and save the page (Ctrl+S)');
    console.log('  2. node tools/chain-diag.mjs "C:\\path\\to\\snapshot.json"');
    process.exit(1);
  }
} else {
  console.log(`reading ${SRC} ...`);
  snap = JSON.parse(await fs.readFile(SRC, 'utf8'));
}
const state = snap.state || snap;
const log = state.log || state.events || snap.log || [];
const head = state.logHead || state.head || snap.logHead || null;
const issued = state.logIssued ?? state.issued ?? snap.issued ?? null;

const rows = log.filter(Boolean).slice().sort((a, b) => Number(a.i) - Number(b.i));
console.log(`\nentries read : ${rows.length}`);
console.log(`issued       : ${issued ?? '(not published)'}`);
console.log(`head         : ${head ? `i=${head.i} h=${String(head.h).slice(0, 16)}…` : '(none)'}`);

if (!rows.length) { console.log('\nno log in the snapshot.'); process.exit(0); }

const have = new Set(rows.map(e => Number(e.i)));
const missing = [];
for (let i = 1; i <= Number(rows[rows.length - 1].i); i++) if (!have.has(i)) missing.push(i);
console.log(`index range  : ${rows[0].i} .. ${rows[rows.length - 1].i}`);
console.log(`missing      : ${missing.length ? missing.join(', ') : 'none'}`);

// ---- canonical entries verify on their own terms
let canonOk = 0, canonBad = 0, prev = null;
for (const e of rows) {
  const p = Number(e.i) === 1 ? GENESIS : (prev || '');
  prev = String(e.h || '');
  if (!e.c) continue;
  const body = { i: e.i, t: e.t, ev: e.ev, c: e.c };
  if (sha(p + canon(body)) === String(e.h)) canonOk++; else canonBad++;
}

// ---- legacy entries: recover the written order, then verify
console.log('\nrecovering legacy entry order (this is a read, nothing is written) ...');
const L = verifyLegacy(rows, { genesis: GENESIS });

console.log(`\n  canonical (c:1)   : ${L.canonical}   verified ${canonOk}, failed ${canonBad}`);
console.log(`  legacy            : ${L.total - L.canonical}   verified ${L.verified}, unrecovered ${L.unrecovered}`);
const pct = L.total ? Math.round(((L.verified + canonOk) / L.total) * 1000) / 10 : 0;
console.log(`  TOTAL VERIFIED    : ${L.verified + canonOk} / ${L.total}  (${pct}%)`);

console.log('\n  by event shape:');
for (const s of L.shapes.slice(0, 18))
  console.log(`   ${String(s.recovered).padStart(5)}/${String(s.n).padEnd(5)} ${(s.via || 'UNRECOVERED').padEnd(17)} ${s.keys.slice(0, 70)}`);

if (L.misses && L.misses.length) {
  console.log('\n  the entries that did not verify:');
  for (const m of L.misses)
    console.log(`   index ${String(m.i).padStart(5)}  ${m.kind.padEnd(10)} stored ${m.stored}…  prev ${m.prev}…  `
      + `${m.hadOrder ? 'its shape HAS a known order (others with the same shape verified)' : 'no order known for this shape'}`);
  console.log('\n  An entry whose shape verified for everyone else is the interesting kind:');
  console.log('  the ordering is known to work, so something about THAT entry differs.');
}

console.log('\n' + (L.unrecovered === 0 && canonBad === 0
  ? 'RESULT: every entry verifies. The log is intact; only the missing index above is a real gap.'
  : `RESULT: ${L.unrecovered + canonBad} entries do not verify under any recovered ordering.`));
console.log('\nNote: a changed VALUE cannot be rescued by any ordering, so anything');
console.log('unrecovered above is either an event shape not in this repo\'s history');
console.log('or a genuine discrepancy. Both are reported, neither is papered over.');
