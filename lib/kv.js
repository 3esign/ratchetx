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
// ============================================================
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const TOK_ = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
const durable = !!(URL_ && TOK_);

const mem = globalThis.__ratchet_mem || (globalThis.__ratchet_mem = new Map());

async function redis(cmd) {
  const r = await fetch(URL_, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOK_}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  if (!r.ok) throw new Error(`kv ${r.status}`);
  const j = await r.json();
  return j.result;
}

async function getJSON(key) {
  if (!durable) return mem.has(key) ? JSON.parse(mem.get(key)) : null;
  const v = await redis(['GET', key]);
  return v == null ? null : JSON.parse(v);
}
async function setJSON(key, val) {
  const s = JSON.stringify(val);
  if (!durable) { mem.set(key, s); return; }
  await redis(['SET', key, s]);
}
/** Set only if the key does not exist. Returns true if WE set it.
 *  This is the whole concurrency story for season settlement: many
 *  requests may notice the season rolled over at once; exactly one
 *  wins this lock and pays the pot; the rest walk away. */
async function setnxJSON(key, val) {
  const s = JSON.stringify(val);
  if (!durable) { if (mem.has(key)) return false; mem.set(key, s); return true; }
  return (await redis(['SET', key, s, 'NX'])) === 'OK';
}
module.exports = { getJSON, setJSON, setnxJSON, durable };
