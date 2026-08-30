'use strict';

// Cosmetic projection only. No balances, settlements or event-log entries are
// written here. House Fleet events have their own Arena/log and cannot consume
// player retention. Ranked external-agent wallets remain ordinary players.
const kv = require('./kv.js');
const { isDemo, isWalletShaped } = require('./verify.js');
const KEY = 'g:feed:players:v2';
const LEGACY_KEY = 'g:feed';
const LOCK = 'lock:g:feed';
const LIMIT = 100;
const RECOVERY_WINDOW = 1000;
const shortW = w => w.slice(0,4) + '…' + w.slice(-4);
const number = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;

function mergeRows(primary, recovered = []) {
  const seen = new Set(), rows = [];
  for (const row of [...primary, ...recovered]) {
    if (!row || row.agent || typeof row.a !== 'string' || typeof row.w !== 'string') continue;
    const identity = row.id || (row.sig && /^ANCHORED/.test(row.a) ? `anchor:${row.sig}` : null)
      || JSON.stringify([row.t,row.w,row.a]);
    if (seen.has(identity)) continue;
    seen.add(identity); rows.push(row);
  }
  return rows.sort((a,b)=>(Number(b.t)||0)-(Number(a.t)||0)).slice(0,LIMIT);
}

// Render only facts actually retained in an event. A historical HIT has XP but
// may not contain its credit payout: do not infer that payout from today's rule.
// Seal rows never expose side/salt, even if an old input accidentally contains it.
function rowFromEvent(entry) {
  const e = entry && entry.ev;
  if (!e || e.agent || !isWalletShaped(e.w) || isDemo(e.w)
      || !Number.isSafeInteger(entry.i) || !number(entry.t)) return null;
  const row = {t:entry.t,w:shortW(e.w),source:'event-log',logIndex:entry.i};
  if (e.k === 'seal' && typeof e.id === 'string' && number(e.stake))
    return {...row,id:`seal:${e.w}:${e.id}`,a:`sealed a shot - ${e.stake} credits`,c:'seal'};
  if (e.k === 'settle' && typeof e.id === 'string' && ['hit','miss','void'].includes(e.res)) {
    const xp = number(e.xp) ? ` +${e.xp} XP` : '';
    return {...row,id:`settle:${e.w}:${e.id}`,a:`${e.res.toUpperCase()}${xp} - settled shot`,c:e.res};
  }
  if (e.k === 'reload' && typeof e.sig === 'string') {
    let a = number(e.burned) ? `BURNED ${e.burned.toLocaleString('en-US')} RCX` : 'RELOADED RCX';
    if (number(e.champs) && e.champs) a += ` - ${e.champs.toLocaleString('en-US')} RCX paid to other champions`;
    if (number(e.retained) && e.retained) a += ` - ${e.retained.toLocaleString('en-US')} RCX stayed with this champion`;
    if (number(e.credited)) a += ` - ${e.credited.toLocaleString('en-US')} credits`;
    return {...row,id:`reload:${e.sig}`,a,c:'seal',sig:e.sig};
  }
  if (e.k === 'anchor' && typeof e.sig === 'string' && Number.isSafeInteger(e.i))
    return {...row,id:`anchor:${e.sig}`,a:`ANCHORED the log on-chain - entry #${e.i}`,c:'hit',sig:e.sig};
  return null;
}

async function recoverRows() {
  const head = await kv.getJSONStrict('g:log:head');
  const end = head && head.i;
  if (!Number.isSafeInteger(end) || end < 1) return [];
  const start = Math.max(1,end-RECOVERY_WINDOW+1), found = new Map();
  const chunks = [];
  for (let c=Math.floor((start-1)/500);c<=Math.floor((end-1)/500);c++) chunks.push(`g:log:c:${c}`);
  for (const chunk of await kv.getManyJSON(chunks))
    for (const e of Array.isArray(chunk) ? chunk : [])
      if (e && Number.isSafeInteger(e.i) && e.i>=start && e.i<=end) found.set(e.i,e);
  // Immutable per-index entries override legacy chunks, exactly as log export.
  for (let from=start;from<=end;from+=500) {
    const count = Math.min(500,end-from+1);
    const entries = await kv.getManyJSON(Array.from({length:count},(_,i)=>`g:log:e:${from+i}`));
    entries.forEach((e,i)=>{if(e && e.i===from+i) found.set(e.i,e);});
  }
  return [...found.values()].map(rowFromEvent).filter(Boolean);
}

async function loadUnderLease() {
  const current = await kv.getJSONStrict(KEY);
  if (Array.isArray(current)) return mergeRows(current);
  const legacy = await kv.getJSONStrict(LEGACY_KEY);
  return mergeRows(Array.isArray(legacy) ? legacy : [], await recoverRows());
}

async function save(rows) {
  // The legacy mirror keeps rollback/snapshot compatibility. Old deployments
  // can still overwrite that mirror, but cannot clobber the versioned source.
  await kv.setManyJSONAtomic([[KEY,rows],[LEGACY_KEY,rows]]);
}

async function readFeed() {
  const current = await kv.getCached(KEY,3000);
  if (Array.isArray(current)) return mergeRows(current);
  let lease;
  try {
    lease = await kv.acquireLease(LOCK,15);
    if (lease) {
      const rows = await loadUnderLease();
      await save(rows);
      return rows;
    }
  } catch {
    // Failed recovery is not an empty successful migration. Keep the legacy
    // display and retry on the next request; no marker or partial write lands.
  } finally {
    if (lease) { try { await kv.releaseLease(LOCK,lease); } catch {} }
  }
  const legacy = await kv.getCached(LEGACY_KEY,3000);
  return mergeRows(Array.isArray(legacy) ? legacy : []);
}

async function bumpFeed(entry) {
  if (!entry || entry.agent) return false;
  const lease = await kv.acquireLease(LOCK,15);
  if (!lease) return false;
  try {
    const rows = await loadUnderLease();
    if (entry.id && rows.some(row=>row.id===entry.id)) { await save(rows); return false; }
    await save(mergeRows([{t:Date.now(),...entry},...rows]));
    return true;
  } finally {
    try { await kv.releaseLease(LOCK,lease); } catch {}
  }
}

module.exports = {readFeed,bumpFeed,rowFromEvent,mergeRows,KEY,LIMIT,RECOVERY_WINDOW};
