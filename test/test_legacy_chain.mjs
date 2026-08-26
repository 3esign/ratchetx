import { createRequire } from 'node:module';
import crypto from 'node:crypto';
const require = createRequire(import.meta.url);
const { verifyLegacy, recoverOrder } = require('../lib/legacy_chain.js');
const { jsonbOrder } = require('../lib/canon.js');
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const GEN = sha('ratchet-genesis');
let p=0,f=0; const ok=(c,l)=>{c?(p++,console.log('PASS  '+l)):(f++,console.log('FAIL  '+l));};

// THE REAL ENTRY 1 from production, and the order the Aug-19 code wrote it in
const evOriginal = { k:'seal', w:'ExtQrxJeSsvWxZADQS7mrpWvqq8w52VRcxLoCbh7cmqV', id:'zxyc0zco',
  feed:'SOL', side:'YES', stake:2500, exp:1787095226987, entry:77.02695426 };
const REAL_H = '4079f90251ba5a800a4fb2e803176b92337693979497731efb33d213b0ff96dd';
const stored = jsonbOrder({ i:1, t:1787094926996, ev:evOriginal, h:REAL_H });

const rec = recoverOrder(stored, GEN);
ok(!!rec, 'recovers an order for the REAL production entry 1');
ok(rec && rec.order.join(',') === 'k,w,id,feed,side,stake,exp,entry',
   `recovered order matches the Aug-19 append site (${rec && rec.order.join(',')})`);
ok(rec && rec.via === 'template', `recovered from a harvested template, not a blind search (${rec && rec.via})`);

const v = verifyLegacy([stored]);
ok(v.verified === 1 && v.unrecovered === 0, 'the real entry verifies once its order is recovered');

// a shape no template covers is recovered by bounded search
const oddEv = { zz:1, aa:2, mm:3, qq:4 };
const oddH = sha(GEN + JSON.stringify({ i:1, t:5, ev:oddEv }));
const oddStored = jsonbOrder({ i:1, t:5, ev:oddEv, h:oddH });
const r2 = recoverOrder(oddStored, GEN);
ok(r2 && r2.via === 'search', 'an unknown shape is recovered by bounded search');

// a genuinely tampered value is NOT recovered — no order can save it
const badEv = { ...evOriginal, stake: 9999 };
const badStored = jsonbOrder({ i:1, t:1787094926996, ev:badEv, h:REAL_H });
ok(recoverOrder(badStored, GEN) === null, 'a changed VALUE cannot be recovered by any ordering — tamper-evidence holds');
const v2 = verifyLegacy([badStored]);
ok(v2.unrecovered === 1 && v2.verified === 0, 'and it is reported unrecovered, never quietly passed');

// canonical entries are left alone
ok(verifyLegacy([{ i:1, t:1, ev:{a:1}, c:1, h:'x' }]).canonical === 1, 'c:1 entries are not this file’s business');

console.log(`\n${p} passed, ${f} failed`); process.exit(f?1:0);
