#!/usr/bin/env node
// Copy RATCHET's complete logical KV state into an EMPTY Supabase ratchet_kv
// table. Source data is never changed or deleted. Active lock:* leases are
// deliberately excluded; they are process coordination, not game history.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const REDIS_URL = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/$/, '');
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
const SUPA_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPA_TOKEN = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const CHECK = process.argv.includes('--check');
const FORCE = process.argv.includes('--force');
if (!REDIS_URL || !REDIS_TOKEN || !SUPA_URL || !SUPA_TOKEN) {
  console.error('Need KV_REST_API_URL, KV_REST_API_TOKEN, SUPABASE_URL and SUPABASE_SERVICE_KEY.');
  process.exit(2);
}

const stable = value => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
};
const digest = rows => crypto.createHash('sha256')
  .update(JSON.stringify(stable(rows))).digest('hex');
const parseString = value => {
  if (value == null) return null;
  try { return JSON.parse(value); } catch { return value; }
};

async function redis(command) {
  const response = await fetch(REDIS_URL, {
    method:'POST', headers:{ Authorization:`Bearer ${REDIS_TOKEN}`, 'Content-Type':'application/json' },
    signal:AbortSignal.timeout(8000), body:JSON.stringify(command),
  });
  const text = await response.text(); let body = null;
  try { body = JSON.parse(text); } catch {}
  if (!response.ok || body?.error) throw new Error(`Upstash ${response.status}: ${body?.error || text}`);
  return body.result;
}
async function redisPipeline(commands, batchSize = 200) {
  const out = [];
  for (let i = 0; i < commands.length; i += batchSize) {
    const batch = commands.slice(i, i + batchSize);
    const response = await fetch(`${REDIS_URL}/pipeline`, {
      method:'POST', headers:{ Authorization:`Bearer ${REDIS_TOKEN}`, 'Content-Type':'application/json' },
      signal:AbortSignal.timeout(15000), body:JSON.stringify(batch),
    });
    if (response.status === 404) {
      out.push(...await Promise.all(batch.map(redis)));
      continue;
    }
    const text = await response.text(); let body = null;
    try { body = JSON.parse(text); } catch {}
    if (!response.ok || !Array.isArray(body)) throw new Error(`Upstash pipeline ${response.status}: ${text}`);
    for (const item of body) {
      if (item?.error) throw new Error(`Upstash pipeline: ${item.error}`);
      out.push(item?.result);
    }
  }
  return out;
}
async function supa(name, args = {}) {
  const response = await fetch(`${SUPA_URL}/rest/v1/rpc/${name}`, {
    method:'POST', headers:{ apikey:SUPA_TOKEN, Authorization:`Bearer ${SUPA_TOKEN}`,
      'Content-Type':'application/json', Accept:'application/json' },
    signal:AbortSignal.timeout(15000), body:JSON.stringify(args),
  });
  const text = await response.text(); let body = null;
  try { body = text ? JSON.parse(text) : null; } catch {}
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${body?.message || text}`);
  return body;
}
async function targetKeys() {
  const keys = (await supa('ratchet_kv_scan', { p_pattern:'*' })) || [];
  return keys.map(String).filter(key => !key.startsWith('lock:')).sort();
}
async function deleteTargetKeys(keys) {
  for (let i = 0; i < keys.length; i += 20)
    await Promise.all(keys.slice(i, i + 20).map(key => supa('ratchet_kv_del', { p_key:key })));
}

async function sourceKeys() {
  const out = []; let cursor = '0';
  for (let page = 0; page < 1000; page++) {
    const result = await redis(['SCAN', cursor, 'MATCH', '*', 'COUNT', '500']);
    cursor = String(result?.[0] ?? '0');
    for (const key of result?.[1] || []) if (!String(key).startsWith('lock:')) out.push(String(key));
    if (cursor === '0') break;
  }
  return [...new Set(out)].sort();
}
async function readRows(keys) {
  const metaRaw = await redisPipeline(keys.flatMap(key => [['TYPE', key], ['PTTL', key]]));
  const meta = [];
  for (let i = 0; i < keys.length; i++) {
    const type = metaRaw[i * 2], ttl = Number(metaRaw[i * 2 + 1]);
    if (ttl === -2 || type === 'none') continue;
    if (!['string','hash','zset'].includes(type))
      throw new Error(`Unsupported Redis type ${type} at ${keys[i]}; refusing partial migration.`);
    meta.push({ key:keys[i], type, ttl });
  }
  const raw = await redisPipeline(meta.map(({ key, type }) => type === 'string' ? ['GET', key]
    : type === 'hash' ? ['HGETALL', key] : ['ZRANGE', key, '0', '-1', 'WITHSCORES']));
  return meta.map((row, i) => {
    let value = raw[i];
    if (row.type === 'string') value = parseString(value);
    else {
      const flat = value || []; value = {};
      for (let j = 0; j < flat.length; j += 2) {
        const n = Number(flat[j + 1]);
        value[flat[j]] = row.type === 'zset' || Number.isFinite(n) ? n : flat[j + 1];
      }
    }
    return { key:row.key, value,
      expiresAt:row.ttl > 0 ? new Date(Date.now() + row.ttl).toISOString() : null };
  });
}

console.log('Reading source key index (read-only)...');
const keys = await sourceKeys();
const rows = await readRows(keys);
const sourceHash = digest(rows.map(({ key, value }) => ({ key, value })));
const targetCount = Number(await supa('ratchet_kv_count'));
console.log(`Source: ${rows.length} persistent keys · sha256 ${sourceHash}`);
console.log(`Target: ${targetCount} live keys`);
if (CHECK) { console.log('check-only: no rows written.'); process.exit(0); }
if (targetCount && !FORCE) {
  console.error('Target is not empty. Refusing to merge two live machines. Use --force only after a reviewed recovery plan.');
  process.exit(1);
}
if (targetCount && FORCE) {
  const wanted = new Set(rows.map(row => row.key));
  const extras = (await targetKeys()).filter(key => !wanted.has(key));
  await deleteTargetKeys(extras);
  console.log(`Removed ${extras.length} target-only persistent keys before overwrite.`);
}

const backupDir = path.resolve('backups');
fs.mkdirSync(backupDir, { recursive:true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = path.join(backupDir, `ratchet-upstash-${stamp}.json`);
fs.writeFileSync(backup, JSON.stringify({ v:1, t:Date.now(), sourceHash, rows }, null, 2));
console.log(`Local migration backup written: ${backup}`);

let imported = 0;
for (let i = 0; i < rows.length; i += 100) {
  imported += Number(await supa('ratchet_kv_import_rows', {
    p_rows:rows.slice(i, i + 100), p_overwrite:FORCE,
  }));
  console.log(`  imported ${Math.min(i + 100, rows.length)}/${rows.length}`);
}
if (!FORCE && imported !== rows.length) throw new Error(`Imported ${imported}/${rows.length}; refusing cutover.`);

const expectedKeys = rows.map(row => row.key).sort();
const copiedKeys = await targetKeys();
if (JSON.stringify(copiedKeys) !== JSON.stringify(expectedKeys))
  throw new Error(`TARGET KEYSET MISMATCH (${copiedKeys.length}/${expectedKeys.length}). Do not cut over Vercel.`);

const copied = [];
for (let i = 0; i < rows.length; i += 100) {
  const batch = rows.slice(i, i + 100);
  const values = await supa('ratchet_kv_mget', { p_keys:batch.map(row => row.key) });
  for (let j = 0; j < batch.length; j++) copied.push({ key:batch[j].key, value:values[j] });
}
const targetHash = digest(copied);
console.log(`Target verification sha256 ${targetHash}`);
if (targetHash !== sourceHash) throw new Error('SOURCE/TARGET HASH MISMATCH. Do not cut over Vercel.');
console.log(`MIGRATION VERIFIED: ${rows.length} keys copied; Upstash source untouched.`);
