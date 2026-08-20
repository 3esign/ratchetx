// The black box only promises one thing: changing any past event changes
// every hash after it. These tests are the two ways that promise used to
// break — a flaky read re-basing the chain to genesis, and a concurrent
// append silently dropping an event that the verifier then certified.
import assert from 'node:assert';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const fresh = () => {
  for (const k of Object.keys(require.cache)) delete require.cache[k];
  globalThis.__ratchet_mem = new Map();
  return require('./lib/log.js');
};
const kvOf = () => require('./lib/kv.js');

// ---- 1. sequential appends chain and verify ----
{
  const log = fresh();
  for (let i = 0; i < 12; i++) await log.append({ k: 'test', n: i });
  const kv = kvOf();
  const entries = await kv.getJSON('g:log:c:0');
  const head = await kv.getJSON('g:log:head');
  const n = await log.logCount();
  assert.equal(n, 12, 'counter tracks appends');
  const v = log.verifyChain(entries, head, n);
  assert.ok(v.ok, 'chain verifies: ' + JSON.stringify(v));
  console.log('12 sequential appends -> chain ok, head i=' + head.i);
}

// ---- 2. THE RESET: a null head must never re-base the chain to genesis ----
{
  const log = fresh();
  for (let i = 0; i < 5; i++) await log.append({ k: 'test', n: i });
  const kv = kvOf();
  globalThis.__ratchet_mem.delete('g:log:head');       // simulate a flaky read
  const h2 = await log.append({ k: 'after-outage' });
  assert.equal(h2.i, 6, `index continued at ${h2.i}, must not restart at 1`);
  assert.equal(await log.logCount(), 6, 'counter is the source of truth');
  console.log('head lost mid-life -> next index still 6, chain not re-based');
}

// ---- 3. CONCURRENT appends must not collide on an index ----
{
  const log = fresh();
  await log.append({ k: 'seed' });
  const res = await Promise.all(Array.from({ length: 25 }, (_, i) => log.append({ k: 'burst', i })));
  const idx = res.map(r => r.i).sort((a, b) => a - b);
  assert.equal(new Set(idx).size, 25, 'every concurrent append got a unique index');
  assert.deepEqual(idx, Array.from({ length: 25 }, (_, i) => i + 2), 'indices are gapless');
  assert.equal(await log.logCount(), 26, 'counter matches');
  console.log('25 concurrent appends -> 25 unique gapless indices, none overwritten');
}

// ---- 4. a DROPPED entry must be reported, not certified ----
{
  const log = fresh();
  for (let i = 0; i < 8; i++) await log.append({ k: 'test', n: i });
  const kv = kvOf();
  const entries = await kv.getJSON('g:log:c:0');
  const head = await kv.getJSON('g:log:head');
  const n = await log.logCount();
  assert.ok(log.verifyChain(entries, head, n).ok, 'baseline ok');

  const short = entries.slice(0, 7);                   // one event vanishes from storage
  const blind = log.verifyChain(short, { i: 7, h: short[6].h });   // old-style check
  assert.ok(blind.ok, 'without the witness a truncated chain still looks fine — the old bug');
  const seen = log.verifyChain(short, { i: 7, h: short[6].h }, n);
  assert.equal(seen.ok, false, 'with the counter the loss is caught');
  assert.match(seen.reason, /8 issued, 7 stored/);
  console.log('dropped entry: old check says ok, counter-aware check says ->', seen.reason);
}

// ---- 5. tampering is still caught ----
{
  const log = fresh();
  for (let i = 0; i < 6; i++) await log.append({ k: 'test', n: i });
  const kv = kvOf();
  const entries = await kv.getJSON('g:log:c:0');
  const head = await kv.getJSON('g:log:head');
  entries[2].ev.n = 999;                               // rewrite history
  const v = log.verifyChain(entries, head, await log.logCount());
  assert.equal(v.ok, false); assert.equal(v.brokenAt, 3);
  console.log('tampered entry 3 -> caught at index', v.brokenAt, '(' + v.reason + ')');
}

// ---- 6. MIGRATION: a live legacy log must continue, not restart ----
{
  const log = fresh();
  const kv = kvOf();
  await kv.setJSON('g:log:head', { i: 198, h: 'a'.repeat(64) });   // production, pre-upgrade
  const r = await log.append({ k: 'first-after-deploy' });
  assert.equal(r.i, 199, `continued at ${r.i}, must not restart the live chain`);
  assert.equal(await log.logCount(), 199, 'counter seeded from the legacy head');
  console.log('legacy head at 198 -> next entry is 199, history preserved');
}

console.log('\nALL PASS');
