import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {runPlay,parseArgs,resolveIntent,classifyCommand,replyFor,PITCH,URLS} from '../skills/ratchetx/scripts/session-play.mjs';

// Words -> one directional shot. Pure fixtures: no network, keys or files.
// Board mirrors the live h105 shape: one directional target per feed, each
// with a different horizon, plus non-directional kinds the runner must skip.
const board={stakeRule:{min:100,max:1000000000,hitPayout:1.7},targets:[
  {id:'H1Q0',kind:'dir',feed:'SOL',mins:5},{id:'H1Q1',kind:'dir',feed:'BONK',mins:10},{id:'H1Q2',kind:'dir',feed:'BTC',mins:15},
  {id:'H1Q3',kind:'dir',feed:'ETH',mins:30},{id:'H1Q4',kind:'dir',feed:'JUP',mins:60},{id:'H1Q5',kind:'dir',feed:'WIF',mins:360},
  {id:'H1Q6',kind:'dir',feed:'PUMP',mins:1440},{id:'H1P',kind:'thr',feed:'PUMP',mins:30},{id:'H1D',kind:'thrDown',feed:'WIF',mins:60},
  {id:'H1R',kind:'race',feed:'BTC',feed2:'ETH',mins:30},{id:'H1B',kind:'range',feed:'SOL',mins:60}]};
const context={feeds:[{feed:'SOL',current:{price:210,priceVsEmaBps:12}},{feed:'BTC',current:{price:109500,priceVsEmaBps:-8}},
  {feed:'ETH',current:{price:4300,priceVsEmaBps:0}},{feed:'WIF',current:{price:1}},{feed:'PUMP',current:{price:0.004,priceVsEmaBps:-3}}]};
const env={board,context,limits:{maxStakeCredits:5000,maxGrossCredits:20000},session:{grossCredits:0},player:{credits:12000}};
const R=(text,extra={})=>{const r=resolveIntent(text,{...env,...extra});return [r.resolution.feed,r.resolution.horizonMinutes,r.side,r.p,r.stake];};

// Routing: status only when the words ask about numbers and start nothing.
for(const t of ['status','stats','how am i doing','my xp','credits','balance?','podium','rank','did i win','results','resume',
  'what is my brier','check my shot','check sol','sol status','how much did i win on sol','ratchetx stats','@bankrbot ratchetx stats','ratchet status','ratchetx how am i doing','ratchetx my xp'])assert.equal(classifyCommand(t),'status',t);
for(const t of ['play','shot','ratchetx','take a shot','hi','gm','spend 1000','put 500 on SOL','call ETH','higher','lower','yes','no',
  'stats then play sol','play and status','spend credits','another one','buy sol','ratchetx put 500 on sol higher','@bankrbot ratchetx play','ratchetx sol'])assert.equal(classifyCommand(t),'execute',t);

// Questions about the game explain; they never fire a shot.
for(const t of ['what is ratchetx','what is ratchetx?','how does this work','explain the flywheel','tell me about rcx rewards','ratchetx?','$RCX?','wtf is this','ratchetx what is this?','@bankrbot ratchetx explain'])
  assert.equal(classifyCommand(t),'explain',t);
for(const t of ['play ratchetx','describe the game and play 500','what is my xp','why did i lose'])assert.notEqual(classifyCommand(t),'explain',t);
for(const must of ['Pyth','Brier','XP','podium','$RCX','70%','30%','0% to the team','flywheel','ratchetx.xyz','Solana','pump.fun','FQb2EyaLZ9TWBemYmQ9zWtXcEwLiSXtz7j619ThQpump'])assert.ok(PITCH.includes(must),must);
assert.doesNotMatch(PITCH,/\b(AI-built|built with AI|agents built|guaranteed)\b/i);
// Bare intent: shortest directional target, trend side, honest default p, minimum stake.
for(const t of ['play','shot','ratchetx','take a shot','hi','gm','play again','another one','something quick','flash'])
  assert.deepEqual(R(t),['SOL',5,'YES',0.55,100],t);
// Asset names, tickers, aliases; the asset's own horizon is used even when long.
assert.deepEqual(R('put 500 on SOL'),['SOL',5,'YES',0.55,500]);
assert.deepEqual(R('call ETH'),['ETH',30,'YES',0.55,100]);
assert.deepEqual(R('bet 2k on bitcoin dumping'),['BTC',15,'NO',0.55,2000]);
assert.deepEqual(R('$JUP to the moon'),['JUP',60,'YES',0.55,100]);
assert.deepEqual(R('bonk short'),['BONK',10,'NO',0.55,100]);
assert.deepEqual(R('wif'),['WIF',360,'YES',0.55,100]);
assert.deepEqual(R('daily pump'),['PUMP',1440,'YES',0.55,100]);
assert.deepEqual(R('pump token lower'),['PUMP',1440,'NO',0.55,100]);
// "pump" alone is a direction, not the PUMP feed.
assert.deepEqual(R('sol pump'),['SOL',5,'YES',0.55,100]);assert.deepEqual(R('pump it'),['SOL',5,'YES',0.55,100]);
// Direction words, negation, price levels.
assert.deepEqual(R('ETH lower'),['ETH',30,'NO',0.55,100]);
assert.deepEqual(R('SOL up'),['SOL',5,'YES',0.55,100]);
assert.deepEqual(R('sol not higher'),['SOL',5,'NO',0.55,100]);
assert.deepEqual(R('sol wont go up'),['SOL',5,'NO',0.55,100]);
assert.deepEqual(R('no way sol goes lower'),['SOL',5,'NO',0.55,100]);
assert.deepEqual(R('sol below 200'),['SOL',5,'NO',0.55,100]);
assert.deepEqual(R('btc above 110k'),['BTC',15,'YES',0.55,100]);
assert.deepEqual(R('BTC to 120000'),['BTC',15,'YES',0.55,100]);
assert.deepEqual(R('btc to 100k'),['BTC',15,'NO',0.55,100]);
assert.deepEqual(R('btc'),['BTC',15,'NO',0.55,100],'no direction: EMA trend decides');
assert.deepEqual(R('eth'),['ETH',30,'YES',0.55,100],'flat EMA defaults to YES');
// Probability: percent, decimal, p=, words; a stated direction is never flipped.
assert.deepEqual(R('I am 80% sure SOL goes up'),['SOL',5,'YES',0.8,100]);
assert.deepEqual(R('sol 70 percent higher'),['SOL',5,'YES',0.7,100]);
assert.deepEqual(R('p=0.65 btc lower'),['BTC',15,'NO',0.65,100]);
assert.deepEqual(R('btc higher 0.9'),['BTC',15,'YES',0.9,100]);
assert.deepEqual(R('solana probably goes higher, 300 credits'),['SOL',5,'YES',0.6,300]);
assert.deepEqual(R('SOL up 20%'),['SOL',5,'YES',0.55,100],'size, not confidence');
assert.deepEqual(R('sol higher 100%'),['SOL',5,'YES',0.99,100]);
// Stake: numbers, k, words, clamps to grant/credits/gross.
assert.deepEqual(R('spend 1000'),['SOL',5,'YES',0.55,1000]);
assert.deepEqual(R('all in on SOL'),['SOL',5,'YES',0.55,5000]);
assert.deepEqual(R('half on wif'),['WIF',360,'YES',0.55,5000]);
assert.deepEqual(R('fire 100000'),['SOL',5,'YES',0.55,5000]);
assert.deepEqual(R('spend 50'),['SOL',5,'YES',0.55,100]);
assert.deepEqual(R('max',{session:{grossCredits:19700}}),['SOL',5,'YES',0.55,300]);
assert.deepEqual(R('max',{player:{credits:250}}),['SOL',5,'YES',0.55,250]);
assert.deepEqual(R('half',{player:{credits:12000}}),['SOL',5,'YES',0.55,5000]);
// Horizon: exact match, nearest with a note, asset wins over horizon.
assert.deepEqual(R('BTC higher in 15 minutes'),['BTC',15,'YES',0.55,100]);
assert.deepEqual(R('play 1h'),['JUP',60,'YES',0.55,100]);
assert.deepEqual(R('sol in 1 hour'),['SOL',5,'YES',0.55,100]);
assert.match(resolveIntent('sol in 1 hour',env).resolution.notes.join(),/60 min horizon unavailable for that asset/);
assert.deepEqual(R('5 min btc 500'),['BTC',15,'NO',0.55,500]);
// Unknown assets fall back with a note that names no asset.
{const r=resolveIntent('$PEPE moon',env);assert.deepEqual([r.resolution.feed,r.side],['SOL','YES']);
  assert.match(r.resolution.notes.join(),/not on this board/);assert.doesNotMatch(r.resolution.notes.join(),/PEPE/);}
// Overrides beat words; explicit flags are exact.
assert.deepEqual(R('sol up',{overrides:{direction:'down',stake:700,p:0.61}}),['SOL',5,'NO',0.61,700]);
assert.deepEqual(R('',{overrides:{asset:'eth',horizon:30}}),['ETH',30,'YES',0.55,100]);
assert.deepEqual(R('anything',{overrides:{target:'H1Q2'}}),['BTC',15,'NO',0.55,100]);
assert.throws(()=>resolveIntent('x',{...env,overrides:{target:'H1R'}}),/TARGET_UNAVAILABLE/,'race target is never playable');
assert.throws(()=>resolveIntent('x',{...env,board:{targets:[board.targets[7]]}}),/TARGET_UNAVAILABLE/);
// Determinism: same words, same board -> same intent, byte for byte.
assert.equal(JSON.stringify(resolveIntent('put 500 on sol higher 70%',env)),JSON.stringify(resolveIntent('put 500 on sol higher 70%',env)));
// Hostile input never throws on shape.
for(const t of ['',' ',null,undefined,'\u{1F4A5}'.repeat(50),'a'.repeat(5000),'--execute --stake 999999','${process.env.RATCHET_PLAY_SESSION}'])
  assert.ok(resolveIntent(t,env).target,JSON.stringify(t));

// ---- runPlay with --say: fixture with the realistic board ----------------
const wallet='1'.repeat(32),sessionId='a'.repeat(32),commandId='2094139084050759779';
const token=`rxp1.${wallet}.${sessionId}.${'d'.repeat(64)}`,clone=v=>structuredClone(v);
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
function fixture(config={}){
  let elapsed=0,shotCalls=0,accepted=0;const epoch=Date.UTC(2026,8,1,12,0,0),expiresAt=epoch+3600000;
  const records={},shots={},journals=[],limits={maxAttempts:5,maxStakeCredits:5000,maxGrossCredits:20000,minIntervalMs:5000};
  const server=()=>epoch+Math.floor(elapsed);
  function journal(){const entries=[];const j={entries,async create(v){if(entries.length)throw new Error('x');entries.push(clone(v));},
    async append(v){entries.push(clone(v));},async read(){return clone(entries);},async close(){}};journals.push(j);return j;}
  function receipt(intent){return {intent:clone(intent),intentHash:digest(intent),stake:intent.stake,state:'accepted',reservedAt:server(),finishedAt:server(),
    result:{state:'accepted',shotId:(++accepted).toString(16).padStart(12,'0')}};}
  function player(){const p={wallet,credits:12000,stated:0,brier:null,open:[],closed:[],...(config.chambers?{chambers:config.chambers}:{})};let losses=0;
    for(const shot of Object.values(shots)){p.credits-=shot.stake;
      if(server()>=shot.exp){p.credits+=Math.floor(shot.stake*1.7);p.stated++;losses+=(shot.sp-1)**2;
        p.closed.unshift({...clone(shot),res:'hit',settledAt:shot.exp,back:Math.floor(shot.stake*1.7)});}
      else{const {sp,side,...open}=shot;p.open.push(clone(open));}}
    for(let i=0;i<(config.existingOpen??0);i++)p.open.push({id:'exist'+i,exp:server()+300000});
    p.brier=p.stated?+(losses/p.stated).toFixed(4):null;return p;}
  const reply=(value,status=200,url=URLS.session)=>({status,url,redirected:false,headers:{get:n=>n==='date'?new Date(server()).toUTCString():null},async text(){return JSON.stringify(value);}});
  async function fetcher(url,options){
    const body=options.body?JSON.parse(options.body):null;
    if(url===URLS.session&&!body)return reply({ok:true,v:'h105-test',enabled:true,network:'solana:mainnet',rights:['shot','status'],requiresExistingAdmittedAgent:true,
      endpoint:URLS.session,budgetRule:'gross-reserved-attempts-v1',agentContract:{shot:{replay:'r',rejected:'t'}}});
    if(url===URLS.context)return reply({ok:true,v:'h105-test',schema:'ratchetx-pyth-context-v1',generatedAt:server(),access:{mode:'shared-read'},
      validation:{fullVerificationRequired:true,ownerFeedIdAndDiscriminatorChecked:true,maxConfidenceBps:200},
      feeds:board.targets.filter(t=>t.kind==='dir').map(t=>({feed:t.feed,current:{price:100,ageNowS:1,confidenceBps:1,publishTime:Math.floor(server()/1000)-1,prevPublishTime:Math.floor(server()/1000)-61,
        priceVsEmaBps:context.feeds.find(f=>f.feed===t.feed)?.current?.priceVsEmaBps??null},activeTargets:[{id:t.id,horizonMinutes:t.mins}]}))},200,url);
    if(url===URLS.board)return reply({ok:true,v:'h105-test',prices:{src:'pyth-onchain'},flipsAt:server()+3600000,stakeRule:board.stakeRule,targets:clone(board.targets)},200,url);
    if(body.op==='status')return reply({ok:true,session:{wallet,id:sessionId,expiresAt,revokedAt:null,expired:false,limits,budgetRule:'gross-reserved-attempts-v1',
      attempts:Object.keys(records).length,grossCredits:Object.values(records).reduce((n,r)=>n+r.stake,0),pending:null,requests:clone(records)},player:player()});
    shotCalls++;assert.ok(journals.some(j=>j.entries[0]?.intent.requestId===body.intent.requestId),'durable intent before dispatch');
    const old=records[body.intent.requestId];if(old)return reply({ok:true,idempotent:true,request:clone(old)});
    const r=receipt(body.intent);records[body.intent.requestId]=r;const t=board.targets.find(t=>t.id===body.intent.target);
    shots[body.intent.requestId]={id:r.result.shotId,requestId:`session:${sessionId}:${body.intent.requestId}`,stake:body.intent.stake,exp:server()+t.mins*60000,side:body.intent.side,sp:body.intent.p};
    return reply({ok:true,request:clone(r),credits:player().credits});
  }
  const deps={fetch:fetcher,now:()=>elapsed,sleep:async ms=>{elapsed+=ms;},env:{RATCHET_PLAY_SESSION:token}};
  return {records,shots,journals,journal,shotCalls:()=>shotCalls,advance:ms=>{elapsed+=ms;},
    run:async(options,extra={})=>{const r=await runPlay(options,{...deps,journal:journal(),...extra});assert.ok(!JSON.stringify(r).includes(token));return r;}};
}
const base={mode:'execute',wallet,sessionId,commandId};
{ // Words seal a shot; the sealed output never names target, side or p.
  const f=fixture(),r=await f.run({...base,say:'put 500 on btc lower, 70% sure'});
  assert.equal(r.code,'SEALED',JSON.stringify(r));assert.equal(r.stakeCredits,500);assert.equal(r.settlesInMinutes,15);assert.deepEqual(r.notes,[]);
  const text=JSON.stringify(r);for(const leak of ['"side"','"target"','"p":','H1Q2','BTC','"NO"'])assert.ok(!text.includes(leak),leak);
  const start=f.journals[0].entries[0];assert.deepEqual([start.intent.target,start.intent.side,start.intent.p,start.intent.stake],['H1Q2','NO',0.7,500]);
  assert.equal(start.horizonMs,900000);assert.equal(start.resolution.feed,'BTC');
  // Same command redelivered with different words: retained receipt, no conflict, no second shot.
  const again=await f.run({...base,say:'sol higher all in'});assert.equal(again.code,'COMMAND_ALREADY_RECORDED');
  assert.equal(again.shotId,r.shotId);assert.equal(f.shotCalls(),2);
  // Exact flags for the same command still conflict when they differ.
  assert.equal((await f.run({...base,target:'H1Q0',side:'YES',p:0.55})).code,'COMMAND_CONFLICT');
  // A 15-minute target resumes to settlement under its own horizon, not the 5-minute constant.
  f.advance(15*60000+1000);
  const settled=await f.run({mode:'resume',wallet,sessionId,maxWaitMs:20000},{journal:f.journals[0]});
  assert.equal(settled.code,'PASS_HIT',JSON.stringify(settled));assert.equal(f.shotCalls(),2);
}
{ // Chambers: h105 status carries no `chambers`; the runner allows two open, refuses the third locally.
  assert.equal((await fixture({existingOpen:1}).run({...base,say:'play'})).code,'SEALED');
  const full=await fixture({existingOpen:2}).run({...base,say:'play'});assert.equal(full.code,'CHAMBERS_FULL');assert.equal(full.openShots,2);
  assert.equal((await fixture({existingOpen:4,chambers:5}).run({...base,say:'play'})).code,'SEALED');
  assert.equal((await fixture({existingOpen:5,chambers:5}).run({...base,say:'play'})).code,'CHAMBERS_FULL');
}
{ // Stake beyond the grant clamps instead of refusing; a note says so without naming the asset.
  const r=await fixture().run({...base,say:'fire 100000 on wif'});assert.equal(r.code,'SEALED');assert.equal(r.stakeCredits,5000);
  assert.match(r.notes.join(),/clamped/);assert.doesNotMatch(r.notes.join(),/WIF/);assert.equal(r.settlesInMinutes,360);
}
{ // Overrides ride along with words; hostile option keys still fail closed.
  const f=fixture(),r=await f.run({...base,say:'play',asset:'eth',direction:'down',stake:300});assert.equal(r.code,'SEALED');
  assert.deepEqual([f.journals[0].entries[0].intent.target,f.journals[0].entries[0].intent.side,f.journals[0].entries[0].intent.stake],['H1Q3','NO',300]);
  for(const bad of [{say:'x'.repeat(501)},{asset:'../x'},{direction:'sideways'},{horizon:0},{horizon:2000},{xHandle:'a',say:'play'}])
    assert.equal((await fixture().run({...base,...bad})).ok,false,JSON.stringify(bad));
}
// CLI: --auto routes by words; status drops the journal and play fields.
{const a=parseArgs(['--auto','--say','how am i doing','--wallet',wallet,'--session-id',sessionId,'--command-id',commandId,'--journal','j']);
  assert.equal(a.options.mode,'status');assert.equal(a.file,undefined);assert.equal('say' in a.options,false);assert.equal('commandId' in a.options,false);}
{const a=parseArgs(['--auto','--say','put 500 on sol','--wallet',wallet,'--session-id',sessionId,'--command-id',commandId,'--journal','j']);
  assert.equal(a.options.mode,'execute');assert.equal(a.options.say,'put 500 on sol');assert.equal(a.file,'j');}
{const a=parseArgs(['--auto','--say','what is ratchetx','--wallet',wallet,'--session-id',sessionId,'--command-id',commandId,'--journal','j']);
  assert.equal(a.options.mode,'explain');assert.equal(a.file,undefined);}
assert.throws(()=>parseArgs(['--auto','--wallet',wallet,'--session-id',sessionId,'--command-id',commandId,'--journal','j']));
assert.throws(()=>parseArgs(['--auto','--say','play','--target','H1Q0','--wallet',wallet,'--session-id',sessionId,'--command-id',commandId,'--journal','j']));
assert.throws(()=>parseArgs(['--status','--say','stats','--wallet',wallet,'--session-id',sessionId]));
// Binary reply contract: every result maps to one postable text with the footer; no identifiers leak.
{const footer='real $RCX';
  const sealed=replyFor({ok:true,code:'SEALED',proofUrl:'https://ratchetx.xyz/api/shot?w=W&id=abc',notes:['stake 9 clamped to allowed 5']});
  assert.match(sealed,/^Prediction sealed on-chain\.\nProof: https:\/\/ratchetx\.xyz\/api\/shot\?w=W&id=abc\nStake 9 clamped to allowed 5\./);assert.ok(sealed.includes(footer));
  assert.equal(replyFor({ok:false,code:'COMMAND_ALREADY_RECORDED',proofUrl:'https://ratchetx.xyz/api/shot?w=W&id=abc'}).split('\n')[1],'Proof: https://ratchetx.xyz/api/shot?w=W&id=abc');
  const st=replyFor({ok:true,code:'STATUS',credits:1649078,stated:12,brier:0.2116,open:[{}],remainingAttempts:60,remainingGrossCredits:90000});
  assert.match(st,/Play Credits: 1,649,078/);assert.match(st,/XP: n\/a/);assert.match(st,/Brier: 0\.2116/);assert.match(st,/Open Chambers: 1/);
  assert.match(replyFor({code:'SESSION_RATE_LIMIT',retryAfterSeconds:3}),/retry in 3 s/);
  assert.match(replyFor({category:'PENDING',code:'SUBMIT_UNRESOLVED'}),/may have been sealed/);
  assert.match(replyFor({code:'MISSING_OR_INVALID_CAPABILITY'}),/No RatchetX play session/);
  assert.match(replyFor({code:'WEIRD'}),/\(WEIRD\)/);assert.equal(replyFor({code:'EXPLAIN',pitch:PITCH}),PITCH);
  for(const r of [{ok:true,code:'SEALED',proofUrl:'u',wallet,sessionId,requestId:'r'.repeat(32)}])assert.ok(!replyFor(r).includes(sessionId));
  for(const code of Object.keys({SESSION_EXPIRED:1,SESSION_REVOKED:1,CHAMBERS_FULL:1,INSUFFICIENT_CREDITS:1,ORACLE_STALE:1,COMMAND_CONFLICT:1}))assert.ok(replyFor({code}).includes(footer),code);
}
// --auto CLI prints exactly one line with ok/code/reply and no identifiers, even without a secret.
{const run=args=>spawnSync(process.execPath,['../skills/ratchetx/scripts/session-play.mjs',...args],{encoding:'utf8',env:{PATH:process.env.PATH}});
  const r=run(['--auto','--say','put 500 on sol higher','--wallet',wallet,'--session-id',sessionId,'--command-id',commandId,'--journal','/nonexistent/dir/j.json']);
  const lines=r.stdout.trim().split('\n');assert.equal(lines.length,1,r.stdout);const out=JSON.parse(lines[0]);
  assert.deepEqual(Object.keys(out).sort(),['code','ok','reply']);assert.equal(out.ok,false);assert.equal(out.code,'MISSING_OR_INVALID_CAPABILITY');
  assert.ok(!r.stdout.includes(sessionId)&&!r.stdout.includes(wallet));assert.equal(r.status,1);
  const e=JSON.parse(run(['--auto','--say','what is ratchetx?','--wallet',wallet,'--session-id',sessionId,'--command-id',commandId,'--journal','x']).stdout.trim());
  assert.equal(e.code,'EXPLAIN');assert.equal(e.reply,PITCH);
}
console.log('Session play intent PASS: words route to status or one shot, asset/direction/horizon/stake/p resolve deterministically, redelivery never conflicts, chambers and stake clamp locally, horizon follows the target');
