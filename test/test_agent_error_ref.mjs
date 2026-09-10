// The public failure reply must identify the failure without describing it.
//
// SAFE_ERRORS keeps unrecognised errors out of a public X thread. That is right,
// and on 2026-09-10 it was also the reason a real failure reached the OWNER as
// four words with nothing to look up. The ref fixes the second half without
// touching the first: eight hex of sha256, which discloses nothing and names the
// throw exactly.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { refOf, candidates } from '../tools/explain-agent-ref.mjs';

const runtime = fs.readFileSync(new URL('../skills/ratchetx-g2/scripts/g2-session.mjs', import.meta.url), 'utf8');
const runtimePath = fileURLToPath(new URL('../skills/ratchetx-g2/scripts/g2-session.mjs', import.meta.url));

test('the ref is attached only when the real code was suppressed', () => {
  // A named, allowlisted code is already the answer; adding a digest of it would
  // be noise in a reply people read on a phone.
  assert.match(runtime, /const ref = code === 'AGENT_CHECK_FAILED'/,
    'the ref must be conditional on the code having been suppressed');
  assert.match(runtime, /\.\.\.\(ref \? \{ ref, phase: publicPhase, kind \} : \{\}\)/,
    'a null ref must not appear in the JSON at all, and suppressed refs must carry only coarse public trace fields');
});

test('the ref discloses nothing and is stable', () => {
  const secretish = 'ENOENT: no such file or directory, open /home/agent/.ratchetx-g2/state.json';
  const ref = refOf(secretish);
  assert.match(ref, /^[0-9a-f]{8}$/);
  assert.equal(ref, refOf(secretish), 'the same failure must always produce the same ref');
  assert.notEqual(refOf(secretish + '!'), ref, 'a different failure must produce a different ref');
  // The point: nothing of the message survives into the reply.
  for (const fragment of ['ENOENT', 'home', 'agent', 'state.json', 'directory']) {
    assert.ok(!ref.includes(fragment), `the ref leaked ${fragment}`);
  }
});

test('a ref resolves back to the throw it came from, for whoever holds the source', () => {
  // COMMAND_ID_REQUIRED is a real literal in the runtime; if the resolver cannot
  // find a string that is definitely there, it cannot find the ones that matter.
  const table = candidates();
  assert.ok(table.has('COMMAND_ID_REQUIRED'), 'the resolver did not read the runtime source');
  const hits = [...table].filter(([value]) => refOf(value) === refOf('COMMAND_ID_REQUIRED'));
  assert.equal(hits.length >= 1, true, 'a known literal must resolve from its ref');
});

test('diagnose answers whether the seed is reaching the agent, without disclosing it', () => {
  // The filter that hides secret-ish NAMES is kept - a screenshot of this reply
  // should not hint at what is configured - but presence is reported separately,
  // because presence is the question the command exists to answer.
  assert.match(runtime, /seedProvided: Boolean\(process\.env\.RATCHET_G2_SEED\)/,
    'diagnose must report seed presence as a boolean');
  assert.ok(!/seedProvided:.*process\.env\.RATCHET_G2_SEED\s*(\?|\.)(?!.*Boolean)/.test(runtime),
    'the seed value itself must never reach the output');
  assert.match(runtime, /withheldEnvCount/, 'the count of hidden names should be visible, so nothing looks missing');
  assert.match(runtime, /is NOT set - on a host with no persistent disk/,
    'the reply must say what a missing seed causes, not only that it is missing');
});

test('diagnose works even when the seed and local identity are absent', () => {
  const env = Object.fromEntries(Object.entries(process.env)
    .filter(([key]) => key.toUpperCase() !== 'RATCHET_G2_SEED'));
  const child = spawnSync(process.execPath, [runtimePath, 'diagnose'], { env, encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr || child.stdout);
  const output = JSON.parse(child.stdout);
  assert.equal(output.code, 'DIAGNOSE');
  assert.equal(output.seedProvided, false);
  assert.match(output.reply, /RATCHET_G2_SEED is NOT set/);
});


test('a suppressed runtime failure carries a public phase and kind', () => {
  const env = { ...process.env, RATCHET_G2_SEED: 'short' };
  const child = spawnSync(process.execPath, [runtimePath, 'init'], { env, encoding: 'utf8' });
  assert.equal(child.status, 1, child.stderr || child.stdout);
  const output = JSON.parse(child.stdout);
  assert.equal(output.code, 'AGENT_CHECK_FAILED');
  assert.match(output.ref, /^[0-9a-f]{8}$/);
  assert.equal(output.phase, 'seed-identity');
  assert.equal(output.kind, 'CONFIGURATION');
  assert.match(output.reply, /phase seed-identity kind CONFIGURATION/);
  assert.doesNotMatch(output.reply, /at least 16 characters/i);
});


test('seed play pre-submit failures return a safe public result', () => {
  assert.match(runtime, /function seededPlayFailure\(error, identity\)/,
    'seed play should not fall through the generic public catch for pre-submit failures');
  assert.match(runtime, /noTransactionSent: !maybeTransactionSent/,
    'the public result must distinguish pre-submit failures from uncertain submitted transactions');
  assert.match(runtime, /catch \(error\) \{ return seededPlayFailure\(error, identity\); \}/,
    'seed play must wrap agent.play directly');
  assert.match(runtime, /Simulation refused\|InstructionError\|Custom/,
    'chain refusals should be categorized without exposing raw simulation details');
});


test('seed play phases identify the failing step', () => {
  const seedAgent = fs.readFileSync(new URL('../lib/g2/seed-agent.mjs', import.meta.url), 'utf8');
  for (const phase of ['play-classify', 'play-load', 'play-advance', 'play-intent', 'play-seal']) {
    assert.match(seedAgent, new RegExp("phase: '" + phase + "'"), 'missing seed phase ' + phase);
  }
});

test('seed play does not require a closed-shot archive lookup before a new seal', () => {
  const seedAgent = fs.readFileSync(new URL('../lib/g2/seed-agent.mjs', import.meta.url), 'utf8');
  assert.match(seedAgent, /let latest = null;\s+if \(Number\(view\.ledger\?\.open \|\| 0\) > 0\) \{\s+onStatus\(\{ phase: 'play-advance' \}\);\s+latest = await advance\(view\);\s+\}/,
    'play should only advance an existing open shot before deciding whether to seal a new one');
  assert.match(seedAgent, /async function status\(\) \{\s+const view = await game\.load\(\);\s+const latest = await advance\(view\);/,
    'status still needs archive lookup for already closed shots');
  assert.match(runtime, /getSignaturesForAddress\|signatures for address/,
    'shot archive lookup failures should not be classified as UNEXPECTED');
});
