import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { PublicKey } from '@solana/web3.js';
import {
  generateTimepinVectors, assertTimepinVectors, serializeVector, PROGRAM_ID, HISTORICAL_PROGRAM_ID,
} from '../onchain/rcx-timepin-v2/scripts/vector-data.mjs';
import { runVectorCommand, readVerifiedArtifact, parseVectorArgs } from '../onchain/rcx-timepin-v2/scripts/generate-vectors.mjs';
import { runVectorCommand as repin } from '../tools/repin-timepin-vectors.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = JSON.parse(readFileSync(join(root, 'onchain/rcx-timepin-v2/vectors/fixture-input.json'), 'utf8'));
const sha = 'a'.repeat(64);
const artifact = { sha256: sha, size: 256, elfFlags: 3, sbpfVersion: 3,
  path: 'ratchetx-onchain-sbf/' + sha + '/rcx_timepin_v2.so' };
const generate = (input = fixture, tuple = artifact) => generateTimepinVectors({ fixture: input, artifact: tuple });
const clone = value => structuredClone(value);
const digest = value => createHash('sha256').update(value).digest('hex');
const mutate = fn => { const value = clone(fixture); fn(value); return value; };
function workspace() {
  const path = mkdtempSync(join(tmpdir(), 'ratchetx-vector-test-'));
  const timepinRoot = join(path, 'timepin');
  const cacheRoot = join(path, 'ratchetx-onchain-sbf');
  mkdirSync(join(timepinRoot, 'vectors'), { recursive: true });
  mkdirSync(join(timepinRoot, 'programs/rcx-timepin-v2/src'), { recursive: true });
  writeFileSync(join(timepinRoot, 'vectors/fixture-input.json'), serializeVector(fixture));
  writeFileSync(join(timepinRoot, 'programs/rcx-timepin-v2/src/lib.rs'), 'declare_id!("' + PROGRAM_ID + '");\n');
  writeFileSync(join(timepinRoot, 'Anchor.toml'), '[programs.localnet]\nrcx_timepin_v2 = "' + PROGRAM_ID + '"\n');
  const elf = Buffer.alloc(256);
  elf.set([0x7f, 0x45, 0x4c, 0x46, 2, 1]); elf.writeUInt32LE(3, 48);
  new PublicKey(PROGRAM_ID).toBuffer().copy(elf, 64);
  const pin = bytes => {
    const dir = join(cacheRoot, digest(bytes)); mkdirSync(dir, { recursive: true });
    const artifactPath = join(dir, 'rcx_timepin_v2.so'); writeFileSync(artifactPath, bytes); return artifactPath;
  };
  const artifactPath = pin(elf);
  return { path, timepinRoot, cacheRoot, artifactPath, elf, pin, cwd: path, env: {}, log: () => {},
    clean: () => {
      assert.equal(dirname(path), tmpdir(), 'cleanup remains in test-owned tmpdir');
      assert.match(path, /ratchetx-vector-test-[^\\/]+$/);
      rmSync(path, { recursive: true, force: true });
    } };
}

test('explicit adapter-1 baseline regenerates every stored account and rent suffix', () => {
  const input = clone(fixture), saved = clone(input);
  const { register: r, lifecycle: l } = generate(input);
  assert.deepEqual(input, saved, 'pure generator never mutates its inputs');
  assert.equal(r.evidencePolicy.fields.adapter, 1);
  assert.match(r.scope, /Synthetic experimental adapter-1/);
  assert.equal(r.need.accountLength, 168);
  assert.equal(r.need.payloadLength, 160);
  assert.match(r.need.fields, /open_refs u32 \| rent_payer Pubkey$/);
  const need = Buffer.from(r.need.accountBytesHex, 'hex');
  assert.equal(need.length, 168); assert.equal(need.readUInt32LE(132), 0);
  assert.equal(need.subarray(136).toString('hex'), fixture.need.rentPayerHex);
  assert.equal(l.accounts.WorkManifest.frozenLocatorFields.subjectAccountSize, 168);
  for (const value of Object.values(l.accounts.TimepinNeedV2.states)) {
    const bytes = Buffer.from(value.accountBytesHex, 'hex');
    assert.equal(bytes.length, 168); assert.equal(bytes[11], value.value);
    assert.equal(bytes.subarray(68, 100).toString('hex'), value.candidateAHashHex);
    assert.equal(bytes.subarray(100, 132).toString('hex'), value.candidateBHashHex);
  }
  assert.equal(Buffer.from(r.evidenceSpec.accountBytesHex, 'hex').length, 262);
  assert.equal(Buffer.from(l.goldenMessages.a.accountBytesHex, 'hex').length, 119);
  assert.equal(Buffer.from(l.accounts.WorkManifest.firstCapture.accountBytesHex, 'hex').length, 42);
  assert.equal(Buffer.from(l.accounts.WorkPage.emptyAccountBytesHex, 'hex').length, 47);
  assert.equal(Buffer.from(l.accounts.WorkPage.reservedFirstAccountBytesHex, 'hex').length, 153);
  assert.equal(Buffer.from(l.accounts.WorkPage.reservedBothAccountBytesHex, 'hex').length, 259);
  assert.equal(r.need.sourceDeadlineTs, 1800001259);
  assert.equal(r.need.captureDeadlineTs, 1800001319);
  assert.equal(r.syntheticGenerationFixture.receiverConfig.completeAccountDataSha256,
    '71255c0e9d2cc86c92b38ff4c759237799098518616ba6fdd0d9b2119e24129e');
  assert.equal(serializeVector(generate()), serializeVector(generate()), 'deterministic output');
});

test('valid policy mutation updates bytes, both hashes, deadlines, PDAs and state encodings together', () => {
  const before = generate(), after = generate(mutate(f => { f.policy.maxPostTargetLagSeconds = 58; }));
  for (const field of ['canonicalBytesHex', 'hashHex']) {
    assert.notEqual(after.register.evidencePolicy[field], before.register.evidencePolicy[field]);
    assert.notEqual(after.register.evidenceSpec[field], before.register.evidenceSpec[field]);
  }
  assert.equal(after.register.need.sourceDeadlineTs, before.register.need.sourceDeadlineTs - 1);
  assert.equal(after.register.need.captureDeadlineTs, before.register.need.captureDeadlineTs - 1);
  assert.notEqual(after.register.need.pda, before.register.need.pda);
  assert.notEqual(after.lifecycle.accounts.WorkPage.fixturePda, before.lifecycle.accounts.WorkPage.fixturePda);
  assert.notEqual(after.lifecycle.goldenMessages.a.candidatePda, before.lifecycle.goldenMessages.a.candidatePda);
  assert.notEqual(after.lifecycle.terminalVectors.finalResultHashHex, before.lifecycle.terminalVectors.finalResultHashHex);
  for (const name of Object.keys(before.lifecycle.accounts.TimepinNeedV2.states)) {
    assert.notEqual(after.lifecycle.accounts.TimepinNeedV2.states[name].accountBytesHex,
      before.lifecycle.accounts.TimepinNeedV2.states[name].accountBytesHex);
  }
  assert.equal(after.lifecycle.goldenMessages.a.messageHashHex, before.lifecycle.goldenMessages.a.messageHashHex);
});

test('generation config and slot mutations affect spec bytes and PDAs but leave policy identity alone', () => {
  const before = generate();
  for (const input of [
    mutate(f => { f.generation.receiverConfig.governanceAuthorityHex = '0c'.repeat(32); }),
    mutate(f => { f.generation.receiverProgramData.generationSlot += 1; }),
  ]) {
    const after = generate(input);
    assert.equal(after.register.evidencePolicy.hashHex, before.register.evidencePolicy.hashHex);
    assert.notEqual(after.register.evidenceSpec.hashHex, before.register.evidenceSpec.hashHex);
    assert.notEqual(after.register.evidenceSpec.accountBytesHex, before.register.evidenceSpec.accountBytesHex);
    assert.notEqual(after.register.need.pda, before.register.need.pda);
  }
});

test('message mutation regenerates message hash, candidate account/PDA, ordering and terminal hashes', () => {
  const before = generate();
  const after = generate(mutate(f => { f.messages.a.price += 42; }));
  assert.notEqual(after.lifecycle.goldenMessages.a.messageHashHex, before.lifecycle.goldenMessages.a.messageHashHex);
  assert.notEqual(after.lifecycle.goldenMessages.a.accountBytesHex, before.lifecycle.goldenMessages.a.accountBytesHex);
  assert.notEqual(after.lifecycle.goldenMessages.a.candidatePda, before.lifecycle.goldenMessages.a.candidatePda);
  assert.notEqual(after.lifecycle.terminalVectors.finalResultHashHex, before.lifecycle.terminalVectors.finalResultHashHex);
  assert.deepEqual(after.lifecycle.terminalVectors.ambiguousHashOrder,
    [after.lifecycle.goldenMessages.a.messageHashHex, after.lifecycle.goldenMessages.b.messageHashHex].sort());
  assert.equal(after.register.need.pda, before.register.need.pda);
  assert.equal(after.lifecycle.terminalVectors.expiredResultHashHex, before.lifecycle.terminalVectors.expiredResultHashHex);
});

test('invalid policy, future registration, wrong adapter, misaligned target and invalid candidate fail closed', () => {
  for (const [edit, pattern] of [
    [f => { f.policy.maxPostTargetLagSeconds = 120; }, /POST_LAG_NOT_BELOW_GRID/],
    [f => { f.policy.adapter = 2; }, /adapter-2/],
    [f => { f.generation.registrationClockSlot = 900; }, /BAD_REGISTERED_SLOT/],
    [f => { f.need.targetTs += 1; }, /TARGET_NOT_ALIGNED/],
    [f => { f.messages.publishTime += 60; }, /POST_LAG/],
    [f => { f.messages.postedSlot = f.generation.registrationClockSlot; }, /CORRUPT_CANDIDATE/],
    [f => { f.need.rentPayerHex = '00'.repeat(32); }, /nonzero rent payer/],
  ]) assert.throws(() => generate(mutate(edit)), pattern);
});

test('complete comparison rejects independently mutated stale fields and injected execution claims', () => {
  for (const edit of [
    v => { v.register.evidencePolicy.canonicalBytesHex = '00'; },
    v => { v.register.evidenceSpec.hashHex = '00'.repeat(32); },
    v => { v.register.need.accountLength = 132; },
    v => { v.register.need.sourceDeadlineTs += 61; },
    v => { v.lifecycle.accounts.WorkManifest.frozenLocatorFields.subjectAccountSize = 132; },
    v => { v.lifecycle.terminalVectors.ambiguousHashOrder.reverse(); },
    v => { v.lifecycle.accounts.TimepinNeedV2.states.final.accountBytesHex = '00'; },
    v => { v.lifecycle.runtimeEvidence = { passed: 3 }; },
    v => { v.lifecycle.goldenMessages.a.runtimeProven = true; },
  ]) {
    const bad = generate(); edit(bad);
    assert.throws(() => assertTimepinVectors(bad, { fixture, artifact }), /differs from complete deterministic generation/);
  }
});

test('execution counts and CU are never inherited or synthesized', () => {
  const input = clone(fixture);
  input.runtimeEvidence = { passed: 123, computeUnits: { capture: 999 } };
  const tuple = { ...artifact, liteSvm: { passed: 3 }, computeUnits: 54173, runtimeProven: true };
  const output = generate(input, tuple);
  const serialized = serializeVector(output);
  assert.doesNotMatch(serialized, /"runtimeEvidence"|"computeUnits"|"liteSvm"|"runtimeProven"|"passed"|"failed"/);
  for (const value of Object.values(output)) {
    assert.equal(value.executionEvidence.status, 'not-included');
    assert.equal(value.executionEvidence.requiredGate, 'tools/g2-build-artifacts.mjs --verify-artifacts');
    assert.match(value.executionEvidence.acceptance, /cannot replace/);
  }
});

test('artifact tuple mismatch, bad version and mutable path are refused', () => {
  for (const change of [
    { path: 'target/deploy/rcx_timepin_v2.so' }, { sha256: 'b'.repeat(64) },
    { sbpfVersion: 2 }, { elfFlags: 2 }, { size: 1 }, { programId: HISTORICAL_PROGRAM_ID },
  ]) assert.throws(() => generate(fixture, { ...artifact, ...change }), /artifact/);
});

test('thin adapters share one writer/check contract and never rewrite on check', () => {
  assert.equal(repin, runVectorCommand);
  const f = workspace();
  try {
    const vectorDir = join(f.timepinRoot, 'vectors');
    runVectorCommand(['--sbf', f.artifactPath], f);
    const originals = ['register-open-v2.json', 'lifecycle-v2.json'].map(name => readFileSync(join(vectorDir, name), 'utf8'));
    const checked = repin(['--check'], f);
    assert.equal(checked.mode, 'check');
    originals.forEach((bytes, i) => assert.equal(readFileSync(join(vectorDir,
      ['register-open-v2.json', 'lifecycle-v2.json'][i]), 'utf8'), bytes));
    const staging = join(f.path, 'explicit-output');
    repin(['--to', PROGRAM_ID, '--artifact', f.artifactPath, '--deployable', '--out', staging], f);
    originals.forEach((bytes, i) => assert.equal(readFileSync(join(staging,
      ['register-open-v2.json', 'lifecycle-v2.json'][i]), 'utf8'), bytes));
    runVectorCommand(['--check', '--out', staging], f);
    const changed = JSON.parse(originals[0]); changed.need.accountLength = 132;
    const changedBytes = serializeVector(changed);
    writeFileSync(join(vectorDir, 'register-open-v2.json'), changedBytes);
    assert.throws(() => repin(['--check'], f), /differs from complete deterministic generation/);
    assert.equal(readFileSync(join(vectorDir, 'register-open-v2.json'), 'utf8'), changedBytes);
  } finally { f.clean(); }
});

test('invalid fixture/artifact/source validation completes before touching either output', () => {
  const f = workspace();
  try {
    const files = ['register-open-v2.json', 'lifecycle-v2.json'].map(name => join(f.timepinRoot, 'vectors', name));
    files.forEach(file => writeFileSync(file, 'existing sentinel\n'));
    writeFileSync(join(f.timepinRoot, 'vectors/fixture-input.json'),
      serializeVector(mutate(v => { v.policy.maxPostTargetLagSeconds = 120; })));
    assert.throws(() => repin(['--artifact', f.artifactPath], f), /POST_LAG_NOT_BELOW_GRID/);
    files.forEach(file => assert.equal(readFileSync(file, 'utf8'), 'existing sentinel\n'));
    const wrong = Buffer.from(f.elf); new PublicKey(HISTORICAL_PROGRAM_ID).toBuffer().copy(wrong, 128);
    assert.throws(() => readVerifiedArtifact(f.pin(wrong), f), /historical/);
    wrong.fill(0, 64, 96);
    assert.throws(() => readVerifiedArtifact(f.pin(wrong), f), /missing canonical/);
    writeFileSync(f.artifactPath, Buffer.concat([f.elf, Buffer.from([1])]));
    assert.throws(() => readVerifiedArtifact(f.artifactPath, f), /content-addressed/);
    writeFileSync(join(f.timepinRoot, 'programs/rcx-timepin-v2/src/lib.rs'), 'declare_id!("' + HISTORICAL_PROGRAM_ID + '");');
    assert.throws(() => repin(['--artifact', f.artifactPath], f), /source declare_id/);
    files.forEach(file => assert.equal(readFileSync(file, 'utf8'), 'existing sentinel\n'));
  } finally { f.clean(); }
});

test('CLI flags are strict and both actual entry points expose the same help', () => {
  for (const args of [
    ['--allow-mixed-staging'], ['--check', '--check'], ['--sbf'], ['--sbf', 'x', '--artifact', 'y'],
    ['--to', HISTORICAL_PROGRAM_ID], ['--deployable', 'true'], ['--in', 'x'],
  ]) assert.throws(() => parseVectorArgs(args));
  const outputs = ['onchain/rcx-timepin-v2/scripts/generate-vectors.mjs', 'tools/repin-timepin-vectors.mjs']
    .map(file => spawnSync(process.execPath, [join(root, file), '--help'], { encoding: 'utf8', windowsHide: true }));
  for (const result of outputs) assert.equal(result.status, 0, result.stderr);
  assert.equal(outputs[0].stdout, outputs[1].stdout);
  assert.match(outputs[0].stdout, /default output is canonical/);
});