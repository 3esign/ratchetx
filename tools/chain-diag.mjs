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

const URL_ = process.argv[2] || 'https://ratchetx.xyz/api/snapshot';
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const GENESIS = sha('ratchet-genesis');

console.log(`downloading ${URL_} ...`);
const res = await fetch(URL_, { signal: AbortSignal.timeout(180_000) });
if (!res.ok) { console.log(`HTTP ${res.status}`); process.exit(1); }
const snap = await res.json();
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

console.log('\n' + (L.unrecovered === 0 && canonBad === 0
  ? 'RESULT: every entry verifies. The log is intact; only the missing index above is a real gap.'
  : `RESULT: ${L.unrecovered + canonBad} entries do not verify under any recovered ordering.`));
console.log('\nNote: a changed VALUE cannot be rescued by any ordering, so anything');
console.log('unrecovered above is either an event shape not in this repo\'s history');
console.log('or a genuine discrepancy. Both are reported, neither is papered over.');
