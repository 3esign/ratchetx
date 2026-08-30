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
const crypto = require('node:crypto');
const { compareOrder, validateOrderedWrite } = require('./kv_order.js');

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
      if (!r.ok) {
        let detail = '';
        try {
          const body = await r.json();
          detail = String(body && body.error || '').replace(/[\r\n]+/g, ' ').slice(0, 180);
        } catch {}
        if (/daily request limit/i.test(detail))
          throw new Error('storage daily request limit reached');
        throw new Error(`kv ${r.status}${detail ? `: ${detail}` : ''}`);
      }
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
// ============================================================
//  PER-INSTANCE READ MEMO.
//
//  A single state request made 21 Redis reads. The page polls every six
//  seconds, so one open browser tab was 302,400 commands a day — a free
//  Upstash tier gone in 48 minutes, and a hard ceiling on ever having more
//  than a handful of people on the site at once.
//
//  Most of those reads are for things that barely change: the market cap, the
//  mint's program, yesterday's podium, the activity feed. Re-reading them ten
//  times a minute per visitor is pure waste.
//
//  RULES, because a stale read is a much worse bug than a slow one:
//    · Opt-in only. getJSON() is untouched; a caller must ask for getCached().
//    · NEVER for anything transactional — player records, credit queues,
//      replay gates, locks, the event log. Those stay strictly consistent.
//    · Every write invalidates the key here, so a read-after-write inside one
//      instance can never see the old value.
//    · Across instances the TTL bounds staleness. Keep TTLs at or under the
//      client's own poll interval and nobody can perceive it.
const rmemo = globalThis.__ratchet_rmemo || (globalThis.__ratchet_rmemo = new Map());
const RMEMO_MAX = 300;

/** Read with a short per-instance memo. Display data only. */
async function getCached(key, ttlMs) {
  const now = Date.now();
  const hit = rmemo.get(key);
  if (hit && now - hit.t < ttlMs) return hit.v;
  const v = await getJSON(key);
  if (rmemo.size >= RMEMO_MAX) rmemo.delete(rmemo.keys().next().value);
  rmemo.set(key, { v, t: now });
  return v;
}
/** Any write drops the memo for that key, so this instance can never serve
 *  a value it has already replaced. */
const rdrop = key => { if (rmemo.size) rmemo.delete(key); };

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

/** Strict batch read for immutable records such as log entries. One MGET
 * replaces hundreds of round trips without turning a backend outage into an
 * array of invented nulls. */
async function getManyJSON(keys) {
  if (!Array.isArray(keys) || !keys.length) return [];
  if (!durable) return keys.map(key => mem.has(key) ? JSON.parse(mem.get(key)) : null);
  const vals = await redis(['MGET', ...keys]);
  return (vals || []).map(parse);
}

async function setJSON(key, val) {
  rdrop(key);
  try {
    const s = JSON.stringify(val);
    if (!durable) { mem.set(key, s); return; }
    await redis(['SET', key, s]);
  } catch (e) {
    if (!durable) mem.set(key, JSON.stringify(val));
    else throw e;
  }
}

async function commitGuarded(input) {
  const g=require('./guarded_commit.js'),tx=g.prepare(input);
  for(const e of tx.entries) rdrop(e.key);
  for(const [key] of tx.debits) rdrop(key);
  if(!durable) return g.memoryCommit(mem,tx);
  const wire={...tx,entries:tx.entries.map(e=>({...e,expectedEncoded:JSON.stringify(e.expected),encoded:JSON.stringify(e.value)}))};
  const keys=[...new Set([g.receiptKey(tx.id),...tx.entries.map(e=>e.key),...tx.debits.map(d=>d[0]),...tx.leases.map(l=>l.key)])];
  return parse(await redis(['EVAL',g.LUA,String(keys.length),...keys,JSON.stringify(wire)]));
}

// New, isolated session records use revision CAS, not an expiring mutex.
// No TTL: expiring a revoked record could resurrect an old signed grant.
async function casPlaySession(key, expectedRevision, value) {
  require('./play_session_record.js').validateCAS(key, expectedRevision, value);
  const encoded = JSON.stringify(value);
  rdrop(key);
  if (!durable) {
    const current = mem.has(key) ? JSON.parse(mem.get(key)) : null;
    if (expectedRevision === null ? current !== null : current?.revision !== expectedRevision) return false;
    mem.set(key, encoded);
    return true;
  }
  const script = `
local current = redis.call('GET', KEYS[1])
if ARGV[1] == '' then
  if current then return 0 end
else
  if not current then return 0 end
  local old = cjson.decode(current)
  if old.revision ~= ARGV[1] then return 0 end
end
redis.call('SET', KEYS[1], ARGV[2])
return 1`;
  // A lost response is ambiguous. The caller must re-read its request ID;
  // retries cannot repeat the write because its expected revision has changed.
  return Number(await redis(['EVAL', script, '1', key, expectedRevision || '', encoded])) === 1;
}

/** Atomically replace several JSON keys. Redis executes the Lua script as
 * one transaction, so a multi-record game action cannot persist halfway. */
async function setManyJSONAtomic(entries) {
  if (!Array.isArray(entries) || !entries.length) return;
  const rows = entries.map(([key, val]) => [String(key), JSON.stringify(val)]);
  for (const [key] of rows) rdrop(key);
  if (!durable) {
    for (const [key, val] of rows) mem.set(key, val);
    return;
  }
  const script = "for i=1,#KEYS do redis.call('SET',KEYS[i],ARGV[i]) end return #KEYS";
  await redis(['EVAL', script, String(rows.length), ...rows.map(r => r[0]), ...rows.map(r => r[1])]);
}

/** setJSON with a TTL (durable backend only; memory mode just holds it).
 *  Used by the price log, where old hourly buckets must expire on their own
 *  rather than accumulate forever. */
async function setJSONEx(key, val, exSeconds) {
  rdrop(key);
  try {
    const s = JSON.stringify(val);
    if (!durable) { mem.set(key, s); return; }
    await redis(['SET', key, s, 'EX', String(exSeconds)]);
  } catch (e) {
    if (!durable) mem.set(key, JSON.stringify(val));
    else throw e;
  }
}

/** Atomically advance a JSON projection by an ordered tuple of integer clocks.
 * Older/equal arrivals neither overwrite the value nor refresh its TTL. */
async function setJSONIfNewer(key, value, fields, exSeconds) {
  validateOrderedWrite(key, value, fields, exSeconds);
  const encoded = JSON.stringify(value);
  rdrop(key);
  if (!durable) {
    const current = mem.has(key) ? JSON.parse(mem.get(key)) : null;
    if (current && compareOrder(value, current, fields) <= 0) return false;
    mem.set(key, encoded);
    return true;
  }
  const script = `
local current = redis.call('GET', KEYS[1])
if current then
  local old = cjson.decode(current)
  local incoming = cjson.decode(ARGV[1])
  local fields = cjson.decode(ARGV[2])
  local newer = false
  local function clock(v)
    if type(v) ~= 'number' and type(v) ~= 'string' then return 0 end
    local n = tonumber(v)
    if not n or n < 0 or n > 9007199254740991 or n ~= math.floor(n) then return 0 end
    return n
  end
  for _, field in ipairs(fields) do
    local a, b = clock(incoming[field]), clock(old[field])
    if a < b then return 0 end
    if a > b then newer = true; break end
  end
  if not newer then return 0 end
end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[3])
return 1`;
  return Number(await redis(['EVAL', script, '1', key, encoded,
    JSON.stringify(fields), String(exSeconds)])) === 1;
}

/** Set only if the key does not exist. Returns true if WE set it.
 *  This is the whole concurrency story for pot settlement and for the
 *  burn/anchor replay gates: many requests may race; exactly one wins.
 *  Optional exSeconds gives the key a TTL (durable backend only). */
async function setnxJSON(key, val, exSeconds) {
  rdrop(key);
  try {
    const s = JSON.stringify(val);
    if (!durable) { if (mem.has(key)) return false; mem.set(key, s); return true; }
    const cmd = exSeconds ? ['SET', key, s, 'EX', String(exSeconds), 'NX'] : ['SET', key, s, 'NX'];
    return (await redis(cmd)) === 'OK';
  } catch {
    return false;
  }
}

/** A short distributed lease with ownership-safe release.
 *
 * `SET NX` + unconditional `DEL` is subtly unsafe: if work outlives the TTL,
 * another process can acquire the key and the first process will then delete
 * the new owner's lock.  Returning an opaque token and deleting only when it
 * still matches closes that race. */
async function acquireLease(key, exSeconds = 30) {
  const token = `${Date.now()}-${crypto.randomBytes(16).toString('hex')}`;
  if (await setnxJSON(key, token, exSeconds)) return token;
  const existing = await getJSONStrict(key);
  if (typeof existing === 'string' && existing.includes('-')) {
    const timestamp = parseInt(existing.split('-')[0], 10);
    if (Date.now() - timestamp > (exSeconds * 1000) + 5000) {
      await releaseLease(key, existing);
      return await setnxJSON(key, token, exSeconds) ? token : null;
    }
  }
  return null;
}

async function releaseLease(key, token) {
  if (!token) return false;
  rdrop(key);
  const encoded = JSON.stringify(token);
  if (!durable) {
    if (mem.get(key) !== encoded) return false;
    mem.delete(key);
    return true;
  }
  const script = "if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end";
  return Number(await redis(['EVAL', script, '1', key, encoded])) === 1;
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

/** Raise a member to an observed absolute score, never lower it. This makes
 * one-time all-time-board backfills safe while live ZINCRBY writes continue. */
async function zmax(key, score, member) {
  if (!Number.isFinite(score)) return false;
  if (!durable) {
    const z = zmem(key), cur = z.get(String(member));
    if (cur != null && cur >= score) return false;
    z.set(String(member), score); return true;
  }
  const script = "local c=redis.call('ZSCORE',KEYS[1],ARGV[1]); " +
    "if (not c) or tonumber(ARGV[2])>tonumber(c) then redis.call('ZADD',KEYS[1],ARGV[2],ARGV[1]); return 1 end return 0";
  return Number(await redis(['EVAL', script, '1', key, String(member), String(score)])) === 1;
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

/** Atomically add several fields of one hash. Economic allocations must land
 * together: a timeout may not record the burn while omitting one pot leg. */
async function hincrMany(key, deltas) {
  const rows = Object.entries(deltas || {}).filter(([,v]) => Number.isFinite(v) && v !== 0);
  if (!rows.length) return;
  if (!durable) {
    const h = hmem(key);
    for (const [f,v] of rows) h.set(f, (h.get(f) || 0) + v);
    return;
  }
  const script = "for i=1,#ARGV,2 do redis.call('HINCRBYFLOAT',KEYS[1],ARGV[i],ARGV[i+1]) end return #ARGV/2";
  await redis(['EVAL', script, '1', key, ...rows.flatMap(([f,v]) => [f, String(v)])]);
}

/** Apply a replay-gated economic event in one transaction.
 *
 * The gate, all numeric queues, and all hash totals either appear together or
 * not at all. This is used for token reloads so a process death can never
 * consume a real burn signature before depositing the player's credits. */
async function applyOnce(gateKey, gateVal, { counters = [], hashKey = null,
  deltas = {}, exSeconds = null } = {}) {
  const cs = counters.filter(([,v]) => Number.isFinite(v) && v !== 0);
  const hs = Object.entries(deltas).filter(([,v]) => Number.isFinite(v) && v !== 0);
  rdrop(gateKey); for (const [k] of cs) rdrop(k); if (hashKey) rdrop(hashKey);
  const gateJson = JSON.stringify(gateVal);
  if (!durable) {
    if (mem.has(gateKey)) return false;
    mem.set(gateKey, gateJson);
    for (const [k,v] of cs) mem.set(k, String((Number(mem.get(k)) || 0) + v));
    if (hashKey) {
      const h = hmem(hashKey);
      for (const [f,v] of hs) h.set(f, (h.get(f) || 0) + v);
    }
    return true;
  }
  const keys = [gateKey, ...cs.map(x => x[0]), ...(hashKey ? [hashKey] : [])];
  const script = "if redis.call('EXISTS',KEYS[1])==1 then return 0 end " +
    "if tonumber(ARGV[2])>0 then redis.call('SET',KEYS[1],ARGV[1],'EX',ARGV[2]) else redis.call('SET',KEYS[1],ARGV[1]) end " +
    "local n=tonumber(ARGV[3]); local p=4; for i=1,n do redis.call('INCRBYFLOAT',KEYS[1+i],ARGV[p]); p=p+1 end " +
    "local m=tonumber(ARGV[p]); p=p+1; if m>0 then local hk=KEYS[2+n]; for i=1,m do redis.call('HINCRBYFLOAT',hk,ARGV[p],ARGV[p+1]); p=p+2 end end return 1";
  const args = [gateJson, String(exSeconds || 0), String(cs.length),
    ...cs.map(x => String(x[1])), String(hs.length), ...hs.flatMap(([f,v]) => [f, String(v)])];
  return Number(await redis(['EVAL', script, String(keys.length), ...keys, ...args])) === 1;
}

/** Replay-gated increments across several sorted sets.
 *
 * Settlement XP reaches both the daily and season ladders.  The player blob
 * and those boards cannot share one Redis key, so a retry after a process
 * interruption used to add the same hit twice.  This gate and every ZINCRBY
 * are one transaction; either both boards move once, or neither moves. */
async function zincrManyOnce(gateKey, gateVal, increments = [], exSeconds = null) {
  const rows = increments.filter(([key, member, by]) =>
    key && member && Number.isFinite(by) && by !== 0);
  rdrop(gateKey);
  const gateJson = JSON.stringify(gateVal);
  if (!durable) {
    if (mem.has(gateKey)) return false;
    mem.set(gateKey, gateJson);
    for (const [key, member, by] of rows) {
      const z = zmem(key);
      z.set(String(member), (z.get(String(member)) || 0) + by);
    }
    return true;
  }
  const keys = [gateKey, ...rows.map(r => String(r[0]))];
  const script = "if redis.call('EXISTS',KEYS[1])==1 then return 0 end " +
    "if tonumber(ARGV[2])>0 then redis.call('SET',KEYS[1],ARGV[1],'EX',ARGV[2]) else redis.call('SET',KEYS[1],ARGV[1]) end " +
    "local n=tonumber(ARGV[3]); local p=4; for i=1,n do redis.call('ZINCRBY',KEYS[1+i],ARGV[p+1],ARGV[p]); p=p+2 end return 1";
  const args = [gateJson, String(exSeconds || 0), String(rows.length),
    ...rows.flatMap(([,member,by]) => [String(member), String(by)])];
  return Number(await redis(['EVAL', script, String(keys.length), ...keys, ...args])) === 1;
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

/** Logical sorted-set keys for Black Box export. Memory mode stores these
 * under an internal Z prefix; durable Redis stores the logical key directly. */
async function scanZKeys(pattern) {
  if (durable) return scanKeys(pattern);
  const rx = new RegExp('^' + pattern.split('*')
    .map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
  return [...mem.keys()].filter(k => k.startsWith('Z') && rx.test(k.slice(1))).map(k => k.slice(1));
}
async function delKey(key) {
  rdrop(key);
  try {
    if (!durable) { mem.delete(key); return; }
    await redis(['DEL', key]);
  } catch {}
}

const redisApi = { getJSON, getCached, getJSONStrict, getManyJSON, setJSON, commitGuarded, casPlaySession, setManyJSONAtomic, setJSONEx, setJSONIfNewer, setnxJSON, acquireLease, releaseLease, applyOnce, delKey, scanKeys, scanZKeys,
                   zincr, zmax, zincrManyOnce, ztop, incrFloat, takeNum, hincr, hincrMany, hall, hseed, durable, backend:durable ? 'upstash' : 'memory',
                   sweepExpired: async () => 0 };   // Redis TTLs expire keys natively; only Postgres needs a sweeper
// Supabase is opt-in and server-only. Until both variables are present the
// deployed game follows the exact existing Upstash/memory path, which makes
// rollout and rollback an environment switch instead of a code fork.
const supabaseApi = require('./supabase_kv.js');
module.exports = supabaseApi.enabled ? supabaseApi : redisApi;
