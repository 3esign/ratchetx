// The live snapshot: what it reads, what it writes down, and what it refuses to
// decide.
//
// The migration root is a claim about who owns what, and until now the only way
// to build one was from a rescue file taken while the game was off the air. This
// tool reads the store the game is actually using. Because it stands between the
// live ledger and a permanent on-chain claim, three properties matter more than
// its features: it never writes, it never judges, and what it writes down stays
// true after it is written.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeRedis, scanPlayers, readRows, census } from '../tools/live_snapshot.mjs';

let checks = 0;
const ok = (cond, label) => { checks++; assert.ok(cond, label); };

// A store that records every command it is asked to run.
function fakeStore(rows, { ttls = {} } = {}) {
  const sent = [];
  let page = 0;
  const pages = [Object.keys(rows).slice(0, 2), Object.keys(rows).slice(2)];
  const redis = async command => {
    sent.push(command[0]);
    if (command[0] === 'SCAN') {
      const out = pages[page] || [];
      const cursor = page + 1 < pages.length ? String(page + 1) : '0';
      page++;
      return [cursor, out];
    }
    if (command[0] === 'MGET') return command.slice(1).map(k => rows[k] ?? null);
    if (command[0] === 'PTTL') return ttls[command[1]] ?? -1;
    throw new Error('unexpected command ' + command[0]);
  };
  return { redis, sent };
}

const WALLET = 'HXFDaHyZ3i477z1BakiTWZg9UQN8rcreruuv9ifC1HvM';
const base = {
  ['u:' + WALLET]: JSON.stringify({ cr: 100, xp: 20 }),
  'u:demo-1ff': JSON.stringify({ cr: 5, xp: 0 }),
  'u:BBB': JSON.stringify({ cr: 7, xp: 2, open: [{ stake: 50, exp: 1788442687103 }] }),
};

// ---- 1. it reads, and only reads -----------------------------------------
{
  const { redis, sent } = fakeStore(base);
  const keys = await scanPlayers(redis);
  await readRows(redis, keys);
  const allowed = new Set(['SCAN', 'MGET', 'PTTL']);
  ok(sent.every(c => allowed.has(c)),
    'a snapshot of the live ledger may send SCAN, MGET and PTTL and nothing else — it sent: ' + [...new Set(sent)].join(','));
  ok(sent.includes('SCAN') && !sent.includes('KEYS'),
    'SCAN, never KEYS: this runs against the store a live game is using');
}

// ---- 2. paging is followed to the end ------------------------------------
{
  const { redis } = fakeStore(base);
  const keys = await scanPlayers(redis);
  ok(keys.length === 3, 'every page of the cursor is followed, not just the first');
  assert.deepEqual(keys, [...keys].sort(), 'keys come back ordered, so two honest runs agree');
}

// ---- 3. a TTL is written as an instant, not as a duration ----------------
{
  const now = 1788400000000;
  const { redis } = fakeStore(base, { ttls: { 'u:BBB': 60000 } });
  const keys = await scanPlayers(redis);
  const rows = await readRows(redis, keys, { now });
  const bbb = rows.find(([k]) => k === 'u:BBB');
  ok(bbb[2] === new Date(now + 60000).toISOString(),
    'a relative TTL stops being true the moment it is written to a file, so it is stored as an absolute instant');
  const permanent = rows.find(([k]) => k === 'u:' + WALLET);
  ok(permanent[2] === null, 'a row with no expiry is recorded as having none, not as expiring now');
}

// ---- 4. a row that vanished between SCAN and MGET is dropped, not nulled --
{
  const { redis } = fakeStore({ ...base, 'u:GONE': null });
  const keys = await scanPlayers(redis);
  const rows = await readRows(redis, keys);
  ok(!rows.some(([k]) => k === 'u:GONE'),
    'a key that disappeared between SCAN and MGET must not become a row with a null value');
}

// ---- 5. the census answers the only question that decides the timing -----
{
  const { redis } = fakeStore(base);
  const rows = await readRows(redis, await scanPlayers(redis));
  const c = census(rows);
  assert.equal(c.players, 3);
  assert.equal(c.demo, 1, 'demo rows are counted so the operator is not surprised by the exclusion later');
  assert.equal(c.openShots, 1);
  assert.equal(c.openStake, 50, 'stake in flight is in nobody\'s cr — a root taken now is short by exactly this');
  assert.equal(c.latestExpiry, 1788442687103, 'and the operator is told WHEN the wait ends, not just that there is one');
  checks += 5;
}

// ---- 6. it decides nothing about who becomes a leaf ----------------------
{
  const src = readFileSync(new URL('../tools/live_snapshot.mjs', import.meta.url), 'utf8');
  ok(!/isDemo|base58|leafOf|merkle/i.test(src.replace(/^\/\/.*$/gm, '')),
    'every rule about who becomes a leaf lives in legacy_root.mjs; a snapshot tool with opinions is a second source of truth');
  ok(/private-snapshots/.test(src),
    'the output is every player\'s balance and belongs in the private folder, never the repository');
}

console.log(`PASS  live snapshot: ${checks} checks — reads only, pages fully, records instants, decides nothing`);
