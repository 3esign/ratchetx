import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {parsePathRequest,pathResponse}=require('../lib/pyth_context.js');
const base=1788080000000;
const args={feed:'WIF',from:base,source:'all',limit:25};
const points=Array.from({length:105},(_,i)=>({observedAt:base+100+Math.floor(i/3),
  publishTime:base+50,postedSlot:1000+i,rpcSlot:1100+i,source:'pyth-onchain-stream',
  price:1+i/1000,confidenceBps:2,emaPrice:1,emaConfidenceBps:2}));
const first=()=>pathResponse(parsePathRequest(args,base+1000),points);

test('positive control: explicit frozen bounds already allow continuation',()=>{
  const p=first(), q=parsePathRequest({...args,to:p.to,cursor:p.nextCursor},base+2000);
  const p2=pathResponse(q,points);
  assert.equal(p2.returned,25);
  assert.notDeepEqual(p2.points[0],p.points[0]);
});
test('omitted to stays bound to the first page, not a second moving now',()=>{
  const p=first(), q=parsePathRequest({...args,cursor:p.nextCursor},base+2000);
  assert.equal(q.to,p.to);
  assert.equal(pathResponse(q,points).points[0].postedSlot,1025);
});
test('server supplies executable nextRequest; five pages retain all 105 observations',()=>{
  let p=first();const kept=[...p.points];let pages=1;
  while(p.nextCursor){
    assert.deepEqual(p.nextRequest,{...args,to:base+1000,cursor:p.nextCursor});
    p=pathResponse(parsePathRequest(p.nextRequest,base+1000+pages*100),points);
    kept.push(...p.points);pages++;
    assert.ok(pages<=5,'bounded continuation');
  }
  assert.equal(p.nextRequest,null);
  assert.equal(pages,5);
  assert.deepEqual(kept,points,'same-millisecond neighbours neither disappear nor repeat');
});
test('explicit changes to bound feed/from/to/source still fail closed',()=>{
  const p=first();
  for(const change of [{feed:'BTC'},{from:base+1},{to:p.to+1},{source:'stream'}])
    assert.throws(()=>parsePathRequest({...args,to:p.to,cursor:p.nextCursor,...change},base+2000),/cursor is invalid/);
});
test('malformed, oversized and out-of-window cursors cannot supply default bounds',()=>{
  for(const cursor of ['not-a-cursor','x'.repeat(4097),Buffer.from(JSON.stringify({v:1,point:{observedAt:base},request:{}})).toString('base64url')])
    assert.throws(()=>parsePathRequest({...args,cursor},base+2000),/cursor is invalid/);
  assert.throws(()=>parsePathRequest({...args,to:base+27*3600e3}),/26 hours/);
});
