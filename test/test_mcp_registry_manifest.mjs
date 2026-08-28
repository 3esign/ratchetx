import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('server.json'));
const domain = JSON.parse(read('.well-known/mcp.json'));
const workflow = read('.github/workflows/publish-mcp.yml');

assert.equal(manifest.$schema,
  'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json');
assert.equal(manifest.name, 'io.github.3esign/ratchetx');
assert.equal(manifest.title, 'RatchetX Forecast Arena');
assert.ok(manifest.description.length > 20 && manifest.description.length <= 100);
assert.equal(manifest.version, domain.version,
  'official registry and domain-owned MCP metadata must describe the same server version');
assert.deepEqual(manifest.repository, {
  url: 'https://github.com/3esign/ratchetx',
  source: 'github',
});
assert.equal(manifest.websiteUrl, 'https://ratchetx.xyz');
assert.deepEqual(manifest.remotes, [{
  type: 'streamable-http',
  url: 'https://ratchetx.xyz/api/mcp',
}]);
assert.deepEqual(manifest.icons, [{
  src: 'https://ratchetx.xyz/icon-512.png',
  mimeType: 'image/png',
  sizes: ['512x512'],
}]);
assert.equal(manifest.packages, undefined,
  'the public remote is directly callable and must not pretend an npm package exists');

assert.match(workflow, /workflow_dispatch:/);
assert.match(workflow, /id-token:\s*write/);
assert.match(workflow, /mcp-publisher login github-oidc/);
assert.match(workflow, /mcp-publisher validate server\.json/);
assert.match(workflow, /mcp-publisher publish server\.json/);
assert.doesNotMatch(workflow, /pull_request_target|self-hosted|secrets\./,
  'registry publishing must not expose a persistent namespace credential');

console.log('PASS  official MCP Registry manifest is remote-only, version-bound, and OIDC-published');
