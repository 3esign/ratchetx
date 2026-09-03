// Which Redis type each key family is, declared once, in one place.
//
// WHY THIS FILE EXISTS. The Supabase store held every value as JSON in one
// table, so migrating to Redis meant deciding, per key, whether it was a
// string, a hash or a sorted set. `tools/kv_import.mjs` decided by prefix --
// `h:*` a hash, `z:*` a sorted set, everything else a string -- which is a
// convention nobody had ever been required to follow. Four hash families do
// not follow it: `g:fh`, `ldg:rx`, `ldg4:dropped`, `odds:<hour>` and
// `funnel_daily:<day>`. They imported as strings.
//
// Nothing complained until an agent tried to play. `HGETALL g:fh` threw
// WRONGTYPE, /api/game?action=pyth-context returned 500, and the Bankr skill
// reported RELEASE_MISMATCH -- because a dead endpoint has no version string,
// and the version check runs before the endpoint check. Three layers of
// indirection between "a key has the wrong Redis type" and the error a person
// finally sees.
//
// So the shape of a key is no longer a naming convention. It is a declaration,
// this file is the only copy of it, and lib/kv.js checks every hash and
// sorted-set command against it before sending. A key whose shape is not
// declared here fails the first time it is used -- in a test, at a keyboard --
// rather than a year later inside an import.
//
// TO ADD A KEY: put its pattern in the right list. If you find yourself
// wanting to skip that, note that the alternative is what happened above.

/** Key families stored as Redis hashes (HSET / HGETALL / HINCRBYFLOAT). */
const HASH_KEYS = [
  /^h:/,                 // the convention, where it was followed
  /^g:fh$/,              // lib/feedhealth.js  — lifetime settlement counters
  /^ldg:rx$/,            // api/game.js        — Brier accumulator
  /^ldg4:dropped$/,      // lib/ledger.js      — drop reasons
  /^odds:[0-9A-Za-z:_-]+$/,        // api/game.js  — crowd belief, per board hour
  /^funnel_daily:[0-9-]+$/,        // lib/funnel.js — milestone counts, per day
];

/** Key families stored as Redis sorted sets (ZADD / ZINCRBY / ZREVRANGE). */
const ZSET_KEYS = [
  /^z:/,                 // every XP ladder: z:lb:<season>, z:lbd:<day>, z:lba:all
];

const matches = (patterns, key) => patterns.some(re => re.test(key));

/** 'hash' | 'zset' | 'string' — what Redis type this key must hold. */
function shapeOf(key) {
  const k = String(key);
  if (matches(HASH_KEYS, k)) return 'hash';
  if (matches(ZSET_KEYS, k)) return 'zset';
  return 'string';
}

/** Throws unless `key` is declared as `shape`. Called by lib/kv.js before any
 *  hash or sorted-set command, so an undeclared key cannot reach the store and
 *  cannot be exported into the next migration as the wrong type. */
function assertShape(key, shape) {
  const actual = shapeOf(key);
  if (actual === shape) return;
  const e = new Error(
    `KV_SHAPE_UNDECLARED: ${JSON.stringify(String(key))} is used as a ${shape}, `
    + `but lib/kv_shapes.js says it is a ${actual}. Declare it there -- a key `
    + `whose shape lives only in its name is a key the next migration will `
    + `import as the wrong Redis type.`);
  e.code = 'KV_SHAPE_UNDECLARED';
  throw e;
}

module.exports = { HASH_KEYS, ZSET_KEYS, shapeOf, assertShape };
