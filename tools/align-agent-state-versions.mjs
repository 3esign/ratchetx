#!/usr/bin/env node
// Align docs/AGENT_STATE.json's skill version fields with the SKILL.md that is
// actually in THIS tree.
//
// Why this exists. The freeze-copy correction (d7c9162) was made on a branch
// whose SKILL.md had already moved to a newer version, so the commit carries
// both the promise fix AND a skill version bump. Cherry-picking it onto main -
// where SKILL.md is still the older version - makes check-versions.mjs fail with
// "AGENT_STATE.json skill == SKILL.md", which is correct: the state file would be
// claiming a skill version that tree does not have.
//
// The publish path must carry the promise fix and NOTHING ELSE, so this puts the
// version fields back to whatever SKILL.md in the current tree says. It is not a
// fixup for a mistake; it is the one line that keeps a cross-branch cherry-pick
// honest.
import fs from 'node:fs';

const SKILL = 'skills/ratchetx/SKILL.md';
const STATE = 'docs/AGENT_STATE.json';

const match = fs.readFileSync(SKILL, 'utf8').match(/version:\s*"([^"]+)"/);
if (!match) {
  console.error(`could not read a version out of ${SKILL}`);
  process.exit(1);
}
const version = match[1];

const state = JSON.parse(fs.readFileSync(STATE, 'utf8'));
if (!state.versions) {
  console.error(`${STATE} has no versions block`);
  process.exit(1);
}
const before = { agentSkill: state.versions.agentSkill, erc8004: state.versions.erc8004 };
state.versions.agentSkill = version;
state.versions.erc8004 = version;
fs.writeFileSync(STATE, JSON.stringify(state, null, 2) + '\n');

if (before.agentSkill === version && before.erc8004 === version) {
  console.log(`AGENT_STATE.json already matches SKILL.md (${version}); nothing changed.`);
} else {
  console.log(`aligned AGENT_STATE.json to SKILL.md ${version} (was agentSkill=${before.agentSkill}, erc8004=${before.erc8004})`);
}
