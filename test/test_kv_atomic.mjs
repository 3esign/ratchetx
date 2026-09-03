// Exercises the new primitives against BOTH backends: the in-memory Map and a
// fake Upstash REST endpoint that implements real Redis semantics. The fake
// backend is what proves the COMMANDS are built and parsed correctly — the
// part that can't be checked without a server.
import assert from 'node:assert';
import { createRequire } from 'node:module';

const Z = new Map(), S = new Map(), H = new Map();
globalThis.fetch = async (_u, opts) => {
  const cmd = JSON.parse(opts.body);
  const [op, key, ...rest] = cmd;
  let result = null;
  if (op === 'ZINCRBY') {
    const z = Z.get(key) || new Map(); Z.set(key, z);
    const v = (z.get(rest[1]) || 0) + Number(rest[0]); z.set(rest[1], v); result = String(v);
  } else if (op === 'EVAL' && String(key).includes("redis.call('ZSCORE'")) {
    const zkey = rest[1], member = rest[2], score = Number(rest[3]);
    const z = Z.get(zkey) || new Map(); Z.set(zkey, z);
    const cur = z.get(member);
    if (cur == null || score > cur) { z.set(member, score); result = 1; }
    else result = 0;
  } else if (op === 'ZREVRANGE') {
    const z = [...(Z.get(key) || new Map()).entries()].sort((a,b)=>b[1]-a[1]);
    const stop = Number(rest[1]);
    const rows = stop === -1 ? z : z.slice(0, stop + 1);
    result = rows.flatMap(([m,sc]) => [m, String(sc)]);
  } else if (op === 'INCRBYFLOAT') {
    const v = (Number(S.get(key)) || 0) + Number(rest[0]); S.set(key, String(v)); result = String(v);
  } else if (op === 'EVAL' && String(key).includes("redis.call('ZINCRBY'")) {
    const nkeys = Number(rest[0]);
    const keys = rest.slice(1, 1 + nkeys), args = rest.slice(1 + nkeys);
    if (S.has(keys[0])) result = 0;
    else {
      S.set(keys[0], args[0]);
      const n = Number(args[2]); let p = 3;
      for (let i=0; i<n; i++) {
        const member = args[p++], by = Number(args[p++]);
        const z = Z.get(keys[1+i]) || new Map(); Z.set(keys[1+i], z);
        z.set(member, (z.get(member) || 0) + by);
      }
      result = 1;
    }
  } else if (op === 'EVAL' && String(key).includes("redis.call('EXISTS',KEYS[1])")) {
    const nkeys = Number(rest[0]);
    const keys = rest.slice(1, 1 + nkeys), args = rest.slice(1 + nkeys);
    if (S.has(keys[0])) result = 0;
    else {
      S.set(keys[0], args[0]);
      const n = Number(args[2]); let p = 3;
      for (let i=0;i<n;i++,p++) S.set(keys[1+i], String((Number(S.get(keys[1+i]))||0) + Number(args[p])));
      const m = Number(args[p++]);
      if (m) {
        const hk = keys[1+n], h = H.get(hk) || new Map(); H.set(hk,h);
        for (let i=0;i<m;i++) { const f=args[p++], by=Number(args[p++]); h.set(f,(h.get(f)||0)+by); }
      }
      result = 1;
    }
  } else if (op === 'HGETALL') {
    result = [...(H.get(key) || new Map()).entries()].flatMap(([f,v])=>[f,String(v)]);
  } else if (op === 'GETSET') {
    result = S.has(key) ? S.get(key) : null; S.set(key, rest[0]);
  } else if (op === 'SET') { S.set(key, rest[0]); result = 'OK'; }
  else if (op === 'GET') { result = S.has(key) ? S.get(key) : null; }
  return { ok: true, json: async () => ({ result }) };
};

async function run(label, durableMode) {
  if (durableMode) { process.env.KV_REST_API_URL = 'https://fake'; process.env.KV_REST_API_TOKEN = 'x'; }
  else { delete process.env.KV_REST_API_URL; delete process.env.KV_REST_API_TOKEN;
         delete process.env.UPSTASH_REDIS_REST_URL; delete process.env.UPSTASH_REDIS_REST_TOKEN; }
  const require = createRequire(import.meta.url);
  for (const k of Object.keys(require.cache)) delete require.cache[k];
  globalThis.__ratchet_mem = new Map();
  const kv = require('../lib/kv.js');
  assert.equal(kv.durable, !!durableMode, label + ': durable flag');

  // --- concurrent increments must ALL land ---
  const N = 50;
  await Promise.all(Array.from({length:N}, () => kv.zincr('z:lbtest', 10, 'alice')));
  const top = await kv.ztop('z:lbtest', 5);
  assert.deepEqual(top, [['alice', N*10]], `${label}: expected 500, got ${JSON.stringify(top)}`);

  // --- ordering + top-N ---
  await kv.zincr('z:lbtest', 900, 'bob');
  await kv.zincr('z:lbtest', 300, 'carol');
  await kv.zincr('z:lbtest', 50,  'dave');
  const t3 = await kv.ztop('z:lbtest', 3);
  assert.deepEqual(t3.map(r=>r[0]), ['bob','alice','carol'], label + ': descending top-3');
  const all = await kv.ztop('z:lbtest');
  assert.equal(all.length, 4, label + ': full range');
  assert.equal(typeof all[0][1], 'number', label + ': scores are numbers');

  // --- absolute backfill can only raise a live score, never overwrite it ---
  assert.equal(await kv.zmax('z:lbtest', 400, 'alice'), false, label + ': lower backfill ignored');
  assert.equal(await kv.zmax('z:lbtest', 800, 'alice'), true, label + ': higher observed total lands');
  assert.equal(await kv.zmax('z:lbtest', 700, 'alice'), false, label + ': later stale total cannot step it back');
  assert.equal((await kv.ztop('z:lbtest')).find(x=>x[0]==='alice')[1], 800,
    label + ': monotonic backfill ends on the maximum');

  // --- the credit queue: deposits cannot be lost, and a take is exclusive ---
  await Promise.all(Array.from({length:20}, () => kv.incrFloat('pend:w', 100)));
  const takes = await Promise.all([kv.takeNum('pend:w'), kv.takeNum('pend:w'), kv.takeNum('pend:w')]);
  assert.equal(takes.reduce((a,b)=>a+b,0), 2000, `${label}: 20x100 deposited, ${takes} taken`);
  assert.equal(takes.filter(v=>v>0).length, 1, label + ': exactly one taker gets it');
  assert.equal(await kv.takeNum('pend:w'), 0, label + ': drained key reads 0');
  assert.equal(await kv.takeNum('pend:never-seen'), 0, label + ': missing key reads 0, not NaN');

  // --- a replay gate and every economic leg are one operation ---
  const once = await kv.applyOnce('sig:abc', {w:'alice'}, {
    counters:[['pend:alice',700],['c7:bob',300]], hashKey:'h:stats',
    deltas:{realBurned:700,champPaid:300},
  });
  const replay = await kv.applyOnce('sig:abc', {w:'alice'}, {
    counters:[['pend:alice',700],['c7:bob',300]], hashKey:'h:stats',
    deltas:{realBurned:700,champPaid:300},
  });
  assert.equal(once,true,label + ': first signature applies');
  assert.equal(replay,false,label + ': replay is refused');
  assert.equal(await kv.takeNum('pend:alice'),700,label + ': player credit landed exactly once');
  assert.equal(await kv.takeNum('c7:bob'),300,label + ': champion leg landed exactly once');
  assert.deepEqual(await kv.hall('h:stats'),{realBurned:700,champPaid:300},label + ': totals landed in the same operation');

  // --- one settlement moves both ladders once, even under retry pressure ---
  const ladderWins = await Promise.all(Array.from({length:20}, () =>
    kv.zincrManyOnce('ladder:alice:shot-1', {shot:'shot-1'}, [
      ['z:season-once','alice',7], ['z:day-once','alice',7],
    ])));
  assert.equal(ladderWins.filter(Boolean).length, 1, label + ': one ladder replay gate wins');
  assert.deepEqual(await kv.ztop('z:season-once'), [['alice',7]], label + ': season XP applied once');
  assert.deepEqual(await kv.ztop('z:day-once'), [['alice',7]], label + ': daily XP applied once');
  assert.equal(await kv.zincrManyOnce('ladder:alice:shot-1', {shot:'shot-1'}, [
    ['z:season-once','alice',7], ['z:day-once','alice',7],
  ]), false, label + ': later ladder replay refused');
  console.log(`${label.padEnd(9)} atomic counters, hashes and ladders OK`);
}

await run('memory', false);
await run('durable', true);
console.log('\nALL PASS');
