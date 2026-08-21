// The observatory publishes claims about someone else's infrastructure on a
// public URL. It has to render from real stored samples, degrade honestly
// when there are none, and never state a number it did not measure.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

globalThis.__ratchet_mem = new Map();
const kv = require('../lib/kv.js');
const { bucketKey } = require('../lib/pxlog.js');
const feeds = require('../api/feeds.js');

let fails = 0;
const ok = (c, n) => { console.log((c ? 'PASS  ' : 'FAIL  ') + n); if (!c) fails++; };
const call = q => new Promise(r => {
  const res = { _s: 200, _h: {}, setHeader(k, v) { this._h[k.toLowerCase()] = v; },
    status(c) { this._s = c; return this; },
    end(b) { r({ status: this._s, body: String(b), h: this._h }); },
    json(o) { r({ status: this._s, body: JSON.stringify(o), json: o, h: this._h }); } };
  feeds({ query: q }, res);
});

// ---- empty first: the page must exist before any data does ----
let r = await call({});
ok(r.status === 200, 'renders with no samples at all');
ok(/OUR SAMPLING DUTY/.test(r.body), 'and still leads with OUR duty cycle, not theirs');
ok(/LIMITS/.test(r.body), 'and still ships its limits');
ok(!/NaN|undefined|null%/.test(r.body), 'no NaN / undefined / null% leaks into the page');

// ---- now with a real record ----
const now = Date.now();
const H0 = Math.floor(now / 3600e3) * 3600e3;
const rows = [];
for (let i = 0; i < 40; i++) {
  const t = H0 + i * 60_000;
  if (t > now) break;
  const pub = Math.floor(t / 1000) - 3;
  const row = { t, src: 'pyth-onchain', SOL: 200 + i * 0.05, BTC: 60000, ETH: 3000,
    ag: { SOL: 3, BTC: 4, ETH: 6 }, cf: { SOL: 1.4, BTC: 0.9, ETH: 1.1 },
    pt: { SOL: pub, BTC: pub, ETH: pub - 1 } };
  if (i % 10 === 0) row.cb = { SOL: 200 + i * 0.05 + 0.4 };
  rows.push(row);
}
if (rows.length) await kv.setJSONEx(bucketKey(rows[0].t), rows, 9999);

r = await call({ hours: '1' });
ok(r.status === 200, 'renders with a record');
ok(/SOL/.test(r.body) && /BTC/.test(r.body), 'every feed gets a row');
ok(/solscan\.io\/account\//.test(r.body), 'each feed links to the account it was read from');
ok(/PriceUpdateV2/.test(r.body), 'the decode is named so it can be reproduced');
ok(/action=path/.test(r.body), 'and the raw samples behind the numbers are linked');
// The reproduce link is the single most important thing on this page: it is
// the difference between "trust our statistics" and "here are the samples".
// It shipped once as ?a=path, which this endpoint does not answer.
ok(!/[?&]a=path/.test(r.body), 'and the link uses the parameter name the API actually answers to');
ok(!/NaN|undefined/.test(r.body), 'no NaN / undefined with real data either');

// ---- JSON must carry the same numbers, and be CORS-open ----
r = await call({ format: 'json', hours: '1' });
ok(r.json && r.json.ok === true, 'JSON form answers');
ok(r.h['access-control-allow-origin'] === '*', 'JSON is CORS-open — the point is that others can read it');
ok(Array.isArray(r.json.limits) && r.json.limits.length >= 4, 'the limits travel with the JSON, not only the HTML');
ok(r.json.feeds && r.json.feeds.SOL, 'per-feed block present');
ok(typeof r.json.ourDutyPct === 'number', 'our own duty cycle is in the payload');
ok(r.json.windowHours === 1, 'the window it used is stated');

// ---- a nonsense window is corrected, and LABELLED as corrected ----
r = await call({ format: 'json', hours: '9999' });
ok(r.json.windowHours === 72, '9999h clamps to 72h');
r = await call({ hours: '9999' });
ok(/72H WINDOW/.test(r.body), 'and the page says 72h, never the number that was asked for');
ok(!/9999/.test(r.body), 'the unclamped number never appears anywhere on the page');

// ---- A BROKEN RECORD MUST FAIL VISIBLY, NOT RENDER A CONFIDENT BLANK ----
// This is the one that matters most. getJSON() returns null on a backend
// failure, so a naive observatory would render "0 samples, 0 stale windows"
// — a flattering and false claim about Pyth — precisely when it was blind.
{
  const kvPath = require.resolve('../lib/kv.js');
  const realKv = require.cache[kvPath];
  for (const k of Object.keys(require.cache)) delete require.cache[k];
  require.cache[kvPath] = { id: kvPath, filename: kvPath, loaded: true, exports: {
    getJSONStrict: async () => { throw new Error('kv exploded'); },
    getJSON: async () => null,
    hall: async () => { throw new Error('kv exploded'); },
    hincr: async () => {}, setJSONEx: async () => {}, setJSON: async () => {},
  } };
  const blind = require('../api/feeds.js');
  const r2 = await new Promise(res2 => {
    const rr = { _s: 200, setHeader() {}, status(c) { this._s = c; return this; },
      end(b) { res2({ status: this._s, body: String(b) }); },
      json(o) { res2({ status: this._s, body: JSON.stringify(o) }); } };
    blind({ query: {} }, rr);
  });
  ok(r2.status === 503, 'a read failure returns 503, not a page of zeroes');
  ok(/could not read/i.test(r2.body), 'and says so, naming the failure');
  ok(!/0 of/.test(r2.body) && !/SAMPLING DUTY/.test(r2.body), 'and publishes no statistics at all while blind');
  for (const k of Object.keys(require.cache)) delete require.cache[k];
  require.cache[kvPath] = realKv;
}

console.log(fails ? `\n${fails} FAILED` : '\nOBSERVATORY OK');
process.exit(fails ? 1 : 0);
