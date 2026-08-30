import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
for(const k of ['SUPABASE_URL','SUPABASE_SERVICE_KEY','SUPABASE_SERVICE_ROLE_KEY','KV_REST_API_URL','KV_REST_API_TOKEN','UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN']) delete process.env[k];
const kv=require('../lib/kv.js'), {hashCommit}=require('../lib/commit.js');
const wallet='7'.repeat(44), handle='proof123', shotId='real-demo';
const playerRow={id:`seal:${wallet}:ranked`,w:'7777…7777',t:2000,a:'sealed a shot - 500 credits',c:'seal'};
await kv.setJSON('g:feed:players:v2',[playerRow]);
await kv.setJSON(`u:${wallet}`,{w:wallet,agent:{name:'REAL-AGENT',since:1000}});
await kv.setJSON('g:evidence:publicRuns',[{agent:'Verified agent',claim:'operator-verified-x',proofs:[{handle,shotId}]}]);
const closed={id:shotId,side:'YES',salt:'test-salt',commitV:2,stake:500,sp:.54,entry:.19,exitPx:.20,
  label:'FLASH: WIF higher',res:'hit',exp:2500,settledAt:3000};
closed.commit=hashCommit({version:2,wallet:'demo-'+handle,shotId,side:closed.side,salt:closed.salt});
await kv.setJSON('u:demo-'+handle,{w:'demo-'+handle,closed:[closed],open:[]});
const game=require('../api/game.js');
let body,status=200;
await game({method:'GET',query:{action:'activity-feed'},headers:{'x-forwarded-for':'activity-agent-test'},socket:{}},
  {setHeader(){},status(n){status=n;return this;},json(v){body=v;return v;}});
assert.equal(status,200);
assert.equal(body.feed.length,2,'real proven demo belongs beside player activity, not in player storage');
assert.equal(body.feed.find(x=>x.id===playerRow.id).actor.kind,'registered-agent');
const demo=body.feed.find(x=>x.mode==='demo');
assert.equal(demo.actor.kind,'demo-agent');
assert.equal(demo.actor.name,'Verified agent');
assert.match(demo.a,/500 demo credits/);
assert.match(demo.a,/no payout/);
assert.ok(demo.proofUrl.endsWith(handle));
assert.equal((await kv.getJSONStrict('g:feed:players:v2')).length,1,'demo never consumes player retention');
console.log('GOLD AGENT ACTIVITY CONTRACT PASS');
