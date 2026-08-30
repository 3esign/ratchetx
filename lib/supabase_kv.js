'use strict';

// Supabase/Postgres implementation of lib/kv.js' public contract.
// Enabled only when both server-side variables exist. The service key must
// never be exposed to the browser; this module is required by Vercel APIs only.
const crypto = require('node:crypto');
const { compareOrder, validateOrderedWrite } = require('./kv_order.js');
const { serverHeaders } = require('./supabase_auth.js');
const URL_ = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const TOK_ = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const enabled = !!(URL_ && TOK_);
const durable = enabled;
const backend = enabled ? 'supabase' : null;

const memo = globalThis.__ratchet_supa_memo || (globalThis.__ratchet_supa_memo = new Map());
const MEMO_MAX = 300;
const drop = key => { if (memo.size) memo.delete(key); };

async function rpc(name, args = {}, retries = 1, requireJson = false) {
  let last;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(`${URL_}/rest/v1/rpc/${name}`, {
        method: 'POST', redirect: 'error',
        headers: {
          ...serverHeaders(TOK_),
          'Content-Type': 'application/json', Accept: 'application/json',
        },
        signal: AbortSignal.timeout(5000),
        body: JSON.stringify(args),
      });
      const text = await response.text();
      let body = null, parsed = false;
      try { body = JSON.parse(text); parsed = true; } catch {}
      if (!response.ok) {
        const detail = String(body && (body.message || body.details || body.hint) || text || '')
          .replace(/[\r\n]+/g, ' ').slice(0, 220);
        const error = new Error(`supabase ${response.status}${detail ? `: ${detail}` : ''}`);
        error.status = response.status;
        throw error;
      }
      // A strict read must distinguish a real JSON null (missing row) from
      // an unreadable successful response. Void writer RPCs keep their contract.
      if (requireJson && !parsed) throw new Error('supabase invalid JSON response');
      return body;
    } catch (error) {
      last = error;
      if (attempt === retries || (error.status && error.status < 500)) break;
      await new Promise(resolve => setTimeout(resolve, 75 * (attempt + 1)));
    }
  }
  throw last;
}

async function getJSONStrict(key) {
  return rpc('ratchet_kv_get', { p_key:String(key) }, 1, true);
}
async function getJSON(key) {
  try { return await getJSONStrict(key); } catch { return null; }
}
async function getCached(key, ttlMs) {
  const now = Date.now(), hit = memo.get(key);
  if (hit && now - hit.t < ttlMs) return hit.v;
  const value = await getJSON(key);
  if (memo.size >= MEMO_MAX) memo.delete(memo.keys().next().value);
  memo.set(key, { v:value, t:now });
  return value;
}
async function getManyJSON(keys) {
  if (!Array.isArray(keys) || !keys.length) return [];
  return (await rpc('ratchet_kv_mget', { p_keys:keys.map(String) })) || [];
}
async function setJSON(key, value) {
  drop(key);
  await rpc('ratchet_kv_set', { p_key:String(key), p_value:value, p_ex_seconds:null });
}
async function commitGuarded(input) {
  const tx=require('./guarded_commit.js').prepare(input);
  for(const e of tx.entries) drop(e.key);
  for(const [key] of tx.debits) drop(key);
  return rpc('ratchet_kv_commit_guarded',{p_tx:tx});
}
async function setJSONEx(key, value, exSeconds) {
  drop(key);
  await rpc('ratchet_kv_set', { p_key:String(key), p_value:value,
    p_ex_seconds:Math.max(1, Math.floor(exSeconds)) });
}
async function setManyJSONAtomic(entries) {
  if (!Array.isArray(entries) || !entries.length) return;
  for (const [key] of entries) drop(key);
  await rpc('ratchet_kv_set_many', { p_entries:entries.map(([key,value]) => [String(key), value]) });
}
// Existing service-role table permissions suffice: no migration or new SQL RPC.
// Every PATCH contains a compare-and-swap predicate evaluated by Postgres under
// its row lock. A concurrent winner invalidates the predicate; retry from a new
// read, never fall back to an unconditional write. This is atomic per key.
async function orderedRequest(method, query, body = null, preference = '') {
  const response = await fetch(`${URL_}/rest/v1/ratchet_kv?${query}`, {
    method, redirect: 'error',
    headers:{...serverHeaders(TOK_), 'Content-Type':'application/json',
      Accept:'application/json', Prefer:'return=representation' + (preference ? ',' + preference : '')},
    signal:AbortSignal.timeout(5000),
    ...(body == null ? {} : {body:JSON.stringify(body)}),
  });
  if (!response.ok) throw new Error(`supabase ordered write ${response.status}`);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error('invalid ordered write response');
  return rows;
}
async function casPlaySession(key, expectedRevision, value) {
  require('./play_session_record.js').validateCAS(key, expectedRevision, value);
  // Query only the random revision, not the whole (potentially large) ledger.
  // These keys are new, permanent records; no legacy/expired-row fallback.
  const body = {key, value, expires_at:null, updated_at:new Date().toISOString()};
  drop(key);
  const rows = expectedRevision === null
    ? await orderedRequest('POST', new URLSearchParams({on_conflict:'key',select:'key'}),
      body, 'resolution=ignore-duplicates')
    : await orderedRequest('PATCH', new URLSearchParams({key:'eq.' + key, select:'key',
      'value->>revision':'eq.' + expectedRevision, expires_at:'is.null'}), body);
  return rows.length === 1;
}
async function setJSONIfNewer(key, value, fields, exSeconds) {
  validateOrderedWrite(key, value, fields, exSeconds);
  // Freeze input across awaits, just as JSON encoding does for the Redis path.
  value = JSON.parse(JSON.stringify(value));
  drop(key);
  for (let attempt = 0; attempt < 5; attempt++) {
    const query = new URLSearchParams({key:'eq.' + key, select:'value,expires_at,updated_at'});
    const [current] = await orderedRequest('GET', query);
    const now = Date.now();
    const expired = current && current.expires_at != null && Date.parse(current.expires_at) <= now;
    if (current && !expired && compareOrder(value, current.value, fields) <= 0) return false;
    const replacement = {key, value, expires_at:new Date(now + exSeconds*1000).toISOString(),
      updated_at:new Date(now).toISOString()};
    let written;
    if (current) {
      const guard = new URLSearchParams({key:'eq.' + key, select:'key',
        value:'eq.' + JSON.stringify(current.value),
        updated_at:'eq.' + current.updated_at,
        expires_at:current.expires_at == null ? 'is.null' : 'eq.' + current.expires_at});
      written = await orderedRequest('PATCH', guard, replacement);
    } else {
      written = await orderedRequest('POST', new URLSearchParams({on_conflict:'key',select:'key'}),
        replacement, 'resolution=ignore-duplicates');
    }
    if (written.length) { drop(key); return true; }
  }
  throw new Error('ordered write contention; retry capture');
}
async function setnxJSON(key, value, exSeconds) {
  drop(key);
  return !!(await rpc('ratchet_kv_setnx', { p_key:String(key), p_value:value,
    p_ex_seconds:exSeconds ? Math.max(1, Math.floor(exSeconds)) : null }));
}
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
  drop(key);
  return !!(await rpc('ratchet_kv_release', { p_key:String(key), p_token:token }));
}
async function delKey(key) {
  drop(key);
  try { await rpc('ratchet_kv_del', { p_key:String(key) }); } catch {}
}
async function scanKeys(pattern) {
  return (await rpc('ratchet_kv_scan', { p_pattern:String(pattern) })) || [];
}
const scanZKeys = scanKeys;

async function incrFloat(key, by) {
  drop(key);
  return Number(await rpc('ratchet_kv_incr', { p_key:String(key), p_by:Number(by) }));
}
async function takeNum(key) {
  drop(key);
  return Number(await rpc('ratchet_kv_take', { p_key:String(key) })) || 0;
}
async function hincr(key, field, by) {
  drop(key);
  return Number(await rpc('ratchet_kv_hincr', {
    p_key:String(key), p_field:String(field), p_by:Number(by),
  }));
}
async function hincrMany(key, deltas) {
  const clean = Object.fromEntries(Object.entries(deltas || {})
    .filter(([,value]) => Number.isFinite(value) && value !== 0));
  if (!Object.keys(clean).length) return;
  drop(key);
  await rpc('ratchet_kv_hincr_many', { p_key:String(key), p_deltas:clean });
}
async function hall(key) {
  return (await rpc('ratchet_kv_hall', { p_key:String(key) })) || {};
}
async function hseed(key, obj) {
  drop(key);
  return !!(await rpc('ratchet_kv_hseed', { p_key:String(key), p_value:obj || {} }));
}
async function zincr(key, by, member) {
  drop(key);
  return Number(await rpc('ratchet_kv_zincr', {
    p_key:String(key), p_member:String(member), p_by:Number(by),
  }));
}
async function zmax(key, score, member) {
  if (!Number.isFinite(score)) return false;
  drop(key);
  return !!(await rpc('ratchet_kv_zmax', {
    p_key:String(key), p_member:String(member), p_score:Number(score),
  }));
}
async function ztop(key, n) {
  const rows = await rpc('ratchet_kv_ztop', {
    p_key:String(key), p_limit:n == null ? null : Math.max(0, Math.floor(n)),
  });
  return (rows || []).map(row => [String(row[0]), Number(row[1])]);
}
async function applyOnce(gateKey, gateVal, { counters = [], hashKey = null,
  deltas = {}, exSeconds = null } = {}) {
  drop(gateKey); for (const [key] of counters) drop(key); if (hashKey) drop(hashKey);
  return !!(await rpc('ratchet_kv_apply_once', {
    p_gate_key:String(gateKey), p_gate_value:gateVal,
    p_counters:counters.map(([key,value]) => [String(key), Number(value)]),
    p_hash_key:hashKey ? String(hashKey) : null, p_deltas:deltas || {},
    p_ex_seconds:exSeconds ? Math.max(1, Math.floor(exSeconds)) : null,
  }));
}
async function zincrManyOnce(gateKey, gateVal, increments = [], exSeconds = null) {
  drop(gateKey); for (const [key] of increments) drop(key);
  return !!(await rpc('ratchet_kv_zincr_many_once', {
    p_gate_key:String(gateKey), p_gate_value:gateVal,
    p_increments:increments.map(([key,member,by]) => [String(key), String(member), Number(by)]),
    p_ex_seconds:exSeconds ? Math.max(1, Math.floor(exSeconds)) : null,
  }));
}

// Expired rows are invisible to every read but were never deleted, so the
// table only ever grew. One instance per hour wins a short lease and deletes
// bounded batches via ratchet_kv_sweep (002_ratchet_kv_sweep.sql). Missing
// SQL function or any failure is harmless: callers guard, readers already
// ignore expired rows, and the next hour retries.
let sweepAt = 0;
async function sweepExpired() {
  const now = Date.now();
  if (now - sweepAt < 3600_000) return 0;
  sweepAt = now;
  if (!(await setnxJSON('lock:kv:sweep', { t: now }, 3300))) return 0;
  let total = 0;
  for (let i = 0; i < 8; i++) {
    const n = Number(await rpc('ratchet_kv_sweep', { p_limit: 500 })) || 0;
    total += n;
    if (n < 500) break;
  }
  return total;
}

module.exports = { enabled, durable, backend, getJSON, getCached, getJSONStrict, getManyJSON, casPlaySession, commitGuarded,
  setJSON, setManyJSONAtomic, setJSONEx, setJSONIfNewer, setnxJSON, acquireLease, releaseLease,
  applyOnce, delKey, scanKeys, scanZKeys, zincr, zmax, zincrManyOnce, ztop,
  incrFloat, takeNum, hincr, hincrMany, hall, hseed, sweepExpired };
