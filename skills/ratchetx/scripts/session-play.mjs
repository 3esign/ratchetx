#!/usr/bin/env node
// One explicitly approved command per invocation. No signer, scheduler or funds.
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {ORIGIN,URLS,canonical,createFileJournal} from './session-smoke.mjs';
export {ORIGIN,URLS,canonical,createFileJournal};

const SCHEMA='ratchetx-session-play-v1', MIN_ROOM=22*60000, HORIZON=300000;
// Server chamber cap is min(4,rank+1)+1, never below 2. Used only when the
// status reply does not publish `chambers` (h105 does not).
const MIN_CHAMBERS=2;
const WALLET=/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, HEX32=/^[a-f0-9]{32}$/, HEX64=/^[a-f0-9]{64}$/;
const SHOT=/^[a-f0-9]{12}$/, COMMAND=/^(?:[0-9]{1,32}|[a-f0-9]{32})$/;
const TOKEN=/^rxp1\.([1-9A-HJ-NP-Za-km-z]{32,44})\.([a-f0-9]{32})\.[a-f0-9]{64}$/;
const CODES=new Set(['SESSION_EXPIRED','SESSION_REVOKED','INVALID_CAPABILITY','SESSION_RATE_LIMIT',
  'SESSION_BUDGET_EXHAUSTED','AGENT_ADMISSION_REQUIRED','PLAYER_BUSY','ORACLE_STALE',
  'ORACLE_CONFIDENCE_TOO_WIDE','FEED_UNAVAILABLE','TARGET_UNAVAILABLE','CHAMBERS_FULL',
  'INVALID_STAKE','INSUFFICIENT_CREDITS','SETTLEMENT_DELIVERY_PENDING','INVALID_PROBABILITY',
  'RATE_LIMITED','WRITE_CONFLICT','WRITE_LEASE_EXPIRED','CREDIT_QUEUE_CONFLICT','SHOT_REFUSED',
  'RECOVERED_NO_DISPATCH','REQUEST_CONFLICT','PRIOR_ATTEMPT_UNRESOLVED','ASSET_NOT_ON_BOARD','ASSET_AMBIGUOUS']);
const finite=n=>typeof n==='number'&&Number.isFinite(n), integer=n=>Number.isSafeInteger(n)&&n>=0;
const same=(a,b)=>canonical(a)===canonical(b);
const digest=text=>createHash('sha256').update(text).digest('hex'), hash=value=>digest(canonical(value));
class Stop extends Error {constructor(code,category='FAILED',detail=null){super(code);this.code=code;this.category=category;this.detail=detail;}}
const stop=(code,category,detail)=>{throw new Stop(code,category,detail);};
const need=(condition,code)=>{if(!condition)stop(code);};
const safeCode=code=>CODES.has(code)?code:'SHOT_REFUSED';
function bounds(value){
  need(value&&integer(value.maxAttempts)&&value.maxAttempts>=1&&value.maxAttempts<=100
    &&integer(value.maxStakeCredits)&&value.maxStakeCredits>=100&&value.maxStakeCredits<=10000000
    &&integer(value.maxGrossCredits)&&value.maxGrossCredits>=value.maxStakeCredits&&value.maxGrossCredits<=100000000
    &&integer(value.minIntervalMs)&&value.minIntervalMs>=1000&&value.minIntervalMs<=600000,'INVALID_SESSION');
  return {maxAttempts:value.maxAttempts,maxStakeCredits:value.maxStakeCredits,
    maxGrossCredits:value.maxGrossCredits,minIntervalMs:value.minIntervalMs};
}
export function commandRequestId(wallet,sessionId,commandId){
  need(typeof wallet==='string'&&WALLET.test(wallet)&&typeof sessionId==='string'&&HEX32.test(sessionId)
    &&typeof commandId==='string'&&COMMAND.test(commandId),'INVALID_COMMAND_ID');
  // A public command ID is deduplication context, NEVER authentication or proof
  // of X authorship. Excluding intent makes changed-intent redelivery conflict.
  return hash({domain:'ratchetx.xyz',version:'session-play-command-v1',wallet,sessionId,commandId}).slice(0,32);
}
function validIntent(i){return !!(i&&HEX32.test(i.requestId)&&/^[A-Za-z0-9:_-]{3,96}$/.test(i.target)
  &&['YES','NO'].includes(i.side)&&finite(i.p)&&i.p>=0.01&&i.p<=0.99
  &&Math.abs(i.p*100-Math.round(i.p*100))<1e-9&&integer(i.stake)&&i.stake>=100&&i.stake<=10000000
  &&Object.keys(i).sort().join(',')==='p,requestId,side,stake,target');}
function intentHash(i){return digest(JSON.stringify({requestId:i.requestId,target:i.target,side:i.side,p:i.p,stake:i.stake}));}
function validReceipt(r,intent){return !!(r&&validIntent(r.intent)&&same(r.intent,intent)&&r.stake===intent.stake
  &&r.intentHash===intentHash(intent)&&integer(r.reservedAt)
  &&['reserved','accepted','rejected'].includes(r.state)
  &&(r.state==='reserved'||integer(r.finishedAt)&&r.finishedAt>=r.reservedAt&&r.result?.state===r.state)
  &&(r.state!=='accepted'||SHOT.test(r.result?.shotId||'')));}
function ids(rows){
  need(Array.isArray(rows)&&rows.every(row=>row&&/^[a-z0-9]{4,16}$/i.test(row.id)),'INVALID_PLAYER');
  const out=rows.map(row=>row.id);need(new Set(out).size===out.length,'INVALID_PLAYER');return out;
}
function playerShape(p){
  need(p&&finite(p.credits)&&p.credits>=0&&integer(p.stated),'INVALID_PLAYER');
  need(p.stated===0?p.brier===null:finite(p.brier)&&p.brier>=0&&p.brier<=1,'INVALID_PLAYER');
  ids(p.open);ids(p.closed);
  need(p.open.every(row=>integer(row.exp)),'INVALID_PLAYER');
}

// ---- Natural-language intent resolution -------------------------------------
// Deterministic: the same words against the same board always give the same
// intent, so a redelivered command cannot "re-decide" itself. The agent passes
// the user's words; the runner decides target, side, p and stake from the live
// board/context and the signed grant. Explicit flags still override any field.
const SAY_MAX=500;
const ASSET_WORDS={SOL:['sol','solana'],BTC:['btc','bitcoin'],ETH:['eth','ethereum','ether'],BONK:['bonk'],
  WIF:['wif','dogwifhat'],JUP:['jup','jupiter'],PUMP:['pumpfun','pump.fun','pumptoken','pumpcoin'],
  // Stocks. Note what is NOT here: bare 'coin' and bare 'hood'. Both are
  // ordinary words in a sentence about this game -- "put it on the coin",
  // "back in the hood" -- and the generic ticker fallback below would have
  // read either as a Coinbase or Robinhood call and spent real credits on an
  // instrument nobody named. The company names are unambiguous, so those are
  // the aliases; the bare tickers are accepted only when they are written the
  // way a ticker is written.
  TSLA:['tsla','tesla'],NVDA:['nvda','nvidia'],PLTR:['pltr','palantir'],
  COIN:['coinbase'],HOOD:['robinhood']};
// Spellings people actually type. These are not guesses at what someone might
// have meant -- they are exact strings, matched exactly, so they can only ever
// resolve to the one asset they are listed under. The fuzzy pass below handles
// everything else, under much stricter rules.
const ASSET_TYPOS={
  SOL:['solona','solanna','soalna','slana','solan'],
  BTC:['bitcion','bitcon','bicoin','bitocin','btcc','bitconi'],
  ETH:['etherium','ethereium','ethreum','etherum','eth\u00e9reum'],
  BONK:['bonkk','boink'],
  WIF:['dogwif','dogwifhat','wifhat'],
  JUP:['jupitor','jupyter','jupier'],
  TSLA:['teslla','telsa','tesle','tesla\u0131','tsl'],
  NVDA:['nivida','nvidea','nvdia','invidia','nvidiaa'],
  PLTR:['palantier','palentir','palanteer'],
  COIN:['coinbse','coinbasse','coibase'],
  HOOD:['robinghood','robinhod','robbinhood','robin hood'],
};
const STOCKS=new Set(['TSLA','NVDA','PLTR','COIN','HOOD']);
const AMBIGUOUS_TICKERS=new Set(['COIN','HOOD']);
// Written as a ticker: $coin in any case, or COIN in capitals. Lowercase
// 'coin' inside a sentence is a word, and is left alone.
const writtenAsTicker=(raw,up)=>new RegExp('\\$'+up+'\\b','i').test(String(raw))||new RegExp('\\b'+up+'\\b').test(String(raw));
const UP_WORDS=['higher','up','upward','upside','moon','mooning','moons','long','rise','rises','rising','bull','bullish','green',
  'above','over','climb','climbs','rally','rallies','yes','breakout','gain','gains','increase','outperform','pumps','pumping'];
const DOWN_WORDS=['lower','down','downward','downside','dump','dumps','dumping','short','drop','drops','dropping','fall','falls',
  'falling','bear','bearish','red','below','under','crash','crashes','tank','tanks','sink','sinks','dip','dips','no','decrease','decline','declines'];
const NEGATIONS=['not','no','never','wont','won\'t','isnt','isn\'t','doesnt','doesn\'t','dont','don\'t','cant','can\'t','nope'];
const STATUS_WORDS=['status','stats','stat','balance','credits','xp','score','brier','rank','ranking','podium','leaderboard','standing',
  'chambers','history','results','result','settled','settle','resume','check','doing','progress','summary','won','win','lost','lose','losing','record'];
const LEADERBOARD_WORDS=['leaderboard','leaderboards','standings'];
const LEADERBOARD_PATTERN=/\b(leaderboard|leaderboards|standings|who.?s?\s+(?:winning|leading|first|ahead)|top\s+(?:players?|agents?|forecasters?|traders?|\d+))\b/i;
// Verbs start a play. Nouns (shot, call, forecast) also appear in status
// questions ("check my shot"), so they never override a status word alone.
// "ratchet"/"ratchetx" is the trigger word in every command, never a verb.
const PLAY_VERBS=['play','shoot','fire','bet','wager','spend','put','predict','gamble','yolo','ape','stake','again','another',
  'go','send','take','make','degen','buy','sell'];
const PLAY_NOUNS=['shot','shots','forecast','prediction','call'];
const norm=text=>String(text).toLowerCase().replace(/[‘’]/g,'\'').replace(/[^a-z0-9$%.'\s-]/g,' ').replace(/\s+/g,' ').trim();
const tokens=text=>norm(text).split(' ').filter(Boolean).map(t=>t.replace(/^[.'-]+|[.'-]+$/g,''));
// Every spelling we accept, flattened once: alias -> feed. Built from the two
// tables above so there is exactly one place to add a name.
const ALIAS_TO_FEED=(()=>{
  const m=new Map();
  for(const [feed,list] of Object.entries(ASSET_WORDS)) for(const a of list) m.set(a,feed);
  for(const [feed,list] of Object.entries(ASSET_TYPOS)) for(const a of list) m.set(a,feed);
  return m;
})();
// Words that mean something else in this grammar. A misspelling must never be
// "corrected" into an asset when the player was speaking the command language:
// 'sell' is one edit from 'sol', and reading it as Solana would be a bet nobody
// placed. Anything in here is off limits to the fuzzy pass, full stop.
const RESERVED=new Set([...UP_WORDS,...DOWN_WORDS,...NEGATIONS,...STATUS_WORDS,...PLAY_VERBS,...PLAY_NOUNS,
  'ratchet','ratchetx','rcx','credits','credit','max','all','half','min','mins','minute','minutes',
  'hour','hours','day','daily','on','the','a','an','my','me','i','is','it','to','at','in','of','and','or','for','with','next',
  // Ordinary words that sit within one edit of an asset name. 'either' is one
  // deletion from 'ether', so "either higher or lower" would otherwise have
  // read as an Ethereum call. Each of these is here because it collides, not
  // because it is common.
  'either','neither','whether','other','others','value','level','close','closes','price','prices','total','still','while','their','there']);
/** Damerau-Levenshtein, capped: it stops as soon as the distance exceeds `max`,
 *  so a long word never costs a full matrix. Transposition counts as one edit
 *  because 'telsa' is the single commonest way to misspell 'tesla'. */
function editDistance(a,b,max){
  if(Math.abs(a.length-b.length)>max)return max+1;
  const prev2=[],prev=[],cur=[];
  for(let j=0;j<=b.length;j++)prev[j]=j;
  for(let i=1;i<=a.length;i++){
    cur[0]=i; let best=i;
    for(let j=1;j<=b.length;j++){
      const cost=a[i-1]===b[j-1]?0:1;
      let v=Math.min(cur[j-1]+1,prev[j]+1,prev[j-1]+cost);
      if(i>1&&j>1&&a[i-1]===b[j-2]&&a[i-2]===b[j-1])v=Math.min(v,prev2[j-2]+1);
      cur[j]=v; if(v<best)best=v;
    }
    if(best>max)return max+1;
    for(let j=0;j<=b.length;j++){prev2[j]=prev[j];prev[j]=cur[j];}
  }
  return prev[b.length];
}
/** One near-miss word -> one feed, or a refusal. Never a guess between two.
 *
 *  The budget is deliberately mean: one edit for a short word, two only from
 *  seven characters up, where two edits is still a small fraction of the word.
 *  A word that lands within budget of TWO different assets is not a typo we can
 *  read, it is a coin flip, and this returns {ambiguous} so the caller refuses
 *  rather than picking. That is the whole point: the parser should be unable to
 *  place a bet the player did not make, not merely unlikely to. */
function fuzzyAsset(words){
  const hits=new Map();   // feed -> {word, alias, dist}
  for(const w of words){
    if(w.length<4||RESERVED.has(w)||ALIAS_TO_FEED.has(w))continue;
    if(/^\d+$/.test(w))continue;
    const budget=w.length>=7?2:1;
    for(const [alias,feed] of ALIAS_TO_FEED){
      if(alias.length<4)continue;                        // 'sol','btc','eth' are too short to risk
      const d=editDistance(w,alias,budget);
      if(d>budget)continue;
      const cur=hits.get(feed);
      if(!cur||d<cur.dist)hits.set(feed,{word:w,alias,dist:d});
    }
  }
  if(hits.size===0)return null;
  if(hits.size>1)return {ambiguous:[...hits.keys()].sort()};
  const [feed,info]=[...hits][0];
  return {feed,...info};
}
function findAsset(words,feeds,raw='',notes=null){
  const joined=' '+words.join(' ')+' ';
  if(/\$pump\b|\bpump(?:\.fun|fun| token| coin)\b|\bon pump\b|\bpump (?:higher|lower|up|down|goes|will|to)\b/.test(joined)&&feeds.includes('PUMP'))return 'PUMP';
  // Collect EVERY asset the words name, then decide -- rather than returning
  // the first one found. First-match-wins looked harmless while a message named
  // at most one asset, but it resolved "bitcoin or ethereum" to whichever the
  // table happened to list first, which is not the player's order and not their
  // choice. Two assets named is two assets named, however they were spelled.
  const named=new Map();                       // feed -> the word that named it
  const see=(feed,word)=>{ if(!named.has(feed))named.set(feed,word); };
  for(const w of words){
    const bare=w.replace(/^\$/,'');
    const exact=ALIAS_TO_FEED.get(bare);
    if(exact){ see(exact,bare); continue; }
    const up=bare.toUpperCase();
    if(/^[A-Z]{2,6}$/.test(up)&&up!=='PUMP'&&up!=='NO'&&ASSET_WORDS[up]){
      if(AMBIGUOUS_TICKERS.has(up)&&!writtenAsTicker(raw,up))continue;
      see(up,bare);
    }
  }
  if(named.size>1)return {ambiguousBetween:[...named.keys()].sort()};
  if(named.size===1){
    const [feed,word]=[...named][0];
    if(notes&&!ASSET_WORDS[feed].includes(word))notes.push('read "'+word+'" as '+feed);
    return feeds.includes(feed)?feed:{unavailable:feed};
  }
  // Nothing named outright. Only now is a near miss worth reading, and only
  // when it can mean exactly one thing.
  const fz=fuzzyAsset(words);
  if(fz&&fz.ambiguous)return {ambiguousBetween:fz.ambiguous};
  if(fz){ if(notes)notes.push('read "'+fz.word+'" as '+fz.feed); return feeds.includes(fz.feed)?fz.feed:{unavailable:fz.feed}; }
  return null;
}
function findDirection(words,assetIsPump){
  let score=0,seen=0;
  for(let i=0;i<words.length;i++){
    const w=words[i];let sign=0;
    if(UP_WORDS.includes(w)||(!assetIsPump&&w==='pump'))sign=1;else if(DOWN_WORDS.includes(w))sign=-1;
    if(!sign)continue;
    if(w==='no'&&i+1<words.length&&['way','chance','shot','idea'].includes(words[i+1]))continue;
    if(w==='no'&&words[i+1]&&(UP_WORDS.includes(words[i+1])||DOWN_WORDS.includes(words[i+1])))continue; // "no higher" handled as negation
    const before=words.slice(Math.max(0,i-3),i);
    if(before.some(b=>NEGATIONS.includes(b)))sign=-sign;
    score+=sign;seen++;
  }
  return seen?(score>0?'YES':score<0?'NO':null):null;
}
function findProbability(text){
  const t=norm(text);let m;
  if((m=/(\d{1,3})\s*(?:%|percent|pct)/.exec(t)))return {p:Number(m[1])/100,source:'percent'};
  if((m=/\bp\s*[=:]?\s*(0?\.\d{1,2})\b/.exec(t)))return {p:Number(m[1]),source:'explicit'};
  if((m=/\b(0\.\d{1,2})\b/.exec(t)))return {p:Number(m[1]),source:'decimal'};
  if(/\b(certain|sure|definitely|guaranteed|confident|lock|obviously|clearly)\b/.test(t))return {p:0.75,source:'word'};
  if(/\b(likely|probably|think|expect|believe|should)\b/.test(t))return {p:0.60,source:'word'};
  return {p:0.55,source:'default'};
}
function findStake(text){
  const t=norm(text);let m;
  if(/\b(all in|all-in|allin|max|maximum|everything|full send|whole)\b/.test(t))return {stake:'max',source:'word'};
  if(/\bhalf\b/.test(t))return {stake:'half',source:'word'};
  if(/\b(minimum|smallest|tiny|small)\b/.test(t))return {stake:100,source:'word'};
  const re=/(?:^|[^$\w.])(\d+(?:\.\d+)?)\s*(k|thousand|credits?|cr|c)?\b(?!\s*(?:%|percent|pct|m\b|min|mins|minute|h\b|hr|hour|day|x\b))/g;
  let best=null;
  while((m=re.exec(t))){
    const before=t.slice(Math.max(0,m.index-12),m.index+1);
    if(/(?:to|at|above|below|over|under|past|hits?|reach(?:es)?|target|price|\$)\s*$/.test(before))continue;
    let n=Number(m[1]);if(m[2]==='k'||m[2]==='thousand')n*=1000;
    if(!Number.isFinite(n)||n<100)continue;
    n=Math.floor(n);if(best===null||m[2])best=n;
  }
  return best===null?{stake:null,source:'default'}:{stake:best,source:'number'};
}
function findHorizon(text){
  const t=norm(text);let m;
  if((m=/(\d+)\s*(?:m|min|mins|minute|minutes)\b/.exec(t)))return Number(m[1]);
  if((m=/(\d+)\s*(?:h|hr|hrs|hour|hours)\b/.exec(t)))return Number(m[1])*60;
  if(/\b(day|daily|24h|tomorrow)\b/.test(t))return 1440;
  return null;
}
/** One canonical explanation. Questions about RatchetX get this, not a shot. */
export const PITCH=`RatchetX - sealed prediction arcade on Solana. $RCX launched on pump.fun, CA FQb2EyaLZ9TWBemYmQ9zWtXcEwLiSXtz7j619ThQpump.
Call SOL, BTC, ETH and the crypto board higher or lower over minutes, sealed before the move, settled on verified Pyth-on-Solana data. No vote, no discretion.
Stocks stay held until an API-keyless sponsored on-chain equity feed can meet the same settlement rule.
Every call carries your probability; Brier scoring builds a public calibration record. Hits earn XP, rank and podium.
Every $RCX reload burns 70%, pays 30% to the podium, 0% to the team.
One flywheel: play -> XP -> podium -> $RCX -> reload -> burn + podium -> play. Humans and agents on one board. ratchetx.xyz`;
const EXPLAIN_PATTERN=/\b(what|whats|what's|how does|how do|explain|tell me|describe|why|wtf|wat)\b.*\b(ratchet|ratchetx|rcx|this|it|game|arcade|arena|podium|flywheel|rewards?)\b|\b(ratchet|ratchetx|rcx)\b\s*\?|\b(explain|info|about|intro|pitch)\b/;
export const HELP=`RatchetX commands (mention @bankrbot):
- ratchetx put 500 on sol higher - sealed forecast: asset, higher/lower, credits, optional 70%
- ratchetx play - quickest board target, 100 credits
- ratchetx board - what can be played right now
- ratchetx stats - credits, XP, Brier, session
- ratchetx leaderboard - who is winning right now
- ratchetx result - your latest settled forecast
- ratchetx what is this - how the flywheel works
Stocks are held until an API-keyless sponsored on-chain equity feed can settle them.
Setup: ratchetx.xyz/play-session.html`;
const META_PATTERN=/\b(update|upgrade|install|reinstall|uninstall|refresh|sync|latest version|github|skill|skills|repo|repository)\b/;
export const META_REPLY='That is a Bankr skill command, not a RatchetX play - nothing was sealed. Ask Bankr: "update the ratchetx skill from https://github.com/3esign/ratchetx/tree/main/skills/ratchetx".';
const HELP_PATTERN=/\b(help|menu|commands?|options|usage|how to play|how do i play|instructions)\b/;
const BOARD_PATTERN=/\b(board|games?|targets?|markets?|what can i play|what'?s (?:on|open|live)|whats (?:on|open|live)|list|available|open now)\b/;
const mins=m=>m%60===0?(m/60)+' h':m+' min';
/** Public board -> the shortest playable targets, one line each. Reveals nothing. */
export function boardReply(board,now=Date.now()){
  const dirs=(board?.targets||[]).filter(t=>t&&t.kind==='dir'&&!t.feed2&&integer(t.mins)&&!STOCKS.has(t.feed)).sort((a,b)=>a.mins-b.mins).slice(0,5);
  if(!dirs.length)return 'No playable target on the board right now. Try again in a minute.\n\n'+FOOTER;
  const left=finite(board.flipsAt)?Math.max(1,Math.round((board.flipsAt-now)/60000)):null;
  const head='On the board now'+(left?' (new board in '+mins(left)+')':'')+':';
  const rows=dirs.map((t,i)=>'- '+t.feed+(i===0?' higher or lower':'')+' in '+mins(t.mins));
  const ex=dirs[1]||dirs[0];
  return head+'\n'+rows.join('\n')+'\nPlay: "ratchetx put 500 on '+ex.feed.toLowerCase()+' lower"\n\n'+FOOTER;
}
/** Global standings from the public arena. Pure. */
export function leaderboardReply(arena){
  const all=Array.isArray(arena?.agents)?arena.agents:[];
  const ranked=all.filter(a=>a&&a.listed&&finite(a.brier)).sort((a,b)=>(b.brierIndex??-1)-(a.brierIndex??-1)||(b.xp||0)-(a.xp||0));
  if(!ranked.length)return 'No ranked forecasters yet - a Brier rank needs 10 stated-probability calls. Be first: play at ratchetx.xyz\n\n'+FOOTER;
  const rows=ranked.slice(0,5).map((a,i)=>(i+1)+'. '+(a.name||a.w||'agent')+' - '+Number(a.xp||0).toLocaleString()+' XP, Brier '+Number(a.brier).toFixed(3)+(a.streak>0?', streak '+a.streak:''));
  return 'RatchetX leaderboard - sharpest forecasters (lower Brier is better):\n'+rows.join('\n')+'\n\nRanked needs 10 stated calls. Play: ratchetx play\n\n'+FOOTER;
}
/** Status-only when the words ask about numbers and name nothing to play;
 * explain when they ask what RatchetX is; otherwise one shot. */
export function classifyCommand(text){
  const words=tokens(String(text??'').slice(0,SAY_MAX));
  const verb=words.some(w=>PLAY_VERBS.includes(w)),dir=findDirection(words,false)!==null,stake=findStake(text).stake!==null;
  const status=words.some(w=>STATUS_WORDS.includes(w));
  const plain=norm(String(text??''));
  if(META_PATTERN.test(plain)&&!dir&&!stake)return 'meta';
  if(HELP_PATTERN.test(plain)&&!dir&&!stake)return 'help';
  if(BOARD_PATTERN.test(plain)&&!dir&&!stake&&!/^(?:\$?\w+\s+)?(?:ratchetx?\s+)?(?:play|shoot|fire|bet|put|spend|wager|predict)\b/.test(plain))return 'board';
  if((LEADERBOARD_PATTERN.test(plain)||words.some(w=>LEADERBOARD_WORDS.includes(w)))&&!verb&&!dir&&!stake)return 'leaderboard';
  if(status&&!verb&&!dir&&!stake)return 'status';
  const asked=EXPLAIN_PATTERN.test(norm(String(text??'')))||/^\W*\$?(ratchet|ratchetx|rcx)\W*\?\W*$/i.test(String(text??''));
  if(asked&&!dir&&!stake&&!verb)return 'explain';
  return 'execute';
}
/** Resolve words into one directional intent on the current board. Pure. */
export function resolveIntent(text,{board,context,limits,session,player,overrides={}}){
  const raw=String(text??'').slice(0,SAY_MAX),words=tokens(raw),notes=[];
  // Local policy firewall: a stale or misconfigured upstream board cannot
  // make a stock playable. The parser still recognizes stock names so it can
  // refuse exactly what the user asked for instead of substituting a token.
  const dirs=(board?.targets||[]).filter(t=>t&&t.kind==='dir'&&!t.feed2&&typeof t.id==='string'&&integer(t.mins)&&t.mins>=1&&!STOCKS.has(t.feed));
  need(dirs.length>0,'TARGET_UNAVAILABLE');
  const feeds=[...new Set(dirs.map(t=>t.feed))];
  let asset=overrides.asset?String(overrides.asset).toUpperCase():findAsset(words,feeds,raw,notes);
  // A near-miss word that is within reach of two different assets is a coin
  // flip, not a typo. Refuse and let the player spell it, rather than pick one
  // and be right half the time with their credits.
  if(asset&&asset.ambiguousBetween)
    stop('ASSET_AMBIGUOUS','REFUSED',{candidates:asset.ambiguousBetween});
  // A named asset that is not on this board is a REFUSAL, never a substitution.
  // This used to fall back to the shortest available target. Spending a stake
  // on an instrument the player did not name is never a degraded answer.
  if(asset&&(typeof asset==='object'||!feeds.includes(asset)))
    stop('ASSET_NOT_ON_BOARD','REFUSED',
      {requestedAsset:typeof asset==='object'?asset.unavailable:asset,availableAssets:feeds});
  let candidates=asset?dirs.filter(t=>t.feed===asset):dirs;
  const horizon=overrides.horizon??findHorizon(raw);
  let target;
  if(overrides.target){target=dirs.find(t=>t.id===overrides.target);need(target,'TARGET_UNAVAILABLE');}
  else if(horizon){
    target=candidates.find(t=>t.mins===horizon);
    if(!target){target=[...candidates].sort((a,b)=>Math.abs(a.mins-horizon)-Math.abs(b.mins-horizon)||a.mins-b.mins)[0];
      notes.push('requested '+horizon+' min horizon unavailable for that asset; nearest is '+target.mins+' min');}
  }else{
    // No asset named: shortest target, but never one whose feed is already
    // near its seal-age limit (JUP/ETH publish every ~30 s; SOL/BTC every second).
    const age=t=>{const c=context?.feeds?.find(row=>row.feed===t.feed)?.current;return finite(c?.ageNowS)?c.ageNowS:0;};
    const limit=t=>Math.min(60,Math.max(30,Math.round(0.15*t.mins*60)));
    const fresh=candidates.filter(t=>age(t)<=limit(t)-15);
    target=[...(fresh.length?fresh:candidates)].sort((a,b)=>a.mins-b.mins||age(a)-age(b))[0];
    if(!fresh.length)notes.push('no fresh feed on the board; oracle may refuse');
  }
  if(asset&&!horizon&&target.mins>60)notes.push('that asset settles in '+target.mins+' min on this board');
  const feed=context?.feeds?.find(row=>row.feed===target.feed),ema=feed?.current?.priceVsEmaBps;
  if(!asset&&!overrides.asset){
    // A $TICKER is an unmistakable naming of an asset, so an unknown one is
    // refused on the same principle as above rather than quietly redirected.
    const dollar=String(raw).match(/\$([A-Za-z]{2,6})\b/);
    if(dollar&&!feeds.includes(dollar[1].toUpperCase())&&!['YES','NO','MAX','ALL'].includes(dollar[1].toUpperCase()))
      stop('ASSET_NOT_ON_BOARD','REFUSED',{requestedAsset:dollar[1].toUpperCase(),availableAssets:feeds});
    // A bare run of capitals is far weaker evidence -- "ratchetx PLAY 500" --
    // so it stays a note on a shot that still happens, exactly as before.
    const ticker=String(raw).match(/\b([A-Z]{3,6})\b/);
    if(ticker&&!feeds.includes(ticker[1].toUpperCase())&&!['YES','NO','MAX','ALL'].includes(ticker[1].toUpperCase()))
      notes.push('no asset on this board was named; played the shortest board target');
  }
  let side=overrides.direction?(/^(yes|up|higher|long)$/i.test(overrides.direction)?'YES':'NO'):findDirection(words,asset==='PUMP');
  let sideSource=side?'user':null;
  const price=feed?.current?.price,level=/(?:\bto|\bat|\bhits?|\breach(?:es)?|\btouch(?:es)?|\bcross(?:es)?)\s*\$?(\d+(?:\.\d+)?)\s*(k|m)?\b/i.exec(norm(raw));
  if(!side&&level&&finite(price)&&price>0){
    const value=Number(level[1])*(level[2]==='k'?1e3:level[2]==='m'?1e6:1);
    if(finite(value)&&value>0&&value!==price){side=value>price?'YES':'NO';sideSource='price-level';}
  }
  if(!side){side=finite(ema)&&ema<0?'NO':'YES';sideSource=finite(ema)?'ema-trend':'default';}
  let {p,source:pSource}=overrides.p!==undefined?{p:overrides.p,source:'flag'}:findProbability(raw);
  p=Math.round(p*100)/100;
  // A stated direction is never flipped. A number under 50% next to a
  // direction is usually a size ("up 20%"), not a confidence, so it is dropped.
  if(p<0.5&&pSource!=='flag'){notes.push('number under 50% ignored as confidence');p=0.55;pSource='default';}
  p=Math.min(0.99,Math.max(0.01,p));
  const remainingGross=limits.maxGrossCredits-session.grossCredits;
  const ceiling=Math.max(0,Math.min(limits.maxStakeCredits,remainingGross,Math.floor(player.credits),board?.stakeRule?.max??Infinity));
  let {stake,source:stakeSource}=overrides.stake!==undefined?{stake:overrides.stake,source:'flag'}:findStake(raw);
  let requested=stake;
  if(stake==='max')stake=ceiling;else if(stake==='half')stake=Math.floor(player.credits/2/100)*100;else if(stake===null)stake=100;
  stake=Math.floor(stake);
  if(stake>ceiling){notes.push('stake '+stake+' clamped to allowed '+ceiling);stake=ceiling;}
  if(stake<100)stake=100;
  return {target:target.id,side,p,stake,resolution:{feed:target.feed,horizonMinutes:target.mins,asset,sideSource,pSource,
    stakeSource,requestedStake:typeof requested==='number'?requested:requested??null,notes}};
}

/** Injected dependencies permit offline fixtures. Only the protected env var
 * supplies a capability. Output is allowlisted; journal intent stays private.
 * Distinct commands still require explicit requester approval in the caller.
 */
export async function runPlay(options={},dependencies={}){
  // The protected token already names the owner wallet and session
  // (rxp1.<wallet>.<session>.<secret>). Callers may omit both; explicit values
  // must still match the token (a replaced grant is never silently accepted
  // under an old expectation).
  {const t=(dependencies.env??process.env)?.RATCHET_PLAY_SESSION,m=typeof t==='string'&&TOKEN.exec(t);
    options={...options};
    if(m){if(options.wallet===undefined)options.wallet=m[1];if(options.sessionId===undefined)options.sessionId=m[2];}}
  const {fetch:fetcher=globalThis.fetch,now=()=>performance.now(),sleep=ms=>new Promise(r=>setTimeout(r,ms)),
    journal,env=process.env,onEvent=()=>{}}=dependencies;
  let phase=options.mode==='status'?'status':'preflight',clock=null,start=null,wire=null,wirePersisted=false;
  let retained=false,debit=false,shotId=null,requestId=null,commandId=options.commandId;
  const began=now(),maxWait=options.maxWaitMs??(options.mode==='status'?15000:21*60000),pollMs=options.pollMs??30000;
  const serverNow=()=>{need(clock,'SERVER_DATE_REQUIRED');return clock.server+Math.max(0,now()-clock.local);};
  const emit=code=>{try{onEvent({phase,code});}catch{}};
  const result=(category,code,extra={})=>({ok:['PASS','STATUS'].includes(category),category,code,phase,
    ...(typeof options.wallet==='string'&&WALLET.test(options.wallet)?{wallet:options.wallet}:{}),
    ...(typeof options.sessionId==='string'&&HEX32.test(options.sessionId)?{sessionId:options.sessionId}:{}),
    ...(typeof commandId==='string'&&COMMAND.test(commandId)?{commandId}:{}),...(requestId?{requestId}:{}),
    journalRetained:retained,immediateWireReplayVerified:!!wire&&wirePersisted,debitObserved:debit,
    ...(shotId?{shotId,proofUrl:ORIGIN+'/api/shot?w='+encodeURIComponent(options.wallet)+'&id='+shotId}:{}),...extra});
  const append=async value=>{try{await journal.append(value);}catch{stop('JOURNAL_WRITE_FAILED');}};
  try{
    need(['status','execute','resume'].includes(options.mode),'EXPLICIT_MODE_REQUIRED');
    need(Object.keys(options).every(key=>['mode','wallet','sessionId','commandId','target','side','p','stake','say','asset','direction','horizon','maxWaitMs','pollMs','waitSettle'].includes(key)),'INVALID_OPTIONS');
    if(options.mode!=='execute')need(!['commandId','target','side','p','stake','say','asset','direction','horizon'].some(key=>key in options),'STATUS_ONLY_MODE');
    if(options.wallet===undefined||options.sessionId===undefined)stop('MISSING_OR_INVALID_CAPABILITY');
    need(typeof options.wallet==='string'&&WALLET.test(options.wallet)
      &&typeof options.sessionId==='string'&&HEX32.test(options.sessionId),'EXPECTED_IDENTITY_REQUIRED');
    need(integer(maxWait)&&maxWait>=5000&&maxWait<=25*60000&&integer(pollMs)&&pollMs>=5000&&pollMs<=30000,'INVALID_WAIT');
    if(options.mode!=='status')need(journal&&typeof journal.create==='function'&&typeof journal.read==='function'
      &&typeof journal.append==='function','JOURNAL_REQUIRED');
    else need(!journal,'STATUS_REQUIRES_NO_JOURNAL');
    const token=env.RATCHET_PLAY_SESSION,parts=typeof token==='string'&&TOKEN.exec(token);
    need(parts,'MISSING_OR_INVALID_CAPABILITY');
    need(parts[1]===options.wallet&&parts[2]===options.sessionId,'CAPABILITY_IDENTITY_MISMATCH');
    async function request(url,body){
      need(Object.values(URLS).includes(url)&&(!body||url===URLS.session),'DESTINATION_REFUSED');
      const remaining=maxWait-(now()-began);if(remaining<=0)stop('WAIT_LIMIT','PENDING');
      const headers={Accept:'application/json'};
      if(body){headers['Content-Type']='application/json';headers.Authorization='Bearer '+token;}
      let response;
      try{response=await fetcher(url,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined,
        redirect:'error',cache:'no-store',signal:AbortSignal.timeout(Math.max(1,Math.floor(Math.min(15000,remaining))))});}
      catch{stop('TRANSPORT_UNCERTAIN','PENDING');}
      need(!response.redirected&&(!response.url||response.url===url)&&integer(response.status)
        &&response.status>=200&&response.status<=599&&!(response.status>=300&&response.status<400),'REDIRECT_REFUSED');
      const age=Number(response.headers?.get('age')||0);need(finite(age)&&age>=0&&age<=86400,'INVALID_SERVER_AGE');
      const stamp=Date.parse(response.headers?.get('date')||'')+age*1000;need(finite(stamp),'SERVER_DATE_REQUIRED');
      if(clock)need(stamp>=clock.server-2000,'SERVER_CLOCK_REWIND');
      clock={server:stamp,local:now()};
      let value;
      try{const text=await response.text();need(text.length<=262144,'RESPONSE_TOO_LARGE');value=JSON.parse(text);}
      catch(error){if(error instanceof Stop)throw error;stop('INVALID_RESPONSE');}
      need(value&&typeof value==='object'&&!Array.isArray(value),'INVALID_RESPONSE');
      return {http:response.status,body:value};
    }
    function status(r){
      // The per-wallet status throttle (5 s) is a collision with another
      // request for this wallet, not a play cooldown: carry its retry hint.
      if(r.http===429&&r.body.code==='SESSION_RATE_LIMIT'){const e=new Stop('STATUS_THROTTLED','PENDING');e.retryAfterSeconds=finite(r.body.retryAfterSeconds)?r.body.retryAfterSeconds:5;throw e;}
      if(r.http!==200||r.body.ok!==true)stop(CODES.has(r.body.code)?r.body.code:'STATUS_UNAVAILABLE','PENDING');
      const {session:s,player:p}=r.body;
      need(s&&s.wallet===options.wallet&&s.id===options.sessionId&&p?.wallet===options.wallet,'STATUS_IDENTITY_MISMATCH');
      need(s.revokedAt===null&&s.expired===false&&integer(s.expiresAt)&&s.expiresAt>serverNow(),'SESSION_INACTIVE');
      const l=bounds(s.limits);
      need(s.budgetRule==='gross-reserved-attempts-v1'&&integer(s.attempts)&&s.attempts<=l.maxAttempts
        &&integer(s.grossCredits)&&s.grossCredits<=l.maxGrossCredits&&s.requests&&typeof s.requests==='object'
        &&!Array.isArray(s.requests),'INVALID_SESSION');
      const rows=Object.entries(s.requests),pending=[];let gross=0,lastReservedAt=null;
      need(rows.length===s.attempts,'INVALID_SESSION');
      for(const [key,r] of rows){
        need(HEX32.test(key)&&r?.intent?.requestId===key&&validReceipt(r,r.intent),'INVALID_SESSION');
        gross+=r.stake;lastReservedAt=Math.max(lastReservedAt??0,r.reservedAt);
        if(r.state==='reserved')pending.push(key);
      }
      need(gross===s.grossCredits&&pending.length<=1
        &&s.pending===(pending.length?pending[0]:null),'INVALID_SESSION');
      playerShape(p);
      if(start)need(s.expiresAt===start.expiresAt&&same(l,start.limits),'SESSION_CHANGED');
      return {s,p,l,nextAttemptAt:lastReservedAt===null?null:lastReservedAt+l.minIntervalMs};
    }
    const summary=({s,p,l,nextAttemptAt})=>({expiresAt:s.expiresAt,limits:l,attempts:s.attempts,grossCredits:s.grossCredits,
      remainingAttempts:l.maxAttempts-s.attempts,remainingGrossCredits:l.maxGrossCredits-s.grossCredits,
      nextAttemptAt,pendingRequestId:s.pending,credits:p.credits,stated:p.stated,brier:p.brier,xp:p.xp,sessionEndsInMinutes:Math.max(0,Math.floor((s.expiresAt-serverNow())/60000)),
      open:p.open.map(row=>({shotId:row.id,expiresAt:row.exp})),
      closed:p.closed.slice(0,5).map(row=>({shotId:row.id,result:row.res,stake:row.stake,back:row.back??null,settledAt:row.settledAt??null})),
      effect:'Status may collect canonical settlement; no forecast was submitted.'});
    if(options.mode==='status')return result('STATUS','STATUS',summary(status(await request(URLS.session,{op:'status'}))));

    if(options.mode==='resume'){
      phase='resume';let entries;
      try{entries=await journal.read();retained=true;}catch{stop('JOURNAL_READ_FAILED');}
      need(Array.isArray(entries)&&entries.length>=1&&entries.length<=10,'INVALID_JOURNAL');start=entries[0];
      need(start?.schema===SCHEMA&&start.kind==='start'&&start.wallet===options.wallet&&start.sessionId===options.sessionId
        &&COMMAND.test(start.commandId||'')&&validIntent(start.intent)&&integer(start.createdAt)&&integer(start.expiresAt),'INVALID_JOURNAL');
      commandId=start.commandId;requestId=commandRequestId(options.wallet,options.sessionId,commandId);
      need(requestId===start.intent.requestId&&same(bounds(start.limits),start.limits)
        &&(start.horizonMs===undefined||integer(start.horizonMs)&&start.horizonMs>=60000&&start.horizonMs<=86400000),'INVALID_JOURNAL');
      const b=start.baseline;
      need(b&&finite(b.credits)&&b.credits>=start.intent.stake&&integer(b.stated)
        &&(b.stated===0?b.brier===null:finite(b.brier)&&b.brier>=0&&b.brier<=1)
        &&Array.isArray(b.closedIds)&&b.closedIds.every(id=>/^[a-z0-9]{4,16}$/i.test(id))
        &&new Set(b.closedIds).size===b.closedIds.length&&b.closedIds.length<=20
        &&finite(b.hitPayout)&&b.hitPayout>0&&integer(b.attempts)&&integer(b.grossCredits)
        &&b.requestHashes&&typeof b.requestHashes==='object'&&!Array.isArray(b.requestHashes)
        &&Object.entries(b.requestHashes).every(([id,value])=>HEX32.test(id)&&HEX64.test(value))
        &&Object.keys(b.requestHashes).length===b.attempts&&!Object.hasOwn(b.requestHashes,requestId)
        &&b.attempts<start.limits.maxAttempts&&b.grossCredits+start.intent.stake<=start.limits.maxGrossCredits,'INVALID_JOURNAL');
      for(const entry of entries.slice(1)){
        if(entry.kind==='wire'){
          need(!wire&&SHOT.test(entry.shotId)&&HEX64.test(entry.receiptHash)&&entry.submitHttp===200
            &&entry.replayHttp===200&&entry.idempotent===true&&typeof entry.debitObserved==='boolean','INVALID_JOURNAL');
          wire=entry;wirePersisted=true;shotId=entry.shotId;debit=entry.debitObserved;
        }else if(entry.kind==='debit'){
          need(!debit&&entry.credits===b.credits-start.intent.stake,'INVALID_JOURNAL');debit=true;
        }else stop('INVALID_JOURNAL');
      }
    }else{
      requestId=commandRequestId(options.wallet,options.sessionId,commandId);
      // Two ways to state intent: exact flags (target/side/p/stake), or the
      // user's words (--say, optionally --asset/--direction/--horizon) which the
      // runner resolves against the live board AFTER authenticating.
      const resolving=typeof options.say==='string'||['asset','direction','horizon'].some(key=>key in options);
      let intent=null,resolution=null;
      if(!resolving){
        intent={requestId,target:options.target,side:options.side,p:options.p,stake:options.stake??100};
        need(validIntent(intent),'EXPLICIT_INTENT_REQUIRED');
      }else need((options.say===undefined||typeof options.say==='string'&&options.say.length<=SAY_MAX)
        &&(options.asset===undefined||/^\$?[A-Za-z]{2,8}$/.test(options.asset))
        &&(options.direction===undefined||/^(yes|no|up|down|higher|lower|long|short)$/i.test(options.direction))
        &&(options.horizon===undefined||integer(options.horizon)&&options.horizon>=1&&options.horizon<=1440)
        &&(options.target===undefined||/^[A-Za-z0-9:_-]{3,96}$/.test(options.target))
        &&(options.side===undefined||['YES','NO'].includes(options.side))
        &&(options.p===undefined||finite(options.p))&&(options.stake===undefined||integer(options.stake)),'EXPLICIT_INTENT_REQUIRED');
      // Authenticate first. Duplicate public command IDs stop here, even when
      // delivered with another journal path, and never consume another attempt.
      const before=status(await request(URLS.session,{op:'status'})),{s,p,l,nextAttemptAt}=before;
      const old=s.requests[requestId];
      if(old){
        // Words resolve against a board that flips hourly, so a redelivered
        // --say command is answered by its retained receipt, never a conflict.
        if(intent&&!same(old.intent,intent))return result('REFUSED','COMMAND_CONFLICT');
        if(old.state==='accepted')shotId=old.result.shotId;
        return result('DUPLICATE','COMMAND_ALREADY_RECORDED',{requestState:old.state,
          ...(old.state==='rejected'?{refusalCode:safeCode(old.result?.code)}:{}),next:'Use the original private journal with --resume; never change command ID to retry this instruction.'});
      }
      if(s.pending)return result('PENDING','PRIOR_ATTEMPT_UNRESOLVED');
      // Local pre-check saves gross allowance: a server CHAMBERS_FULL refusal
      // would still reserve an attempt.
      if(p.open.length>=(integer(p.chambers)&&p.chambers>=1?p.chambers:MIN_CHAMBERS))
        return result('REFUSED','CHAMBERS_FULL',{openShots:p.open.length});
      let contract,context,board;
      const read=async()=>{contract=await request(URLS.session);context=await request(URLS.context);board=await request(URLS.board);};
      if(resolving){
        await read();
        const r=resolveIntent(options.say??'',{board:board.body,context:context.body,limits:l,session:s,player:p,
          overrides:{asset:options.asset,direction:options.direction??options.side,horizon:options.horizon,target:options.target,p:options.p,stake:options.stake}});
        resolution=r.resolution;intent={requestId,target:r.target,side:r.side,p:r.p,stake:r.stake};
        need(validIntent(intent),'EXPLICIT_INTENT_REQUIRED');
      }
      if(s.attempts>=l.maxAttempts||intent.stake>l.maxStakeCredits||s.grossCredits+intent.stake>l.maxGrossCredits)
        return result('REFUSED','SESSION_BUDGET_EXHAUSTED');
      if(nextAttemptAt!==null&&nextAttemptAt>serverNow())return result('REFUSED','SESSION_RATE_LIMIT',
        {retryAfterSeconds:Math.ceil((nextAttemptAt-serverNow())/1000)});
      need(p.credits>=intent.stake,'INSUFFICIENT_CREDITS');
      need(s.expiresAt-serverNow()>=MIN_ROOM,'INSUFFICIENT_SESSION_LIFETIME');
      if(!resolving)await read();
      need(contract.http===200&&contract.body.ok===true&&contract.body.enabled===true&&contract.body.network==='solana:mainnet'
        &&same(contract.body.rights,['shot','status'])&&contract.body.requiresExistingAdmittedAgent===true
        &&contract.body.endpoint===URLS.session&&contract.body.budgetRule==='gross-reserved-attempts-v1'
        &&contract.body.agentContract?.shot?.replay&&contract.body.agentContract?.shot?.rejected,'CONTRACT_REFUSED');
      // An endpoint that did not answer has no version string, so comparing
      // versions first reports RELEASE_MISMATCH for what is actually an outage.
      // That happened on 2026-09-03: pyth-context was returning 500 (a migrated
      // key had the wrong Redis type), and the player was told the releases did
      // not match. Say which endpoint is down, and say it before anything that
      // reads a field out of a body that was never delivered.
      const dead=[['play-session',contract],['board',board],['pyth-context',context]]
        .filter(([,r])=>r.http!==200||r.body?.ok!==true)
        .map(([name,r])=>name+' '+r.http);
      need(dead.length===0,'ENDPOINT_UNAVAILABLE');
      need(typeof contract.body.v==='string'&&contract.body.v===context.body.v&&contract.body.v===board.body.v,'RELEASE_MISMATCH');
      need(board.http===200&&board.body.ok===true&&board.body.prices?.src==='pyth-onchain'
        &&finite(board.body.flipsAt)&&board.body.flipsAt>serverNow()&&finite(board.body.stakeRule?.hitPayout)
        &&board.body.stakeRule.hitPayout>0&&board.body.stakeRule.min<=intent.stake&&board.body.stakeRule.max>=intent.stake,'BOARD_REFUSED');
      const target=board.body.targets?.find(row=>row.id===intent.target);
      need(target&&target.kind==='dir'&&!target.feed2&&integer(target.mins)&&target.mins>=1&&target.mins<=1440,'TARGET_NOT_DIRECTIONAL');
      need(context.http===200&&context.body.ok===true&&context.body.schema==='ratchetx-pyth-context-v1'
        &&context.body.access?.mode==='shared-read'&&context.body.validation?.fullVerificationRequired===true
        &&context.body.validation?.ownerFeedIdAndDiscriminatorChecked===true
        &&context.body.validation?.maxConfidenceBps===200,'CONTEXT_REFUSED');
      const feed=context.body.feeds?.find(row=>row.feed===target.feed),q=feed?.current;
      need(finite(context.body.generatedAt)&&context.body.generatedAt<=serverNow()+2000&&q
        &&finite(q.price)&&q.price>0&&finite(q.ageNowS)&&q.ageNowS>=0&&finite(q.publishTime)&&finite(q.prevPublishTime)
        &&feed.activeTargets?.some(row=>row.id===intent.target),'CONTEXT_REFUSED');
      const freshness=()=>Math.max(q.ageNowS,(serverNow()-q.publishTime*1000)/1000,
        q.ageNowS+Math.max(0,serverNow()-context.body.generatedAt)/1000);
      // Same seal rule as api/game.js maxSealAge: slow feeds (JUP, ETH) on long
      // windows get 60 s; the 5-minute flash keeps 45 s.
      const maxSealAge=Math.min(60,Math.max(30,Math.round(0.15*target.mins*60)));
      // A slow feed can be one publish away from fresh: re-read the shared
      // context (read-only) up to twice before refusing locally.
      for(let again=0;again<2&&!(finite(freshness())&&freshness()<=maxSealAge);again++){
        await sleep(4000);context=await request(URLS.context);
        const nf=context.body?.feeds?.find(row=>row.feed===target.feed);
        if(nf?.current&&finite(nf.current.ageNowS)&&finite(nf.current.publishTime)){Object.assign(feed,nf);Object.assign(q,nf.current);}
      }
      need(finite(freshness())&&freshness()<=maxSealAge,'ORACLE_STALE');
      need(finite(q.confidenceBps)&&q.confidenceBps>=0&&q.confidenceBps<=200,'ORACLE_CONFIDENCE_TOO_WIDE');
      start={schema:SCHEMA,kind:'start',wallet:options.wallet,sessionId:options.sessionId,commandId,intent,horizonMs:target.mins*60000,
        ...(resolution?{resolution}:{}),createdAt:Math.floor(serverNow()),expiresAt:s.expiresAt,limits:l,baseline:{credits:p.credits,stated:p.stated,brier:p.brier,
          closedIds:ids(p.closed),hitPayout:board.body.stakeRule.hitPayout,attempts:s.attempts,grossCredits:s.grossCredits,
          requestHashes:Object.fromEntries(Object.entries(s.requests).map(([id,r])=>[id,hash(r)]))}};
      try{await journal.create(start);retained=true;}catch{stop('JOURNAL_CREATE_FAILED');}
      need(start.expiresAt-serverNow()>=MIN_ROOM,'INSUFFICIENT_SESSION_LIFETIME');
      need(freshness()<=maxSealAge,'ORACLE_STALE');
      phase='submit';emit('SUBMIT_ONCE');const body={op:'shot',intent};
      const submitted=await request(URLS.session,body);
      if(submitted.body.request?.state==='rejected'&&validReceipt(submitted.body.request,intent))
        return result('REFUSED',safeCode(submitted.body.request.result?.code));
      if(submitted.http!==200||submitted.body.ok!==true||submitted.body.idempotent===true
        ||!validReceipt(submitted.body.request,intent)||submitted.body.request.state!=='accepted')
        return result('PENDING','SUBMIT_UNRESOLVED');
      shotId=submitted.body.request.result.shotId;
      // Adjacent wire requests: no sleep, status, log or journal append here.
      phase='replay';const replay=await request(URLS.session,body);
      if(replay.http!==200||replay.body.ok!==true||replay.body.idempotent!==true
        ||!same(replay.body.request,submitted.body.request))return result('PENDING','REPLAY_UNVERIFIED');
      debit=submitted.body.credits===start.baseline.credits-intent.stake;
      wire={kind:'wire',shotId,receiptHash:hash(replay.body.request),submitHttp:200,replayHttp:200,idempotent:true,debitObserved:debit};
      await append(wire);wirePersisted=true;emit('IMMEDIATE_WIRE_REPLAY_VERIFIED');
      if(finite(submitted.body.credits)&&!debit)stop('CONCURRENT_ACCOUNTING_CHANGE','INCONCLUSIVE');
      if(!options.waitSettle){
        // Sealed output never carries target, side or p: the reply on X must
        // not leak the sealed call. Stake and horizon are safe to state.
        return result('PASS','SEALED',{
          status:'SEALED',
          shotId,
          proofUrl:ORIGIN+'/api/shot?w='+encodeURIComponent(options.wallet)+'&id='+shotId,
          creditsRemaining:submitted.body.credits,
          stakeCredits:intent.stake,settlesInMinutes:target.mins,sessionEndsInMinutes:Math.max(0,Math.floor((s.expiresAt-serverNow())/60000)),
          ...(resolution?{notes:resolution.notes}:{}),
          message:'Prediction sealed on-chain.'
        });
      }
    }

    phase='settlement';let first=options.mode==='resume',nextPoll=wire&&debit?null:0;const horizonMs=start.horizonMs??HORIZON;
    while(now()-began<maxWait){
      if(clock&&serverNow()+5000>=start.expiresAt)return result('PENDING','SESSION_EXPIRING');
      if(!first){
        // With a directly observed debit, no pre-expiry status polling is needed.
        const desired=nextPoll===null?start.createdAt+horizonMs:nextPoll||serverNow()+5000;
        while(serverNow()<desired){
          const remaining=maxWait-(now()-began);if(remaining<=0)return result('PENDING','WAIT_LIMIT');
          await sleep(Math.min(30000,desired-serverNow(),remaining));
        }
      }
      first=false;if(now()-began>=maxWait)return result('PENDING','WAIT_LIMIT');
      const {s,p}=status(await request(URLS.session,{op:'status'})),r=s.requests[requestId],b=start.baseline,stake=start.intent.stake;
      if(!r)return result('PENDING','ATTEMPT_NOT_FOUND');
      need(same(r.intent,start.intent),'COMMAND_CONFLICT');
      if(r.state==='rejected')return result('REFUSED',safeCode(r.result?.code));
      if(r.state==='reserved')return result('PENDING','ATTEMPT_RESERVED');
      need(validReceipt(r,start.intent)&&r.state==='accepted','INVALID_ACCEPTED_RECEIPT');shotId=r.result.shotId;
      if(wire)need(wire.shotId===shotId&&wire.receiptHash===hash(r),'RECEIPT_CHANGED');
      if(s.attempts!==b.attempts+1||s.grossCredits!==b.grossCredits+stake||s.pending!==null
        ||Object.keys(s.requests).length!==b.attempts+1||Object.entries(b.requestHashes).some(([id,h])=>!s.requests[id]||hash(s.requests[id])!==h))
        stop('SESSION_ACCOUNTING_CHANGED','INCONCLUSIVE');
      const openIds=ids(p.open),closedIds=ids(p.closed),closed=p.closed.find(row=>row.id===shotId),opened=p.open.find(row=>row.id===shotId),shot=closed||opened;
      need(shot&&shot.requestId===`session:${options.sessionId}:${requestId}`&&shot.stake===stake&&integer(shot.exp)
        &&shot.exp>=r.reservedAt+horizonMs&&shot.exp<=r.finishedAt+horizonMs&&r.finishedAt<start.expiresAt,'SHOT_IDENTITY_MISMATCH');
      if(!same(openIds,closed?[]:[shotId])||!same(closedIds,closed?[shotId,...b.closedIds].slice(0,20):b.closedIds))
        stop('CONCURRENT_ACTIVITY','INCONCLUSIVE');
      if(!closed){
        if(p.credits!==b.credits-stake||p.stated!==b.stated||p.brier!==b.brier)stop('CONCURRENT_ACCOUNTING_CHANGE','INCONCLUSIVE');
        if(!debit){await append({kind:'debit',credits:p.credits});debit=true;}
        nextPoll=Math.max(shot.exp,serverNow()+pollMs);emit('SETTLEMENT_PENDING');continue;
      }
      need(['hit','miss','void'].includes(closed.res)&&closed.side===start.intent.side&&closed.sp===start.intent.p
        &&integer(closed.settledAt)&&closed.settledAt>=shot.exp&&closed.settledAt<=serverNow()+2000,'TERMINAL_IDENTITY_MISMATCH');
      const hit=closed.res==='hit',voided=closed.res==='void',payout=hit?Math.floor(stake*b.hitPayout):voided?stake:0;
      if(p.credits!==b.credits-stake+payout||p.stated!==b.stated+(voided?0:1))stop('CONCURRENT_ACCOUNTING_CHANGE','INCONCLUSIVE');
      if(hit&&closed.back!==payout)stop('PAYOUT_CHANGED','INCONCLUSIVE');
      const loss=voided?null:(start.intent.p-(hit?1:0))**2;
      const mean=voided?b.brier:((b.brier??0)*b.stated+loss)/p.stated;
      const tolerance=voided?0:0.000051+b.stated*0.00005/p.stated;
      if(mean===null?p.brier!==null:!finite(p.brier)||Math.abs(p.brier-mean)>tolerance)stop('BRIER_ACCOUNTING_CHANGED','INCONCLUSIVE');
      const accounting={outcome:closed.res.toUpperCase(),stakeCredits:stake,creditsBefore:b.credits,creditsAfter:p.credits,
        statedBefore:b.stated,statedAfter:p.stated,squaredError:loss,brier:p.brier,brierCheck:'public-rounded-mean',
        remainingAttempts:s.limits.maxAttempts-s.attempts,remainingGrossCredits:s.limits.maxGrossCredits-s.grossCredits};
      if(!wire||!wirePersisted||!debit)return result('INCONCLUSIVE','SETTLED_WITHOUT_COMPLETE_WIRE_EVIDENCE',accounting);
      return result('PASS','PASS_'+closed.res.toUpperCase(),accounting);
    }
    return result('PENDING','WAIT_LIMIT');
  }catch(error){
    const code=error instanceof Stop?error.code:'RUNNER_FAILED';let category=error instanceof Stop?error.category:'FAILED';
    if(['submit','replay'].includes(phase)&&category==='FAILED'&&code!=='JOURNAL_WRITE_FAILED')category='PENDING';
    return result(category,code,error instanceof Stop&&error.detail?error.detail:{});
  }finally{try{await journal?.close?.();}catch{}}
}

// ---- One reply per result. The agent posts `reply` verbatim; nothing else. --
const FOOTER='ratchetx.xyz - solana prediction arcade rewarding $RCX';
const NEW_SESSION='Approve a new play session at ratchetx.xyz/play-session.html.';
const REFUSALS={
  SESSION_RATE_LIMIT:r=>'Cooldown active. Please retry in '+(r.retryAfterSeconds??'a few')+' s. Nothing was sealed.',
  STATUS_THROTTLED:()=>'Another request for this wallet was running at the same time. Nothing was sealed - send the command again in a minute.',
  CHAMBERS_FULL:()=>'All your forecast chambers are active. Wait for one to settle.',
  SESSION_BUDGET_EXHAUSTED:()=>'This play session\'s allowance is used up. '+NEW_SESSION,
  INSUFFICIENT_CREDITS:()=>'Not enough play credits for that stake.',
  SESSION_EXPIRED:()=>'Your play session has expired. '+NEW_SESSION,
  SESSION_REVOKED:()=>'Your play session was revoked. '+NEW_SESSION,
  SESSION_INACTIVE:()=>'Your play session is no longer active. '+NEW_SESSION,
  INSUFFICIENT_SESSION_LIFETIME:()=>'Your play session ends too soon for a new forecast. '+NEW_SESSION,
  ORACLE_STALE:()=>'The oracle is not fresh enough right now. Try again in a minute.',
  ORACLE_CONFIDENCE_TOO_WIDE:()=>'The oracle is not fresh enough right now. Try again in a minute.',
  FEED_UNAVAILABLE:()=>'That feed is not on the board right now. Try again in a minute.',
  TARGET_UNAVAILABLE:()=>'No playable target on the board right now. Try again in a minute.',
  AGENT_ADMISSION_REQUIRED:()=>'This wallet is not admitted to ranked play yet. Register at ratchetx.xyz first.',
  MISSING_OR_INVALID_CAPABILITY:()=>'No RatchetX play session is configured for this account. '+NEW_SESSION,
  ASSET_AMBIGUOUS:r=>{
    const c=Array.isArray(r.candidates)?r.candidates.join(' or '):'more than one asset';
    return 'Nothing was sealed. That could have meant '+c+', and RatchetX will not guess between two assets with your credits. Spell the one you want and send it again.';
  },
  ASSET_NOT_ON_BOARD:r=>{
    const want=r.requestedAsset?String(r.requestedAsset).toUpperCase():'That asset';
    const have=Array.isArray(r.availableAssets)&&r.availableAssets.length
      ? ' On the board now: '+r.availableAssets.join(', ')+'.' : '';
    // A stock is not absent for an hour. It is held until the API-keyless
    // oracle path has a sponsored on-chain equity account that can satisfy the
    // same seal and settlement evidence rules as crypto.
    if(STOCKS.has(want))
      return 'Nothing was sealed. '+want+' is a stock. RatchetX\'s API-keyless oracle path has no sponsored on-chain equity feed, so stocks stay held and the game will not settle on a source it cannot verify by the same rule as crypto.'+have;
    return 'Nothing was sealed. '+want+' is not on the board this hour, and RatchetX will not put your credits on a different asset than the one you named.'+have+' The board changes every hour - reply "ratchetx board" to see it.';
  },
  CAPABILITY_IDENTITY_MISMATCH:()=>'No RatchetX play session is configured for this account. '+NEW_SESSION,
  PRIOR_ATTEMPT_UNRESOLVED:()=>'A previous forecast is still being confirmed. Ask for status in a minute.',
  COMMAND_CONFLICT:()=>'That post was already used for a different forecast. Send a new post for a new forecast.',
  PLAYER_BUSY:()=>'Your wallet was busy with another update (the site open in a browser, or a settlement in flight). Nothing was sealed - send a new post in a few seconds.',
};
const n=v=>v===null||v===undefined?'n/a':typeof v!=='number'?String(v):Number.isInteger(v)?v.toLocaleString('en-US'):String(+v.toFixed(4));
const endsSoon=r=>finite(r.sessionEndsInMinutes)&&r.sessionEndsInMinutes<=30?'\nSession ends in '+mins(Math.max(1,r.sessionEndsInMinutes))+' - approve a new one at ratchetx.xyz/play-session.html.':'';
const outcomeLine=c=>c.result==='hit'?'Result: HIT - +'+n(c.back)+' credits.':c.result==='miss'?'Result: MISS.':c.result==='void'?'Result: VOID - stake refunded.':null;
export function replyFor(r){
  if(!r||typeof r!=='object')return 'RatchetX could not take that command right now.\n\n'+FOOTER;
  if(r.code==='EXPLAIN')return r.pitch||PITCH;
  const note=Array.isArray(r.notes)&&r.notes.length?'\n'+r.notes[0].charAt(0).toUpperCase()+r.notes[0].slice(1)+'.':'';
  if(r.code==='SEALED'||(r.code==='COMMAND_ALREADY_RECORDED'&&r.proofUrl)){
    const tail=r.settled?'\n'+outcomeLine(r.settled):finite(r.settlesInMinutes)?'\nSettles in '+mins(r.settlesInMinutes)+'. Check: reply "ratchetx result" or open the proof.':'';
    return 'Prediction sealed on-chain.\nProof: '+r.proofUrl+note+tail+endsSoon(r)+'\n\n'+FOOTER;
  }
  if(r.code==='STATUS')return 'RatchetX Player Status:\n'
    +'\u2022 Play Credits: '+n(r.credits)+'\n\u2022 XP: '+n(r.xp)+'\n\u2022 Open Chambers: '+n(Array.isArray(r.open)?r.open.length:null)
    +'\n\u2022 Forecasts Stated: '+n(r.stated)+' (Brier: '+n(r.brier)+')'
    +'\n\u2022 Session: '+n(r.remainingAttempts)+' attempts / '+n(r.remainingGrossCredits)+' credits left'+(finite(r.sessionEndsInMinutes)?', ends in '+mins(Math.max(1,r.sessionEndsInMinutes)):'')
    +(Array.isArray(r.closed)&&r.closed[0]?'\n\u2022 Last '+outcomeLine(r.closed[0]).replace('Result: ','result: '):'')+'\n\n'+FOOTER;
  if(r.code==='COMMAND_ALREADY_RECORDED')return (REFUSALS[r.refusalCode]?.(r)??'That post was already processed.')+'\n\n'+FOOTER;
  // A known refusal (expired session, no admission, stale oracle...) keeps its
  // own sentence whatever category carried it; the status path reports
  // server refusals under PENDING.
  if(REFUSALS[r.code]&&!['submit','replay','settlement'].includes(r.phase))return REFUSALS[r.code](r)+'\n\n'+FOOTER;
  // Only a failure AFTER the shot was dispatched can mean "maybe sealed".
  // Before submit nothing was sent, so say so and invite a retry.
  if(r.category==='PENDING'&&['submit','replay','settlement'].includes(r.phase))
    return 'Your forecast may have been sealed; it will not be resent. Ask "ratchetx result" in a minute.\n\n'+FOOTER;
  if(r.category==='PENDING')return 'RatchetX did not answer in time ('+(r.code||'TIMEOUT')+'). Nothing was sealed - send the command again.\n\n'+FOOTER;
  const text=REFUSALS[r.code]?.(r);
  return (text??'RatchetX could not take that forecast right now ('+(r.code||'ERROR')+').')+'\n\n'+FOOTER;
}
export function parseArgs(args){
  const options={},seen=new Set();let file;
  const values=new Set(['--wallet','--session-id','--command-id','--target','--side','--p','--stake','--say','--asset','--direction','--horizon','--journal','--max-wait-seconds']);
  for(let i=0;i<args.length;i++){
    const flag=args[i];need(!seen.has(flag),'INVALID_ARGUMENTS');seen.add(flag);
    if(['--status','--execute','--resume','--auto'].includes(flag)){need(!options.mode,'INVALID_ARGUMENTS');options.mode=flag.slice(2);continue;}
    if(flag==='--wait-settle'){options.waitSettle=true;continue;}
    need(values.has(flag)&&typeof args[i+1]==='string'&&!args[i+1].startsWith('--'),'INVALID_ARGUMENTS');const value=args[++i];
    if(flag==='--journal')file=value;
    else if(flag==='--session-id')options.sessionId=value;
    else if(flag==='--command-id')options.commandId=value;
    else if(flag==='--max-wait-seconds')options.maxWaitMs=Number(value)*1000;
    else options[flag.slice(2)]=['--p','--stake','--horizon'].includes(flag)?Number(value):value;
  }
  need(options.mode&&(options.mode==='status'?!file:!!file),'EXPLICIT_MODE_AND_JOURNAL_REQUIRED');
  if(options.mode==='auto'){
    // Words decide: status-only questions read; everything else plays once.
    need(typeof options.say==='string'&&!['target','side','p','asset','direction','horizon'].some(key=>key in options),'AUTO_REQUIRES_SAY');
    const kind=classifyCommand(options.say);
    if(kind==='status'){options.mode='status';for(const key of ['commandId','say','stake'])delete options[key];file=undefined;}
    else if(['explain','help','board','meta','leaderboard'].includes(kind)){options.mode=kind;file=undefined;}
    else options.mode='execute';
  }
  if(!['execute','explain','help','board','meta','leaderboard'].includes(options.mode))need(!['commandId','target','side','p','stake','say','asset','direction','horizon'].some(key=>key in options),'STATUS_ONLY_MODE');
  return {options,file};
}
async function main(){
  if(process.argv.length===3&&process.argv[2]==='--help'){
    console.log('Status: node session-play.mjs --status --wallet OWNER --session-id SESSION_ID');
    console.log('Play from words: node session-play.mjs --auto --say "USER TEXT" --command-id X_POST_ID_OR_32HEX_NONCE --journal NEW_PRIVATE_FILE   (owner wallet and session come from RATCHET_PLAY_SESSION; --wallet/--session-id are optional and must match)');
    console.log('  --auto optionally waits for the outcome (--max-wait-seconds N, or words like "wait"/"tell me the result") and then replies once with seal + result.');
    console.log('  --auto answers "what is ratchetx" questions with the canonical pitch (no request), reads status when the words only ask about stats; otherwise it resolves asset/direction/horizon/stake/probability from the words against the live board and plays ONCE. Optional overrides: --asset SOL --direction up|down --horizon 5 --stake 500 --p 0.6');
    console.log('Play exact: node session-play.mjs --execute --wallet OWNER --session-id SESSION_ID --command-id X_POST_ID_OR_32HEX_NONCE --target BOARD_TARGET_ID --side YES|NO --p 0.55 --journal NEW_PRIVATE_FILE [--stake 100] [--max-wait-seconds 1260]');
    console.log('Resume status only: node session-play.mjs --resume --wallet OWNER --session-id SESSION_ID --journal EXISTING_PRIVATE_FILE');
    console.log('Protected RATCHET_PLAY_SESSION env only. Public IDs never authorize play or prove X identity. One approved five-minute forecast, one open shot, remaining signed limits, 22min session lifetime. Reuse the command ID for the SAME instruction; never change it to retry. No grant, signer, transfer, reload, scheduler or demo.');return;
  }
  try{const {options,file}=parseArgs(process.argv.slice(2));
    const auto=process.argv.includes('--auto');
    if(options.mode==='explain'){
      const r={ok:true,category:'EXPLAIN',code:'EXPLAIN',pitch:PITCH};
      // The $RCX mint as tool data with its source, so a platform that only
      // repeats verified contract addresses has something to verify against.
      let token=null;
      try{const res=await fetch(URLS.board,{headers:{Accept:'application/json'},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000)});
        if(res.status===200){const body=await res.json();if(body?.ok===true&&body.token?.mint)token=body.token;}}catch{}
      console.log(JSON.stringify(auto?{ok:true,code:'EXPLAIN',reply:replyFor(r),...(token?{token}:{})}:{...r,...(token?{token}:{})}));return;
    }
    if(options.mode==='help'){console.log(JSON.stringify({ok:true,code:'HELP',reply:HELP+'\n\n'+FOOTER}));return;}
    if(options.mode==='meta'){console.log(JSON.stringify({ok:false,code:'NOT_A_GAME_COMMAND',reply:META_REPLY+'\n\n'+FOOTER}));process.exitCode=1;return;}
    if(options.mode==='board'){
      // Public board read, no bearer, no journal. Same fixed URL as play.
      let board=null;
      try{const res=await fetch(URLS.board,{headers:{Accept:'application/json'},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000)});
        if(res.status===200){const body=await res.json();if(body&&body.ok===true)board=body;}}catch{}
      console.log(JSON.stringify({ok:!!board,code:board?'BOARD':'BOARD_UNAVAILABLE',reply:boardReply(board)}));return;
    }
    if(options.mode==='leaderboard'){
      let arena=null;
      try{const res=await fetch(ORIGIN+'/api/game?action=arena',{headers:{Accept:'application/json'},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000)});
        if(res.status===200){const body=await res.json();if(body&&body.ok===true)arena=body;}}catch{}
      console.log(JSON.stringify({ok:!!arena,code:arena?'LEADERBOARD':'LEADERBOARD_UNAVAILABLE',reply:leaderboardReply(arena)}));return;
    }
    if(auto){
      // Binary contract: one line, ok + code + the exact text to post. No
      // events, no identifiers, no intent. Never waits for settlement.
      const {maxWaitMs,...play}=options;
      // Preflight is read-only, so a transport hiccup before dispatch is
      // retried here (up to 3 tries); anything at or after submit never is.
      let r;
      for(let attempt=1;attempt<=3;attempt++){
        r=await runPlay({...play,waitSettle:undefined},{...(file?{journal:createFileJournal(file)}:{})});
        if(!(r.category==='PENDING'&&['preflight','status'].includes(r.phase)&&attempt<3))break;
        await new Promise(res=>setTimeout(res,2000*attempt));
      }
      // Optional smart wait: only when asked (--max-wait-seconds or words like
      // "wait"/"tell me the result"). Polls the audited status path until this
      // shot settles or the budget ends, then ONE reply carries seal + result.
      const asked=/\b(wait|until|tell me (?:the )?(?:result|outcome)|report (?:the )?(?:result|outcome)|and (?:the )?result)\b/i.test(String(play.say||''));
      const budget=finite(maxWaitMs)?maxWaitMs:asked&&finite(r.settlesInMinutes)?r.settlesInMinutes*60000+90000:0;
      if(r.code==='SEALED'&&budget>0){
        const deadline=Date.now()+Math.min(budget,25*60000);
        while(Date.now()<deadline){
          await new Promise(res=>setTimeout(res,Math.max(1000,Math.min(20000,deadline-Date.now()))));
          const st=await runPlay({mode:'status',wallet:play.wallet,sessionId:play.sessionId});
          const hit=st.ok&&Array.isArray(st.closed)&&st.closed.find(row=>row.shotId===r.shotId);
          if(hit){r.settled=hit;break;}
          if(!st.ok&&!['STATUS_UNAVAILABLE','TRANSPORT_UNCERTAIN','WAIT_LIMIT','STATUS_THROTTLED'].includes(st.code))break;
        }
      }
      console.log(JSON.stringify({ok:r.ok,code:r.code,reply:replyFor(r)}));process.exitCode=r.ok?0:1;return;
    }
    const output=await runPlay(options,{...(file?{journal:createFileJournal(file)}:{}),onEvent:event=>console.log(JSON.stringify(event))});
    console.log(JSON.stringify(output));process.exitCode=output.ok?0:output.category==='PENDING'?2:1;
  }catch{console.log(JSON.stringify({ok:false,category:'FAILED',code:'INVALID_ARGUMENTS'}));process.exitCode=1;}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)await main();
