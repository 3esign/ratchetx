// The obligations snapshot is the input to a distribution of real balances, and
// it can never be re-taken once the store moves or resets. So the one thing it
// must not do is quietly change what it copied.
//
// It did. `readRows` parsed every value and the writer re-serialised it, and
// JSON.parse/stringify rounds any integer past 2^53: 9007199254740993 comes back
// as ...992. A digest over that file would be a digest of something the store
// never held, and nobody would ever know, because the number that changed is
// still a plausible number.
//
// This test pins the fix: the raw store string travels with every row, and the
// tool COUNTS the rows that would drift instead of hiding them.
import assert from 'node:assert/strict';
import { readRows, fidelityReport, sha256File, SNAPSHOT_TOOL_VERSION } from '../tools/live_snapshot.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BIG = '9007199254740993';                 // 2^53 + 1, survives only as text
const RAW_BIG = `{"cr":${BIG},"open":[]}`;
const RAW_PLAIN = '{"cr":42,"open":[]}';
const RAW_SPACED = '{"cr": 7,  "open": []}';    // formatting the store chose, not ours

function stubRedis(rows, ttls = {}) {
  return async function redis(command) {
    const [verb, ...args] = command;
    if (verb === 'MGET') return args.map(k => (k in rows ? rows[k] : null));
    if (verb === 'PTTL') return ttls[args[0]] ?? -1;
    throw new Error('unexpected command ' + verb);
  };
}

// 1. The raw string survives byte for byte, including a value JSON cannot hold.
{
  const store = { 'u:a': RAW_BIG, 'u:b': RAW_PLAIN, 'u:c': RAW_SPACED };
  const rows = await readRows(stubRedis(store), ['u:a', 'u:b', 'u:c']);
  assert.equal(rows.length, 3);
  for (const [key, , , raw] of rows) {
    assert.equal(raw, store[key], `raw string for ${key} must be byte-identical to the store`);
  }
  // and the proof that this matters: the parsed value has already lost it
  const [, parsedBig] = rows.find(r => r[0] === 'u:a');
  assert.notEqual(String(parsedBig.cr), BIG, 'precondition: JSON parsing does lose 2^53+1');
  assert.equal(String(parsedBig.cr), '9007199254740992', 'and it loses it in exactly this way');
}

// 2. The drift is counted and named, not swallowed.
{
  const store = { 'u:a': RAW_BIG, 'u:b': RAW_PLAIN, 'u:c': RAW_SPACED };
  const rows = await readRows(stubRedis(store), ['u:a', 'u:b', 'u:c']);
  const report = fidelityReport(rows);
  assert.equal(report.reserialised, 2, 'the big number and the spaced row both drift');
  assert.ok(report.examples.includes('u:a'), 'the drifting rows are named');
  assert.ok(report.examples.includes('u:c'));
  // a row that round-trips exactly is not reported
  assert.ok(!report.examples.includes('u:b'));
}

// 3. A store row that is not JSON at all is kept as text, not dropped.
{
  const store = { 'u:x': 'not json at all' };
  const rows = await readRows(stubRedis(store), ['u:x']);
  assert.equal(rows[0][3], 'not json at all', 'unparsable rows keep their bytes');
  assert.equal(rows[0][1], 'not json at all', 'and are handed on as the string they are');
}

// 4. Rows that vanished between SCAN and MGET are skipped, not written as null.
{
  const rows = await readRows(stubRedis({ 'u:a': RAW_PLAIN }), ['u:a', 'u:gone']);
  assert.equal(rows.length, 1);
  assert.equal(rows[0][0], 'u:a');
}

// 5. The digest is over the file as written, and it changes when the file does.
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rx-snap-'));
  const f = path.join(dir, 'a.ndjson');
  fs.writeFileSync(f, '["u:a",{"cr":1},null]\n');
  const first = sha256File(f);
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.equal(first, sha256File(f), 'stable for an unchanged file');
  fs.writeFileSync(f, '["u:a",{"cr":2},null]\n');
  assert.notEqual(first, sha256File(f), 'and it moves when one credit does');
}

// 6. The tool stamps a version, so a manifest can say which code produced it.
assert.match(SNAPSHOT_TOOL_VERSION, /^\d{4}-\d{2}-\d{2}\.\d+$/);

console.log('OK  snapshot fidelity: raw bytes preserved, drift counted, digests stable');
