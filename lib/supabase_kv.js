'use strict';

// Supabase/Postgres implementation of lib/kv.js' public contract.
// Enabled only when both server-side variables exist. The service key must
// never be exposed to the browser; this module is required by Vercel APIs only.
const crypto = require('node:crypto');
const URL_ = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const TOK_ = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const enabled = !!(URL_ && TOK_);
const durable = enabled;
const backend = enabled ? 'supabase' : null;

const memo = globalThis.__ratchet_supa_memo || (globalThis.__ratchet_supa_memo = new Map());
const MEMO_MAX = 300;
const drop = key => { if (memo.size) memo.delete(key); };

async function rpc(name, args = {}, retries = 1) {
  let last;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(`${URL_}/rest/v1/rpc/${name}`, {
        method: 'POST',
        headers: {
          apikey: TOK_, Authorization: `Bearer ${TOK_}`,
          'Content-Type': 'application/json', Accept: 'application/json',
        },
        signal: AbortSignal.timeout(5000),
        body: JSON.stringify(args),
      });
      const text = await response.text();
      let body = null;
      try { body = text ? JSON.parse(text) : null; } catch {}
      if (!response.ok) {
        const detail = String(body && (body.message || body.details || body.hint) || text || '')
          .replace(/[\r\n]+/g, ' ').slice(0, 220);
        const error = new Error(`supabase ${response.status}${detail ? `: ${detail}` : ''}`);
        error.status = response.status;
        throw error;
      }
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
  return rpc('ratchet_kv_get', { p_key:String(key) });
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
      await delKey(key);
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

module.exports = { enabled, durable, backend, getJSON, getCached, getJSONStrict, getManyJSON,
  setJSON, setManyJSONAtomic, setJSONEx, setnxJSON, acquireLease, releaseLease,
  applyOnce, delKey, scanKeys, scanZKeys, zincr, zmax, zincrManyOnce, ztop,
  incrFloat, takeNum, hincr, hincrMany, hall, hseed };
