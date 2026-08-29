import fs from 'fs';
import crypto from 'crypto';

let failed = false;
function assertVersion(label, actual, expected) {
  if (actual !== expected) {
    console.error(`[FAIL] ${label}: expected ${expected}, got ${actual}`);
    failed = true;
  } else {
    console.log(`[OK] ${label}: ${actual}`);
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

try {
  const agentState = readJson('docs/AGENT_STATE.json');

  // --- SKILLS ---
  const skillText = fs.readFileSync('skills/ratchetx/SKILL.md', 'utf8');
  const skillVersionMatch = skillText.match(/version:\s*"([^"]+)"/);
  const skillVersion = skillVersionMatch ? skillVersionMatch[1] : null;

  const catalog = readJson('.well-known/ai-catalog.json');
  const catalogSkillItem = catalog.entries.find(i => i.url && i.url.includes('SKILL.md'));
  const catalogSkillVersion = catalogSkillItem ? catalogSkillItem.version : null;

  // Agent Skills Index Digest
  const skillsIndex = readJson('.well-known/agent-skills/index.json');
  const skillItem = skillsIndex.skills.find(s => s.name === 'ratchetx');
  const actualDigest = 'sha256:' + crypto.createHash('sha256').update(skillText).digest('hex');

  assertVersion('Agent Skills index digest == SKILL.md sha256', skillItem.digest, actualDigest);
  assertVersion('AI Catalog Skill == SKILL.md', catalogSkillVersion, skillVersion);
  assertVersion('AGENT_STATE.json skill == SKILL.md', agentState.versions.agentSkill, skillVersion);

  // --- MCP ---
  const mcp = readJson('.well-known/mcp.json');
  const mcpVersion = mcp.version;
  const catalogMcpItem = catalog.entries.find(i => i.type && i.type.includes('mcp'));
  const catalogMcpVersion = catalogMcpItem ? catalogMcpItem.version : mcpVersion;

  const mcpRuntimeApi = fs.readFileSync('api/mcp.js', 'utf8');
  const mcpRuntimeApiMatch = mcpRuntimeApi.match(/MCP_VERSION\s*=\s*'([^']+)'/);
  const mcpRuntimeApiVersion = mcpRuntimeApiMatch ? mcpRuntimeApiMatch[1] : null;

  const mcpRuntimeLogic = fs.readFileSync('mcp/ratchet-mcp.mjs', 'utf8');
  const mcpRuntimeLogicMatch = mcpRuntimeLogic.match(/VERSION\s*=\s*'([^']+)'/);
  const mcpRuntimeLogicVersion = mcpRuntimeLogicMatch ? mcpRuntimeLogicMatch[1] : null;

  const mcpRegistry = readJson('server.json');
  const mcpRegistryLegacy = readJson('mcp/server.json');

  assertVersion('AI Catalog MCP == mcp.json', catalogMcpVersion, mcpVersion);
  assertVersion('api/mcp.js runtime == mcp.json', mcpRuntimeApiVersion, mcpVersion);
  assertVersion('mcp/ratchet-mcp.mjs runtime == mcp.json', mcpRuntimeLogicVersion, mcpVersion);
  assertVersion('server.json (Official Registry) == mcp.json', mcpRegistry.version, mcpVersion);
  assertVersion('mcp/server.json (Legacy Registry) == mcp.json', mcpRegistryLegacy.version, mcpVersion);
  assertVersion('AGENT_STATE.json mcp == mcp.json', agentState.versions.mcp, mcpVersion);

  // --- ERC-8004 ---
  const regJson = readJson('.well-known/agent-registration.json');
  const skillSvc = regJson.services.find(s => s.name === 'Agent Skill');
  const regSkillVersion = skillSvc ? skillSvc.version : null;
  
  assertVersion('ERC-8004 profile (agent-registration.json) == SKILL.md', regSkillVersion, skillVersion);
  assertVersion('AGENT_STATE.json erc8004 == SKILL.md', agentState.versions.erc8004, skillVersion);

  if (failed) {
    process.exit(1);
  }
  console.log("All comprehensive version & digest checks passed.");
} catch (e) {
  console.error(e);
  process.exit(1);
}
