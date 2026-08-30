import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
for (const key of ['SUPABASE_URL','SUPABASE_SERVICE_KEY','SUPABASE_SERVICE_ROLE_KEY',
  'KV_REST_API_URL','KV_REST_API_TOKEN','UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN']) delete process.env[key];
const kv = require('../lib/kv.js');
const feed = require('../lib/activity_feed.js');
const wallet = '7'.repeat(44);
const ev = (i,k,rest={}) => ({i,t:1000+i,ev:{k,w:wallet,...rest}});
const seal = ev(7,'seal',{id:'older',stake:500,side:'YES',salt:'must-not-display'});
const settle = ev(8,'settle',{id:'older',res:'hit',xp:241});
const current = {id:`settle:${wallet}:latest`,t:2000,w:'7777…7777',a:'HIT +401 XP - +85,000 credits',c:'hit'};
const legacy = [current,...Array.from({length:98},(_,i)=>({t:1900-i,w:'Fleet',a:'HIT',agent:1})),
  {t:900,w:'7777…7777',a:'DAILY #1',c:'hit'}];
await kv.setJSON('g:feed',legacy);
await kv.setJSON('g:log:head',{i:1005,h:'retained-head'});
await kv.setJSON('g:log:c:0',[{...settle,ev:{...settle.ev,xp:999}}]);
const fixtures = [seal,settle,ev(1,'seal',{id:'outside-window',stake:500}),
  ev(9,'seal',{w:'demo-wallet',id:'demo',stake:500}),
  ev(10,'agent',{id:'fleet',agent:'fleet',res:'hit'}),
  ev(11,'settle',{id:'latest',res:'hit',xp:401}),
  ev(12,'reload',{sig:'receipt',burned:70,champs:30,credited:100}),
  ev(13,'anchor',{sig:'anchor-receipt',i:10}),
  ev(14,'settle',{id:'voided',res:'void'})];
for (const e of fixtures) await kv.setJSON(`g:log:e:${e.i}`,e);
const getMany = kv.getManyJSON;
let readKeys = 0;
kv.getManyJSON = async keys => {readKeys += keys.length;return getMany(keys);};
const rows = await feed.readFeed();
assert.equal(rows.length,7,'restore retained player receipts, not Fleet/demo or invented missing events');
assert.equal(readKeys,1003,'one migration reads at most 1000 event keys plus three legacy chunks');
assert.ok(rows.some(x=>x.id===`seal:${wallet}:older`));
assert.ok(rows.some(x=>x.a==='HIT +241 XP - settled shot'),'immutable entry overrides a stale legacy chunk');
assert.ok(!JSON.stringify(rows).includes('must-not-display'));
assert.ok(!JSON.stringify(rows).includes('YES'));
assert.ok(!rows.some(x=>x.id?.includes('outside-window')));
assert.deepEqual(rows.find(x=>x.id===current.id),current,'original exact payout receipt beats reconstructed summary');
assert.ok(!rows.find(x=>x.logIndex===8).a.includes('credits'),'never infer absent historical payout');
assert.deepEqual(await kv.getJSONStrict('g:log:e:8'),settle,'projection does not rewrite history');
assert.deepEqual(await kv.getJSONStrict('g:feed'),rows,'legacy snapshot mirror contains player rows');
await kv.setJSON('g:feed',[{w:'old-deployment',a:'overwrote legacy mirror',agent:1}]);
assert.deepEqual(await feed.readFeed(),rows,'in-flight old writers cannot overwrite new player projection');
assert.equal(readKeys,1003,'normal reads never rescan event history');
assert.equal(await feed.bumpFeed({...current,t:3000}),false,'replayed receipt remains one row');
assert.equal((await feed.readFeed()).filter(x=>x.id===current.id).length,1);
await feed.bumpFeed({id:'new-ranked-agent',w:'ranked external agent',a:'sealed a shot',c:'seal'});
assert.ok((await feed.readFeed()).some(x=>x.id==='new-ranked-agent'),'external ranked agents remain players');

await kv.delKey(feed.KEY);
await kv.setJSON('g:feed',legacy);
kv.getManyJSON = async()=>{throw new Error('fixture database outage');};
assert.equal((await feed.readFeed()).length,2,'database failure keeps available legacy player rows');
assert.equal(await kv.getJSONStrict(feed.KEY),null,'failed recovery does not persist partial/empty success');
kv.getManyJSON = getMany;
assert.equal((await feed.readFeed()).length,7,'next request retries successful recovery');

const html = fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
assert.ok(html.includes('${esc(f.w)}') && html.includes('${esc(f.a)}'),'all feed text is HTML escaped');
assert.ok(html.includes('encodeURIComponent(f.sig)'),'transaction link path is encoded');
console.log('ACTIVITY RECOVERY PASS');
