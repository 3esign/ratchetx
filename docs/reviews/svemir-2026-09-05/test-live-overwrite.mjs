import test from 'node:test';
import assert from 'node:assert/strict';
import {openLiveNeed,capture,finalizeLive} from './live-independent-review/live_capture.mjs';
test('private overwrite AFTER the first scheduled sponsor print changes the first honest capture',()=>{
 const T=6000,m=(publish_time,price,hash)=>({authentic:true,feed_id:'SOL',publish_time,prev_publish_time:publish_time-1,price,conf:1,exponent:-2,hash});
 const before={message:m(T-3,100,'before'),post_time:T-3},P={message:m(T+2,90,'sponsor-P'),post_time:T+2},Q={message:m(T+3,110,'private-Q'),post_time:T+3},next={message:m(T+7,95,'sponsor-next'),post_time:T+7};
 const run=posts=>{const n=openLiveNeed(T,30,30);assert.equal(capture(n,posts,T+4,'same-honest-crank').ok,true);assert.equal(finalizeLive(n,T+60).ok,true);return n.winner.message.price;};
 assert.equal(run([before,P,next]),90);assert.equal(run([before,P,Q,next]),110);
 // Both PDA histories increase publish_time strictly. The same honest capture
 // arrives within the assumed sponsor-only five-second lifetime, but a private
 // permissionless write shortened that lifetime. This is a model scenario.
});
