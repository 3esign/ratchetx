// Agent discovery is a protocol surface, not marketing copy. Keep the files
// machine-readable, internally linked, and honest about what is free, ranked,
// canonical and merely optional.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = p => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const catalog = JSON.parse(read('../.well-known/ai-catalog.json'));
const mcp = JSON.parse(read('../.well-known/mcp.json'));
const llms = read('../llms.txt');
const vercel = JSON.parse(read('../vercel.json'));

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

const board = catalog.entries.find(e => e.identifier.endsWith(':live-board'));
const corpus = catalog.entries.find(e => e.identifier.endsWith(':forecast-corpus'));
assert.equal(board.metadata.paymentRequired, false, 'the live board is free');
assert.equal(corpus.metadata.paymentRequired, false, 'the public corpus is free');
assert.match(llms, /\.well-known\/ai-catalog\.json/);
assert.match(llms, /canonical arbiter for credits and XP/);

const wellKnownHeaders = vercel.headers.find(h => h.source === '/.well-known/(.*)');
assert.ok(wellKnownHeaders, 'Vercel must serve well-known discovery files with explicit headers');
assert.ok(wellKnownHeaders.headers.some(h => h.key === 'Access-Control-Allow-Origin' && h.value === '*'));

console.log('PASS  ARD catalog is schema-shaped, linked, CORS-visible, and honest');
