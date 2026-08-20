// ============================================================
//  lib/kv.js — storage with two backends, zero dependencies.
//
//  If KV_REST_API_URL + KV_REST_API_TOKEN exist (Vercel KV /
//  Upstash Redis via the Vercel Marketplace), every read/write
//  goes there and state is durable and shared.
//
//  If they do not exist, an in-memory Map on globalThis is used:
//  the game fully works for a demo, but state is per-instance
//  and evaporates on cold starts. The frontend is told which
//  mode is live and says so on screen — honesty is the aesthetic.
//
//  HARDENED 2026-08-19:
//  · getJSONStrict — for the money paths (player records, stats,
//    replay gates). A failed READ must throw, not masquerade as
//    "no data": returning null on a flaky read could hand a
//    player a fresh record that later OVERWRITES their real one.
//    getJSON stays lenient for cosmetic reads (feed, caches).
//  · setnxJSON gained an optional TTL (seconds) — used for the
//    anchor-XP cooldown. The in-memory fallback ignores TTL,
//    which only matters in demo mode.
// ============================================================
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const TOK_ = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
const durable = !!(URL_ && TOK_);

const mem = globalThis.__ratchet_mem || (globalThis.__ratchet_mem = new Map());

async function redis(cmd, retries = 1) {
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch(URL_, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOK_}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(3500),
        body: JSON.stringify(cmd),
      });
      if (!r.ok) throw new Error(`kv ${r.status}`);
      const j = await r.json();
      return j.result;
    } catch (e) {
      if (i === retries) throw e;
      await new Promise(res => setTimeout(res, 50));
    }
  }
}

const parse = v => (v == null ? null : (typeof v === 'object' ? v : JSON.parse(v)));

/** Lenient read: any failure reads as "no data". For cosmetic keys only
 *  (feed, ladders shown on screen, caches) — never for money. */
async function getJSON(key) {
  try {
    if (!durable) return mem.has(key) ? JSON.parse(mem.get(key)) : null;
    return parse(await redis(['GET', key]));
  } catch {
    return null;
  }
}

/** Strict read: a backend failure THROWS (surfacing as a 500) instead of
 *  returning null. Use for player records, stats, and replay gates, where
 *  "read failed" and "does not exist" must never be confused. */
async function getJSONStrict(key) {
  if (!durable) return mem.has(key) ? JSON.parse(mem.get(key)) : null;
  return parse(await redis(['GET', key]));
}

async function setJSON(key, val) {
  try {
    const s = JSON.stringify(val);
    if (!durable) { mem.set(key, s); return; }
    await redis(['SET', key, s]);
  } catch (e) {
    if (!durable) mem.set(key, JSON.stringify(val));
    else throw e;
  }
}

/** setJSON with a TTL (durable backend only; memory mode just holds it).
 *  Used by the price log, where old hourly buckets must expire on their own
 *  rather than accumulate forever. */
async function setJSONEx(key, val, exSeconds) {
  try {
    const s = JSON.stringify(val);
    if (!durable) { mem.set(key, s); return; }
    await redis(['SET', key, s, 'EX', String(exSeconds)]);
  } catch (e) {
    if (!durable) mem.set(key, JSON.stringify(val));
    else throw e;
  }
}

/** Set only if the key does not exist. Returns true if WE set it.
 *  This is the whole concurrency story for pot settlement and for the
 *  burn/anchor replay gates: many requests may race; exactly one wins.
 *  Optional exSeconds gives the key a TTL (durable backend only). */
async function setnxJSON(key, val, exSeconds) {
  try {
    const s = JSON.stringify(val);
    if (!durable) { if (mem.has(key)) return false; mem.set(key, s); return true; }
    const cmd = exSeconds ? ['SET', key, s, 'EX', String(exSeconds), 'NX'] : ['SET', key, s, 'NX'];
    return (await redis(cmd)) === 'OK';
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------
 *  ATOMIC PRIMITIVES.
 *
 *  Everything above is read-modify-write: load a blob, change it, store it.
 *  That is fine for a player record, where every field derives from the same
 *  snapshot and last-write-wins collapses concurrent writers harmlessly.
 *
 *  It is NOT fine for a shared counter. `lb[w] = lb[w] + xp` on a key that
 *  many requests touch loses increments when writers overlap and — worse —
 *  rewrites the WHOLE ladder from whatever the reader happened to see. One
 *  timed-out GET returning null meant one player's row replacing everyone's.
 *
 *  These four are server-side atomic. The ladder and out-of-band credits use
 *  them instead.
 * ---------------------------------------------------------------- */

// memory-mode sorted set: key -> Map(member -> score)
const zmem = key => { if (!mem.has('Z' + key)) mem.set('Z' + key, new Map()); return mem.get('Z' + key); };

/** Atomically add `by` to a member's score. Returns the new score. */
async function zincr(key, by, member) {
  if (!durable) { const z = zmem(key); const v = (z.get(member) || 0) + by; z.set(member, v); return v; }
  return Number(await redis(['ZINCRBY', key, String(by), String(member)]));
}

/** Top `n` by score, descending, as [[member, score], ...]. n omitted = all. */
async function ztop(key, n) {
  if (!durable) {
    const rows = [...zmem(key).entries()].sort((a, b) => b[1] - a[1]);
    return n ? rows.slice(0, n) : rows;
  }
  const flat = await redis(['ZREVRANGE', key, '0', String(n ? n - 1 : -1), 'WITHSCORES']);
  const out = [];
  for (let i = 0; i < (flat || []).length; i += 2) out.push([flat[i], Number(flat[i + 1])]);
  return out;
}

/** Atomically add to a float counter. Returns the new value. */
async function incrFloat(key, by) {
  if (!durable) { const v = (Number(mem.get(key)) || 0) + by; mem.set(key, String(v)); return v; }
  return Number(await redis(['INCRBYFLOAT', key, String(by)]));
}

/** Read a numeric counter and reset it to zero, atomically. The pair
 *  (incrFloat, takeNum) is a queue that cannot lose a deposit to a
 *  concurrent writer, which is the whole point. */
async function takeNum(key) {
  if (!durable) { const v = Number(mem.get(key)) || 0; mem.set(key, '0'); return v; }
  const v = await redis(['GETSET', key, '0']);
  return Number(v) || 0;
}

/* ---- atomic hash counters -------------------------------------
 *  A blob of totals read, mutated and written back loses one stake to
 *  another and, at a period boundary, can resurrect a pot that was just
 *  paid out in full. A Redis HASH fixes it without costing extra reads:
 *  HINCRBYFLOAT is atomic per field, and HGETALL still reads the whole
 *  thing in one round trip.
 * -------------------------------------------------------------- */
const hmem = key => { if (!mem.has('H' + key)) mem.set('H' + key, new Map()); return mem.get('H' + key); };

/** Atomically add to one field. Returns the new value. */
async function hincr(key, field, by) {
  if (!durable) { const h = hmem(key); const v = (h.get(field) || 0) + by; h.set(field, v); return v; }
  return Number(await redis(['HINCRBYFLOAT', key, field, String(by)]));
}

/** Every field, as an object of numbers. One round trip. */
async function hall(key) {
  if (!durable) return Object.fromEntries(hmem(key));
  const raw = await redis(['HGETALL', key]);
  const out = {};
  if (Array.isArray(raw)) { for (let i = 0; i < raw.length; i += 2) out[raw[i]] = Number(raw[i + 1]); }
  else if (raw && typeof raw === 'object') { for (const k of Object.keys(raw)) out[k] = Number(raw[k]); }
  return out;
}

/** Seed fields only if the hash does not exist yet. Returns true if WE seeded. */
async function hseed(key, obj) {
  if (!durable) {
    if (mem.has('H' + key)) return false;
    const h = hmem(key);
    for (const [f, v] of Object.entries(obj)) if (Number.isFinite(v)) h.set(f, v);
    return true;
  }
  if (await redis(['EXISTS', key])) return false;
  const flat = [];
  for (const [f, v] of Object.entries(obj)) if (Number.isFinite(v)) flat.push(f, String(v));
  if (flat.length) await redis(['HSET', key, ...flat]);
  return true;
}

/** List keys matching a Redis glob pattern. Used ONLY by the snapshot
 *  (the Black Box) — game logic never scans. Memory mode filters the Map. */
async function scanKeys(pattern) {
  if (!durable) {
    const rx = new RegExp('^' + pattern.split('*').map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
    return [...mem.keys()].filter(k => rx.test(k));
  }
  const out = []; let cursor = '0';
  for (let hops = 0; hops < 200; hops++) {           // hard bound: 200 pages
    const r = await redis(['SCAN', cursor, 'MATCH', pattern, 'COUNT', 500]);
    if (!Array.isArray(r) || r.length < 2) break;
    cursor = String(r[0]);
    for (const k2 of r[1] || []) out.push(k2);
    if (cursor === '0') break;
  }
  return out;
}

async function delKey(key) {
  try {
    if (!durable) { mem.delete(key); return; }
    await redis(['DEL', key]);
  } catch {}
}

module.exports = { getJSON, getJSONStrict, setJSON, setJSONEx, setnxJSON, delKey, scanKeys,
                   zincr, ztop, incrFloat, takeNum, hincr, hall, hseed, durable };
