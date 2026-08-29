import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
globalThis.__ratchet_mem = new Map();

const kv = require('../lib/kv.js');
const { saveAgentRun } = require('../lib/agent_receipts.js');
const { buildAgentReport } = require('../lib/agent_report.js');
const wallet = 'HXFDaHyZ3i477z1BakiTWZg9UQN8rcreruuv9ifC1HvM';
await kv.setJSON(`u:${wallet}`, { w:wallet, agent:{ name:'REPORT BOT',
  identity:{ standard:'solana-agent-registry-erc8004', globalId:'sol:fixture' } },
  qualified:false, shots:12, bn:10, bsum:2, calib:{ 5:{n:10,h:6} },
  closed:[{ id:'report1', feed:'SOL', res:'hit', t:Date.now(), sp:0.6 }] });
await kv.setJSON(`hist:${wallet}`, [{ id:'report1', feed:'SOL', res:'hit', t:Date.now(), sp:0.6 }]);
const run = await saveAgentRun({ shotId:'report1', receipt:{ result:'MATCH' },
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

await kv.setJSON('u:demo-clean1', { w:'demo-clean1', shots:0, bn:0, closed:[] });
const demo = await buildAgentReport('demo-clean1');
assert.equal(demo.body.reportCard.identityProof.walletAuthenticatedRegistration, false);
assert.equal(demo.body.reportCard.identityProof.demo, true);
assert.equal(demo.body.reportCard.ranking.listed, false);
const bareDemo = await buildAgentReport('clean1');
assert.equal(bareDemo.status, 200);
assert.equal(bareDemo.body.reportCard.identity, 'demo-clean1');
assert.equal(bareDemo.body.reportCard.identityProof.demo, true);
console.log('PASS report-card numbers, identity labels and durable receipt provenance');
