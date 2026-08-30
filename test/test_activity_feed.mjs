import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
for (const key of ['SUPABASE_URL','SUPABASE_SERVICE_KEY','SUPABASE_SERVICE_ROLE_KEY',
  'KV_REST_API_URL','KV_REST_API_TOKEN','UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN']) delete process.env[key];
const kv = require('../lib/kv.js');
const source = fs.readFileSync(new URL('../api/game.js', import.meta.url), 'utf8');
const body = source.match(/async function bumpFeed\(entry\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(body, 'exercise the production feed writer');
const write = vm.runInNewContext(body + '\nbumpFeed', { ...kv, require, Date });
const players = Array.from({length:100}, (_, i) => ({id:'player-'+i,t:1000-i,w:'player',a:'sealed a shot',c:'seal'}));
await kv.setJSON('g:feed', players);
for (let i=0;i<200;i++) await write({id:'fleet-'+i,w:'Fleet',a:'HIT',agent:1});
const retained = (await kv.getJSONStrict('g:feed')).filter(row=>!row.agent);
assert.equal(retained.length, 100, 'hidden house-agent activity must not consume player-feed retention');
assert.ok(retained.some(row=>row.id==='player-99'), 'oldest retained player survives a fleet burst');
console.log('ACTIVITY FEED RETENTION PASS');
