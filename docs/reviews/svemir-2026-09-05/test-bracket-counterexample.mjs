import {test} from 'node:test';
import assert from 'node:assert/strict';
const bracket=(prev,pub,T)=>prev<T&&T<=pub;
const observedMinimum=(messages,T,lag)=>messages.filter(m=>m.publish>=T&&m.publish<=T+lag).sort((a,b)=>a.publish-b.publish)[0]??null;
test('integer one-second predecessor bracket requires publish exactly equal to target',()=>{
  for(let T=0;T<600;T++)for(let pub=T-5;pub<=T+10;pub++)assert.equal(bracket(pub-1,pub,T),pub===T);
});
test('reported 5-second phase2 cadence has zero strict minute crossings independent of crank speed',()=>{
  const pubs=Array.from({length:86400/5},(_,i)=>i*5+2);
  const targets=Array.from({length:1440},(_,i)=>i*60);
  assert.equal(targets.filter(T=>pubs.some(pub=>bracket(pub-1,pub,T))).length,0);
  // This is a synthetic logical implication of a fixed cadence, NOT a 24-hour live measurement.
  assert.equal(targets.filter(T=>bracket(T-1,T,T)).length,1440);
});
test('minimum of submitted observations does not prove earliest published price; omission changes payout direction',()=>{
  const T=60,feed=[{publish:62,price:90},{publish:67,price:110},{publish:72,price:95}],entry=100;
  const all=observedMinimum(feed,T,30),late=observedMinimum(feed.slice(1),T,30);
  assert.equal(all.price>entry,false);assert.equal(late.price>entry,true);
  assert.equal(late.publish-all.publish,5);
  assert.equal(observedMinimum([],T,30),null);
});
test('canonical account overwrite makes an uncaptured earlier print unavailable to later honest callers',()=>{
  const chainAt62={publish:62,price:90},chainAt67={publish:67,price:110};
  assert.notDeepEqual(chainAt62,chainAt67);
  const lateCaptures=[chainAt67,{publish:72,price:95}];
  assert.equal(observedMinimum(lateCaptures,60,30).publish,67);
  assert.equal(observedMinimum([...lateCaptures,chainAt62],60,30).publish,62);
  // The last case requires evidence the current canonical account no longer supplies.
});
