import { createRequire } from 'node:module';
import crypto from 'node:crypto';
const require = createRequire(import.meta.url);
const log = require('../lib/log.js');
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const GEN = 'ratchet-genesis';
let p=0,f=0; const ok=(c,l)=>{c?(p++,console.log('PASS  '+l)):(f++,console.log('FAIL  '+l));};

function build(n){ let h=sha(GEN); const out=[];
  for(let i=1;i<=n;i++){ const e={i,t:1000+i,ev:{k:'x',n:i}}; const hh=sha(h+JSON.stringify(e)); out.push({...e,h:hh}); h=hh; }
  return {entries:out, head:{i:n,h}}; }

// 1 clean
let {entries,head}=build(10);
let v=log.verifyChain(entries,head,10);
ok(v.ok&&v.intact&&v.segments.length===1,'clean chain verifies intact, one segment');

// 2 undisclosed hole still fails hard
v=log.verifyChain(entries.filter(e=>e.i!==4),head,10);
ok(v.ok===false&&v.brokenAt===4&&/missing entry 4/.test(v.reason),'undisclosed gap at 4 still fails loudly');

// 3 the real case: 350 entries, 345 removed, disclosed
const big=build(350);
const holed=big.entries.filter(e=>e.i!==345);
v=log.verifyChain(holed,big.head,350);
ok(v.ok===true,'disclosed gap 345: ok (nothing undisclosed is broken)');
ok(v.intact===false,'disclosed gap 345: NOT intact — the loss is not hidden');
ok(v.count===349&&JSON.stringify(v.missing)==='[345]','counts and names the missing index');
ok(v.segments.length===2&&v.segments[0].from===1&&v.segments[0].to===344
   &&v.segments[1].from===346&&v.segments[1].to===350,'splits into 1-344 and 346-350');
ok(v.segments[0].anchor==='genesis'&&v.segments[1].anchor==='stored-hash','segment anchors are declared');
ok(/disclosed gap/.test(v.reason||''),'reason states segmented verification');

// 4 tamper INSIDE the post-gap segment is still caught
const tam=holed.map(e=>e.i===349?{...e,ev:{k:'x',n:999}}:e);
v=log.verifyChain(tam,big.head,350);
ok(v.ok===false&&v.brokenAt===349&&v.reason==='hash mismatch','tampering after the gap is still caught');

// 5 tamper BEFORE the gap caught too
const tam2=holed.map(e=>e.i===100?{...e,ev:{k:'x',n:999}}:e);
v=log.verifyChain(tam2,big.head,350);
ok(v.ok===false&&v.brokenAt===100,'tampering before the gap is still caught');

// 6 a SECOND, new hole next to the disclosed one must fail
v=log.verifyChain(holed.filter(e=>e.i!==900&&e.i!==200),big.head,350);
ok(v.ok===false&&v.brokenAt===200,'a new undisclosed hole fails even alongside a disclosed one');

// 7 head mismatch
v=log.verifyChain(holed,{i:350,h:'0'.repeat(64)},350);
ok(v.ok===false&&v.reason==='head mismatch','head mismatch still caught');

// 8 legacy 2-arg call keeps working
v=log.verifyChain(entries,head);
ok(v.ok&&v.intact,'legacy two-argument call unchanged');

console.log(`\n${p} passed, ${f} failed`); process.exit(f?1:0);
