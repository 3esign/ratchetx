import fs from 'fs';
import { spawnSync } from 'child_process';

const DB_FILE = 'data/shadow_ledger.ndjson';
if (!fs.existsSync('data')) fs.mkdirSync('data');

async function runPipeline() {
  console.log('[Shadow Replay] Starting durable shadow settlement...');
  
  const existingHandles = new Set();
  if (fs.existsSync(DB_FILE)) {
    const lines = fs.readFileSync(DB_FILE, 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const doc = JSON.parse(line);
        if (doc.id) existingHandles.add(doc.id);
      } catch(e){}
    }
  }
  
  console.log(`[Shadow Replay] Found ${existingHandles.size} already verified shots.`);
  
  const apiUrl = 'https://ratchetx.xyz/api/record?format=json';
  const recordRes = await fetch(apiUrl);
  if (!recordRes.ok) throw new Error(`HTTP ${recordRes.status} from record API`);
  const data = await recordRes.json();
  
  let checked = 0;
  let newReceipts = 0;
  
  for (const shot of data.rows) {
    if (existingHandles.has(shot.id)) continue;
    
    console.log(`[Shadow Replay] Verifying shot ${shot.id}...`);
    const shotUrl = `https://ratchetx.xyz/api/shot?id=${shot.id}`;
    
    const child = spawnSync('node', ['scripts/verifier.mjs', shotUrl], { encoding: 'utf8' });
    if (child.error) {
      console.error(`Failed to run verifier: ${child.error}`);
      continue;
    }
    
    // The verifier prints regular logs and then the JSON receipt.
    // Let's parse the JSON from stdout.
    const output = child.stdout.trim();
    const jsonMatch = output.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const receipt = JSON.parse(jsonMatch[0]);
        fs.appendFileSync(DB_FILE, JSON.stringify(receipt) + '\n');
        newReceipts++;
        console.log(`[Shadow Replay] Saved AgentRunReceipt for ${shot.id} -> ${receipt.result}`);
      } catch(e) {
        console.error(`[Shadow Replay] Failed to parse verifier output for ${shot.id}`);
      }
    } else {
      console.error(`[Shadow Replay] No JSON receipt found in output for ${shot.id}`);
    }
    checked++;
  }
  
  console.log(`[Shadow Replay] Pipeline completed. Verified ${checked} new shots, wrote ${newReceipts} receipts.`);
}

runPipeline().catch(console.error);
