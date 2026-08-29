import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const { publicSpec, cleanHandle, progressFromState } = require('../lib/gauntlet.js');
const spec = publicSpec();

assert.equal(spec.id, 'first-contact-001');
assert.equal(spec.status, 'open');
assert.equal(spec.mode, 'free-demo');
assert.equal(spec.completionRule.predicate, 'player.stated >= 1');
assert.equal(spec.reward.money, false);
assert.equal(spec.reward.token, false);
assert.equal(spec.reward.rankedEntry, false);
assert.equal(spec.measurement.globalCompletionCount, null);
assert.equal(cleanHandle('demo-AbC123'), 'abc123');
assert.throws(() => cleanHandle('not valid!'), /3-18 lowercase/);

const ready = progressFromState({ player:{ stated:0, open:[], history:[] } }, 'abc123');
assert.equal(ready.stage, 'ready_to_forecast');
assert.equal(ready.completed, false);
assert.equal(ready.brier, null, 'missing Brier is not coerced to a perfect zero');

const waiting = progressFromState({ player:{
  stated:0, open:[{ id:'sealed' }], history:[],
} }, 'abc123');
assert.equal(waiting.stage, 'awaiting_settlement');
assert.equal(waiting.completed, false);

const complete = progressFromState({ player:{
  stated:1, brier:0.1521, brierIndex:61, open:[],
  history:[
    { id:'unscored', label:'BTC UP', res:'miss', sp:null, entry:100, exit:99, t:124 },
    { id:'proof1', label:'SOL UP', res:'hit', sp:0.61, entry:100, exit:101, t:123 },
  ],
} }, 'abc123');
assert.equal(complete.stage, 'complete');
assert.equal(complete.completed, true);
assert.equal(complete.latestEvidence.id, 'proof1', 'a newer p-less call is not Gauntlet evidence');
assert.equal(complete.latestEvidence.probability, 0.61);
assert.match(complete.apiProof, /handle=abc123$/);

const gameHandler = require('../api/game.js');
async function callGame(query = {}, method = 'GET') {
  let status = 200;
  let body;
  const headers = {};
  await gameHandler({ method, query, body:{}, headers:{'x-forwarded-for':'14.14.14.14'}, socket:{} }, {
    status(code) { status = code; return this; },
    setHeader(name, value) { headers[name.toLowerCase()] = value; },
    json(value) { body = value; return value; },
    end() {},
  });
  return { status, body, headers };
}

let response = await callGame({ action:'gauntlet' });
assert.equal(response.status, 200);
assert.equal(response.body.gauntlet.id, spec.id);
assert.equal(response.body.progress, null);
assert.match(response.headers['cache-control'], /s-maxage=60/);

response = await callGame({ action:'gauntlet', handle:'not valid!' });
assert.equal(response.status, 400);
assert.equal(response.body.code, 'BAD_HANDLE');

response = await callGame({ action:'gauntlet' }, 'POST');
assert.equal(response.status, 405);

const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const page = read('gauntlet.html');
const agents = read('agents.html');
const game = read('api/game.js');
const mcp = read('api/mcp.js');
const llms = read('llms.txt');
const sitemap = read('sitemap.xml');
const vercel = JSON.parse(read('vercel.json'));
const catalog = JSON.parse(read('.well-known/ai-catalog.json'));
const registration = JSON.parse(read('agent-registration.json'));

assert.match(page, /FIRST CONTACT/);
assert.match(page, /CHECK PROGRESS/);
assert.match(page, /COPY MISSION/);
assert.doesNotMatch(page, /innerHTML|private.?key|secret.?key/i);
assert.match(agents, /href="\/gauntlet"/);
assert.match(game, /gauntlet:\s*publicSpec\(\)/);
assert.match(game, /action === 'gauntlet'/);
assert.match(game, /progress:progressFromState\(state, gauntletHandle\)/);
assert.match(mcp, /out\.gauntlet\s*=\s*progressFromState/);
assert.match(llms, /GET \/api\/gauntlet/);
assert.match(sitemap, /https:\/\/ratchetx\.xyz\/gauntlet/);
assert.ok(vercel.rewrites.some(route =>
  route.source === '/gauntlet' && route.destination === '/gauntlet.html'));
assert.ok(vercel.rewrites.some(route =>
  route.source === '/api/gauntlet' && route.destination === '/api/game?action=gauntlet'));
assert.equal(fs.existsSync(new URL('../api/gauntlet.js', import.meta.url)), false,
  'Gauntlet must reuse api/game so the Hobby deployment stays within 12 functions');
assert.ok(catalog.entries.some(entry =>
  entry.identifier.endsWith(':gauntlet:first-contact')
  && entry.url === 'https://ratchetx.xyz/api/gauntlet'));
assert.ok(registration.services.some(service =>
  service.name === 'Gauntlet' && service.endpoint === 'https://ratchetx.xyz/api/gauntlet'));

console.log('PASS  Agent Gauntlet is free, canonical-state-derived, discoverable, and non-economic');
