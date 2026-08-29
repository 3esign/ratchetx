import { createRequire } from 'node:module';
import { verifyShot } from './verifier.mjs';
const require = createRequire(import.meta.url);
const { getAgentRun, saveAgentRun } = require('../lib/agent_receipts.js');

const ORIGIN = String(process.env.PUBLIC_ORIGIN || 'https://ratchetx.xyz').replace(/\/$/, '');

async function recordPages() {
  const rows = [];
  let after = 0;
  for (let page = 0; page < 1000; page++) {
    const res = await fetch(`${ORIGIN}/api/record?format=json&limit=1000&after=${after}`);
    if (!res.ok) throw new Error(`record API HTTP ${res.status}`);
    const body = await res.json();
    rows.push(...(body.rows || []));
    const next = Number(body.cursor);
    if (!(body.rows || []).length || !Number.isFinite(next) || next <= after) break;
    after = next;
  }
  return rows;
}

async function runPipeline() {
  console.log('[Shadow Replay] reading the complete settled record');
  const rows = await recordPages();
  let checked = 0, saved = 0, skipped = 0;
  for (const shot of rows) {
    if (await getAgentRun(shot.id)) { skipped++; continue; }
    const receipt = await verifyShot(`${ORIGIN}/shot.html?id=${encodeURIComponent(shot.id)}`);
    checked++;
    if (receipt.result === 'INSUFFICIENT_EVIDENCE') {
      console.log(`[Shadow Replay] ${shot.id}: insufficient evidence (${receipt.reason})`);
      continue;
    }
    const run = await saveAgentRun({ shotId:shot.id, receipt,
      chain:{ settlementIndex:shot.i } });
    saved++;
    console.log(`[Shadow Replay] ${shot.id}: ${receipt.result} ${run.digest}`);
  }
  console.log(`[Shadow Replay] complete: ${rows.length} rows, ${checked} checked, ${saved} durable receipts, ${skipped} already present`);
}

runPipeline().catch(error => { console.error(error); process.exitCode = 1; });
