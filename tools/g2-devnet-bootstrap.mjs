#!/usr/bin/env node
// Devnet-only, resumable first admission. This file never changes the production
// manifest or mints RCX. Test credits come from a separate, public one-wallet
// snapshot whose immutable root is installed BEFORE claim_legacy.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, randomBytes, webcrypto } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import * as web3 from '@solana/web3.js';
import { createCoreG2Client, ACCOUNT_DISCRIMINATOR } from '../onchain/ratchet-core-g2/client/client-v2.mjs';
import { buildLegacySnapshot } from '../onchain/ratchet-core-g2/legacy-snapshot.mjs';
import { rulesetPolicyHash, rulesetPolicyMerkleParent, verifyRulesetPolicyProof,
  encodeEconomy, encodeRuleset } from '../onchain/ratchet-core-g2/model.mjs';
import { validateGeneration, encodeEvidenceSpec } from '../onchain/rcx-timepin/model-v2.mjs';
import { readGeneration } from '../onchain/rcx-timepin-v2/scripts/devnet-lifecycle.mjs';
import { auditDerivedManifest } from '../onchain/rcx-timepin-v2/scripts/cadence-sampler.mjs';
import { sendOne, loadSigner } from '../ops/g2-send/send.mjs';
import { DEVNET_GENESIS } from '../ops/g2-deploy/plan.mjs';

export { DEVNET_GENESIS };
export const PROGRAMS = Object.freeze({ core: 'ANVGVtDrECeyQkS56UZ9ZiWCUxk2JWEVNJioFW8JEwbL', timepin: 'C8wwxUGmoKAV22MaY3oW2Q6QeDbmB9dbNdbohsRjJkYp' });
export const PAYER = 'wJYFx75hzP9h2ujQQ6mpJWLeYgPSUdLtuWjrw881rKz';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PRIVATE = path.join(ROOT, 'ops/g2-deploy/keys');
const STATE_PATH = path.join(PRIVATE, 'devnet-bootstrap-state.json');
const RECEIPT_PATH = path.join(ROOT, 'docs/receipts/g2-devnet-bootstrap.json');
const MANIFEST_PATH = path.join(ROOT, 'releases/g2-mainnet-economy.json');
const sha = bytes => createHash('sha256').update(bytes).digest();
const hex = bytes => Buffer.from(bytes).toString('hex');
const json = value => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2) + '\n';
const requireFact = (ok, message) => { if (!ok) throw new Error(message); };
const same = (a, b, label) => requireFact(Buffer.from(a).equals(Buffer.from(b)), label + ' mismatch');
const key = value => new web3.PublicKey(value).toBuffer();
const u64 = n => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const proofBytes = nodes => { const b = Buffer.alloc(4); b.writeUInt32LE(nodes.length); return Buffer.concat([b, ...nodes]); };
const client = () => createCoreG2Client({ web3, coreProgramId: PROGRAMS.core, timepinProgramId: PROGRAMS.timepin, cryptoImpl: webcrypto });

export function parseArgs(argv) {
  const opt = { send: false, prepareOnly: false };
  let mode = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--send' || a === '--dry-run') {
      requireFact(mode === null, 'choose --send or --dry-run once'); mode = a; opt.send = a === '--send';
    } else if (a === '--prepare-only') opt.prepareOnly = true;
    else if (a === '--help') opt.help = true;
    else if (a === '--rpc' || a === '--keypair') {
      const v = argv[++i]; requireFact(v && !v.startsWith('--'), a + ' requires a value');
      const name = a.slice(2); requireFact(!opt[name], a + ' repeated'); opt[name] = v;
    } else throw new Error('unknown argument ' + a);
  }
  if (opt.help) return opt;
  requireFact(opt.rpc, '--rpc is required; no implicit cluster');
  const url = new URL(opt.rpc); requireFact(['https:', 'http:'].includes(url.protocol), 'RPC must be HTTP(S)');
  requireFact(!opt.send || opt.keypair, '--send requires --keypair before any network access');
  return opt;
}

export function assertBoundary(genesis, payer = PAYER, programs = PROGRAMS) {
  requireFact(genesis === DEVNET_GENESIS, 'only the exact DEVNET genesis is allowed; no mainnet/testnet/unknown cluster');
  requireFact(payer === PAYER, 'only the designated devnet payer is allowed');
  requireFact(isDeepStrictEqual(programs, PROGRAMS), 'canonical deployed program IDs are required');
}

function approvedPolicy(manifest) {
  auditDerivedManifest(manifest);
  assertBoundary(DEVNET_GENESIS, PAYER, manifest.programs);
  const wanted = { schema: 2, timepinProgram: PROGRAMS.timepin, timepinSchema: 2, rulesetPolicyCount: 49,
    rcxMint: 'FQb2EyaLZ9TWBemYmQ9zWtXcEwLiSXtz7j619ThQpump',
    rcxTokenProgram: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', rcxDecimals: 6,
    rawUnitsPerCredit: '1000000', burnPerMille: 700, podiumPerMille: 300, podiumCurve: [500, 300, 200],
    rankShardCount: 16, daySeconds: 86400, hitPayoutNumerator: '17', hitPayoutDenominator: '10', settleXp: '1',
    minStake: '100', maxStake: '1000000000', maxOpen: 5, cleanupBondLamports: '50000', revealWindowSeconds: 3600, maxHorizonSeconds: 86400 };
  for (const [k, v] of Object.entries(wanted)) requireFact(isDeepStrictEqual(manifest.economy[k], v), 'approved economy field changed: ' + k);
  const r = manifest.rulesetTemplate;
  requireFact(r.schema === 2 && r.entryMode === 2 && r.maxEntryAgeSeconds === 0 && r.bandNumerator === 0 && r.bandDenominator === 1, 'approved ruleset policy changed');
  requireFact(isDeepStrictEqual(r.horizons.map(h => [h.horizonSeconds, h.baseXp]), [[300,'10'],[600,'11'],[900,'12'],[1800,'14'],[3600,'16'],[21600,'20'],[86400,'24']]), 'all seven approved horizons and XP values are required');
  const s = manifest.evidenceSpecTemplate;
  for (const [k, v] of Object.entries({ schema: 2, requiredVerification: 1, maxTargetAheadSeconds: 90000, maxPreTargetGapSeconds: 0, challengeWindowSeconds: 900, maxFutureSkewSeconds: 30, minExponent: -12, maxExponent: 2, maxConfidenceBps: 200 })) requireFact(s[k] === v, 'approved evidence field changed: ' + k);
}

export function generationPins(generation) {
  return { receiverProgramdataSlot: String(generation.receiverProgramdataSlot), receiverConfigHash: hex(sha(generation.receiverConfigData)),
    wormholeProgram: new web3.PublicKey(generation.wormholeProgram).toBase58(), wormholeProgramdataSlot: String(generation.wormholeProgramdataSlot) };
}

export function newState({ manifestSha256, clock, generation }) {
  requireFact(BigInt(clock.slot) > 0n, 'positive real Clock slot required');
  return { schema: 1, purpose: 'DEVNET_TEST_CREDITS_ONLY', clusterGenesis: DEVNET_GENESIS, programs: PROGRAMS, payer: PAYER,
    manifestSha256, cutoverSlot: String(clock.slot), migrationId: hex(sha(Buffer.from('ratchetx:g2:devnet-test-bootstrap:' + PAYER + ':' + clock.slot))),
    // This is a devnet test allocation, not an approved production balance.
    testCredits: '10000', generation: generationPins(generation), nonce: '0', side: 1, probability: 6000,
    salt: randomBytes(32).toString('hex'), targets: null, steps: [] };
}

export async function buildContext({ manifest, manifestSha256, state, generation, clock }) {
  approvedPolicy(manifest); assertBoundary(state.clusterGenesis, state.payer, state.programs);
  requireFact(state.schema === 1 && state.purpose === 'DEVNET_TEST_CREDITS_ONLY', 'unrecognized private state');
  requireFact(state.manifestSha256 === manifestSha256, 'manifest changed since private state was created');
  requireFact(state.testCredits === '10000' && state.nonce === '0' && state.side === 1 && state.probability === 6000, 'private test allocation/commitment parameters changed');
  requireFact(/^[0-9a-f]{64}$/.test(state.salt) && /[1-9a-f]/.test(state.salt), 'private salt must be nonzero 32 bytes');
  requireFact(isDeepStrictEqual(state.generation, generationPins(generation)), 'oracle generation changed; refusing existing immutable test economy');
  const cutover = BigInt(state.cutoverSlot);
  requireFact(cutover > 0n && cutover <= BigInt(clock.slot), 'legacy cutover must be a positive past real slot');
  const migration = sha(Buffer.from('ratchetx:g2:devnet-test-bootstrap:' + PAYER + ':' + cutover));
  requireFact(hex(migration) === state.migrationId, 'test migration identity mismatch');
  const c = client();
  const snapshot = buildLegacySnapshot([{ wallet: PAYER, credits: state.testCredits, xp: '0' }], {
    cutoverSlot: cutover, clusterGenesisHash: key(DEVNET_GENESIS), migrationId: migration, programId: PROGRAMS.core });
  const economyArgs = { ...manifest.economy, timepinProgram: key(PROGRAMS.timepin), rcxMint: key(manifest.economy.rcxMint), rcxTokenProgram: key(manifest.economy.rcxTokenProgram),
    clusterGenesisHash: key(DEVNET_GENESIS), migrationId: migration, legacyRoot: snapshot.root, legacySnapshotHash: snapshot.snapshotHash,
    legacyCutoverSlot: cutover, legacyLeafCount: 1, legacyTotalCredits: BigInt(state.testCredits), legacyTotalXp: 0n };
  // The JSON manifest uses decimal strings; both canonical serializers receive
  // exact BigInts so their independent type checks agree without Number rounding.
  for (const name of ['rawUnitsPerCredit', 'hitPayoutNumerator', 'hitPayoutDenominator', 'settleXp', 'minStake', 'maxStake', 'cleanupBondLamports']) economyArgs[name] = BigInt(economyArgs[name]);
  const specs = [], rules = [];
  for (const feed of manifest.feeds) {
    const args = { ...manifest.evidenceSpecTemplate, receiverProgram: key(manifest.evidenceSpecTemplate.receiverProgram), pushOracleProgram: key(manifest.evidenceSpecTemplate.pushOracleProgram),
      feedId: Buffer.from(feed.feedId, 'hex'), maxPostTargetLagSeconds: feed.maxPostTargetLagSeconds, captureGraceSeconds: manifest.evidenceSpecTemplate.challengeWindowSeconds,
      receiverProgramdataSlot: BigInt(state.generation.receiverProgramdataSlot), receiverConfigHash: Buffer.from(state.generation.receiverConfigHash, 'hex'),
      wormholeProgram: key(state.generation.wormholeProgram), wormholeProgramdataSlot: BigInt(state.generation.wormholeProgramdataSlot) };
    const gen = validateGeneration(args, generation, BigInt(clock.slot)); requireFact(gen.ok, 'oracle generation rejected: ' + gen.code + ' ' + (gen.detail || ''));
    same(c.encodeEvidenceSpecArgs(args), encodeEvidenceSpec(args), 'client/model evidence bytes');
    const spec = { symbol: feed.symbol, priceAccount: feed.sponsoredAccount, args, specHash: await c.evidenceSpecHash(args), evidencePolicyHash: await c.evidencePolicyHash(args) };
    specs.push(spec);
    for (const horizon of manifest.rulesetTemplate.horizons) {
      const args = { ...manifest.rulesetTemplate, ...horizon, baseXp: BigInt(horizon.baseXp), economyHash: Buffer.alloc(32), evidenceSpecHash: spec.specHash, evidencePolicyHash: spec.evidencePolicyHash, feedId: spec.args.feedId };
      rules.push({ symbol: feed.symbol, args, leaf: rulesetPolicyHash(args, economyArgs) });
    }
  }
  requireFact(rules.length === 49 && new Set(rules.map(r => hex(r.leaf))).size === 49, '49 distinct approved ruleset policies required');
  const sorted = [...rules].sort((a, b) => Buffer.compare(a.leaf, b.leaf));
  const levels = [sorted.map(r => r.leaf)];
  while (levels.at(-1).length > 1) {
    const level = levels.at(-1), next = [];
    for (let i = 0; i < level.length; i += 2) next.push(rulesetPolicyMerkleParent(level[i], level[i + 1] || level[i]));
    levels.push(next);
  }
  economyArgs.rulesetPolicyRoot = levels.at(-1)[0]; economyArgs.rulesetPolicyCount = rules.length;
  same(c.encodeEconomyArgs(economyArgs), encodeEconomy(economyArgs), 'client/model economy bytes');
  const economy = { args: economyArgs, economyHash: await c.economyHashOf(economyArgs) };
  for (const r of rules) {
    let index = sorted.indexOf(r); r.proof = [];
    for (const level of levels.slice(0, -1)) { r.proof.push(level[index ^ 1] || level[index]); index = Math.floor(index / 2); }
    requireFact(verifyRulesetPolicyProof(r.leaf, r.proof, economyArgs.rulesetPolicyRoot), 'ruleset proof generation failed');
    r.args.economyHash = economy.economyHash;
    same(c.encodeRulesetArgs(r.args), encodeRuleset(r.args, economyArgs), 'client/model ruleset bytes');
    r.rulesetHash = await c.rulesetHashOf(r.args);
  }
  const spec = specs.find(s => s.symbol === 'SOL');
  const ruleset = rules.find(r => r.symbol === 'SOL' && r.args.horizonSeconds === 300);
  c.validateForwardKernel({ economy, ruleset, evidenceSpec: spec });
  const commit = await c.commitmentHash({ economyHash: economy.economyHash, rulesetHash: ruleset.rulesetHash, player: PAYER, nonce: 0n,
    side: state.side, probability: state.probability, salt: Buffer.from(state.salt, 'hex') });
  const addresses = { economy: c.economyPda(economy.economyHash)[0], evidenceSpec: c.evidenceSpecPda(spec.specHash)[0], ruleset: c.rulesetPda(ruleset.rulesetHash)[0],
    ledger: c.ledgerPda(economy.economyHash, PAYER)[0], historyPage: c.historyPagePda(economy.economyHash, PAYER, 0n)[0], shot: c.shotPda(economy.economyHash, PAYER, 0n)[0] };
  const sys = web3.SystemProgram.programId;
  const instructions = {
    register_evidence_spec: await c.registerEvidenceSpecIx({ payer: PAYER, args: spec.args }),
    register_economy: c.buildIx('ratchet-core-g2', 'register_economy', { actor: PAYER, economy: addresses.economy, timepin_program: PROGRAMS.timepin, system_program: sys }, economy.economyHash, c.encodeEconomyArgs(economyArgs)),
    register_ruleset: c.buildIx('ratchet-core-g2', 'register_ruleset', { actor: PAYER, economy: addresses.economy, ruleset: addresses.ruleset, evidence_spec: addresses.evidenceSpec, system_program: sys }, ruleset.rulesetHash, c.encodeRulesetArgs(ruleset.args), proofBytes(ruleset.proof)),
    claim_legacy: c.buildIx('ratchet-core-g2', 'claim_legacy', { player: PAYER, economy: addresses.economy, ledger: addresses.ledger, system_program: sys }, u64(state.testCredits), u64(0), proofBytes([])),
    open_history_page: c.openHistoryPageIx({ actor: PAYER, player: PAYER, economyHash: economy.economyHash, pageIndex: 0n }),
  };
  return { c, economy, specs, rules, spec, ruleset, snapshot, commit, addresses, instructions };
}

export function timingFor(ctx, clock) {
  return ctx.c.admissionTiming({ chainNowTs: BigInt(clock.nowTs), economy: ctx.economy, ruleset: ctx.ruleset, evidenceSpec: ctx.spec });
}

export async function readClock(connection) {
  const info = await connection.getAccountInfo(web3.SYSVAR_CLOCK_PUBKEY, 'confirmed');
  requireFact(info && info.data.length === 40 && !info.executable && info.owner.toBase58() === 'Sysvar1111111111111111111111111111111111111', 'invalid real Clock sysvar');
  const b = Buffer.from(info.data); const out = { slot: b.readBigUInt64LE(0), nowTs: b.readBigInt64LE(32) };
  requireFact(out.slot > 0n && out.nowTs > 0n, 'invalid real Clock values'); return out;
}

export function publicReceipt(ctx, state, status, details = {}) {
  let needs = [];
  if (state.targets) needs = ['entry', 'exit'].map(kind => {
    const target = BigInt(state.targets[kind + 'TargetTs']); const source = target + BigInt(ctx.spec.args.maxPostTargetLagSeconds);
    return { kind, address: ctx.c.needPda(ctx.spec.specHash, target)[0].toBase58(), targetTs: String(target), sourceDeadlineTs: String(source), captureDeadlineTs: String(source + BigInt(ctx.spec.args.captureGraceSeconds)) };
  });
  const steps = state.steps.map(s => ({ ...s }));
  return { schema: 1, status, scope: 'DEVNET_TEST_ECONOMY_ONLY; admission, not capture/settlement evidence', generatedAt: new Date().toISOString(), clusterGenesis: DEVNET_GENESIS,
    programs: PROGRAMS, payer: PAYER, sourceManifestSha256: state.manifestSha256, legacySnapshot: ctx.snapshot.manifest,
    economyHash: hex(ctx.economy.economyHash), evidenceSpecHash: hex(ctx.spec.specHash), rulesetHash: hex(ctx.ruleset.rulesetHash), commitment: hex(ctx.commit),
    addresses: Object.fromEntries(Object.entries(ctx.addresses).map(([k, v]) => [k, v.toBase58()])), generation: state.generation,
    policyRoot: hex(ctx.economy.args.rulesetPolicyRoot), policyCount: ctx.rules.length,
    policies: ctx.rules.map(r => ({ symbol: r.symbol, horizonSeconds: r.args.horizonSeconds, leaf: hex(r.leaf), rulesetHash: hex(r.rulesetHash), proof: r.proof.map(hex) })),
    observer: { feed: 'SOL', priceAccount: ctx.spec.priceAccount, adapter: 2, targetGridSeconds: 300, maxPostTargetLagSeconds: 299, captureGraceSeconds: 900,
      mustObserveBothNeedsConcurrently: true, needs },
    steps, landed: steps.filter(s => s.ok).length, sealSignature: steps.find(s => s.step === 'seal_forward' && s.ok)?.signature,
    ...details };
}

function safeDirectory(directory) {
  const rel = path.relative(ROOT, directory); requireFact(rel && !rel.startsWith('..') && !path.isAbsolute(rel), 'output directory escaped repository');
  let at = ROOT;
  for (const part of rel.split(path.sep)) { at = path.join(at, part); if (!fs.existsSync(at)) fs.mkdirSync(at); requireFact(fs.lstatSync(at).isDirectory() && !fs.lstatSync(at).isSymbolicLink(), 'output directory must not be a link'); }
}
function safeFile(file) { if (fs.existsSync(file)) requireFact(fs.lstatSync(file).isFile() && !fs.lstatSync(file).isSymbolicLink(), 'state/receipt must be a regular file'); }
function saveJson(file, value, privateFile = false) {
  safeDirectory(path.dirname(file)); safeFile(file);
  const temp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(temp, json(value), { flag: 'wx', mode: privateFile ? 0o600 : 0o644 });
  fs.renameSync(temp, file);
}

export async function runBootstrapCli(opt, { connection = new web3.Connection(opt.rpc, 'confirmed'), log = console.log } = {}) {
  requireFact(!opt.send || opt.keypair, '--send requires --keypair before any network access');
  assertBoundary(await connection.getGenesisHash());
  let signer = null;
  if (opt.keypair) { signer = loadSigner(web3, path.resolve(opt.keypair)); assertBoundary(DEVNET_GENESIS, signer.publicKey.toBase58()); }
  for (const id of Object.values(PROGRAMS)) {
    const info = await connection.getAccountInfo(new web3.PublicKey(id), 'confirmed');
    requireFact(info?.executable && info.owner.equals(new web3.PublicKey('BPFLoaderUpgradeab1e11111111111111111111111')), 'canonical program is not deployed/executable: ' + id);
  }
  const manifestBytes = fs.readFileSync(MANIFEST_PATH), manifest = JSON.parse(manifestBytes), manifestSha256 = hex(sha(manifestBytes));
  approvedPolicy(manifest);
  let clock = await readClock(connection); const generation = await readGeneration(connection);
  safeFile(STATE_PATH);
  const state = fs.existsSync(STATE_PATH) ? JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) : newState({ manifestSha256, clock, generation });
  const ctx = await buildContext({ manifest, manifestSha256, state, generation, clock });
  const { c, economy, ruleset, spec, addresses } = ctx;
  let lock = null, status = opt.send ? 'IN_PROGRESS' : 'DRY_RUN';
  const persist = () => { if (opt.send) { saveJson(STATE_PATH, state, true); saveJson(RECEIPT_PATH, publicReceipt(ctx, state, status)); } };
  const get = address => connection.getAccountInfo(new web3.PublicKey(address), 'confirmed');
  const evidence = (address, info) => ({ evidence: true, address: String(address), owner: info.owner.toBase58(), dataLen: info.data.length, dataSha256: hex(sha(info.data)) });
  const ledgerValue = info => c.validateLedgerAccount({ address: addresses.ledger, info, economy, player: PAYER });
  const requireClaimed = info => { const l = ledgerValue(info); requireFact(l.legacyCredits === BigInt(state.testCredits) && l.legacyXp === 0n, 'ledger does not hold the exact test snapshot claim'); return l; };
  const verifyShot = info => {
    const shot = c.validateShotAccount({ address: addresses.shot, info, economy, ruleset, player: PAYER, nonce: 0n });
    requireFact(state.targets, 'existing Shot has no saved private target/commitment state');
    same(shot.commit, ctx.commit, 'Shot commitment');
    requireFact(shot.stake === BigInt(economy.args.minStake) && shot.entryTargetTs === BigInt(state.targets.entryTargetTs) && shot.exitTargetTs === BigInt(state.targets.exitTargetTs) && shot.scoreDay === BigInt(state.targets.scoreDay), 'existing Shot terms mismatch');
    requireFact(shot.entryNeed.equals(c.needPda(spec.specHash, shot.entryTargetTs)[0]) && shot.exitNeed.equals(c.needPda(spec.specHash, shot.exitTargetTs)[0]) && shot.rentRefund.toBase58() === PAYER, 'existing Shot need/refund mismatch'); return shot;
  };
  const ensure = async (name, address, type, instruction, validate, maySkip = () => true) => {
    let info = await get(address);
    if (info) {
      const value = await validate(info);
      if (maySkip(value)) {
        log('VERIFIED EXISTING ' + name + ' ' + address);
        if (!state.steps.some(s => s.step === name)) state.steps.push({ step: name, ok: false, skipped: true, readBack: evidence(address, info), reason: 'existing account verified; no signature invented' });
        persist(); return true;
      }
    }
    if (!opt.send) {
      if (signer) { const r = await sendOne({ connection, web3, instruction, signer, mode: 'dry-run', log }); requireFact(!r.simulation?.err, 'dry-run simulation failed for ' + name); }
      log('DRY RUN: next required transaction is ' + name + '; dependent simulations require it to land');
      return false;
    }
    assertBoundary(await connection.getGenesisHash(), signer.publicKey.toBase58());
    const result = await sendOne({ connection, web3, instruction, signer, mode: 'send', expect: { address: String(address), owner: type === 'EvidenceSpecV2' || type === 'TimepinNeedV2' ? PROGRAMS.timepin : PROGRAMS.core, discriminator: Buffer.from(ACCOUNT_DISCRIMINATOR[type], 'hex') }, log });
    requireFact(result.sent && result.signature && result.evidence?.evidence, 'transaction did not produce verified evidence: ' + name + ': ' + (result.reason || result.evidence?.problems?.join('; ') || 'unknown'));
    info = await get(address); const afterValue = await validate(info);
    requireFact(maySkip(afterValue), 'confirmed transaction did not establish the required postcondition: ' + name);
    state.steps = state.steps.filter(s => s.step !== name);
    state.steps.push({ step: name, ok: true, signature: result.signature, readBack: evidence(address, info) }); persist(); return true;
  };
  try {
    if (opt.send) { safeDirectory(PRIVATE); lock = fs.openSync(STATE_PATH + '.lock', 'wx', 0o600); persist(); }
    const prep = [
      ['register_evidence_spec', addresses.evidenceSpec, 'EvidenceSpecV2', ctx.instructions.register_evidence_spec, info => c.validateEvidenceSpecAccount({ address: addresses.evidenceSpec, info, expectedHash: spec.specHash })],
      ['register_economy', addresses.economy, 'Economy', ctx.instructions.register_economy, info => c.validateEconomyAccount({ address: addresses.economy, info, expectedHash: economy.economyHash })],
      ['register_ruleset', addresses.ruleset, 'Ruleset', ctx.instructions.register_ruleset, info => c.validateRulesetAccount({ address: addresses.ruleset, info, economy, expectedHash: ruleset.rulesetHash })],
      ['claim_legacy', addresses.ledger, 'PlayerLedger', ctx.instructions.claim_legacy, info => { const l = ledgerValue(info); requireFact(l.legacyXp === 0n && (l.legacyCredits === 0n || l.legacyCredits === BigInt(state.testCredits)), 'unexpected legacy claim'); if (!l.legacyCredits) requireFact(l.credits === 0n && l.nextShotNonce === 0n && l.xp === 0n, 'unclaimed ledger is not fresh'); return l; }, l => l.legacyCredits === BigInt(state.testCredits)],
    ];
    for (const args of prep) if (!await ensure(...args)) return publicReceipt(ctx, state, 'DRY_RUN', { nextStep: args[0], simulated: Boolean(signer), laterStepsSimulated: false });
    const ledger = requireClaimed(await get(addresses.ledger));
    const existingShot = await get(addresses.shot);
    if (existingShot) { verifyShot(existingShot); status = 'RESUMED_EXISTING_SHOT'; persist(); return publicReceipt(ctx, state, status); }
    requireFact(ledger.credits >= BigInt(economy.args.minStake) && ledger.nextShotNonce === 0n && ledger.open === 0, 'ledger is not ready for the first funded shot');
    if (!await ensure('open_history_page', addresses.historyPage, 'HistoryPage', ctx.instructions.open_history_page, info => c.validateHistoryPageAccount({ address: addresses.historyPage, info, economy, player: PAYER, pageIndex: 0n }))) return publicReceipt(ctx, state, 'DRY_RUN', { nextStep: 'open_history_page', laterStepsSimulated: false });
    if (opt.prepareOnly) { status = 'PREPARED'; persist(); return publicReceipt(ctx, state, status, { credits: String(ledger.credits), timedNeedsOpened: false }); }
    clock = await readClock(connection);
    if (!state.targets && opt.send) {
      // Core insists on the FIRST eligible grid target, so do not invent an
      // extra grid of lead. Wait until this exact target has a useful send window.
      while (timingFor(ctx, clock).entryTargetTs - BigInt(clock.nowTs) - 60n < 120n) {
        log('Waiting for a fresh admission window before spending Need rent');
        await new Promise(resolve => setTimeout(resolve, 5000)); clock = await readClock(connection);
      }
    }
    const timing = timingFor(ctx, clock);
    if (!state.targets) { state.targets = JSON.parse(json(timing)); persist(); }
    const recheckTiming = async () => { const live = await readClock(connection); const t = timingFor(ctx, live); requireFact(t.entryTargetTs === BigInt(state.targets.entryTargetTs), 'saved target is no longer the exact eligible target; refusing additional Need rent or a different shot'); return t; };
    await recheckTiming();
    for (const kind of ['entry', 'exit']) {
      await recheckTiming(); const targetTs = BigInt(state.targets[kind + 'TargetTs']), address = c.needPda(spec.specHash, targetTs)[0];
      if (!await ensure('open_need_' + kind, address, 'TimepinNeedV2', c.openNeedIx({ actor: PAYER, specHash: spec.specHash, targetTs }), info => c.validateNeedAccount({ address, info, evidenceSpec: spec, targetTs }))) return publicReceipt(ctx, state, 'DRY_RUN', { nextStep: 'open_need_' + kind, laterStepsSimulated: false });
    }
    await recheckTiming();
    const seal = await c.sealForwardIx({ player: PAYER, economyHash: economy.economyHash, rulesetHash: ruleset.rulesetHash, evidenceSpecHash: spec.specHash,
      nonce: 0n, commit: ctx.commit, stake: economy.args.minStake, entryTargetTs: BigInt(state.targets.entryTargetTs), horizonSeconds: ruleset.args.horizonSeconds, scoreDay: BigInt(state.targets.scoreDay) });
    if (!await ensure('seal_forward', addresses.shot, 'Shot', seal, verifyShot)) return publicReceipt(ctx, state, 'DRY_RUN', { nextStep: 'seal_forward', laterStepsSimulated: false });
    const after = requireClaimed(await get(addresses.ledger)); requireFact(after.nextShotNonce === 1n && after.open === 1 && after.credits === BigInt(state.testCredits) - BigInt(economy.args.minStake), 'post-seal ledger debit/nonce/open mismatch');
    status = 'SEALED'; persist(); return publicReceipt(ctx, state, status);
  } catch (error) { status = 'FAILED'; if (lock !== null) persist(); throw error; }
  finally { if (lock !== null) { fs.closeSync(lock); fs.unlinkSync(STATE_PATH + '.lock'); } }
}

export async function main(argv = process.argv.slice(2)) {
  const opt = parseArgs(argv);
  if (opt.help) { console.log('node tools/g2-devnet-bootstrap.mjs --rpc URL [--keypair PATH] [--send] [--prepare-only]\nDefault: dry run. --prepare-only registers the test economy and claims credits, without timed Needs or a Shot.'); return; }
  const receipt = await runBootstrapCli(opt);
  console.log(json(receipt));
  if (opt.send) console.log('Public receipt: ' + RECEIPT_PATH + '\nPrivate restart state remains in the ignored deploy keys directory.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error('DEVNET BOOTSTRAP REFUSED: ' + error.message); process.exitCode = 1; });
}
