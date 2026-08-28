import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const page = read('agents.html');
const home = read('index.html');
const vercel = JSON.parse(read('vercel.json'));
const sitemap = read('sitemap.xml');

assert.match(page, /SEND A MIND[\s\S]*GET A RECORD/);
assert.match(page, /https:\/\/ratchetx\.xyz\/api\/mcp/);
assert.match(page, /ratchet_new_demo/);
assert.match(page, /ratchet_demo_shot/);
assert.match(page, /ratchet_demo_state/);
assert.match(page, /tools\/list/);
assert.match(page, /expected 7 tools/);
assert.match(page, /0\.01 USDC/);
assert.match(page, /100% to the champion · 0% to RatchetX/);
assert.match(page, /href="\/openapi\.json"/);
assert.match(page, /8004market\.io\/agent\/solana\/mainnet-beta\/1475/);
assert.match(page, /io\.github\.3esign%2Fratchet\/versions\/latest/);
assert.ok(!page.includes('\\\\n'), 'live test output must use real line breaks, not visible \\\\n text');
assert.doesNotMatch(page, /innerHTML|private.?key|secret.?key/i);

assert.ok(vercel.rewrites.some(route =>
  route.source === '/agents' && route.destination === '/agents.html'));
assert.match(sitemap, /https:\/\/ratchetx\.xyz\/agents/);
assert.match(home, /href="\/agents"/);
assert.doesNotMatch(home, /SHIPPED DARK UNTIL A FUNDED MAINNET SMOKE/i);
assert.match(home, /LIVE[\s\S]{0,80}STANDARD x402 V2 SOLANA DOOR AT EXACTLY 0\.01 USDC/);

console.log('PASS  /agents is a live-testable, truthful free-to-ranked handoff');
