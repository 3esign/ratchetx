// The Black Box, walkable. The whole-state export stopped being fetchable as
// the log grew, which quietly hollowed out the resurrection promise. These
// assertions are about that promise, not about pagination mechanics.
import http from 'node:http';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
const require = createRequire(import.meta.url);
let pass = 0, failn = 0;
const ok = (c, l) => { if (c) { pass++; console.log('PASS  ' + l); } else { failn++; console.log('FAIL  ' + l); } };

globalThis.__ratchet_mem = new Map();
const log = require('../lib/log.js');
const api = require('../api/log.js');
const kv = require('../lib/kv.js');
const sha = s => crypto.createHash('sha256').update(s).digest('hex');

for (let n = 1; n <= 12; n++) await log.append({ k: 'test', n, w: 'W' });

const srv = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const fake = { method: 'GET', query: Object.fromEntries(u.searchParams), headers: {}, socket: {} };
  const out = { _s: 200, status(c) { this._s = c; return this; },
    json(o) { res.writeHead(this._s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); },
    setHeader() {}, end(t) { res.end(t); } };
  await api(fake, out);
});
await new Promise(r => srv.listen(8341, r));
const get = qs => fetch(`http://127.0.0.1:8341/?${qs}`).then(r => r.json());

// 1. a page arrives, and says how to get the next one
const p1 = await get('after=0&limit=5');
ok(p1.ok && p1.entries.length === 5, `a page of five arrives (${p1.entries && p1.entries.length})`);
ok(p1.entries[0].i === 1 && p1.entries[4].i === 5, 'the page starts where it was asked to');
ok(p1.next === 5, 'and hands back the cursor for the next page');
ok(p1.issued === 12 && p1.head && p1.head.i === 12,
   'every page carries the issued count and the head, so a partial download is detectable');

// 2. walking the whole log in pages reaches every entry
let cursor = 0, walked = [];
for (let guard = 0; guard < 20; guard++) {
  const page = await get(`after=${cursor}&limit=5`);
  walked.push(...page.entries);
  if (page.next == null) break;
  cursor = page.next;
}
ok(walked.length === 12, `walking in pages reaches the whole log (${walked.length}/12)`);

// 3. the chain verifies across a page boundary — the point of the exercise
let h = sha('ratchet-genesis'), chainOk = true;
for (const e of walked) {
  const body = { i: e.i, t: e.t, ev: e.ev, ...(e.c ? { c: e.c } : {}) };
  const { canon } = require('../lib/canon.js');
  const recomputed = e.c ? sha(h + canon(body)) : sha(h + JSON.stringify(body));
  if (e.h !== recomputed) { chainOk = false; break; }
  h = recomputed;
}
ok(chainOk, 'entries walked in pages still recompute into one continuous chain');

// 4. one entry by index — the cheapest way to check a single claim
const single = await get('i=7');
ok(single.ok && single.entry && single.entry.i === 7, 'a single entry can be fetched by index');
const gone = await get('i=999');
ok(gone.ok === true && gone.entry === null && /issued/.test(gone.note || ''),
   'an index with nothing stored answers null and says to compare with issued');

// 5. LEGACY CHUNKS COUNT. Old entries live only in the 500-entry chunk blobs;
// reading just the per-index keys reported the whole early history as missing.
// An endpoint whose job is to make gaps visible must not invent them.
{
  const legacy = { i: 20, t: 5, ev: { k: 'old', n: 20 }, h: 'f'.repeat(64) };
  await kv.setJSON('g:log:c:0', [legacy]);          // chunk 0 holds 1..500
  await kv.setJSON('g:log:n', 20);
  const page = await get('after=19&limit=1');
  ok(page.count === 1 && page.entries[0] && page.entries[0].i === 20,
     'an entry that exists ONLY in a legacy chunk is returned, not reported missing');
  const byIndex = await get('i=20');
  ok(byIndex.entry && byIndex.entry.i === 20, 'and the same entry is reachable by index');
  await kv.setJSON('g:log:c:0', []);
  await kv.setJSON('g:log:n', 12);
}

// 6. a gap inside a window is REPORTED, not smoothed over
await kv.delKey('g:log:e:4');
const holed = await get('after=0&limit=12');
ok(holed.count === 11 && holed.missingInRange === 1,
   `a missing index inside the window is counted, not hidden (count=${holed.count}, missing=${holed.missingInRange})`);
ok(!holed.entries.some(e => e.i === 4), 'and the absent entry is simply absent, never fabricated');

// 7. limits are bounded so one caller cannot ask for everything again
const huge = await get('after=0&limit=99999');
ok(huge.range.to - huge.range.from + 1 <= 2000, 'an oversized limit is capped rather than honoured');

console.log(`\n${pass} passed, ${failn} failed`);
process.exitCode = failn ? 1 : 0;
srv.closeAllConnections?.();
await new Promise(r => srv.close(() => r()));
setTimeout(() => process.exit(process.exitCode || 0), 3000).unref();
