// The public dataset endpoint. Formats, paging headers, CORS, and the one
// rule that outranks all of them: an open shot's side never leaves the server.
import assert from 'node:assert';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

globalThis.__ratchet_mem = new Map();
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const log = require('./lib/log.js');
const api = require('./api/record.js');
const W = 'HXFDaHyZ3i477z1BakiTWZg9UQN8rcreruuv9ifC1HvM';

let fails = 0;
const ok = (c, n) => { console.log((c ? 'PASS  ' : 'FAIL  ') + n); if (!c) fails++; };
const call = q => new Promise(done => {
  const res = { _s: 200, _h: {}, setHeader(k, v) { this._h[k.toLowerCase()] = v; },
    status(c) { this._s = c; return this; },
    end(b) { done({ status: this._s, body: String(b), h: this._h }); },
    json(o) { done({ status: this._s, body: JSON.stringify(o), json: o, h: this._h }); } };
  api({ query: q }, res);
});

for (let i = 0; i < 6; i++) {
  const side = i % 2 ? 'YES' : 'NO', salt = 'ab'.repeat(8) + i;
  await log.append({ k: 'seal', w: W, id: 'r' + i, feed: 'SOL', stake: 500,
    exp: Date.now() + 300e3, entry: 100, commit: sha(`${side}|${salt}`) });
  await log.append({ k: 'settle', w: W, id: 'r' + i, res: i % 3 ? 'hit' : 'miss',
    exitPx: 101, exitAt: Date.now(), side, salt, commit: sha(`${side}|${salt}`) });
}
// and one that is still open — its side must never appear
await log.append({ k: 'seal', w: W, id: 'SECRET', feed: 'BTC', stake: 9999,
  exp: Date.now() + 999e3, entry: 60000, commit: sha('YES|zzzz') });

let r = await call({});
ok(r.status === 200, 'the landing page renders');
ok(/THE RECORD/.test(r.body), 'and names itself');
ok(/ratchet-record-v1/.test(r.body), 'publishes the pseudonym salt');
ok(/public domain/i.test(r.body), 'states the licence');
ok(/action=path/.test(r.body) || /DATASET\.md/.test(r.body), 'points at how to reproduce a row');
ok(!/SECRET/.test(r.body), 'the open shot is nowhere on the page');

r = await call({ format: 'ndjson', limit: '3' });
ok(r.h['content-type'].includes('x-ndjson'), 'ndjson content type');
ok(r.h['access-control-allow-origin'] === '*', 'CORS open — the dataset is meant to be taken');
ok(r.h['x-ratchet-cursor'] != null, 'the cursor travels in a header too');
const lines = r.body.trim().split('\n');
ok(lines.length === 3, 'limit honoured (' + lines.length + ')');
ok(lines.every(l => { try { JSON.parse(l); return true; } catch { return false; } }), 'every line parses');
ok(!/SECRET/.test(r.body), 'no open shot in ndjson');
ok(!r.body.includes(W), 'no raw wallet in ndjson');

r = await call({ format: 'csv', limit: '4' });
ok(r.h['content-type'].includes('text/csv'), 'csv content type');
ok(r.body.split('\n')[0].startsWith('schema,i,id,who,agent,feed'), 'csv header is the published order');
ok(!/SECRET/.test(r.body), 'no open shot in csv');

r = await call({ format: 'json', limit: '2' });
ok(r.json.ok === true, 'json form answers');
ok(r.json.rows.length === 2, 'json honours limit');
ok(r.json.chain && typeof r.json.chain.issued === 'number', 'the chain head and issued count travel with the data');
ok(r.json.rows.every(x => x.commitVerified === true), 'every exported commitment recomputes');

// paging must terminate and cover everything
{
  let after = 0, seen = [], guard = 0;
  while (guard++ < 20) {
    const p = await call({ format: 'json', limit: '2', after: String(after) });
    if (!p.json.rows.length) break;
    seen.push(...p.json.rows.map(x => x.id));
    if (p.json.cursor === after) break;
    after = p.json.cursor;
  }
  ok(seen.length === 6, `paging covered all 6 settled rows (${seen.length})`);
  ok(new Set(seen).size === seen.length, 'with no duplicates');
  ok(!seen.includes('SECRET'), 'and never the open one');
}

// a store failure must not answer with an empty dataset
{
  const kvPath = require.resolve('./lib/kv.js');
  const realKv = require.cache[kvPath];
  for (const k of Object.keys(require.cache)) delete require.cache[k];
  require.cache[kvPath] = { id: kvPath, filename: kvPath, loaded: true, exports: {
    getJSON: async () => { throw new Error('kv down'); }, setJSON: async () => {},
    setJSONEx: async () => {}, incrFloat: async () => { throw new Error('kv down'); } } };
  const blind = require('./api/record.js');
  const r2 = await new Promise(done => {
    const res = { _s: 200, setHeader() {}, status(c) { this._s = c; return this; },
      end(b) { done({ status: this._s, body: String(b) }); },
      json(o) { done({ status: this._s, body: JSON.stringify(o), json: o }); } };
    blind({ query: { format: 'json' } }, res);
  });
  ok(r2.status === 503, 'a read failure is a 503, not an empty dataset that looks complete');
  for (const k of Object.keys(require.cache)) delete require.cache[k];
  require.cache[kvPath] = realKv;
}

console.log(fails ? `\n${fails} FAILED` : '\nRECORD API OK');
process.exit(fails ? 1 : 0);
