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
const { getJSON, getJSONStrict, getManyJSON, setJSON, setManyJSONAtomic,
  setJSONEx, acquireLease, releaseLease } = require('./kv.js');

const GENESIS = 'ratchet-genesis';
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
// FULL RETENTION (the Black Box): every entry has an immutable, single-writer
// key (g:log:e:<i>). Legacy 500-entry chunk blobs remain as an export/read
// accelerator and migration source, but are not authoritative because their
// read-modify-write updates can race under concurrency.
const CHUNK = 500;

// THE WHOLE APPEND IS ATOMIC.
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
// A counter alone fixed index collisions but introduced a third failure: a
// process could die after INCR and before writing its immutable entry.  That
// creates a permanent issued-but-missing index.  Appends are now serialized
// by an ownership-safe lease, then the entry, counter, head and read models
// are committed in one Redis Lua transaction.  There is no point at which an
// index exists without its event.
const LINK_TTL = 30 * 24 * 3600;      // links are only ever read by i+1
const linkKey = i => `g:log:h:${i}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function append(ev, onceKey = null) {
  if (onceKey != null && !/^[A-Za-z0-9:._-]{1,180}$/.test(String(onceKey)))
    throw new Error('invalid idempotent event key');
  const onceGate = onceKey == null ? null : `g:log:once:${onceKey}`;
  let lease = null;
  for (let a = 0; a < 80 && !lease; a++) {
    lease = await acquireLease('lock:g:log', 30);
    if (!lease) await sleep(25 + Math.min(a, 20) * 5);
  }
  if (!lease) throw new Error('event log busy - retry');
  try {
    if (onceGate) {
      const prior = await getJSONStrict(onceGate);
      if (prior) return { ...prior, duplicate:true };
    }
    let head = await getJSONStrict('g:log:head');
    const issuedRaw = await getJSONStrict('g:log:n');
    let issued = Number(issuedRaw) || 0;

    if (!head && issued > 0) {
      const last = await getJSONStrict(`g:log:e:${issued}`);
      if (last && last.i === issued && /^[0-9a-f]{64}$/.test(last.h || ''))
        head = { i:issued, h:last.h };
      else throw new Error(`event log head missing at issued index ${issued}`);
    }
    if (head && !issued) issued = Number(head.i) || 0;
    if ((head ? Number(head.i) : 0) !== issued)
      throw new Error(`event log index mismatch - head ${head ? head.i : 0}, issued ${issued}`);

    const i = issued + 1;
    const prev = i === 1 ? sha(GENESIS) : head.h;
    const entry = { i, t:Date.now(), ev };
    const h = sha(prev + JSON.stringify(entry));
    const stored = { ...entry, h };
    const newHead = { i, h };

    const cn = Math.floor((i - 1) / CHUNK);
    const chunkKey = `g:log:c:${cn}`;
    const chunk = (await getJSONStrict(chunkKey)) || [];
    if (chunk.some(e => e && e.i === i)) throw new Error(`event log index ${i} already stored`);
    chunk.push(stored);

    const heads = (await getJSONStrict('g:log:heads')) || {};
    heads[i] = h;
    const keys = Object.keys(heads).map(Number).sort((a,b)=>a-b);
    while (keys.length > 500) delete heads[keys.shift()];
    const recent = (await getJSONStrict('g:log:recent')) || [];
    recent.unshift(stored);

    const writes = [
      [`g:log:e:${i}`, stored],
      [chunkKey, chunk],
      ['g:log:heads', heads],
      ['g:log:recent', recent.slice(0, 60)],
      ['g:log:head', newHead],
      ['g:log:n', i],
    ];
    if (onceGate) writes.push([onceGate, { i, h, t:entry.t }]);
    await setManyJSONAtomic(writes);
    try { await setJSONEx(linkKey(i), h, LINK_TTL); } catch {}
    return { ...newHead, duplicate:false };
  } finally {
    try { await releaseLease('lock:g:log', lease); } catch {}
  }
}

async function appendOnce(key, ev) {
  return append(ev, key);
}

/** How many entries the server says exist. The verifier compares this with
 *  how many it can actually read, which is what turns a silently dropped
 *  event into a reported one. */
async function logCount() {
  const n = await getJSONStrict('g:log:n');
  return Number(n) || 0;
}

/** Merge legacy chunks with authoritative single-writer entries. */
async function readEntries(issued = null) {
  const n = Number.isFinite(issued) ? issued : await logCount();
  const slots = [];
  for (let c = 0; c * CHUNK < n; c++)
    for (const e of (await getJSONStrict(`g:log:c:${c}`)) || [])
      if (e && e.i) slots[e.i - 1] = e;
  for (let start = 1; start <= n; start += 500) {
    const stop = Math.min(n, start + 499);
    const keys = Array.from({ length: stop - start + 1 }, (_, k) => `g:log:e:${start + k}`);
    const rows = await getManyJSON(keys);
    rows.forEach((e, k) => { if (e) slots[start + k - 1] = e; });
  }
  return slots.filter(Boolean);
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
  if (Number.isFinite(expectedCount) && expectedCount > 0 && entries.length !== expectedCount) {
    // A row count only identifies a missing tail. Walk the monotonic indices
    // so a historical hole is reported at its actual position.
    let brokenAt = 1;
    for (const e of entries) {
      if (!e || Number(e.i) !== brokenAt) break;
      brokenAt++;
    }
    return { ok: false, count: entries.length, brokenAt,
             reason: `missing entry ${brokenAt} — ${expectedCount} issued, ${entries.length} stored` };
  }
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

module.exports = { append, appendOnce, decideAnchor, verifyChain, logCount, readEntries, MEMO_PROGRAM, CHUNK };
