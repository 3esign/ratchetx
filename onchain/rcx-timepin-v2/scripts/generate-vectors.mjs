import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PublicKey } from '@solana/web3.js';
import {
  deriveCandidatePda,
  deriveEvidenceSpecPda,
  deriveNeedPda,
  deriveWorkManifestPda,
  deriveWorkPagePda,
  hashPriceMessage,
  terminalResultHash,
  validateEvidenceSpec,
} from '../../rcx-timepin/model-v2.mjs';

const EXPECTED_PROGRAM_ID = 'C8wwxUGmoKAV22MaY3oW2Q6QeDbmB9dbNdbohsRjJkYp';
const HISTORICAL_PROGRAM_ID = 'US517G5965aydkZ46HS38QLi7UQiSojurfbQfKCELFx';
const EXPECTED_SBF_FILENAME = 'rcx_timepin_v2.so';
const EXPECTED_SBPF_VERSION = 3;
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const registerPath = join(root, 'vectors', 'register-open-v2.json');
const lifecyclePath = join(root, 'vectors', 'lifecycle-v2.json');
const args = process.argv.slice(2);
let checkOnly = false;
let sbfArgument;
for (let index = 0; index < args.length; index += 1) {
  const argument = args[index];
  if (argument === '--check') {
    if (checkOnly) throw new Error('--check may be specified only once');
    checkOnly = true;
    continue;
  }
  if (argument === '--sbf') {
    if (sbfArgument !== undefined) throw new Error('--sbf may be specified only once');
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error('--sbf requires a path');
    sbfArgument = value;
    index += 1;
    continue;
  }
  throw new Error(`unexpected argument: ${argument}`);
}
if (sbfArgument === undefined) {
  throw new Error('--sbf <immutable-hash-addressed-path> is required');
}
const sbfPath = realpathSync(resolve(root, sbfArgument));
const sbfPathComponents = sbfPath.split(/[\\/]+/).filter(Boolean);
if (sbfPathComponents.some(component => component.toLowerCase() === 'target')) {
  throw new Error('Timepin artifact path must not contain a mutable target directory');
}

const originalRegister = readFileSync(registerPath, 'utf8');
const originalLifecycle = readFileSync(lifecyclePath, 'utf8');
const register = JSON.parse(originalRegister);
const lifecycle = JSON.parse(originalLifecycle);
const program = new PublicKey(EXPECTED_PROGRAM_ID);
const programBytes = program.toBuffer();
const historicalProgramBytes = new PublicKey(HISTORICAL_PROGRAM_ID).toBuffer();
const key = value => new PublicKey(value).toBuffer();
const hex = value => Buffer.from(value, 'hex');
const address = value => new PublicKey(value).toBase58();
const countOccurrences = (buffer, needle) => {
  let count = 0;
  let offset = 0;
  while ((offset = buffer.indexOf(needle, offset)) !== -1) {
    count += 1;
    offset += 1;
  }
  return count;
};

const source = readFileSync(join(root, 'programs', 'rcx-timepin-v2', 'src', 'lib.rs'), 'utf8');
const anchor = readFileSync(join(root, 'Anchor.toml'), 'utf8');
if (!source.includes('declare_id!("' + EXPECTED_PROGRAM_ID + '")')) {
  throw new Error('source declare_id does not match canonical Timepin identity');
}
if (!anchor.includes('"' + EXPECTED_PROGRAM_ID + '"')) {
  throw new Error('Anchor.toml does not match canonical Timepin identity');
}

const fields = register.evidencePolicy.fields;
const spec = {
  schema: fields.schema,
  adapter: fields.adapter,
  receiverProgram: key(fields.receiverProgram),
  pushOracleProgram: key(fields.pushOracleProgram),
  shardId: fields.shardId,
  feedId: hex(fields.feedIdHex),
  requiredVerification: fields.requiredVerification,
  targetGridSeconds: fields.targetGridSeconds,
  minOpenLeadSeconds: fields.minOpenLeadSeconds,
  maxTargetAheadSeconds: fields.maxTargetAheadSeconds,
  maxPreTargetGapSeconds: fields.maxPreTargetGapSeconds,
  maxPostTargetLagSeconds: fields.maxPostTargetLagSeconds,
  captureGraceSeconds: fields.captureGraceSeconds,
  maxFutureSkewSeconds: fields.maxFutureSkewSeconds,
  minExponent: fields.minExponent,
  maxExponent: fields.maxExponent,
  maxConfidenceBps: fields.maxConfidenceBps,
  receiverProgramdataSlot: BigInt(
    register.syntheticGenerationFixture.receiverProgramData.generationSlot,
  ),
  receiverConfigHash: hex(
    register.syntheticGenerationFixture.receiverConfig.completeAccountDataSha256,
  ),
  wormholeProgram: key(register.syntheticGenerationFixture.wormholeProgram),
  wormholeProgramdataSlot: BigInt(
    register.syntheticGenerationFixture.wormholeProgramData.generationSlot,
  ),
  registeredSlot: BigInt(register.syntheticGenerationFixture.registrationClockSlot),
};

// THE VECTORS MUST DESCRIBE A SPEC THE PROGRAM WOULD ACCEPT.
//
// This script re-pins the program id but copies the POLICY straight out of the
// existing vectors, so whatever is in them is what comes back out. On
// 2026-09-05 what was in them was adapter 1 with grid 60 and lag 120 - the
// experimental strict-bracket adapter, and a lag at twice the grid, which
// validate_spec now refuses because one print would settle two consecutive
// targets. Re-pinning without this check would have locked golden vectors for a
// spec that cannot register, on the rule we are not shipping, into the one build
// that Gate 1 allows.
//
// Fail here, loudly, before anything is written. The vectors are the reference
// every later comparison is made against; a wrong one is not caught downstream,
// it becomes the definition of correct.
{
  const verdict = validateEvidenceSpec(spec);
  if (!verdict.ok) {
    throw new Error(
      `REFUSING TO PIN VECTORS: the policy in the source vectors describes a spec the `
      + `program would reject at registration (${verdict.code}`
      + `${verdict.detail ? `: ${verdict.detail}` : ''}). `
      + `adapter=${spec.adapter} grid=${spec.targetGridSeconds} `
      + `lag=${spec.maxPostTargetLagSeconds} lead=${spec.minOpenLeadSeconds} `
      + `skew=${spec.maxFutureSkewSeconds} pregap=${spec.maxPreTargetGapSeconds}. `
      + `Fix the policy in the source vectors first - re-pinning copies it forward.`,
    );
  }
}

const specPda = deriveEvidenceSpecPda(programBytes, spec);
const target = BigInt(register.need.targetTs);
const needPda = deriveNeedPda(programBytes, spec, target);
const firstManifest = deriveWorkManifestPda(programBytes, 1);
const terminalManifest = deriveWorkManifestPda(programBytes, 2);
const workPage = deriveWorkPagePda(programBytes, needPda.address);
const common = lifecycle.goldenMessages.common;
const feedId = hex(common.feedIdHex);
const message = name => ({
  price: BigInt(lifecycle.goldenMessages[name].price),
  conf: BigInt(lifecycle.goldenMessages[name].conf),
  exponent: common.exponent,
  publishTime: BigInt(common.publishTime),
  prevPublishTime: BigInt(common.prevPublishTime),
  emaPrice: BigInt(lifecycle.goldenMessages[name].price),
  emaConf: BigInt(lifecycle.goldenMessages[name].conf),
});
const hashA = hashPriceMessage(message('a'), feedId);
const hashB = hashPriceMessage(message('b'), feedId);
const candidateA = deriveCandidatePda(programBytes, needPda.address, hashA);
const candidateB = deriveCandidatePda(programBytes, needPda.address, hashB);
const [low, high] = Buffer.compare(hashA, hashB) < 0 ? [hashA, hashB] : [hashB, hashA];
const zero = Buffer.alloc(32);
const terminalNeed = {
  address: needPda.address,
  targetTs: target,
  state: 'Final',
  candidateAHash: hashA,
  candidateBHash: zero,
};
const sbf = readFileSync(sbfPath);
if (sbf.length < 52 || !sbf.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) {
  throw new Error('Timepin artifact is missing or not ELF');
}
if (sbf[4] !== 2 || sbf[5] !== 1) {
  throw new Error('Timepin artifact must be a 64-bit little-endian ELF');
}
const elfFlags = sbf.readUInt32LE(48);
if (elfFlags !== EXPECTED_SBPF_VERSION) {
  throw new Error(`Timepin artifact must be SBPFv${EXPECTED_SBPF_VERSION}; ELF e_flags=${elfFlags}`);
}
const canonicalProgramIdOccurrences = countOccurrences(sbf, programBytes);
const historicalProgramIdOccurrences = countOccurrences(sbf, historicalProgramBytes);
if (canonicalProgramIdOccurrences < 1) {
  throw new Error(`Timepin artifact does not embed canonical program id ${EXPECTED_PROGRAM_ID}`);
}
if (historicalProgramIdOccurrences !== 0) {
  throw new Error(`Timepin artifact still embeds historical program id ${HISTORICAL_PROGRAM_ID}`);
}
const sbfHash = createHash('sha256').update(sbf).digest('hex');
if (basename(sbfPath) !== EXPECTED_SBF_FILENAME) {
  throw new Error(`Timepin artifact filename must be exactly ${EXPECTED_SBF_FILENAME}`);
}
if (basename(dirname(sbfPath)).toLowerCase() !== sbfHash) {
  throw new Error('Timepin artifact parent directory must equal its SHA-256');
}
if (basename(dirname(dirname(sbfPath))).toLowerCase() !== 'ratchetx-onchain-sbf') {
  throw new Error('Timepin artifact must be inside the ratchetx-onchain-sbf cache');
}
const vectorSbfPath = `ratchetx-onchain-sbf/${sbfHash}/${EXPECTED_SBF_FILENAME}`;
const localSbfEvidence = {
  path: vectorSbfPath,
  size: sbf.length,
  sha256: sbfHash,
  elfFlags,
  sbpfVersion: EXPECTED_SBPF_VERSION,
  releaseArtifact: false,
  rebuiltBySvmTask: false,
};

register.programId = EXPECTED_PROGRAM_ID;
register.programIdBytesHex = programBytes.toString('hex');
register.deployableIdentity = true;
register.evidenceSpec.pda = address(specPda.address);
register.evidenceSpec.pdaBump = specPda.bump;
register.need.pda = address(needPda.address);
register.need.pdaBump = needPda.bump;
register.localSbfEvidence = { ...localSbfEvidence };

lifecycle.programId = EXPECTED_PROGRAM_ID;
lifecycle.deployableIdentity = true;
lifecycle.fixtureNeed.address = address(needPda.address);
lifecycle.fixtureNeed.bump = needPda.bump;
lifecycle.accounts.WorkManifest.firstCapture.pda = address(firstManifest.address);
lifecycle.accounts.WorkManifest.firstCapture.bump = firstManifest.bump;
lifecycle.accounts.WorkManifest.terminalize.pda = address(terminalManifest.address);
lifecycle.accounts.WorkManifest.terminalize.bump = terminalManifest.bump;
lifecycle.accounts.WorkPage.fixturePda = address(workPage.address);
lifecycle.accounts.WorkPage.fixtureBump = workPage.bump;
lifecycle.goldenMessages.a.candidatePda = address(candidateA.address);
lifecycle.goldenMessages.a.candidateBump = candidateA.bump;
lifecycle.goldenMessages.b.candidatePda = address(candidateB.address);
lifecycle.goldenMessages.b.candidateBump = candidateB.bump;
lifecycle.terminalVectors.finalResultHashHex =
  terminalResultHash(terminalNeed).toString('hex');
lifecycle.terminalVectors.ambiguousResultHashHex = terminalResultHash({
  ...terminalNeed,
  state: 'Ambiguous',
  candidateAHash: low,
  candidateBHash: high,
}).toString('hex');
lifecycle.terminalVectors.expiredResultHashHex = terminalResultHash({
  ...terminalNeed,
  state: 'Expired',
  candidateAHash: zero,
  candidateBHash: zero,
}).toString('hex');
lifecycle.localSbfEvidence = { ...localSbfEvidence };

const nextRegister = JSON.stringify(register, null, 2) + '\n';
const nextLifecycle = JSON.stringify(lifecycle, null, 2) + '\n';
if (checkOnly) {
  if (nextRegister !== originalRegister || nextLifecycle !== originalLifecycle) {
    throw new Error('Timepin vectors are stale; run generate-vectors.mjs');
  }
} else {
  writeFileSync(registerPath, nextRegister, 'utf8');
  writeFileSync(lifecyclePath, nextLifecycle, 'utf8');
}

console.log(JSON.stringify({
  mode: checkOnly ? 'check' : 'write',
  programId: EXPECTED_PROGRAM_ID,
  sbfPath: vectorSbfPath,
  sbfSize: sbf.length,
  sbfSha256: sbfHash,
  elfFlags,
  sbpfVersion: EXPECTED_SBPF_VERSION,
  canonicalProgramIdOccurrences,
  historicalProgramIdOccurrences,
  evidenceSpecPda: register.evidenceSpec.pda,
  needPda: register.need.pda,
}));
