// ============================================================
//  lib/legacy_chain.js — reading the pre-canonical log.
//
//  Entries written before c:1 were hashed over JSON.stringify output, whose
//  byte order is INSERTION order. Postgres jsonb then re-ordered every key by
//  (length, bytewise) on its way into storage, so the bytes we can read today
//  are not the bytes that were hashed. Nothing was altered — the input was
//  normalised out from under the hash.
//
//  The transformation is lossy in exactly one dimension: order. The values are
//  all still there. So a legacy entry can be verified by recovering the order
//  it was written in and re-hashing that. This file does the recovery, and is
//  honest about the entries it cannot recover.
//
//  Two sources of candidate orders:
//    1. TEMPLATES — every append() key order that has ever existed in this
//       repository, harvested from git history. These are facts about what the
//       code wrote, not guesses.
//    2. SEARCH — for a key set no template covers, permutations are tried once
//       per distinct key set (not per entry) and the winner is reused. A key
//       set that no order reproduces is reported as unrecovered. It is never
//       "fixed" by writing a new hash.
//
//  This recovers history for reading. It does not rewrite it: no stored hash
//  and no stored entry is ever modified.
// ============================================================
const crypto = require('node:crypto');
const sha = s => crypto.createHash('sha256').update(s).digest('hex');

const TEMPLATES = Object.freeze([
  { kind: "agent", keys: ["k", "agent", "id", "res", "side", "exitPx"] },
  { kind: "agentjoin", keys: ["k", "w", "name"] },
  { kind: "anchor", keys: ["k", "w", "i", "sig", "xp"] },
  { kind: "anchor", keys: ["k", "w", "i", "sig"] },
  { kind: "aseal", keys: ["k", "agent", "id", "label", "side", "entry", "exp"] },
  { kind: "chal", keys: ["k", "id", "by", "label", "side", "stake", "mins"] },
  { kind: "chalexpire", keys: ["k", "id", "by", "stake", "refunded"] },
  { kind: "chaltake", keys: ["k", "id", "by", "taker", "label", "entry", "exp", "stake"] },
  { kind: "mirror", keys: ["k", "w", "sig", "id", "commit"] },
  { kind: "podium", keys: ["k", "rule", "period", "id", "list"] },
  { kind: "podium", keys: ["k", "period", "list"] },
  { kind: "reload", keys: ["k", "w", "sig", "amount", "burned", "champs"] },
  { kind: "reload", keys: ["k", "w", "sig", "amount"] },
  { kind: "root", keys: ["k", "day", "root", "players"] },
  { kind: "seal", keys: ["k", "w", "id", "feed", "stake", "exp", "entry", "commit"] },
  { kind: "seal", keys: ["k", "w", "id", "feed", "side", "stake", "exp", "entry"] },
  { kind: "season", keys: ["k", "season", "pot", "paid", "winners"] },
  { kind: "settle", keys: ["k", "w", "id", "res", "exitPx", "exitAt", "side", "salt", "commit"] },
  { kind: "settle", keys: ["k", "w", "id", "res", "exitPx", "side", "salt", "commit"] },
  { kind: "settle", keys: ["k", "w", "id", "res", "reason"] },
  { kind: "settle", keys: ["k", "w", "id", "res", "exitPx"] },
  { kind: "stake", keys: ["k", "w", "on"] },
  { kind: "stakeyield", keys: ["k", "w", "bal"] },
  { kind: "wardenmodel", keys: ["k", "from", "to", "retired"] },
  { kind: "wseal", keys: ["k", "id", "feed", "thresh", "p", "exp"] },
  { kind: "wsettle", keys: ["k", "id", "outcome", "hit", "exitPx"] }
]);

const setKey = keys => keys.slice().sort().join(',');
const reorder = (obj, order) => {
  const out = {};
  for (const k of order) if (k in obj) out[k] = obj[k];
  for (const k of Object.keys(obj)) if (!(k in out)) out[k] = obj[k];   // never drop a field
  return out;
};

function* permutations(arr) {
  if (arr.length <= 1) { yield arr; return; }
  for (let i = 0; i < arr.length; i++) {
    const rest = arr.slice(0, i).concat(arr.slice(i + 1));
    for (const p of permutations(rest)) yield [arr[i], ...p];
  }
}

const MAX_SEARCH_KEYS = 8;          // 8! = 40320 tries, once per key set

/** Find the insertion order that reproduces `entry.h` from `prev`.
 *  Returns { order, via } or null. Pure: reads, never writes. */
function recoverOrder(entry, prev, { templates = TEMPLATES, maxKeys = MAX_SEARCH_KEYS } = {}) {
  const ev = entry.ev;
  if (!ev || typeof ev !== 'object' || Array.isArray(ev)) return null;
  const keys = Object.keys(ev);
  const want = String(entry.h || '');
  const test = order => sha(prev + JSON.stringify({ i: entry.i, t: entry.t, ev: reorder(ev, order) })) === want;

  const sig = setKey(keys);
  for (const t of templates) {
    if (setKey(t.keys) !== sig) continue;
    if (test(t.keys)) return { order: t.keys, via: 'template' };
  }
  // a template for a SUPERSET/subset shape often still orders the shared keys
  for (const t of templates) {
    const order = t.keys.filter(k => keys.includes(k));
    if (order.length !== keys.length) continue;
    if (test(order)) return { order, via: 'template-partial' };
  }
  if (keys.length <= maxKeys) {
    for (const perm of permutations(keys)) if (test(perm)) return { order: perm, via: 'search' };
  }
  return null;
}

/** Verify a whole legacy run. Entries chain off their PREDECESSOR'S STORED
 *  hash, so one unrecoverable entry does not cascade into the next.
 *  Returns per-key-set outcomes and totals — a measurement, not a verdict. */
function verifyLegacy(entries, { genesis = sha('ratchet-genesis'), templates = TEMPLATES } = {}) {
  const rows = (entries || []).filter(Boolean).slice().sort((a, b) => Number(a.i) - Number(b.i));
  const learned = new Map();          // key set -> order (found once, reused)
  const shapes = new Map();           // key set -> { n, ok, via }
  let verified = 0, unrecovered = 0, canonical = 0, prevStored = null;

  for (const e of rows) {
    const prev = Number(e.i) === 1 ? genesis : (prevStored || '');
    prevStored = String(e.h || '');
    if (e.c) { canonical++; continue; }               // canonical entries are not this file's job
    const ev = e.ev;
    if (!ev || typeof ev !== 'object') { unrecovered++; continue; }
    const sig = setKey(Object.keys(ev));
    const row = shapes.get(sig) || { keys: Object.keys(ev).slice().sort(), n: 0, ok: 0, via: null };
    row.n++;

    let order = learned.get(sig), okNow = false;
    if (order) okNow = sha(prev + JSON.stringify({ i: e.i, t: e.t, ev: reorder(ev, order) })) === String(e.h);
    if (!okNow) {
      const found = recoverOrder(e, prev, { templates });
      if (found) { learned.set(sig, found.order); row.via = found.via; okNow = true; }
    } else if (!row.via) row.via = 'learned';

    if (okNow) { verified++; row.ok++; } else unrecovered++;
    shapes.set(sig, row);
  }
  return {
    total: rows.length, canonical, verified, unrecovered,
    shapes: [...shapes.entries()].map(([sig, r]) => ({ keys: sig, n: r.n, recovered: r.ok, via: r.via }))
      .sort((a, b) => b.n - a.n),
  };
}

module.exports = { TEMPLATES, recoverOrder, verifyLegacy, reorder, setKey };
