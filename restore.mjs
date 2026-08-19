#!/usr/bin/env node
// ============================================================
//  restore.mjs — resurrect the machine from a Black Box snapshot.
//  Zero dependencies. Two modes:
//
//    node restore.mjs snapshot.json --check
//        Verify only: recompute the whole hash chain from genesis,
//        confirm it reaches the snapshot's logHead, and print the
//        head that should match an on-chain anchor memo
//        ("RATCHET|<i>|<head>"). Touches nothing.
//
//    KV_REST_API_URL=... KV_REST_API_TOKEN=... node restore.mjs snapshot.json
//        Load the snapshot into a FRESH Upstash Redis. Refuses to
//        write over an existing live instance (g:log:head present)
//        unless --force is given. Then deploy this repo to Vercel
//        with the same KV env vars and the machine lives again —
//        same players, same credits, same history, provably.
// ============================================================
import fs from 'node:fs';
import crypto from 'node:crypto';

const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const GENESIS = 'ratchet-genesis';

const file = process.argv[2];
const CHECK = process.argv.includes('--check');
const FORCE = process.argv.includes('--force');
if (!file) { console.error('usage: node restore.mjs <snapshot.json> [--check] [--force]'); process.exit(2); }

const snap = JSON.parse(fs.readFileSync(file, 'utf8'));
const state = snap.state || snap;
const { log = [], logHead } = state;

// ---- 1. verify the chain, always
let h = sha(GENESIS), broken = null;
for (let n = 0; n < log.length; n++) {
  const e = log[n];
  if (e.i !== n + 1) { broken = { at: n + 1, why: 'gap or misorder' }; break; }
  const r = sha(h + JSON.stringify({ i: e.i, t: e.t, ev: e.ev }));
  if (e.h && e.h !== r) { broken = { at: e.i, why: 'hash mismatch' }; break; }
  h = r;
}
if (!broken && logHead && (logHead.i !== log.length || logHead.h !== h))
  broken = { at: logHead.i, why: 'head mismatch' };

if (broken) {
  console.error(`CHAIN BROKEN at entry #${broken.at} (${broken.why}) — this snapshot is not the real history. Refusing.`);
  process.exit(1);
}
console.log(`chain OK: ${log.length} entries replay from genesis to head #${logHead?.i} ${logHead?.h}`);
console.log(`verify on-chain: find a Solana memo "RATCHET|<i>|<hash>" whose <i> ≤ ${logHead?.i} and whose hash matches entry <i>'s h in this snapshot.`);
if (state.anchors?.length) for (const a of state.anchors) console.log(`  known anchor: entry #${a.i} tx ${a.sig}`);
if (snap.sha256) {
  const rehash = sha(JSON.stringify(state));
  console.log(`snapshot sha256 ${rehash === snap.sha256 ? 'MATCHES' : 'DIFFERS (re-serialized locally — fine if chain OK)'}`);
}
if (CHECK) { console.log('check-only mode: nothing written.'); process.exit(0); }

// ---- 2. load into a fresh KV
const URL_ = process.env.KV_REST_API_URL, TOK_ = process.env.KV_REST_API_TOKEN;
if (!URL_ || !TOK_) { console.error('set KV_REST_API_URL and KV_REST_API_TOKEN (a FRESH Upstash Redis) to restore.'); process.exit(2); }
async function redis(cmd) {
  const r = await fetch(URL_, { method: 'POST', headers: { Authorization: `Bearer ${TOK_}`, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd) });
  if (!r.ok) throw new Error(`kv ${r.status}`);
  return (await r.json()).result;
}
const put = (k, v) => redis(['SET', k, JSON.stringify(v)]);

const existing = await redis(['GET', 'g:log:head']);
if (existing && !FORCE) { console.error('target KV already has a live machine (g:log:head exists). Use --force only if you mean to overwrite it.'); process.exit(1); }

let n = 0;
const singles = {
  'g:stats': state.stats, 'g:season': state.season, 'g:day': state.day,
  'g:podium': state.podium, 'g:podium:prev': state.podiumPrev,
  'g:feed': state.feed, 'g:anchors': state.anchors,
  'g:warden:rec': state.warden?.rec, 'g:warden:hist': state.warden?.hist, 'g:warden:open': state.warden?.open,
  'g:dayResults': state.results?.day, 'g:seasonResults': state.results?.season,
  'g:supply0': state.supply0, 'g:log:head': logHead,
};
for (const [k, v] of Object.entries(singles)) if (v != null) { await put(k, v); n++; }
for (let c = 0; c * 500 < log.length; c++) { await put(`g:log:c:${c}`, log.slice(c * 500, (c + 1) * 500)); n++; }
await put('g:log:recent', log.slice(-60).reverse()); n++;
const heads = {}; for (const e of log.slice(-500)) heads[e.i] = e.h;
await put('g:log:heads', heads); n++;
let voided = 0;
for (const [w, p] of Object.entries(state.players || {})) {
  // snapshots strip sealed sides, so open shots cannot settle after a
  // resurrection — they are VOID-REFUNDED here, honestly and visibly.
  const q = { ...p };
  for (const s of q.open || []) {
    if (s.src === 'cr') q.cr = (q.cr || 0) + s.stake; else q.bal = (q.bal || 0) + s.stake;
    voided++;
  }
  q.open = [];
  await put(`u:${w}`, q); n++;
}
if (voided) console.log(`void-refunded ${voided} open shot(s) — sealed sides are never exported, so they cannot settle post-resurrection.`);
for (const [s2, v] of Object.entries(state.sigs || {})) { await put(`sig:${s2}`, v); n++; }
for (const [k, v] of Object.entries(state.boards || {})) { await put(k, v); n++; }
for (const [w, v] of Object.entries(state.hists || {})) { await put(`hist:${w}`, v); n++; }

console.log(`restored ${n} keys. Deploy this repo to Vercel with the same KV env vars (+ RATCHET_MINT, SOLANA_RPC_URL) and the machine lives again.`);
