import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
for (const key of ['KV_REST_API_URL','KV_REST_API_TOKEN','UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN','SUPABASE_URL','SUPABASE_SERVICE_KEY','SUPABASE_SERVICE_ROLE_KEY']) delete process.env[key];
globalThis.fetch = async () => { throw new Error('network forbidden in public proof fixtures'); };
globalThis.__ratchet_mem = new Map();

const kv = require('../lib/kv.js');
const { saveAgentRun } = require('../lib/agent_receipts.js');
const { buildAgentReport, handler:reportHandler } = require('../lib/agent_report.js');
const { hashCommit } = require('../lib/commit.js');
assert.equal(kv.backend, 'memory');
const wallet = 'HXFDaHyZ3i477z1BakiTWZg9UQN8rcreruuv9ifC1HvM';
const sealedAt = Date.UTC(2026, 7, 30, 16, 55, 34);
const salt = '12'.repeat(16);
const closedShot = { id:'report1', feed:'SOL', res:'hit', kind:'dir', side:'YES',
  salt, commitV:2, commit:hashCommit({version:2,wallet,shotId:'report1',side:'YES',salt}),
  entry:100, exitPx:101, stake:100, back:170, xp:13, sp:0.6,
  exp:sealedAt+300_000, settledAt:sealedAt+301_000 };
await kv.setJSON(`u:${wallet}`, { w:wallet, agent:{ name:'REPORT BOT',
  identity:{ standard:'solana-agent-registry-erc8004', globalId:'sol:fixture' } },
  qualified:false, shots:12, bn:10, bsum:2, calib:{ 5:{n:10,h:6} },
  closed:[closedShot, { id:'open99', res:'open', side:'NO', salt:'sealed-secret' }],
  open:[{ id:'open88', side:'NO', salt:'open-secret' }] });
await kv.setJSON(`hist:${wallet}`, [{ id:'report1', feed:'SOL', res:'hit', t:sealedAt+301_000, sp:0.6 },
  { id:'history1', res:'hit', t:sealedAt-1000 }]);
await kv.setJSON(`g:log:once:seal:${wallet}:report1`, { i:43, t:sealedAt, h:'a'.repeat(64) });
const run = await saveAgentRun({ shotId:'report1', receipt:{ result:'MATCH',
  trustBoundary:{ oracleAccountValidation:'validated at observation time', independentPythReplay:false } },
  chain:{ settlementIndex:44 } });
const out = await buildAgentReport(wallet);
assert.equal(out.status, 200);
assert.equal(out.body.reportCard.identityProof.walletAuthenticatedRegistration, true);
assert.equal(out.body.reportCard.identityProof.registryLinked, true);
assert.equal(out.body.reportCard.ranking.listed, true);
assert.equal(out.body.reportCard.ranking.minimumStatedCalls, 10);
assert.equal(out.body.reportCard.stats.brierScore, 0.2);
assert.equal(out.body.reportCard.stats.calibration[0].observedRate, 0.6);
assert.equal(out.body.reportCard.latestReceipt.digest, run.digest);
assert.equal(out.body.reportCard.latestReceipt.selectionAuthority, 'ratchet-server-hash-chain');
assert.equal(out.body.reportCard.latestReceipt.receiptType, 'retained-evidence-agent-run');
assert.equal(out.body.reportCard.latestReceipt.receiptStatus, 'available');
assert.equal(out.body.reportCard.latestReceipt.httpSessionReplayStatus, 'not-assessed');
assert.equal(out.body.reportCard.latestReceipt.independentPythReplay, false);
assert.equal(out.body.reportCard.latestReceipt.proofPageAvailable, true);
assert.match(out.body.reportCard.latestReceipt.explanation, /not evidence of HTTP session replay/);
assert.deepEqual(out.body.reportCard.links.settledShots.map(row => row.shotId), ['report1']);

// Resolve generated URLs to the real public handlers. A plausible but nonexistent
// /shot.html URL or a proof missing its owner must fail this test, not merely a regex.
async function openProof(link) {
  const url = new URL(link);
  assert.equal(url.origin, 'https://ratchetx.xyz');
  const proofHandler = require(`..${url.pathname}.js`);
  let status = 200, body = '';
  await proofHandler({ method:'GET', query:Object.fromEntries(url.searchParams) }, {
    setHeader(){}, status(code){status=code;return this;}, end(value){body=value;},
  });
  return {status,body};
}
for (const link of [out.body.reportCard.latestReceipt.proofPage,
  out.body.reportCard.links.settledShots[0].proofPage]) {
  const page = await openProof(link);
  assert.equal(page.status, 200);
  assert.match(page.body, /MATCHES/);
  assert.ok(page.body.includes(closedShot.commit));
  assert.ok(page.body.includes(`${wallet}|report1|YES|${salt}`));
  assert.match(page.body, /2026-08-30 16:55 UTC/);
}
const reportUrl = new URL(out.body.reportCard.links.report);
const routes = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url)));
assert.equal(routes.rewrites.find(row => row.source===reportUrl.pathname)?.destination,
  '/api/game?action=agent-report');
let publicReport;
await reportHandler({method:'GET',query:Object.fromEntries(reportUrl.searchParams)}, {
  setHeader(){}, status(code){assert.equal(code,200);return this;}, json(body){publicReport=body;},
});
assert.equal(publicReport.reportCard.identity, wallet);

for (const id of ['open99','open88','unknown1']) {
  const url = new URL(out.body.reportCard.latestReceipt.proofPage);
  url.searchParams.set('id', id);
  const page = await openProof(url);
  assert.equal(page.status,404);
  assert.ok(!page.body.includes('sealed-secret') && !page.body.includes('open-secret'));
}
for (const owner of ['11111111111111111111111111111111', '']) {
  const url = new URL(out.body.reportCard.latestReceipt.proofPage);
  url.searchParams.set('w', owner);
  const page = await openProof(url);
  assert.equal(page.status, owner ? 404 : 400);
  assert.ok(!page.body.includes(salt));
}

await kv.delKey('agentrun:report1');
const noReceipt = await buildAgentReport(wallet);
assert.equal(noReceipt.body.reportCard.latestReceipt.status,'not-yet-replayed');
assert.equal(noReceipt.body.reportCard.latestReceipt.receiptStatus,'not-found-in-retained-history');
assert.equal(noReceipt.body.reportCard.latestReceipt.httpSessionReplayStatus,'not-assessed');
assert.match(noReceipt.body.reportCard.latestReceipt.explanation,/does not mean a shot failed/);
assert.equal((await openProof(noReceipt.body.reportCard.links.settledShots[0].proofPage)).status,200,
  'settled proof remains public without an AgentRun or HTTP replay verdict');
await saveAgentRun({shotId:'history1',receipt:{result:'MATCH'}});
const historyReceipt = await buildAgentReport(wallet);
assert.equal(historyReceipt.body.reportCard.latestReceipt.shotId,'history1');
assert.equal(historyReceipt.body.reportCard.latestReceipt.proofPageAvailable,false);
assert.deepEqual(historyReceipt.body.reportCard.links.settledShots.map(row=>row.shotId),['report1']);

await kv.setJSON('u:demo-clean1', { w:'demo-clean1', shots:0, bn:0, closed:[] });
const demo = await buildAgentReport('demo-clean1');
assert.equal(demo.body.reportCard.identityProof.walletAuthenticatedRegistration, false);
assert.equal(demo.body.reportCard.identityProof.demo, true);
assert.equal(demo.body.reportCard.ranking.listed, false);
const bareDemo = await buildAgentReport('clean1');
assert.equal(bareDemo.status, 200);
assert.equal(bareDemo.body.reportCard.identity, 'demo-clean1');
assert.equal(bareDemo.body.reportCard.identityProof.demo, true);
assert.equal(bareDemo.body.reportCard.links.report,'https://ratchetx.xyz/api/agent?id=demo-clean1');
assert.deepEqual(bareDemo.body.reportCard.links.settledShots,[]);
console.log('PASS report-card numbers, identity labels, receipt boundaries and real public proof handlers');
