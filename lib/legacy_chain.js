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
const { canon } = require('./canon.js');
const sha = s => crypto.createHash('sha256').update(s).digest('hex');

const TEMPLATES = Object.freeze([
  { kind: "settle", keys: ["k", "w", "id", "res", "exitPx", "exitAt", "exitPx2", "exitAt2", "side", "salt", "commit", "commitV", "settleRule", "settleRuleApplied", "outcomeRule", "allocationRule", "xp", "settleXp", "skillXp", "truthPlane", "settlementAuthority"] },
  { kind: "settle", keys: ["k", "w", "id", "res", "exitPx", "exitAt", "exitPx2", "exitAt2", "side", "salt", "sp", "commit", "commitV", "settleRule", "settleRuleApplied", "outcomeRule", "allocationRule", "xp", "settleXp", "skillXp"] },
  { kind: "settle", keys: ["k", "w", "id", "res", "exitPx", "exitAt", "exitPx2", "exitAt2", "side", "salt", "commit", "commitV", "settleRule", "settleRuleApplied", "outcomeRule", "allocationRule", "xp", "settleXp", "skillXp"] },
  { kind: "settle", keys: ["k", "w", "id", "res", "exitPx", "exitAt", "exitPx2", "exitAt2", "side", "salt", "commit", "commitV", "settleRule", "outcomeRule", "allocationRule", "xp", "settleXp", "skillXp"] },
  { kind: "settle", keys: ["k", "w", "id", "res", "exitPx", "exitAt", "exitPx2", "exitAt2", "side", "salt", "commit", "commitV", "settleRule", "allocationRule", "xp", "settleXp", "skillXp"] },
  { kind: "seal", keys: ["k", "w", "id", "feed", "feed2", "stake", "exp", "entry", "entry2", "commit", "commitV", "settleRule", "outcomeRule", "allocationRule", "challenge"] },
  { kind: "aseal", keys: ["k", "agent", "id", "label", "kind", "feed", "feed2", "side", "entry", "entry2", "pct", "exp", "settleRule", "outcomeRule"] },
  { kind: "seal", keys: ["k", "w", "id", "feed", "feed2", "stake", "exp", "entry", "entry2", "commit", "commitV", "settleRule", "allocationRule", "challenge"] },
  { kind: "settle", keys: ["k", "w", "id", "res", "exitPx", "exitAt", "exitPx2", "exitAt2", "side", "salt", "commit", "commitV", "settleRule", "allocationRule"] },
  { kind: "aseal", keys: ["k", "agent", "id", "label", "kind", "feed", "feed2", "side", "entry", "entry2", "pct", "exp", "settleRule"] },
  { kind: "agent", keys: ["k", "agent", "id", "res", "side", "outcome", "exitPx", "exitPx2", "exitAt", "exitAt2"] },
  { kind: "settle", keys: ["k", "w", "id", "res", "reason", "commitV", "settleRuleApplied", "indicativePx", "indicativeAt", "indicativeGapSec"] },
  { kind: "wsettle", keys: ["k", "id", "outcome", "hit", "exitPx", "exitAt", "prevExitAt", "confBps", "outcomeRule"] },
  { kind: "reload", keys: ["k", "w", "sig", "amount", "credited", "burned", "champs", "retained", "legs"] },
  { kind: "settle", keys: ["k", "w", "id", "res", "reason", "commitV", "indicativePx", "indicativeAt", "indicativeGapSec"] },
  { kind: "settle", keys: ["k", "w", "id", "res", "exitPx", "exitAt", "side", "salt", "commit"] },
  { kind: "wseal", keys: ["k", "id", "feed", "thresh", "p", "exp", "settleRule", "outcomeRule"] },
  { kind: "chaltake", keys: ["k", "id", "by", "taker", "label", "entry", "exp", "stake"] },
  { kind: "wsettle", keys: ["k", "id", "outcome", "hit", "exitPx", "exitAt", "prevExitAt", "confBps"] },
  { kind: "seal", keys: ["k", "w", "id", "feed", "stake", "exp", "entry", "commit"] },
  { kind: "settle", keys: ["k", "w", "id", "res", "exitPx", "side", "salt", "commit"] },
  { kind: "seal", keys: ["k", "w", "id", "feed", "side", "stake", "exp", "entry"] },
  { kind: "avoid", keys: ["k", "agent", "id", "reason", "exitPx", "exitPx2", "exitAt"] },
  { kind: "chal", keys: ["k", "id", "by", "label", "side", "stake", "mins"] },
  { kind: "wseal", keys: ["k", "id", "feed", "thresh", "p", "exp", "settleRule"] },
  { kind: "aseal", keys: ["k", "agent", "id", "label", "side", "entry", "exp"] },
  { kind: "settle", keys: ["k", "w", "id", "res", "reason", "commitV"] },
  { kind: "wseal", keys: ["k", "id", "feed", "thresh", "p", "exp"] },
  { kind: "agent", keys: ["k", "agent", "id", "res", "side", "exitPx"] },
  { kind: "reload", keys: ["k", "w", "sig", "amount", "burned", "champs"] },
  { kind: "podium", keys: ["k", "rule", "period", "id", "list"] },
  { kind: "chalexpire", keys: ["k", "id", "by", "stake", "refunded"] },
  { kind: "?", keys: ["k", "period", "pot", "paid", "winners"] },
  { kind: "wvoid", keys: ["k", "id", "reason", "exitPx", "exitAt"] },
  { kind: "anchor", keys: ["k", "w", "i", "sig", "xp"] },
  { kind: "mirror", keys: ["k", "w", "sig", "id", "commit"] },
  { kind: "wsettle", keys: ["k", "id", "outcome", "hit", "exitPx"] },
  { kind: "settle", keys: ["k", "w", "id", "res", "reason"] },
  { kind: "settle", keys: ["k", "w", "id", "res", "exitPx"] },
  { kind: "season", keys: ["k", "season", "pot", "paid", "winners"] },
  { kind: "root", keys: ["k", "day", "root", "players"] },
  { kind: "wardenmodel", keys: ["k", "from", "to", "retired"] },
  { kind: "avoid", keys: ["k", "agent", "id", "reason"] },
  { kind: "stakeyield", keys: ["k", "w", "bal", "y"] },
  { kind: "reload", keys: ["k", "w", "sig", "amount"] },
  { kind: "anchor", keys: ["k", "w", "i", "sig"] },
  { kind: "wvoid", keys: ["k", "id", "reason"] },
  { kind: "agentjoin", keys: ["k", "w", "name"] },
  { kind: "stake", keys: ["k", "w", "on"] },
  { kind: "podium", keys: ["k", "period", "list"] },
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

const MAX_SEARCH_KEYS = 9;          // 9! = 362880 tries, once per key SET, not per entry

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

/** jsonb re-ordered keys at EVERY depth, not just the top level. An event
 *  carrying an array of objects — a payout list, a winners list — therefore
 *  needs its nested objects restored too, and the flat recovery above will
 *  never verify it.
 *
 *  Objects appearing in the same list share a shape, so one order is searched
 *  per distinct key SET rather than per object. Combined with the top-level
 *  candidates that keeps the search small enough to be exhaustive, and
 *  exhaustive is the point: if no assignment reproduces the hash, the value
 *  itself differs and no amount of reordering will hide that. */
function collectShapes(v, out = new Map(), depth = 0) {
  if (depth > 6 || v === null || typeof v !== 'object') return out;
  if (Array.isArray(v)) { for (const x of v) collectShapes(x, out, depth + 1); return out; }
  const keys = Object.keys(v);
  if (keys.length > 1) {
    const sig = keys.slice().sort().join(',');
    if (!out.has(sig)) out.set(sig, keys.slice().sort());
  }
  for (const k of keys) collectShapes(v[k], out, depth + 1);
  return out;
}

function applyOrders(v, orders, depth = 0) {
  if (depth > 6 || v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(x => applyOrders(x, orders, depth + 1));
  const keys = Object.keys(v);
  const sig = keys.slice().sort().join(',');
  const order = orders.get(sig);
  const seq = order ? order.filter(k => k in v).concat(keys.filter(k => !order.includes(k))) : keys;
  const outObj = {};
  for (const k of seq) outObj[k] = applyOrders(v[k], orders, depth + 1);
  return outObj;
}

const MAX_DEEP_TRIES = 500_000;

/** Last resort for an entry the flat recovery cannot verify: search the nested
 *  object orders as well. Returns { orders, via } or null. */
function recoverDeep(entry, prev, { templates = TEMPLATES } = {}) {
  const ev = entry.ev;
  if (!ev || typeof ev !== 'object') return null;
  const want = String(entry.h || '');
  const topKeys = Object.keys(ev);
  const topSig = topKeys.slice().sort().join(',');

  // candidate orders for the TOP level: templates first, then permutations
  const tops = [];
  for (const t of templates) {
    if (t.keys.slice().sort().join(',') === topSig) tops.push(t.keys);
    else { const f = t.keys.filter(k => topKeys.includes(k)); if (f.length === topKeys.length) tops.push(f); }
  }
  if (topKeys.length <= 7) for (const perm of permutations(topKeys)) tops.push(perm);
  if (!tops.length) tops.push(topKeys);

  // nested shapes, excluding the root itself
  const nested = [...collectShapes(ev).entries()].filter(([sig]) => sig !== topSig);
  const nestedPerms = nested.map(([sig, keys]) =>
    [sig, keys.length <= 7 ? [...permutations(keys)] : [keys]]);

  let tries = 0;
  const walk = (idx, chosen) => {
    if (idx === nestedPerms.length) {
      for (const top of tops) {
        if (++tries > MAX_DEEP_TRIES) return null;
        const orders = new Map(chosen);
        orders.set(topSig, top);
        const rebuilt = applyOrders(ev, orders);
        if (sha(prev + JSON.stringify({ i: entry.i, t: entry.t, ev: rebuilt })) === want)
          return { orders, via: 'deep' };
      }
      return null;
    }
    const [sig, options] = nestedPerms[idx];
    for (const opt of options) {
      const hit = walk(idx + 1, [...chosen, [sig, opt]]);
      if (hit) return hit;
    }
    return null;
  };
  return walk(0, []);
}

/** Verify a whole legacy run. Entries chain off their PREDECESSOR'S STORED
 *  hash, so one unrecoverable entry does not cascade into the next.
 *  Returns per-key-set outcomes and totals — a measurement, not a verdict. */
function verifyLegacy(entries, { genesis = sha('ratchet-genesis'), templates = TEMPLATES } = {}) {
  const rows = (entries || []).filter(Boolean).slice().sort((a, b) => Number(a.i) - Number(b.i));
  // Indices we hold, so an entry whose PREDECESSOR is missing can be named as
  // what it is. Its prev hash died with the lost entry, so no ordering and no
  // search can verify it — that is arithmetic, not a discrepancy, and calling
  // it a failure would misreport the one real gap as two problems.
  const present = new Set(rows.map(e => Number(e.i)));
  const learned = new Map();          // key set -> order (found once, reused)
  const shapes = new Map();           // key set -> { n, ok, via }
  const misses = [];                  // the individual entries that did not verify
  let verified = 0, unrecovered = 0, canonical = 0, orphaned = 0, prevStored = null;

  for (const e of rows) {
    const prev = Number(e.i) === 1 ? genesis : (prevStored || '');
    prevStored = String(e.h || '');
    if (e.c) {
      // Canonical entries verify on their own rule, in the same pass, so one
      // walk answers for the whole log instead of two that have to be
      // reconciled afterwards.
      const body = { i: e.i, t: e.t, ev: e.ev, c: e.c };
      if (sha(prev + canon(body)) === String(e.h)) { canonical++; verified++; }
      else {
        canonical++; unrecovered++;
        if (misses.length < 40) misses.push({ i: Number(e.i), t: e.t ?? null,
          kind: (e.ev && e.ev.k) || '?', keys: Object.keys(e.ev || {}),
          stored: String(e.h || '').slice(0, 16), prev: String(prev).slice(0, 16),
          canonical: true, hadOrder: true });
      }
      continue;
    }
    if (Number(e.i) > 1 && !present.has(Number(e.i) - 1)) {
      orphaned++;
      misses.push({ i: Number(e.i), t: e.t ?? null, kind: (e.ev && e.ev.k) || '?',
        keys: Object.keys(e.ev || {}), stored: String(e.h || '').slice(0, 16),
        prev: '(lost with entry ' + (Number(e.i) - 1) + ')', orphan: true, hadOrder: true });
      continue;
    }
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
      else {
        // Nested objects were reordered too. Only reached for the handful the
        // flat path cannot explain, so an exhaustive search is affordable here.
        const deep = recoverDeep(e, prev, { templates });
        if (deep) { row.via = 'deep'; okNow = true; }
      }
    } else if (!row.via) row.via = 'learned';

    if (okNow) { verified++; row.ok++; }
    else {
      unrecovered++;
      // Name them. Once the count is small this is the whole question, and a
      // total without a list is not something anyone can check.
      if (misses.length < 40) misses.push({
        i: Number(e.i), t: e.t ?? null, kind: (ev && ev.k) || '?',
        keys: Object.keys(ev), stored: String(e.h || '').slice(0, 16),
        prev: String(prev).slice(0, 16),
        hadOrder: !!learned.get(sig),
      });
    }
    shapes.set(sig, row);
  }
  return {
    total: rows.length, canonical, verified, unrecovered, orphaned, misses,
    shapes: [...shapes.entries()].map(([sig, r]) => ({ keys: sig, n: r.n, recovered: r.ok, via: r.via }))
      .sort((a, b) => b.n - a.n),
  };
}

module.exports = { TEMPLATES, recoverOrder, recoverDeep, verifyLegacy, reorder, setKey,
  collectShapes, applyOrders };
