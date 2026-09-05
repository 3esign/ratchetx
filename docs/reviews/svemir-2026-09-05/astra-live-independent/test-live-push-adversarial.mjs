import test from 'node:test';
import assert from 'node:assert/strict';
import { openLiveNeed, capture, finalizeLive, expireLive } from './live_capture.mjs';
const T=6000,feed='SOL',PDA='canonical-sponsored-PDA';
const message=(publish_time,price,hash)=>({authentic:true,feed_id:feed,publish_time,prev_publish_time:publish_time-1,price,conf:1,exponent:-2,hash});
// A source-level abstraction of official pyt2 update_price_feed: unrestricted
// payer, authenticated same-feed update, strictly newer publish time, same PDA.
// This does not authenticate fabricated signatures or execute deployed SBF.
function push(posts,m,at,payer){assert.ok(payer);assert.equal(m.authentic,true);assert.equal(m.feed_id,feed);const last=posts.at(-1);if(last&&m.publish_time<=last.message.publish_time)return false;posts.push({message:m,post_time:at,address:PDA,write_authority:PDA,payer});return true;}

test('LA1 an adversarial permissionless PDA write changes payoff while an honest first-post capture exists in BOTH histories',()=>{
 const before=message(T-3,100,'before'),privateQ=message(T,110,'private-Q'),scheduledP=message(T+2,90,'scheduled-P');
 const run=(publishPrivate)=>{
  const posts=[];push(posts,before,T-3,'sponsor');
  if(publishPrivate)push(posts,privateQ,T+1,'keyed-player');
  push(posts,scheduledP,T+2,'sponsor');
  const n=openLiveNeed(T,30,30);
  // Same honest crank schedule in both worlds; no malicious capture is needed.
  capture(n,posts,T+1,'honest');capture(n,posts,T+3,'honest');
  assert.equal(finalizeLive(n,T+60).ok,true);
  const firstPost=posts.find(p=>p.message.publish_time>=T);
  assert.equal(n.winner.message.hash,firstPost.message.hash); // H2 holds.
  assert.ok(posts.every(p=>p.address===PDA&&p.write_authority===PDA));
  return n;
 };
 const withheld=run(false),posted=run(true);
 assert.equal(withheld.winner.message.price,90);assert.equal(posted.winner.message.price,110);
 assert.notEqual(withheld.winner.message.price>100,posted.winner.message.price>100);
});

test('LA2 an honest capturer missing several windows can settle on the sixth post, not necessarily the next one',()=>{
 const posts=[];for(let k=0;k<6;k++)push(posts,message(T+2+5*k,100+k,'post-'+k),T+2+5*k,'sponsor');
 const n=openLiveNeed(T,30,30);
 assert.equal(capture(n,posts,T+29,'delayed-honest').ok,true);
 assert.equal(n.winner.message.publish_time,T+27);
 assert.equal(finalizeLive(n,T+60).ok,true);
});

test('LA3 after all admissible prints are overwritten a functioning late crank cannot capture an in-range message',()=>{
 const posts=[];for(let k=0;k<9;k++)push(posts,message(T+2+5*k,100+k,'post-'+k),T+2+5*k,'sponsor');
 const n=openLiveNeed(T,30,30);
 assert.equal(capture(n,posts,T+44,'late-honest').reason,'POST_TARGET_LAG_TOO_LARGE');
 assert.equal(expireLive(n,T+60).ok,true);
});
