// The bug that broke the chain, and the fix, both reproduced from scratch.
//
// A hash chain over JSON is only as stable as the BYTES it hashes. Postgres
// jsonb does not store JSON text: it parses and returns keys in its own
// canonical order (shortest first, then bytewise). Hashing JSON.stringify
// output therefore stops reproducing the moment the storage layer changes.
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
const require = createRequire(import.meta.url);
const { canon, jsonbOrder } = require('../lib/canon.js');
const log = require('../lib/log.js');
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const GEN = 'ratchet-genesis';
let p = 0, f = 0;
const ok = (c, l) => { if (c) { p++; console.log('PASS  ' + l); } else { f++; console.log('FAIL  ' + l); } };

// ---- 1. canon is stable under any reordering
const ev = { k:'seal', w:'W', id:'x1', feed:'SOL', side:'YES', stake:2500, exp:2, entry:77.5 };
ok(canon(ev) === canon(jsonbOrder(ev)), 'canonical bytes survive a jsonb key reordering');
ok(JSON.stringify(ev) !== JSON.stringify(jsonbOrder(ev)), 'plain stringify does NOT — this is the whole bug');
ok(canon({ a:1, b:undefined }) === '{"a":1}', 'undefined fields drop exactly as JSON.stringify drops them');
ok(canon({ z:[3,1,{ b:1, a:2 }] }) === '{"z":[3,1,{"a":2,"b":1}]}', 'arrays keep order, nested objects are sorted');

// ---- 2. the historical failure, reproduced exactly
const legacy = { i:1, t:1000, ev };
const legacyHash = sha(sha(GEN) + JSON.stringify(legacy));           // hashed before storage
const afterDb = jsonbOrder({ ...legacy, h: legacyHash });            // what storage hands back
ok(Object.keys(afterDb).join(',') === 'h,i,t,ev', 'jsonb returns the outer entry as h,i,t,ev');
const replay = sha(sha(GEN) + JSON.stringify({ i:afterDb.i, t:afterDb.t, ev:afterDb.ev }));
ok(replay !== legacyHash, 'replaying a stored legacy entry does NOT reproduce its hash');
ok(log.verifyChain([afterDb], { i:1, h:legacyHash }, 1).ok === false,
   'so the verifier reports a legacy entry as broken — correctly, and this is what we saw live');

// ---- 3. the fix: a canonical entry survives the same round trip
const fresh = { i:1, t:1000, ev, c:1 };
const freshHash = sha(sha(GEN) + canon(fresh));
const freshAfterDb = jsonbOrder({ ...fresh, h: freshHash });
const v = log.verifyChain([freshAfterDb], { i:1, h:freshHash }, 1);
ok(v.ok === true && v.intact === true, 'a c:1 entry verifies after the SAME reordering that broke the old one');

// ---- 4. tamper-evidence is not weakened by canonicalisation
const tampered = { ...freshAfterDb, ev: { ...ev, stake: 9999 } };
ok(log.verifyChain([tampered], { i:1, h:freshHash }, 1).ok === false,
   'changing a value still breaks the chain — only ORDER stopped mattering');

// ---- 5. a real append chain verifies end to end after a full round trip
globalThis.__ratchet_mem = new Map();
const kv = require('../lib/kv.js');
for (let n = 0; n < 6; n++) await log.append({ k:'test', n, w:'W', feed:'SOL', longerKeyName:n });
const entries = await log.readEntries();
const head = await kv.getJSON('g:log:head');
ok(log.verifyChain(entries, head, await log.logCount()).ok, 'six real appends verify');
const roundTripped = entries.map(e => jsonbOrder(JSON.parse(JSON.stringify(e))));
const after = log.verifyChain(roundTripped, head, await log.logCount());
ok(after.ok === true && after.intact === true,
   'and they still verify after every entry is jsonb-reordered — the chain is now storage-independent');

console.log(`\n${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
