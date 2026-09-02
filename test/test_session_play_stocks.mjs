// Bankr holds a spend capability. Stocks are recognized for an exact refusal,
// but are never playable until the canonical API-keyless oracle path has a
// sponsored on-chain equity feed.
//
// Two failure modes matter, and both are new with stocks:
//   1. COIN and HOOD are ordinary English words. "put it on the coin" must not
//      buy Coinbase, and "back in the hood" must not buy Robinhood.
//   2. Even if an upstream board accidentally contains a stock, the runner
//      filters it locally. Asking for Tesla must never become a SOL shot.
import assert from 'node:assert/strict';
import {resolveIntent,replyFor,boardReply,PITCH,HELP} from '../skills/ratchetx/scripts/session-play.mjs';

const stake={min:100,max:1000000000,hitPayout:1.7};
const mixed={stakeRule:stake,targets:[
  {id:'H1Q0',kind:'dir',feed:'SOL',mins:5},{id:'H1Q1',kind:'dir',feed:'BTC',mins:10},
  {id:'H1Q2',kind:'dir',feed:'ETH',mins:15},
  {id:'H1S0',kind:'dir',feed:'TSLA',mins:5},{id:'H1S1',kind:'dir',feed:'NVDA',mins:30},
  {id:'H1S2',kind:'dir',feed:'COIN',mins:60},{id:'H1S3',kind:'dir',feed:'HOOD',mins:60}]};
const cryptoOnly={stakeRule:stake,targets:[
  {id:'H1Q0',kind:'dir',feed:'SOL',mins:5},{id:'H1Q1',kind:'dir',feed:'BTC',mins:10}]};
const context={feeds:[{feed:'SOL',current:{price:210,priceVsEmaBps:12}},{feed:'BTC',current:{price:109500}}]};
const env={board:mixed,context,limits:{maxStakeCredits:5000,maxGrossCredits:20000},
  session:{grossCredits:0},player:{credits:12000}};
const feedFor=(text,extra={})=>resolveIntent(text,{...env,...extra}).resolution.feed;
let checks=0;
const is=(text,want,why,extra)=>{checks++;assert.equal(feedFor(text,extra),want,why||text);};
const held=text=>{checks++;assert.throws(()=>resolveIntent(text,env),/ASSET_NOT_ON_BOARD/,text);};

// ---- stock names and symbols are understood, then refused -----------------
for(const text of ['put 500 on tesla higher','nvidia lower','palantir higher',
  '$TSLA higher','tsla higher','coinbase higher','robinhood lower']) held(text);

// ---- and the two that are also words are not guessed at -------------------
// The shortest target is SOL at 5 min; that is what "no asset named" resolves
// to, and it is what these must resolve to.
is('put 500 on the coin higher','SOL','a coin is a coin, not Coinbase');
is('flip a coin, higher','SOL','still not Coinbase');
is('back in the hood, sol higher','SOL','a hood is not Robinhood');
// Written like a ticker, it names the held stock and is refused.
for(const text of ['put 500 on $coin higher','COIN higher','HOOD lower']) held(text);

// ---- an asset we cannot play is refused, never swapped ---------------------
// This is the whole point of the file. A stock is held everywhere; a token can
// still be absent only from this hour's board.
checks++;
assert.throws(()=>resolveIntent('put 5000 on tesla higher',{...env,board:cryptoOnly}),
  /ASSET_NOT_ON_BOARD/,'a stock off the board must refuse, not seal something else');
checks++;
assert.throws(()=>resolveIntent('$PEPE moon',env),/ASSET_NOT_ON_BOARD/,
  'an asset we do not run at all must refuse too');
checks++;
assert.throws(()=>resolveIntent('put 500 on wif higher',{...env,board:cryptoOnly}),
  /ASSET_NOT_ON_BOARD/,'the same rule protects tokens, which it always should have');

// ---- and the refusal tells the player what WOULD have worked --------------
// A stock and a token are refused for different reasons and must not be refused
// in the same words. A token is off THIS board and will be back; a stock is held
// (2026-09-02: no free feed publishes equities fast enough to settle honestly),
// so telling a player to check the next board sends them back every hour to be
// refused again. The invariant both share: name the asset, never substitute one.
{
  const stock=replyFor({ok:false,category:'REFUSED',code:'ASSET_NOT_ON_BOARD',
    requestedAsset:'TSLA',availableAssets:['SOL','BTC','ETH']});
  checks++;assert.match(stock,/Nothing was sealed/,'the first thing a player needs to know');
  checks++;assert.match(stock,/TSLA is a stock/,'name the asset they actually asked for');
  checks++;assert.match(stock,/API-keyless oracle path has no sponsored on-chain equity feed/,
    'name the exact permanent product constraint');
  checks++;assert.doesNotMatch(stock,/this hour|next hour|board changes every hour/,
    'a held asset must not promise a later board');
  checks++;assert.match(stock,/On the board now: SOL, BTC, ETH\./,'name what works, so the next message is right');
  checks++;assert.doesNotMatch(stock,/sealed on-chain/,'nothing happened and the words must not suggest it did');

  const token=replyFor({ok:false,category:'REFUSED',code:'ASSET_NOT_ON_BOARD',
    requestedAsset:'WIF',availableAssets:['SOL','BTC','ETH']});
  checks++;assert.match(token,/WIF is not on the board this hour/,'a token IS coming back');
  checks++;assert.match(token,/will not put your credits on a different asset than the one you named/);
}

// ---- a stale/misconfigured board cannot advertise a stock ------------------
{
  const b=boardReply(mixed);
  checks++;assert.doesNotMatch(b,/TSLA|NVDA|COIN|HOOD/,'stock targets are filtered locally');
  checks++;assert.doesNotMatch(b,/stock|24\/7 index|exchange print/i);
  const c=boardReply(cryptoOnly);
  checks++;assert.doesNotMatch(c,/\(stock\)/,'no stock on the board, no stock line');
  checks++;assert.doesNotMatch(c,/24\/7 index/,'the note appears only when it applies');
}
checks++;assert.doesNotMatch(HELP,/put 500 on tesla|stocks too/,'help must not offer a held target');
checks++;assert.match(HELP,/API-keyless sponsored on-chain equity feed/);
checks++;assert.doesNotMatch(PITCH,/Call crypto or US stocks|playable around the clock/);
checks++;assert.match(PITCH,/Stocks stay held until an API-keyless sponsored on-chain equity feed/);
checks++;assert.ok(PITCH.length<=700,'pitch stays short: '+PITCH.length);

console.log(`Session play stocks PASS - ${checks} checks: stock names refuse without dispatch, `
  + `'coin' and 'hood' stay English words, and stale upstream stock targets stay hidden`);
