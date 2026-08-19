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

module.exports = { getJSON, getJSONStrict, setJSON, setnxJSON, delKey, scanKeys, durable };
