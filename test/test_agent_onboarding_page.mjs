import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { TOOLS } = require('../api/mcp.js');

const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const page = read('agents.html');
const home = read('index.html');
const vercel = JSON.parse(read('vercel.json'));
const sitemap = read('sitemap.xml');
const inlineScript = page.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(inlineScript, 'agent page has one auditable inline controller');
assert.doesNotThrow(() => new Function(inlineScript[1]), 'agent page controller parses as JavaScript');

assert.match(page, /SEND A MIND[\s\S]*GET A RECORD/);
assert.match(page, /https:\/\/ratchetx\.xyz\/api\/mcp/);
assert.match(page, /ratchet_new_demo/);
assert.match(page, /ratchet_pyth_context/);
assert.match(page, /ratchet_pyth_path/);
assert.match(page, /ratchet_demo_shot/);
assert.match(page, /ratchet_demo_state/);
assert.match(page, /tools\/list/);
assert.match(page, new RegExp('EXPECTED_TOOLS=\\['));
assert.match(page, new RegExp("names\\.length!==EXPECTED_TOOLS\\.length"));
for (const tool of TOOLS) assert.match(page, new RegExp(tool.name), `onboarding live check includes ${tool.name}`);
assert.equal(TOOLS.length, 13, 'onboarding tool count is tied to the canonical MCP list');
assert.match(page, /0\.01 USDC/);
assert.match(page, /100% to the champion · 0% to RatchetX/);
assert.match(page, /href="\/openapi\.json"/);
assert.match(page, /8004market\.io\/agent\/solana\/mainnet-beta\/1475/);
assert.match(page, /io\.github\.3esign%2Fratchet\/versions\/latest/);
assert.match(page, /PUBLIC AGENT REPORT/);
assert.match(page, /REPORT_API='\/api\/agent'/);
assert.match(page, /CALIBRATION CURVE · FORECAST vs OBSERVED/);
assert.match(page, /ranking\.statedCalls\+' \/ '\+ranking\.minimumStatedCalls/);
assert.match(page, /stats\.brierScore/);
assert.match(page, /stats\.calibration/);
assert.match(page, /history\.replaceState\(null,'','\/agents\?id='/);
assert.ok(!page.includes('\\\\n'), 'live test output must use real line breaks, not visible \\\\n text');
assert.doesNotMatch(page, /innerHTML|private.?key|secret.?key/i);

assert.ok(vercel.rewrites.some(route =>
  route.source === '/agents' && route.destination === '/agents.html'));
assert.match(sitemap, /https:\/\/ratchetx\.xyz\/agents/);
assert.match(home, /href="\/agents"/);
assert.doesNotMatch(home, /SHIPPED DARK UNTIL A FUNDED MAINNET SMOKE/i);
assert.match(home, /LIVE[\s\S]{0,80}STANDARD x402 V2 SOLANA DOOR AT EXACTLY 0\.01 USDC/);

console.log('PASS  /agents is a live-testable, truthful free-to-ranked handoff');
