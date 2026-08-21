// The proof page must show a settled shot in full AND never leak an open one.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const crypto = await import('node:crypto');

const pricesPath = require.resolve('../lib/prices.js');
require.cache[pricesPath] = { id: pricesPath, filename: pricesPath, loaded: true,
  exports: { getPrices: async () => ({ src:'stub', SOL:100 }) } };
const kv = require('../lib/kv.js');
const shot = require('../api/shot.js');
const { bucketKey } = require('../lib/pxlog.js');

let fails = 0;
const ok = (c, n) => { console.log((c?'PASS  ':'FAIL  ')+n); if(!c) fails++; };
const call = q => new Promise(r => {
  const res = { _s:200, _h:{}, setHeader(){}, status(c){this._s=c;return this;},
    end(b){ r({ status:this._s, body:b }); } };
  shot({ query:q }, res);
});

const W = 'HXFDaHyZ3i477z1BakiTWZg9UQN8rcreruuv9ifC1HvM';
const side = 'YES', salt = 'a1b2c3d4e5f6a7b8';
const commit = crypto.createHash('sha256').update(`${side}|${salt}`).digest('hex');
const now = Date.now(), t = now - 300e3;
await kv.setJSON(`u:${W}`, { w:W, closed:[
  { id:'abc123', kind:'dir', feed:'SOL', side, salt, commit, res:'hit', label:'SOL higher in 5 minutes',
    stake:2500, back:4250, xp:56, entry:86.0, exitPx:87.4, t, exp:now-60e3, settledAt:now-55e3, exitAt:now-58e3 },
  // an OPEN shot parked in closed by mistake must still not reveal a side
  { id:'open99', kind:'dir', feed:'SOL', side:'NO', salt:'zz', commit:'x', label:'open one', t, exp:now+600e3 },
] });
await kv.setJSON(bucketKey(t), [
  { t: t+30e3, SOL: 86.2 }, { t: t+90e3, SOL: 86.9 }, { t: now-58e3, SOL: 87.4 },
]);

let r = await call({ w:W, id:'abc123' });
ok(r.status === 200, 'a settled shot renders');
ok(/HIT/.test(r.body), 'the verdict is stated');
ok(r.body.includes(commit), 'the sealed commitment is published');
ok(r.body.includes(salt), 'the salt is published so the hash can be recomputed');
ok(/MATCHES/.test(r.body), 'and the page says the recomputation matches');
ok(/\$86\.00/.test(r.body) && /\$87\.40/.test(r.body), 'entry and exit are shown');
ok(/\+1\.63%/.test(r.body), 'the move is computed');
ok(/<svg/.test(r.body) && /class="sp"/.test(r.body), 'the oracle path is drawn from the recorded log');
ok(/og:title/.test(r.body) && /twitter:card/.test(r.body), 'it unfurls when shared');
ok(/first Pyth print at or after expiry/.test(r.body), 'the settling sample is named');

r = await call({ w:W, id:'open99' });
ok(r.status === 404, 'a shot with no result is refused');
ok(!/NO<\/b>|"NO"/.test(r.body) && !r.body.includes('zz'), 'and leaks neither its side nor its salt');

r = await call({ w:'<script>', id:'abc123' });
ok(r.status === 400 && !/<script>/.test(r.body), 'a junk wallet is rejected and never echoed');
r = await call({ w:W, id:'nope' });
ok(r.status === 404, 'an unknown id 404s');

console.log(fails ? `\n${fails} FAILURES` : '\nALL PASS');
process.exit(fails?1:0);
