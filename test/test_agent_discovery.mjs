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
const registration = JSON.parse(read('../agent-registration.json'));
const domainRegistration = JSON.parse(read('../.well-known/agent-registration.json'));
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
assert.match(frontmatter[1], /^\s+version:\s+"1\.0\.6"$/m);

assert.deepEqual(domainRegistration, registration,
  'the well-known domain proof must mirror the primary ERC-8004 registration file');
assert.equal(registration.type, 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1');
assert.equal(registration.name, 'RatchetX');
assert.equal(registration.active, true);
assert.equal(registration.x402Support, true);
assert.deepEqual(registration.registrations, [{
  agentId: 'Auj5yXbsaeQUJpYpSRugkgRE3ABc76uqmUe3Vz7fxqCu',
  agentRegistry: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:8oo4dC4JvBLwy5tGgiH3WwK4B9PWxL9Z4XjA2jzkQMbQ',
}], 'the domain profile must point back to the canonical Solana agent asset and mainnet registry');
assert.deepEqual(registration.supportedTrust, ['reputation', 'crypto-economic']);
assert.ok(registration.services.some(s => s.name === 'MCP'
  && s.endpoint === 'https://ratchetx.xyz/api/mcp'
  && s.version === '2025-11-25'));
assert.deepEqual(registration.services.find(s => s.name === 'MCP').tools, [
  'ratchet_new_demo', 'ratchet_board', 'ratchet_demo_shot', 'ratchet_demo_state',
  'ratchet_arena', 'ratchet_challenges', 'ratchet_proof',
]);
assert.ok(registration.services.some(s => s.name === 'x402'
  && s.endpoint === 'https://ratchetx.xyz/api/agent-entry' && s.version === '2'));
assert.ok(registration.services.some(s => s.name === 'Gauntlet'
  && s.endpoint === 'https://ratchetx.xyz/api/gauntlet' && s.version === '1.0'));
const oasf = registration.services.find(s => s.name === 'OASF');
assert.ok(oasf && oasf.skills.length >= 3 && oasf.domains.includes('technology/blockchain/blockchain'));

const board = catalog.entries.find(e => e.identifier.endsWith(':live-board'));
const corpus = catalog.entries.find(e => e.identifier.endsWith(':forecast-corpus'));
const paidEntry = catalog.entries.find(e => e.identifier.endsWith(':x402:ranked-entry-claim'));
const gauntlet = catalog.entries.find(e => e.identifier.endsWith(':gauntlet:first-contact'));
assert.equal(board.metadata.paymentRequired, false, 'the live board is free');
assert.equal(corpus.metadata.paymentRequired, false, 'the public corpus is free');
assert.equal(gauntlet.url, 'https://ratchetx.xyz/api/gauntlet');
assert.equal(gauntlet.metadata.paymentRequired, false);
assert.equal(gauntlet.metadata.monetaryReward, false);
assert.equal(gauntlet.metadata.completionPredicate, 'player.stated >= 1');
assert.equal(mcp.gauntlet.id, 'first-contact-001');
assert.equal(mcp.gauntlet.api, 'https://ratchetx.xyz/api/gauntlet');
assert.match(mcp.inspection.schemasWithoutAClient, /405/);
assert.deepEqual(mcp.inspection.standardClientFlow,
  ['POST initialize', 'POST tools/list', 'POST tools/call']);
assert.equal(mcp.trustBoundary.canonicalSettlement, 'ratchet-server');
assert.equal(mcp.trustBoundary.independentPythReplay, false);
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
assert.match(llms, /GET \/api\/gauntlet/);
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
  '/gauntlet',
  '/api/gauntlet',
  '/api/agent-entry',
  '/openapi.json',
  '/agent-registration.json',
  '/llms.txt',
  '/skills/ratchetx/SKILL.md',
  '/.well-known/agent-skills/index.json',
  '/.well-known/ai-catalog.json',
  '/.well-known/mcp.json',
  '/.well-known/agent-registration.json',
]) {
  assert.ok(sitemap.includes(path), `sitemap is missing agent discovery path: ${path}`);
}
assert.ok(vercel.rewrites.some(route =>
  route.source === '/gauntlet' && route.destination === '/gauntlet.html'));

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
const registrationHeaders = vercel.headers.find(h => h.source === '/agent-registration.json');
assert.ok(registrationHeaders && registrationHeaders.headers.some(h =>
  h.key === 'Access-Control-Allow-Origin' && h.value === '*'),
  'ERC-8004 registration metadata must be readable cross-origin');

console.log('PASS  agent discovery is installable, digest-bound, linked, CORS-visible, and honest');
