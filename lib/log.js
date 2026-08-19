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
const { getJSON, setJSON } = require('./kv.js');

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

async function append(ev) {
  const head = (await getJSON('g:log:head')) || { i: 0, h: sha(GENESIS) };
  const entry = { i: head.i + 1, t: Date.now(), ev };
  const h = sha(head.h + JSON.stringify(entry));
  const newHead = { i: entry.i, h };
  await setJSON('g:log:head', newHead);
  // ---- full retention: one-time backfill (possible while the whole
  // history still fits in the recent window), then append to the
  // current chunk.
  if (entry.i > 1 && !(await getJSON('g:log:c:0'))) {
    const recent = (await getJSON('g:log:recent')) || [];
    if (recent.length >= head.i) {
      const all = recent.slice(0, head.i).reverse();      // oldest-first 1..head.i
      for (let c = 0; c * CHUNK < all.length; c++)
        await setJSON(`g:log:c:${c}`, all.slice(c * CHUNK, (c + 1) * CHUNK));
    }
  }
  const cn = Math.floor((entry.i - 1) / CHUNK);
  const chunk = (await getJSON(`g:log:c:${cn}`)) || [];
  chunk.push({ ...entry, h });
  await setJSON(`g:log:c:${cn}`, chunk);
  const heads = (await getJSON('g:log:heads')) || {};
  heads[entry.i] = h;
  const keys = Object.keys(heads).map(Number).sort((a,b)=>a-b);
  while (keys.length > 500) delete heads[keys.shift()];
  await setJSON('g:log:heads', heads);
  const recent = (await getJSON('g:log:recent')) || [];
  recent.unshift({ ...entry, h });
  await setJSON('g:log:recent', recent.slice(0, 60));
  return newHead;
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
function verifyChain(entries, head) {
  let h = sha(GENESIS);
  for (let n = 0; n < entries.length; n++) {
    const e = entries[n];
    if (e.i !== n + 1) return { ok: false, count: n, brokenAt: n + 1, reason: 'gap or misorder' };
    const recomputed = sha(h + JSON.stringify({ i: e.i, t: e.t, ev: e.ev }));
    if (e.h && e.h !== recomputed) return { ok: false, count: n, brokenAt: e.i, reason: 'hash mismatch' };
    h = recomputed;
  }
  if (head && (head.i !== entries.length || head.h !== h))
    return { ok: false, count: entries.length, brokenAt: head.i, reason: 'head mismatch' };
  return { ok: true, count: entries.length, brokenAt: null };
}

module.exports = { append, decideAnchor, verifyChain, MEMO_PROGRAM, CHUNK };
