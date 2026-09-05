import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { openNeed, submit, finalize, compareKey } from './fable-model.mjs';

// Counterexamples use Fable's exact executable transition functions. As in his
// model, authentic=true abstracts oracle verification. These are protocol
// counterexamples, not fabricated signed mainnet evidence or an SBF verdict.
const spec=Object.freeze({feed_id:'SOL',target_grid_seconds:60,min_open_lead_seconds:30,max_post_target_lag_seconds:30,challenge_window_seconds:900,min_exponent:-12,max_exponent:2,max_confidence_bps:200});
const T=6000;
const message=(at,price,tag,prev=at-1)=>({authentic:true,feed_id:'SOL',publish_time:at,prev_publish_time:prev,price,conf:1,exponent:-2,hash:createHash('sha256').update(tag).digest('hex')});
const newNeed=()=>openNeed(spec,T,T-60);
const downProfit=(entry,exit)=>exit<entry?1:-1;
const upProfit=(entry,exit)=>exit>entry?1:-1;
function finish(messages){const n=newNeed();for(const [m,who,time] of messages)assert.equal(submit(n,m,who,time,spec).accepted,true);assert.equal(finalize(n,T+900,50000).ok,true);return n;}

test('A1 private earlier authentic message can be withheld to improve DOWN payoff despite an honest public capturer',()=>{
 const publicP=message(T+2,90,'public-P'),privateQ=message(T,110,'private-Q');
 const absent=finish([[publicP,'honest',T+3]]);
 const present=finish([[publicP,'honest',T+3],[privateQ,'keyed-player',T+899]]);
 assert.ok(compareKey(present.winner.message,absent.winner.message)<0);
 assert.equal(downProfit(100,absent.winner.message.price),1);
 assert.equal(downProfit(100,present.winner.message.price),-1);
 // Earlier-key monotonicity and an improved withholding payoff coexist.
});

test('A2 a private lower hash at identical publish/prev times also permits selective disclosure',()=>{
 let low=message(T+2,110,'same-second-a'),high=message(T+2,90,'same-second-b');
 // The model abstracts signed messages. Relabel which hypothetical authentic
 // price has the lower digest; do not claim these were observed on mainnet.
 if(low.hash>high.hash)[low.hash,high.hash]=[high.hash,low.hash];
 const absent=finish([[high,'honest',T+3]]),present=finish([[high,'honest',T+3],[low,'keyed-player',T+899]]);
 assert.equal(absent.winner.message.publish_time,present.winner.message.publish_time);
 assert.equal(absent.winner.message.prev_publish_time,present.winner.message.prev_publish_time);
 assert.ok(compareKey(present.winner.message,absent.winner.message)<0);
 assert.equal(downProfit(100,absent.winner.message.price),1);
 assert.equal(downProfit(100,present.winner.message.price),-1);
});

test('A3 the price-time span is not the disclosure deadline: private entry evidence can be chosen after a five-minute exit print',()=>{
 const publicEntry=message(T+2,90,'entry-public'),privateEntry=message(T,110,'entry-private');
 const honestOnly=newNeed(),withPrivate=newNeed();
 for(const n of [honestOnly,withPrivate])assert.equal(submit(n,publicEntry,'honest',T+3,spec).accepted,true);
 const publiclyObservedExitPrice=100,exitPrintAt=T+300;
 assert.ok(T+899>exitPrintAt);
 assert.equal(submit(withPrivate,privateEntry,'keyed-player',T+899,spec).replaced,true);
 for(const n of [honestOnly,withPrivate])assert.equal(finalize(n,T+900,50000).ok,true);
 assert.equal(upProfit(honestOnly.winner.message.price,publiclyObservedExitPrice),1);
 assert.equal(upProfit(withPrivate.winner.message.price,publiclyObservedExitPrice),-1);
});

test('A4 identical final price under reordering does not imply an identical bounty recipient',()=>{
 const m=message(T+2,100,'duplicate');
 const ab=finish([[m,'Alice',T+3],[m,'Bob',T+4]]),ba=finish([[m,'Bob',T+3],[m,'Alice',T+4]]);
 assert.equal(ab.winner.message.hash,ba.winner.message.hash);
 assert.equal(ab.payout.to,'Alice');assert.equal(ba.payout.to,'Bob');
 assert.equal(ab.payout.lamports,ba.payout.lamports);
 // This is an explicit first-inclusion rule, not a claim of a second payout.
});
