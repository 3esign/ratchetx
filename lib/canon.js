// ============================================================
//  lib/canon.js — canonical JSON, so a hash survives its storage.
//
//  WHY THIS FILE EXISTS, in one sentence: we hashed the serialization
//  instead of the value, and the database reordered the serialization.
//
//  The event log computed h = sha256(prev + JSON.stringify(entry)).
//  JSON.stringify emits keys in insertion order. Postgres `jsonb` does
//  not store JSON text — it parses, and returns keys in ITS canonical
//  order: shortest key first, then bytewise. So the moment the KV
//  backend moved to Supabase, every entry came back with its keys
//  rearranged, the recomputed bytes stopped matching the bytes that
//  were hashed, and a chain of perfectly intact records stopped
//  verifying.
//
//  Nothing was altered and no data was lost. The hashes are still
//  correct hashes of what was written. We simply could no longer
//  reproduce the input, because the storage layer normalised it.
//
//  The fix is the one every hash chain over structured data needs:
//  hash a CANONICAL form. Sort the keys yourself, deterministically,
//  before hashing — then it does not matter what order any database,
//  driver, or JSON implementation hands the object back in.
// ============================================================

/** Deterministic JSON: object keys sorted lexicographically, recursively.
 *  Arrays keep their order (order is meaning there). Undefined values are
 *  dropped exactly as JSON.stringify drops them, so canon() and
 *  JSON.stringify() agree on which fields exist — only on order do they
 *  differ. */
function canon(v) {
  if (v === null || typeof v !== 'object') {
    const s = JSON.stringify(v);
    return s === undefined ? 'null' : s;
  }
  if (Array.isArray(v)) return '[' + v.map(x => canon(x === undefined ? null : x)).join(',') + ']';
  const keys = Object.keys(v).filter(k => v[k] !== undefined).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
}

/** How Postgres `jsonb` orders keys: by length, then bytewise. Kept here
 *  because it is the transformation that broke the old chain, and being able
 *  to reproduce it is what lets the legacy verifier reason about history
 *  instead of guessing at it. */
function jsonbOrder(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(jsonbOrder);
  const out = {};
  for (const k of Object.keys(v).sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0)))
    out[k] = jsonbOrder(v[k]);
  return out;
}

module.exports = { canon, jsonbOrder };
