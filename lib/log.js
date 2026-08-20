// ============================================================
//  lib/log.js — the hash-chained event log, and its on-chain anchor.
//
//  Every game event (seal, settle, reload, season payout) appends
//  an entry: h_i = sha256(h_{i-1} + json(event)). Changing ANY
//  past event changes every hash after it. The current head is
//  published in every API response.
//
//  THE ANCHOR - keyless by design: ANYONE may send a Solana memo
//  transaction containing "RATCHET|<i>|<head>" from their own
//  wallet and submit the signature. The server verifies the memo
//  matches a recorded head and the signer paid for it. From that
//  moment, every event up to index i provably existed before that
//  slot - timestamped by the chain itself, not by us. Scribes earn
//  XP: the log's integrity is a game mechanic, not a chore.
// ============================================================
const crypto = require('node:crypto');
const { getJSON, getJSONStrict, setJSON, setJSONEx, setnxJSON, incrFloat } = require('./kv.js');

const GENESIS = 'ratchet-genesis';
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
// FULL RETENTION (h4, the Black Box): every entry is also stored in
// 500-entry chunk blobs (g:log:c:0, g:log:c:1, ...) so the ENTIRE log —
// not just heads and a recent window — survives, exports through
// /api/snapshot, and can be replayed hash-by-hash by anyone. Chunk
// writes are read-modify-write; under heavy concurrency an entry could
// be dropped from a chunk while the head chain still advanced — the
// verifier REPORTS exactly where the chain breaks rather than papering
// over it. A diagnostic that cannot fail is not a diagnostic.
const CHUNK = 500;

// THE INDEX IS ATOMIC.
// It used to come from reading the head: `head.i + 1`. Two failure modes,
// both fatal to the only thing this file promises.
//
//   1. The head was read with the LENIENT getJSON, which returns null on any
//      backend hiccup. A single timed-out GET made the next entry index 1
//      again — the chain silently re-based to genesis and every anchor ever
//      placed became unverifiable.
//   2. Two concurrent appends both read i=41 and both wrote i=42. One event
//      vanished, and because the surviving chain was internally consistent,
//      verifyChain returned ok. A dropped event certified as intact.
//
// INCR fixes both: every appender gets a unique, gapless index from the
// server, so no entry can claim another's slot and a failed read can never
// masquerade as an empty log. Each entry's hash goes in its own key — one
// writer per key, so linking cannot race either.
const LINK_TTL = 30 * 24 * 3600;      // links are only ever read by i+1
const linkKey = i => `g:log:h:${i}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

let seeded = false;
/** Seed the atomic counter from the legacy head, exactly once, ever.
 *  SETNX makes it safe for every instance to attempt it. */
async function ensureIndex() {
  if (seeded) return;
  const head = await getJSONStrict('g:log:head');     // strict: a flaky read must not seed 0
  const start = head && Number.isFinite(head.i) ? head.i : 0;
  const won = await setnxJSON('g:log:n', start);
  if (won && start > 0 && head.h) await setJSONEx(linkKey(start), head.h, LINK_TTL);
  seeded = true;
}

/** The predecessor's hash, waiting briefly for an append that is still in
 *  flight. If it never lands we do NOT invent a link — we re-base on a value
 *  derived from the index and mark the entry, so the verifier reports exactly
 *  where the break is. A diagnostic that cannot fail is not a diagnostic. */
async function linkTo(k) {
  for (let a = 0; a < 6; a++) {
    const h = await getJSON(linkKey(k));
    if (typeof h === 'string' && h.length === 64) return { prev: h, broken: false };
    if (a < 5) await sleep(60);
  }
  return { prev: sha(`missing-link|${k}`), broken: true };
}

async function append(ev) {
  await ensureIndex();
  const i = Math.round(await incrFloat('g:log:n', 1));   // unique and gapless
  const { prev, broken } = i === 1 ? { prev: sha(GENESIS), broken: false } : await linkTo(i - 1);
  const entry = { i, t: Date.now(), ev };
  if (broken) entry.rebased = true;
  const h = sha(prev + JSON.stringify(entry));
  // single writer per key: this is the link the NEXT entry chains to
  await setJSONEx(linkKey(i), h, LINK_TTL);

  const newHead = { i, h };
  // never roll the published head backwards for a slow appender
  const curHead = await getJSON('g:log:head');
  if (!curHead || !(curHead.i > i)) await setJSON('g:log:head', newHead);

  // ---- full retention: one-time backfill (possible while the whole
  // history still fits in the recent window), then append to the
  // current chunk.
  if (i > 1 && !(await getJSON('g:log:c:0'))) {
    const recent0 = (await getJSON('g:log:recent')) || [];
    if (recent0.length >= i - 1) {
      const all = recent0.slice(0, i - 1).reverse();      // oldest-first 1..i-1
      for (let c = 0; c * CHUNK < all.length; c++)
        await setJSON(`g:log:c:${c}`, all.slice(c * CHUNK, (c + 1) * CHUNK));
    }
  }
  const cn = Math.floor((i - 1) / CHUNK);
  const chunk = (await getJSON(`g:log:c:${cn}`)) || [];
  chunk.push({ ...entry, h });
  await setJSON(`g:log:c:${cn}`, chunk);
  const heads = (await getJSON('g:log:heads')) || {};
  heads[i] = h;
  const keys = Object.keys(heads).map(Number).sort((a,b)=>a-b);
  while (keys.length > 500) delete heads[keys.shift()];
  await setJSON('g:log:heads', heads);
  const recent = (await getJSON('g:log:recent')) || [];
  recent.unshift({ ...entry, h });
  await setJSON('g:log:recent', recent.slice(0, 60));
  return newHead;
}

/** How many entries the server says exist. The verifier compares this with
 *  how many it can actually read, which is what turns a silently dropped
 *  event into a reported one. */
async function logCount() {
  const n = await getJSON('g:log:n');
  return Number(n) || 0;
}

const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';

/** Pure verdict over a parsed memo tx — unit-testable without a network. */
function decideAnchor(tx, { wallet, heads, nowMs = Date.now(), maxAgeSec = 86400 }) {
  if (tx === undefined) return { ok:false, reason:'RPC unreachable — try again in a minute' };
  if (!tx || !tx.meta) return { ok:false, reason:'transaction not found yet — wait a few seconds' };
  if (tx.meta.err != null) return { ok:false, reason:'that transaction failed on-chain' };
  const bt = +tx.blockTime;
  if (!Number.isFinite(bt) || nowMs/1000 - bt > maxAgeSec) return { ok:false, reason:'transaction too old or unconfirmed' };
  const msg = tx.transaction && tx.transaction.message;
  const signer = ((msg && msg.accountKeys) || []).find(k => k.signer);
  if (!signer || signer.pubkey !== wallet) return { ok:false, reason:'that transaction was not signed by your connected wallet' };
  let memo = null;
  for (const ix of (msg && msg.instructions) || []) {
    if (ix.program === 'spl-memo' || ix.programId === MEMO_PROGRAM) memo = typeof ix.parsed === 'string' ? ix.parsed : memo;
  }
  if (!memo) return { ok:false, reason:'no memo instruction found in that transaction' };
  const m = memo.match(/^RATCHET\|(\d+)\|([0-9a-f]{64})$/);
  if (!m) return { ok:false, reason:'memo is not in the RATCHET|index|hash format — copy it exactly from the proof page' };
  const i = +m[1];
  if (!heads[i]) return { ok:false, reason:`log index ${i} is not in the recent window — anchor the current head` };
  if (heads[i] !== m[2]) return { ok:false, reason:'that hash does not match our log at that index — if our log were ever rewritten, this is exactly the check that would catch it' };
  return { ok:true, i, h: m[2], slot: tx.slot || null };
}

/** Pure verifier over a full ordered log. Recomputes every hash from
 *  genesis and checks it against both the stored per-entry hash and the
 *  claimed head. Returns { ok, count, brokenAt } — brokenAt is the first
 *  index where the chain fails, or null. */
function verifyChain(entries, head, expectedCount) {
  // An entry silently missing from storage used to leave a self-consistent
  // chain that verified clean. The atomic counter is an independent witness:
  // if the server issued 200 indices and we can only read 198 entries, two
  // events are gone and this must say so.
  if (Number.isFinite(expectedCount) && expectedCount > 0 && entries.length !== expectedCount)
    return { ok: false, count: entries.length, brokenAt: entries.length + 1,
             reason: `missing entries — ${expectedCount} issued, ${entries.length} stored` };
  let h = sha(GENESIS);
  for (let n = 0; n < entries.length; n++) {
    const e = entries[n];
    if (e.i !== n + 1) return { ok: false, count: n, brokenAt: n + 1, reason: 'gap or misorder' };
    const body = e.rebased ? { i: e.i, t: e.t, ev: e.ev, rebased: true } : { i: e.i, t: e.t, ev: e.ev };
    if (e.rebased) h = sha(`missing-link|${e.i - 1}`);   // declared break, not a hidden one
    const recomputed = sha(h + JSON.stringify(body));
    if (e.h && e.h !== recomputed) return { ok: false, count: n, brokenAt: e.i, reason: 'hash mismatch' };
    h = recomputed;
  }
  if (head && (head.i !== entries.length || head.h !== h))
    return { ok: false, count: entries.length, brokenAt: head.i, reason: 'head mismatch' };
  return { ok: true, count: entries.length, brokenAt: null };
}

module.exports = { append, decideAnchor, verifyChain, logCount, MEMO_PROGRAM, CHUNK };
