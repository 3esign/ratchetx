// Exercises the new primitives against BOTH backends: the in-memory Map and a
// fake Upstash REST endpoint that implements real Redis semantics. The fake
// backend is what proves the COMMANDS are built and parsed correctly — the
// part that can't be checked without a server.
import assert from 'node:assert';
import { createRequire } from 'node:module';

const Z = new Map(), S = new Map();
globalThis.fetch = async (_u, opts) => {
  const cmd = JSON.parse(opts.body);
  const [op, key, ...rest] = cmd;
  let result = null;
  if (op === 'ZINCRBY') {
    const z = Z.get(key) || new Map(); Z.set(key, z);
    const v = (z.get(rest[1]) || 0) + Number(rest[0]); z.set(rest[1], v); result = String(v);
  } else if (op === 'ZREVRANGE') {
    const z = [...(Z.get(key) || new Map()).entries()].sort((a,b)=>b[1]-a[1]);
    const stop = Number(rest[1]);
    const rows = stop === -1 ? z : z.slice(0, stop + 1);
    result = rows.flatMap(([m,sc]) => [m, String(sc)]);
  } else if (op === 'INCRBYFLOAT') {
    const v = (Number(S.get(key)) || 0) + Number(rest[0]); S.set(key, String(v)); result = String(v);
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
  const kv = require('./lib/kv.js');
  assert.equal(kv.durable, !!durableMode, label + ': durable flag');

  // --- concurrent increments must ALL land ---
  const N = 50;
  await Promise.all(Array.from({length:N}, () => kv.zincr('lbtest', 10, 'alice')));
  const top = await kv.ztop('lbtest', 5);
  assert.deepEqual(top, [['alice', N*10]], `${label}: expected 500, got ${JSON.stringify(top)}`);

  // --- ordering + top-N ---
  await kv.zincr('lbtest', 900, 'bob');
  await kv.zincr('lbtest', 300, 'carol');
  await kv.zincr('lbtest', 50,  'dave');
  const t3 = await kv.ztop('lbtest', 3);
  assert.deepEqual(t3.map(r=>r[0]), ['bob','alice','carol'], label + ': descending top-3');
  const all = await kv.ztop('lbtest');
  assert.equal(all.length, 4, label + ': full range');
  assert.equal(typeof all[0][1], 'number', label + ': scores are numbers');

  // --- the credit queue: deposits cannot be lost, and a take is exclusive ---
  await Promise.all(Array.from({length:20}, () => kv.incrFloat('pend:w', 100)));
  const takes = await Promise.all([kv.takeNum('pend:w'), kv.takeNum('pend:w'), kv.takeNum('pend:w')]);
  assert.equal(takes.reduce((a,b)=>a+b,0), 2000, `${label}: 20x100 deposited, ${takes} taken`);
  assert.equal(takes.filter(v=>v>0).length, 1, label + ': exactly one taker gets it');
  assert.equal(await kv.takeNum('pend:w'), 0, label + ': drained key reads 0');
  assert.equal(await kv.takeNum('pend:never-seen'), 0, label + ': missing key reads 0, not NaN');
  console.log(`${label.padEnd(9)} zincr/ztop/incrFloat/takeNum OK`);
}

await run('memory', false);
await run('durable', true);
console.log('\nALL PASS');
