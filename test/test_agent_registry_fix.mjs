import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const server = read('tools/agent-registry-fix/server.mjs');
const app = read('tools/agent-registry-fix/app.js');
const page = read('tools/agent-registry-fix/index.html');
const registration = JSON.parse(read('agent-registration.json'));

for (const value of [
  'HXFDaHyZ3i477z1BakiTWZg9UQN8rcreruuv9ifC1HvM',
  'Auj5yXbsaeQUJpYpSRugkgRE3ABc76uqmUe3Vz7fxqCu',
  '8oo4dC4JvBLwy5tGgiH3WwK4B9PWxL9Z4XjA2jzkQMbQ',
  'https://ratchetx.xyz/agent-registration.json',
]) {
  assert.ok(server.includes(value) && app.includes(value) && page.includes(value), `fixed fact missing: ${value}`);
}
assert.equal(registration.name, 'RatchetX');
assert.equal(registration.x402Support, true);
const mcp = registration.services.find(service => service.name === 'MCP');
assert.deepEqual(mcp.tools, [
  'ratchet_new_demo', 'ratchet_board', 'ratchet_demo_shot', 'ratchet_demo_state',
  'ratchet_arena', 'ratchet_challenges', 'ratchet_proof',
]);
assert.ok(registration.services.some(service => service.name === 'x402'
  && service.endpoint === 'https://ratchetx.xyz/api/agent-entry'));
assert.equal(registration.registrations[0].agentId,
  'Auj5yXbsaeQUJpYpSRugkgRE3ABc76uqmUe3Vz7fxqCu');
assert.equal(registration.registrations[0].agentRegistry,
  'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:8oo4dC4JvBLwy5tGgiH3WwK4B9PWxL9Z4XjA2jzkQMbQ');
assert.match(server, /registryInstructions\.length !== 1/);
assert.match(server, /ComputeBudget111111111111111111111111111111/);
assert.match(app, /validate\(signed, data\.prepared\)/);
assert.match(server, /\['sendTransaction', 'getSignatureStatuses', 'getTransaction'\]/);
assert.doesNotMatch(server + app, /private.?key|secret.?key/i);
assert.match(page, /no new agent is minted/i);

console.log('PASS  Agent Registry repair is fixed to one owner, asset, program, URI and instruction');
