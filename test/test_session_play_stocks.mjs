// Bankr holds a spend capability. Every mistake it can make costs somebody
// credits, so the stock rules are pinned here rather than left to the general
// asset resolver, which was written when every feed was a token.
//
// Two failure modes matter, and both are new with stocks:
//   1. COIN and HOOD are ordinary English words. "put it on the coin" must not
//      buy Coinbase, and "back in the hood" must not buy Robinhood.
//   2. Twelve feeds share ten slots, so a named asset is often not on THIS
//      hour's board. The old resolver answered that by sealing a shot on
//      whatever was shortest. Asking for Tesla and getting BONK is not a
//      degraded answer, it is the wrong bet with real money.
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

// ---- the tickers are understood, by name and by symbol --------------------
is('put 500 on tesla higher','TSLA');
is('nvidia lower','NVDA');
is('palantir higher','PLTR',undefined,{board:{stakeRule:stake,targets:[{id:'P',kind:'dir',feed:'PLTR',mins:5}]}});
is('$TSLA higher','TSLA');
is('tsla higher','TSLA');
is('coinbase higher','COIN');
is('robinhood lower','HOOD');

// ---- and the two that are also words are not guessed at -------------------
// The shortest target is SOL at 5 min; that is what "no asset named" resolves
// to, and it is what these must resolve to.
is('put 500 on the coin higher','SOL','a coin is a coin, not Coinbase');
is('flip a coin, higher','SOL','still not Coinbase');
is('back in the hood, sol higher','SOL','a hood is not Robinhood');
// Written the way a ticker is written, it IS the ticker.
is('put 500 on $coin higher','COIN','$coin names the stock');
is('COIN higher','COIN','capitals name the stock');
is('HOOD lower','HOOD','capitals name the stock');

// ---- an asset we cannot play is refused, never swapped ---------------------
// This is the whole point of the file. TSLA is real and playable in general,
// just not on THIS board, which happens most hours.
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
  checks++;assert.doesNotMatch(stock,/this hour|next hour|board changes every hour/,
    'a held asset must not promise a later board');
  checks++;assert.match(stock,/On the board now: SOL, BTC, ETH\./,'name what works, so the next message is right');
  checks++;assert.doesNotMatch(stock,/sealed on-chain/,'nothing happened and the words must not suggest it did');

  const token=replyFor({ok:false,category:'REFUSED',code:'ASSET_NOT_ON_BOARD',
    requestedAsset:'WIF',availableAssets:['SOL','BTC','ETH']});
  checks++;assert.match(token,/WIF is not on the board this hour/,'a token IS coming back');
  checks++;assert.match(token,/will not put your credits on a different asset than the one you named/);
}

// ---- the player is told how a stock settles BEFORE they play one ----------
// In the receipt would be too late, and the sealed reply deliberately reveals
// nothing about the target anyway. The board is where the choice is made.
{
  const b=boardReply(mixed);
  checks++;assert.match(b,/TSLA.*\(stock\)/,'a stock is marked as one on the board');
  checks++;assert.match(b,/Pyth 24\/7 index mark, not an exchange print/);
  checks++;assert.match(b,/around the clock/);
  const c=boardReply(cryptoOnly);
  checks++;assert.doesNotMatch(c,/\(stock\)/,'no stock on the board, no stock line');
  checks++;assert.doesNotMatch(c,/24\/7 index/,'the note appears only when it applies');
}
checks++;assert.match(HELP,/tesla, nvidia, palantir, coinbase, robinhood/,'the menu names every stock');
checks++;assert.match(HELP,/not an exchange print/,'and says what one settles on');
checks++;assert.match(PITCH,/never an exchange print/,'so does the standing explanation');
checks++;assert.ok(PITCH.length<=700,'pitch stays short: '+PITCH.length);

console.log(`Session play stocks PASS - ${checks} checks: tickers resolve by name and symbol, `
  + `'coin' and 'hood' stay English words, an asset off the board refuses instead of `
  + `swapping, and the board says what a stock settles on before anyone plays one`);
