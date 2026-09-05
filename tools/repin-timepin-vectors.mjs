#!/usr/bin/env node
// Deterministic RE-PIN of the Timepin v2 golden vectors from one program id to another.
//
// Not a from-scratch generator: measured fields (CU counts, LiteSVM pass counts, prose) are kept
// verbatim. ONLY program-id-dependent fields are re-derived through onchain/rcx-timepin/model-v2.mjs,
// mirroring exactly what test/test_timepin_v2_lifecycle_vectors.mjs recomputes:
//   programId, programIdBytesHex, deployableIdentity, EvidenceSpec PDA/bump, Need PDA/bump,
//   fixtureNeed, both WorkManifest PDAs, WorkPage PDA, both Candidate PDAs, the three terminal
//   result hashes (they include the Need address), and localSbfEvidence.size/sha256.
//
// Proof of correctness  : --check  (re-pin to the CURRENT id must reproduce the current files)
// Completeness proof    : after a real re-pin, no old-id-derived string may survive anywhere
// Fail-closed (default) : if the artifact does NOT embed the target id (declare_id! not baked in), the
//                         tool REFUSES to emit anything — mixed-identity staging (new-id PDAs paired with
//                         an old-id artifact tuple) is never produced by default. --deployable is
//                         additionally refused in that case. A review-only override, --allow-mixed-staging,
//                         writes to staged-MIXED-<id> with an in-JSON marker + a directory marker so it can
//                         never be mistaken for a canonical candidate. provenance.json is always written.
//
//   node tools/repin-timepin-vectors.mjs --check
//   node tools/repin-timepin-vectors.mjs --to <programId> --artifact <path/rcx_timepin_v2.so> [--deployable] [--in dir] [--out dir]
//   Clean mode additionally: rejects any [0x07;32] placeholder bytes, binds lib.rs declare_id! + Anchor.toml to --to,
//   copies the artifact to onchain/rcx-timepin-v2/artifacts/<sha256>/rcx_timepin_v2.so and pins THAT path in the vectors.
//   Strict args: unknown flags, duplicates, and values on boolean flags are rejected.
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PublicKey } from '@solana/web3.js';
import {
  deriveEvidenceSpecPda, deriveNeedPda, deriveCandidatePda, deriveWorkManifestPda,
  deriveWorkPagePda, hashPriceMessage, terminalResultHash,
  WORK_KIND_FIRST_CAPTURE, WORK_KIND_TERMINALIZE,
  validateEvidenceSpec,
} from '../onchain/rcx-timepin/model-v2.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const BOOL_FLAGS = new Set(['check', 'deployable', 'allow-mixed-staging']);
const VALUE_FLAGS = new Set(['to', 'artifact', 'in', 'out']);
const args = {};
{
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (!tok.startsWith('--')) { console.error(`REJECTED argument '${tok}': positional values are not accepted`); process.exit(2); }
    const name = tok.slice(2);
    if (!BOOL_FLAGS.has(name) && !VALUE_FLAGS.has(name)) { console.error(`REJECTED unknown flag --${name}`); process.exit(2); }
    if (name in args) { console.error(`REJECTED duplicate flag --${name}`); process.exit(2); }
    if (BOOL_FLAGS.has(name)) {
      if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) { console.error(`REJECTED --${name} takes no value (got '${argv[i + 1]}')`); process.exit(2); }
      args[name] = true;
    } else {
      const val = argv[i + 1];
      if (val === undefined || val.startsWith('--')) { console.error(`REJECTED --${name} requires a value`); process.exit(2); }
      args[name] = val; i++;
    }
  }
}
const inDir = resolve(root, args.in || 'onchain/rcx-timepin-v2/vectors');
const R = JSON.parse(readFileSync(join(inDir, 'register-open-v2.json'), 'utf8'));
const L = JSON.parse(readFileSync(join(inDir, 'lifecycle-v2.json'), 'utf8'));
const sha256 = b => createHash('sha256').update(b).digest();
const key = s => new PublicKey(s).toBuffer();
const b58 = buf => new PublicKey(buf).toBase58();
const hex = s => Buffer.from(s, 'hex');

const check = args.check === true;
const toId = check ? R.programId : args.to;
if (!toId) { console.error('need --to <programId> (or --check)'); process.exit(2); }
const artifactPath = check
  ? join(root, 'onchain', 'rcx-timepin-v2', L.localSbfEvidence.path)
  : (args.artifact ? resolve(root, args.artifact) : null);
if (!artifactPath || !existsSync(artifactPath)) { console.error('need --artifact <path.so> that exists'); process.exit(2); }
const artifact = readFileSync(artifactPath);
const artifactSha = sha256(artifact).toString('hex');
const embeds = artifact.indexOf(key(toId)) >= 0;
const wantDeployable = check ? R.deployableIdentity : args.deployable === true;
if (wantDeployable && !embeds) {
  console.error(`REFUSED: --deployable requested but ${artifactPath} does not embed ${toId} (declare_id not baked in). Rebuild first.`);
  process.exit(1);
}
const PLACEHOLDER_US517_BYTES = Buffer.alloc(32, 0x07); // US517G59...LFx == base58([7;32])
const TIMEPIN_ROOT = join(root, 'onchain', 'rcx-timepin-v2');
const mixed = !check && !embeds;
let snapshotRelPath = null, sourceBinding = null;
if (!check && !mixed) {
  // (a) exact artifact filename
  if (basename(artifactPath) !== 'rcx_timepin_v2.so') { console.error(`REFUSED: artifact must be named rcx_timepin_v2.so (got ${basename(artifactPath)})`); process.exit(1); }
  // (b) no placeholder bytes may survive in a release candidate (catches a half-migrated binary)
  if (artifact.indexOf(PLACEHOLDER_US517_BYTES) >= 0) { console.error(`REFUSED: artifact still contains the US517 placeholder byte pattern [0x07;32] at offset ${artifact.indexOf(PLACEHOLDER_US517_BYTES)} — half-migrated binary`); process.exit(1); }
  // (c) content-addressed snapshot: artifacts/<sha256>/rcx_timepin_v2.so ; parent dir must equal the computed hash
  const parent = basename(dirname(artifactPath));
  if (/^[0-9a-f]{64}$/.test(parent) && parent !== artifactSha) { console.error(`REFUSED: artifact parent dir ${parent} is not its computed sha256 ${artifactSha}`); process.exit(1); }
  const snapDir = join(TIMEPIN_ROOT, 'artifacts', artifactSha);
  const snapPath = join(snapDir, 'rcx_timepin_v2.so');
  mkdirSync(snapDir, { recursive: true });
  if (!existsSync(snapPath)) copyFileSync(artifactPath, snapPath);
  if (sha256(readFileSync(snapPath)).toString('hex') !== artifactSha) { console.error('REFUSED: snapshot bytes do not match computed hash'); process.exit(1); }
  snapshotRelPath = `artifacts/${artifactSha}/rcx_timepin_v2.so`;
  // (d) bind the source generation: declare_id! in lib.rs and Anchor.toml must equal the target id
  const libPath = join(TIMEPIN_ROOT, 'programs', 'rcx-timepin-v2', 'src', 'lib.rs');
  const anchorPath = join(TIMEPIN_ROOT, 'Anchor.toml');
  if (!existsSync(libPath) || !existsSync(anchorPath)) { console.error('REFUSED: cannot bind source — lib.rs or Anchor.toml missing'); process.exit(1); }
  const lib = readFileSync(libPath, 'utf8'), anchor = readFileSync(anchorPath, 'utf8');
  const declared = (lib.match(/declare_id!\("([1-9A-HJ-NP-Za-km-z]{32,44})"\)/) || [])[1];
  const anchored = (anchor.match(/rcx_timepin_v2\s*=\s*"([1-9A-HJ-NP-Za-km-z]{32,44})"/) || [])[1];
  if (declared !== toId) { console.error(`REFUSED: source declare_id!(${declared}) != target ${toId}`); process.exit(1); }
  if (anchored !== toId) { console.error(`REFUSED: Anchor.toml rcx_timepin_v2 = ${anchored} != target ${toId}`); process.exit(1); }
  sourceBinding = { libRs: { path: 'programs/rcx-timepin-v2/src/lib.rs', sha256: sha256(Buffer.from(lib)).toString('hex'), declareId: declared },
                    anchorToml: { path: 'Anchor.toml', sha256: sha256(Buffer.from(anchor)).toString('hex'), programId: anchored } };
}
if (mixed && args['allow-mixed-staging'] !== true) {
  console.error(`REFUSED: ${artifactPath} does not embed ${toId} — emitting ${toId.slice(0, 6)} PDAs paired with this artifact tuple would be MIXED-IDENTITY staging. Rebuild with declare_id=${toId}, then re-run with --artifact <that .so>. (Review-only override: --allow-mixed-staging; output is marked MIXED and is never canonical.)`);
  process.exit(1);
}

// ---- spec exactly as the reader test assembles it (register vector is the source of truth) ----
const f = R.evidencePolicy.fields, g = R.syntheticGenerationFixture;
const spec = {
  schema: f.schema, adapter: f.adapter,
  receiverProgram: key(f.receiverProgram), pushOracleProgram: key(f.pushOracleProgram),
  shardId: f.shardId, feedId: hex(f.feedIdHex), requiredVerification: f.requiredVerification,
  targetGridSeconds: f.targetGridSeconds, minOpenLeadSeconds: f.minOpenLeadSeconds,
  maxTargetAheadSeconds: f.maxTargetAheadSeconds, maxPreTargetGapSeconds: f.maxPreTargetGapSeconds,
  maxPostTargetLagSeconds: f.maxPostTargetLagSeconds, captureGraceSeconds: f.captureGraceSeconds,
  maxFutureSkewSeconds: f.maxFutureSkewSeconds, minExponent: f.minExponent, maxExponent: f.maxExponent,
  maxConfidenceBps: f.maxConfidenceBps,
  receiverProgramdataSlot: BigInt(g.receiverProgramData.generationSlot),
  receiverConfigHash: hex(g.receiverConfig.completeAccountDataSha256),
  wormholeProgram: key(g.wormholeProgram),
  wormholeProgramdataSlot: BigInt(g.wormholeProgramData.generationSlot),
  registeredSlot: BigInt(g.registrationClockSlot),
};

// THE SOURCE VECTORS MUST DESCRIBE A SPEC THE PROGRAM WOULD ACCEPT.
//
// This tool re-derives every PDA and hash from the policy in the register
// vector - it does not invent one - so a policy the program refuses cannot be
// re-pinned into anything meaningful. Without this the first thing that happens
// is a RangeError out of encodeEvidencePolicy with a stack trace, which reads
// like a broken tool rather than like stale fixtures, and the gate reports
// "repin --check FAILED" with no idea why.
//
// Measured 2026-09-05: the vectors carry adapter 1 (the experimental strict
// bracket) with grid 60 and lag 120 - twice the grid, refused since the
// uniqueness invariant landed. They need adapter 2, lag = grid - 1, a lead that
// clears the skew, and a zero pre-gap, and that update belongs in the SINGLE
// re-pin at Gate 1 rather than in a separate edit.
{
  const verdict = validateEvidenceSpec(spec);
  if (!verdict.ok) {
    console.error(
      `REFUSING TO RE-PIN: the policy in the source vectors describes a spec the program `
      + `would reject at registration (${verdict.code}`
      + `${verdict.detail ? `: ${verdict.detail}` : ''}).\n`
      + `  adapter=${spec.adapter} grid=${spec.targetGridSeconds} `
      + `lag=${spec.maxPostTargetLagSeconds} lead=${spec.minOpenLeadSeconds} `
      + `skew=${spec.maxFutureSkewSeconds} pregap=${spec.maxPreTargetGapSeconds}\n`
      + `  Fix the policy in the register vector first - re-pinning copies it forward, `
      + `it does not correct it.`,
    );
    process.exit(1);
  }
}
const program = key(toId);
const target = BigInt(R.need.targetTs);

// ---- every OLD id-derived string, so the completeness proof can assert none survives ----
const oldStrings = new Set([
  R.programId, R.programIdBytesHex, R.evidenceSpec.pda, R.need.pda, L.fixtureNeed.address,
  L.accounts.WorkManifest.firstCapture.pda, L.accounts.WorkManifest.terminalize.pda,
  L.accounts.WorkPage.fixturePda, L.goldenMessages.a.candidatePda, L.goldenMessages.b.candidatePda,
  L.terminalVectors.finalResultHashHex, L.terminalVectors.ambiguousResultHashHex,
  L.terminalVectors.expiredResultHashHex,
]);

// ---- re-derive ----
const r = structuredClone(R), l = structuredClone(L);
const specPda = deriveEvidenceSpecPda(program, spec);
const needPda = deriveNeedPda(program, spec, target);
r.programId = toId; l.programId = toId;
r.programIdBytesHex = program.toString('hex');
r.deployableIdentity = wantDeployable; l.deployableIdentity = wantDeployable;
r.evidenceSpec.pda = b58(specPda.address); r.evidenceSpec.pdaBump = specPda.bump;
r.need.pda = b58(needPda.address); r.need.pdaBump = needPda.bump;
l.fixtureNeed.address = b58(needPda.address); l.fixtureNeed.bump = needPda.bump;
for (const [kind, k] of [[WORK_KIND_FIRST_CAPTURE, 'firstCapture'], [WORK_KIND_TERMINALIZE, 'terminalize']]) {
  const p = deriveWorkManifestPda(program, kind);
  l.accounts.WorkManifest[k].pda = b58(p.address); l.accounts.WorkManifest[k].bump = p.bump;
}
const page = deriveWorkPagePda(program, needPda.address);
l.accounts.WorkPage.fixturePda = b58(page.address); l.accounts.WorkPage.fixtureBump = page.bump;
const c = L.goldenMessages.common;
const msg = n => ({
  price: BigInt(L.goldenMessages[n].price), conf: BigInt(L.goldenMessages[n].conf),
  exponent: c.exponent, publishTime: BigInt(c.publishTime), prevPublishTime: BigInt(c.prevPublishTime),
  emaPrice: BigInt(L.goldenMessages[n].price), emaConf: BigInt(L.goldenMessages[n].conf),
});
const hashA = hashPriceMessage(msg('a'), hex(c.feedIdHex));
const hashB = hashPriceMessage(msg('b'), hex(c.feedIdHex));
if (hashA.toString('hex') !== L.goldenMessages.a.messageHashHex ||
    hashB.toString('hex') !== L.goldenMessages.b.messageHashHex) {
  console.error('model/vector drift: golden message hashes do not match — refusing to re-pin on a drifted model');
  process.exit(1);
}
for (const [n, h] of [['a', hashA], ['b', hashB]]) {
  const cand = deriveCandidatePda(program, needPda.address, h);
  l.goldenMessages[n].candidatePda = b58(cand.address); l.goldenMessages[n].candidateBump = cand.bump;
}
const [low, high] = Buffer.compare(hashA, hashB) < 0 ? [hashA, hashB] : [hashB, hashA];
const tn = { address: needPda.address, targetTs: target, state: 'Final', candidateAHash: hashA, candidateBHash: Buffer.alloc(32) };
l.terminalVectors.finalResultHashHex = terminalResultHash(tn).toString('hex');
l.terminalVectors.ambiguousResultHashHex = terminalResultHash({ ...tn, state: 'Ambiguous', candidateAHash: low, candidateBHash: high }).toString('hex');
l.terminalVectors.expiredResultHashHex = terminalResultHash({ ...tn, state: 'Expired', candidateAHash: Buffer.alloc(32), candidateBHash: Buffer.alloc(32) }).toString('hex');
for (const v of [r, l]) {
  v.localSbfEvidence.size = artifact.length; v.localSbfEvidence.sha256 = artifactSha;
  if (snapshotRelPath) v.localSbfEvidence.path = snapshotRelPath; // content-addressed, never target/deploy
  if (mixed) {
    v.localSbfEvidence.mixedIdentityStaging = true;
    v.localSbfEvidence.mixedIdentityNote = `REVIEW-ONLY: PDAs are derived for ${toId}; the artifact tuple is the historical ${R.programId}-baked ELF. NOT canonical. Excluded from any candidate swap. Regenerate from the hash-addressed ${toId.slice(0, 6)} ELF.`;
  }
}

// ---- completeness proof: after a real id change, no stale old-id-derived string may survive ----
const out = { 'register-open-v2.json': r, 'lifecycle-v2.json': l };
if (toId !== R.programId) {
  const stale = [];
  const walk = (o, p) => {
    if (typeof o === 'string') { if (oldStrings.has(o)) stale.push(`${p}=${o}`); }
    else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) walk(v, `${p}.${k}`);
  };
  for (const [n, v] of Object.entries(out)) walk(v, n);
  if (stale.length) { console.error('INCOMPLETE re-pin, stale fields remain:\n' + stale.join('\n')); process.exit(1); }
}

const ser = v => JSON.stringify(v, null, 2) + '\n';
if (check) {
  const same = fname => {
    const raw = readFileSync(join(inDir, fname), 'utf8');
    return {
      byteIdentical: ser(out[fname]) === raw,
      semanticIdentical: JSON.stringify(out[fname]) === JSON.stringify(JSON.parse(raw)),
    };
  };
  const files = Object.fromEntries(Object.keys(out).map(fn => [fn, same(fn)]));
  const pass = Object.values(files).every(x => x.semanticIdentical);
  console.log(JSON.stringify({ mode: 'check', programId: toId, artifactSha, artifactEmbedsId: embeds, files,
    verdict: pass ? 'PASS: re-pin to the current id reproduces the current vectors' : 'FAIL' }, null, 2));
  process.exit(pass ? 0 : 1);
}
const outDir = resolve(root, args.out || join('onchain/rcx-timepin-v2/vectors', `staged-${mixed ? 'MIXED-' : ''}${toId.slice(0, 6)}`));
mkdirSync(outDir, { recursive: true });
for (const [n, v] of Object.entries(out)) writeFileSync(join(outDir, n), ser(v), 'utf8');
if (mixed) writeFileSync(join(outDir, 'MIXED_IDENTITY_NOT_CANONICAL.txt'),
  `These vectors pair ${toId} PDAs with the historical ${R.programId}-baked artifact (${artifactSha}).\nReview-only. Never swap into vectors/. Regenerate from the ${toId.slice(0, 6)}-baked ELF.\n`, 'utf8');
const inHash = fn => sha256(readFileSync(join(inDir, fn))).toString('hex');
writeFileSync(join(outDir, 'provenance.json'), JSON.stringify({
  tool: 'tools/repin-timepin-vectors.mjs', toolSha256: sha256(readFileSync(fileURLToPath(import.meta.url))).toString('hex'),
  generatedAt: new Date().toISOString(), node: process.version,
  mode: mixed ? 'MIXED-IDENTITY (review only, non-canonical)' : 'clean (artifact embeds target id)',
  from: R.programId, to: toId, deployableIdentity: wantDeployable,
  inputs: { inDir, 'register-open-v2.json': inHash('register-open-v2.json'), 'lifecycle-v2.json': inHash('lifecycle-v2.json') },
  artifact: { path: artifactPath, size: artifact.length, sha256: artifactSha, embedsTargetId: embeds, idOffset: artifact.indexOf(key(toId)),
    containsPlaceholderUS517Bytes: artifact.indexOf(PLACEHOLDER_US517_BYTES) >= 0, contentAddressedSnapshot: snapshotRelPath },
  sourceBinding,
}, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({
  mode: mixed ? 'repin-MIXED-review-only' : 'repin-clean', from: R.programId, to: toId, deployableIdentity: wantDeployable,
  artifact: artifactPath, artifactSize: artifact.length, artifactSha, artifactEmbedsTarget: embeds, outDir,
  need: r.need.pda, evidenceSpec: r.evidenceSpec.pda, workPage: l.accounts.WorkPage.fixturePda,
  candidateA: l.goldenMessages.a.candidatePda, candidateB: l.goldenMessages.b.candidatePda,
  finalResultHash: l.terminalVectors.finalResultHashHex,
}, null, 2));
