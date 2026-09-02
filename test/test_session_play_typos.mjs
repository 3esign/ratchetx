// Bankr must be UNABLE to place a bet the player did not make -- not merely
// unlikely to. Typos are where that promise is easiest to break: the moment a
// parser starts correcting words, it starts deciding what somebody meant, and
// it is spending their credits on the answer.
//
// So the rule here has two halves and both are tested. Read a misspelling when
// it can only mean one thing. Refuse when it could mean two. Never touch a word
// that belongs to the command language, because 'sell' is close to 'sol' and
// reading it as Solana would be a bet out of thin air.
import assert from 'node:assert/strict';
import { resolveIntent, replyFor } from '../skills/ratchetx/scripts/session-play.mjs';

const stake={min:100,max:1000000000,hitPayout:1.7};
const board={stakeRule:stake,targets:[
  {id:'Q0',kind:'dir',feed:'SOL',mins:5},{id:'Q1',kind:'dir',feed:'BTC',mins:10},
  {id:'Q2',kind:'dir',feed:'ETH',mins:15},{id:'Q3',kind:'dir',feed:'BONK',mins:30},
  {id:'Q4',kind:'dir',feed:'JUP',mins:60},{id:'Q5',kind:'dir',feed:'WIF',mins:360},
  {id:'S0',kind:'dir',feed:'TSLA',mins:5},{id:'S1',kind:'dir',feed:'NVDA',mins:30},
  {id:'S2',kind:'dir',feed:'COIN',mins:60},{id:'S3',kind:'dir',feed:'HOOD',mins:60},
  {id:'S4',kind:'dir',feed:'PLTR',mins:60}]};
const context={feeds:[{feed:'SOL',current:{price:99,priceVsEmaBps:5}}]};
const env={board,context,limits:{maxStakeCredits:5000,maxGrossCredits:20000},
  session:{grossCredits:0},player:{credits:12000}};
const feedFor=t=>resolveIntent(t,env).resolution.feed;
let checks=0;
const is=(text,want,why)=>{checks++;assert.equal(feedFor(text),want,why||text);};

// ---- 1. spellings people actually type ------------------------------------
is('put 500 on teslla higher','TSLA');
is('telsa lower','TSLA');
is('nivida higher','NVDA');
is('nvidea higher','NVDA');
is('solona higher','SOL');
is('bitcion lower','BTC');
is('etherium higher','ETH');
is('coinbse higher','COIN');
is('robinhod lower','HOOD');
is('palentir higher','PLTR');
is('jupitor higher','JUP');

// ---- 2. near misses nobody wrote down -------------------------------------
// One edit on a short name, two from seven characters up. Possessives and
// plurals fall out of this for free, which is why they are not in any table.
is('solanas price higher','SOL', "a possessive is just a two-edit near miss");
is('bitcoinn higher','BTC');
is('ethereumm lower','ETH');
is('palantirr higher','PLTR');

// ---- 3. THE LINE: command words are never "corrected" into assets ----------
// Every one of these is within an edit or two of an asset name and every one
// must be left alone. 'sell' near 'sol', 'either' one deletion from 'ether',
// 'call'/'fall'/'all' near each other and near nothing we trade.
// The board's shortest target is SOL at 5 min, so "no asset named" lands there
// -- these assert the parser did NOT name an asset, not that it picked one.
for (const t of ['sell 500 higher','play 500 higher','call it higher','either higher or lower',
                 'total send it higher','close the price higher','make it higher','take another higher']) {
  checks++;
  const r = resolveIntent(t, env);
  assert.equal(r.resolution.asset, null, `"${t}" must name no asset, got ${r.resolution.asset}`);
}

// ---- 4. two candidates is a refusal, never a pick -------------------------
// Constructed to sit within budget of two different assets at once. The parser
// must stop rather than flip a coin with somebody's stake.
{
  checks++;
  let threw = null;
  try { resolveIntent('put 1000 on bonkk and boink higher', {...env,
    board:{stakeRule:stake,targets:[{id:'A',kind:'dir',feed:'BONK',mins:5}]}}); }
  catch (e) { threw = e; }
  // both spellings map to BONK, so this one must NOT be ambiguous -- it is the
  // control for the test below.
  assert.equal(threw, null, 'two spellings of the SAME asset is not ambiguity');
}
{
  checks++;
  assert.throws(() => resolveIntent('teslla and nivida higher', env), /ASSET_AMBIGUOUS/,
    'two different assets in reach means refuse');
}

// ---- 5. the refusal says what it could not choose between -----------------
{
  const reply = replyFor({ok:false,category:'REFUSED',code:'ASSET_AMBIGUOUS',candidates:['NVDA','TSLA']});
  checks++;assert.match(reply,/Nothing was sealed/);
  checks++;assert.match(reply,/NVDA or TSLA/,'name both, so the player can pick');
  checks++;assert.match(reply,/will not guess between two assets/);
  checks++;assert.doesNotMatch(reply,/sealed on-chain/);
}

// ---- 6. the player is told what was read, on the shot itself --------------
{
  checks++;
  const r = resolveIntent('put 500 on teslla higher', env);
  assert.match(r.resolution.notes.join(' '), /read "teslla" as TSLA/,
    'a correction must be stated, not silent');
}

// ---- 7. three-letter names are never fuzzy targets ------------------------
// 'sol', 'btc', 'eth' are too short for one edit to mean anything: at three
// characters a single edit reaches a third of the alphabet.
for (const t of ['sob higher','bth lower','eta higher','sot higher']) {
  checks++;
  assert.equal(resolveIntent(t, env).resolution.asset, null, `"${t}" must not resolve`);
}

console.log(`Session play typos PASS - ${checks} checks: misspellings resolve when they can `
  + `mean one thing, refuse when they could mean two, and never touch a command word`);
