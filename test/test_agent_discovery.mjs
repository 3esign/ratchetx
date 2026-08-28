// Agent discovery is a protocol surface, not marketing copy. Keep the files
// machine-readable, internally linked, and honest about what is free, ranked,
// canonical and merely optional.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';

const read = p => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const catalog = JSON.parse(read('../.well-known/ai-catalog.json'));
const mcp = JSON.parse(read('../.well-known/mcp.json'));
const skillIndex = JSON.parse(read('../.well-known/agent-skills/index.json'));
const skillBytes = fs.readFileSync(new URL('../skills/ratchetx/SKILL.md', import.meta.url));
const skill = skillBytes.toString('utf8');
const llms = read('../llms.txt');
const sitemap = read('../sitemap.xml');
const openapi = JSON.parse(read('../openapi.json'));
const vercel = JSON.parse(read('../vercel.json'));
const vercelIgnore = read('../.vercelignore');

assert.equal(catalog.specVersion, '1.0');
assert.equal(catalog.host.displayName, 'RatchetX');
assert.equal(catalog.host.identifier, undefined, 'do not claim did:web without publishing a DID document');
assert.ok(Array.isArray(catalog.entries) && catalog.entries.length >= 4);

const ids = new Set();
for (const entry of catalog.entries) {
  assert.match(entry.identifier, /^urn:air:[a-zA-Z0-9.-]+(:[a-zA-Z0-9._-]+)+$/);
  assert.ok(!ids.has(entry.identifier), `duplicate catalog identifier: ${entry.identifier}`);
  ids.add(entry.identifier);
  assert.ok(entry.displayName && entry.type && entry.url);
  assert.ok(Array.isArray(entry.representativeQueries));
  assert.ok(entry.representativeQueries.length >= 2 && entry.representativeQueries.length <= 5);
}

const mcpEntry = catalog.entries.find(e => e.type === 'application/mcp-server-card+json');
assert.equal(mcpEntry.url, 'https://ratchetx.xyz/.well-known/mcp.json');
assert.equal(mcp.apiBase, 'https://ratchetx.xyz/api/game');
assert.ok(mcp.servers.some(s => s.type === 'streamable-http' && s.url === 'https://ratchetx.xyz/api/mcp'),
  'discovery must offer a zero-install remote, not only a clone-and-run stdio server');
assert.ok(catalog.entries.some(e => e.identifier.endsWith(':skill:forecast-arena')
  && e.url === 'https://ratchetx.xyz/skills/ratchetx/SKILL.md'),
  'the portable Agent Skill is part of domain-anchored discovery');

assert.equal(skillIndex.$schema, 'https://schemas.agentskills.io/discovery/0.2.0/schema.json');
assert.equal(skillIndex.skills.length, 1);
assert.deepEqual(
  { name: skillIndex.skills[0].name, type: skillIndex.skills[0].type, url: skillIndex.skills[0].url },
  {
    name: 'ratchetx',
    type: 'skill-md',
    url: 'https://ratchetx.xyz/skills/ratchetx/SKILL.md',
  },
);
const skillDigest = crypto.createHash('sha256').update(skillBytes).digest('hex');
assert.equal(skillIndex.skills[0].digest, `sha256:${skillDigest}`,
  'the domain index digest must match the exact deployed Skill bytes');
const frontmatter = skill.match(/^---\r?\n([\s\S]*?)\r?\n---/);
assert.ok(frontmatter, 'the Agent Skill needs YAML frontmatter');
assert.match(frontmatter[1], /^description:\s*[>|]/m,
  'description must use a YAML block scalar so colon-space cannot break installation');
assert.match(frontmatter[1], /^\s+version:\s+"1\.0\.4"$/m);

const board = catalog.entries.find(e => e.identifier.endsWith(':live-board'));
const corpus = catalog.entries.find(e => e.identifier.endsWith(':forecast-corpus'));
const paidEntry = catalog.entries.find(e => e.identifier.endsWith(':x402:ranked-entry-claim'));
assert.equal(board.metadata.paymentRequired, false, 'the live board is free');
assert.equal(corpus.metadata.paymentRequired, false, 'the public corpus is free');
assert.equal(paidEntry.url, 'https://ratchetx.xyz/api/agent-entry');
assert.equal(paidEntry.metadata.paymentRequired, true);
assert.equal(paidEntry.metadata.method, 'POST');
assert.equal(paidEntry.metadata.amountAtomic, '10000');
assert.equal(paidEntry.metadata.teamSharePct, 0);
assert.deepEqual(
  { catalog:paidEntry.metadata.externalDiscovery.catalog,
    listed:paidEntry.metadata.externalDiscovery.listed },
  { catalog:'PayAI Bazaar', listed:true },
);
assert.match(llms, /\.well-known\/ai-catalog\.json/);
assert.match(llms, /canonical arbiter for credits and XP/);
assert.match(llms, /https:\/\/ratchetx\.xyz\/api\/mcp/);
assert.match(llms, /Standard x402 v2 USDC door \(LIVE\)/);
assert.match(llms, /funded mainnet payment and[\s\S]*idempotent replay test passed/);
assert.match(llms, /POST \/api\/agent-entry/);
assert.match(llms, /PayAI Bazaar independently indexed/);
assert.equal(openapi.openapi, '3.1.0');
assert.equal(openapi.servers[0].url, 'https://ratchetx.xyz');
assert.equal(openapi.info.contact.url, 'https://github.com/3esign/ratchetx/issues');
const paidOperation = openapi.paths['/api/agent-entry'].post;
assert.equal(paidOperation.operationId, 'buyRatchetXRankedEntryClaim');
assert.deepEqual(paidOperation['x-payment-info'], {
  price:{ mode:'fixed', currency:'USD', amount:'0.01' },
  protocols:[{ x402:{} }],
});
assert.ok(paidOperation.responses['200'] && paidOperation.responses['402']);
assert.equal(paidOperation.requestBody.content['application/json'].schema.additionalProperties, false);
assert.deepEqual(Object.keys(openapi.paths), ['/api/agent-entry'],
  'free APIs must not be mislabeled as paid x402scan resources');
assert.doesNotMatch(llms, /shipped dark|production flag is still OFF/i);
for (const path of [
  '/api/agent-entry',
  '/openapi.json',
  '/llms.txt',
  '/skills/ratchetx/SKILL.md',
  '/.well-known/agent-skills/index.json',
  '/.well-known/ai-catalog.json',
  '/.well-known/mcp.json',
]) {
  assert.ok(sitemap.includes(path), `sitemap is missing agent discovery path: ${path}`);
}

const wellKnownHeaders = vercel.headers.find(h => h.source === '/.well-known/(.*)');
assert.ok(wellKnownHeaders, 'Vercel must serve well-known discovery files with explicit headers');
assert.ok(wellKnownHeaders.headers.some(h => h.key === 'Access-Control-Allow-Origin' && h.value === '*'));
const skillHeaders = vercel.headers.find(h => h.source === '/skills/ratchetx/SKILL.md');
assert.ok(skillHeaders && skillHeaders.headers.some(h =>
  h.key === 'Content-Type' && h.value.startsWith('text/markdown')),
  'the public Agent Skill must be served as Markdown');
assert.match(vercelIgnore, /^!skills\/ratchetx\/SKILL\.md$/m,
  'the exact public Agent Skill must be re-included after the global Markdown deploy exclusion');
const openapiHeaders = vercel.headers.find(h => h.source === '/openapi.json');
assert.ok(openapiHeaders && openapiHeaders.headers.some(h =>
  h.key === 'Access-Control-Allow-Origin' && h.value === '*'),
  'OpenAPI discovery must be readable cross-origin');

console.log('PASS  agent discovery is installable, digest-bound, linked, CORS-visible, and honest');
