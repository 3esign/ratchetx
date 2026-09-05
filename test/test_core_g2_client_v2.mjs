import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import * as web3 from '@solana/web3.js';

import {
  CORE_G2_SCHEMA,
  ENTRY_MODE,
  RCX_DECIMALS,
  RCX_MINT,
  RCX_RAW_UNITS_PER_CREDIT,
  TIMEPIN_SCHEMA_V2,
  TOKEN_2022_PROGRAM,
  commitmentHash as modelCommitmentHash,
  economyHash,
  encodeEconomy,
  encodeRuleset,
  encodeTimepinEvidenceSpec,
  makeEconomyAccount,
  makeRulesetAccount,
  makeTimepinEvidenceSpecAccount,
  rulesetHash,
  timepinEvidencePolicyHash,
  timepinEvidenceSpecHash,
  alignFutureTarget,
} from '../onchain/ratchet-core-g2/model.mjs';
import {
  ACCOUNT_DISCRIMINATOR,
  INSTRUCTION_DISCRIMINATOR,
  PYTH_PUSH_ORACLE_PROGRAM,
  PYTH_RECEIVER_PROGRAM,
  createCoreG2Client,
} from '../onchain/ratchet-core-g2/client/client-v2.mjs';

const { PublicKey, SystemProgram } = web3;
const coreProgram = new PublicKey(
  'ANVGVtDrECeyQkS56UZ9ZiWCUxk2JWEVNJioFW8JEwbL');
const timepinProgram = new PublicKey(
  'C8wwxUGmoKAV22MaY3oW2Q6QeDbmB9dbNdbohsRjJkYp');
const client = createCoreG2Client({
  web3, coreProgramId: coreProgram, timepinProgramId: timepinProgram,
  cryptoImpl: webcrypto,
});

const hash = label => createHash('sha256').update(label).digest();
const key = label => new PublicKey(hash(label));
const asBuffer = value => Buffer.from(value);
const disc = (scope, name) => createHash('sha256')
  .update(scope + ':' + name).digest().subarray(0, 8);
const infoFrom = account => ({
  owner: new PublicKey(account.owner),
  executable: account.executable,
  data: Buffer.from(account.data),
});
const mutateInfo = (info, change) => {
  const copy = {
    ...info, owner: new PublicKey(info.owner), data: Buffer.from(info.data),
  };
  change(copy);
  return copy;
};
const keyStrings = instruction =>
  instruction.keys.map(item => item.pubkey.toBase58());
const flags = instruction =>
  instruction.keys.map(item => [item.isSigner, item.isWritable]);

for (const [name, encoded] of Object.entries(INSTRUCTION_DISCRIMINATOR))
  assert.deepEqual(asBuffer(encoded.match(/../g).map(byte => parseInt(byte, 16))),
    disc('global', name), 'instruction discriminator ' + name);
for (const [name, encoded] of Object.entries(ACCOUNT_DISCRIMINATOR))
  assert.deepEqual(asBuffer(encoded.match(/../g).map(byte => parseInt(byte, 16))),
    disc('account', name), 'account discriminator ' + name);

const evidenceArgs = {
  schema: TIMEPIN_SCHEMA_V2,
  adapter: 1,
  receiverProgram: new PublicKey(PYTH_RECEIVER_PROGRAM).toBuffer(),
  pushOracleProgram: new PublicKey(PYTH_PUSH_ORACLE_PROGRAM).toBuffer(),
  shardId: 0,
  feedId: hash('SOL/USD feed'),
  requiredVerification: 1,
  targetGridSeconds: 60,
  minOpenLeadSeconds: 30,
  maxTargetAheadSeconds: 7_200,
  maxPreTargetGapSeconds: 120,
  maxPostTargetLagSeconds: 10,
  captureGraceSeconds: 10,
  maxFutureSkewSeconds: 5,
  minExponent: -12,
  maxExponent: 2,
  maxConfidenceBps: 1_000,
  receiverProgramdataSlot: 5n,
  receiverConfigHash: hash('receiver config generation'),
  wormholeProgram: key('wormhole program').toBuffer(),
  wormholeProgramdataSlot: 6n,
  registeredSlot: 9n,
};
const evidencePolicyHash = timepinEvidencePolicyHash(evidenceArgs);
const evidenceSpecHash = timepinEvidenceSpecHash(evidenceArgs);

const economySpec = {
  schema: CORE_G2_SCHEMA,
  timepinProgram: timepinProgram.toBuffer(),
  timepinSchema: TIMEPIN_SCHEMA_V2,
  clusterGenesisHash: hash('devnet genesis'),
  migrationId: hash('migration zero'),
  legacyRoot: Buffer.alloc(32),
  legacySnapshotHash: Buffer.alloc(32),
  legacyCutoverSlot: 0n,
  legacyLeafCount: 0,
  legacyTotalCredits: 0n,
  legacyTotalXp: 0n,
  rulesetPolicyRoot: hash('allowed rulesets root'),
  rulesetPolicyCount: 1,
  rcxMint: RCX_MINT,
  rcxTokenProgram: TOKEN_2022_PROGRAM,
  rcxDecimals: RCX_DECIMALS,
  rawUnitsPerCredit: RCX_RAW_UNITS_PER_CREDIT,
  burnPerMille: 700,
  podiumPerMille: 300,
  podiumCurve: [500, 300, 200],
  rankShardCount: 16,
  daySeconds: 86_400,
  hitPayoutNumerator: 2n,
  hitPayoutDenominator: 1n,
  settleXp: 10n,
  minStake: 1n,
  maxStake: 100n,
  maxOpen: 64,
  cleanupBondLamports: 100_000n,
  revealWindowSeconds: 60,
  maxHorizonSeconds: 7_200,
};
const economyHashValue = economyHash(economySpec);
const rulesetSpec = {
  schema: CORE_G2_SCHEMA,
  economyHash: economyHashValue,
  evidenceSpecHash,
  evidencePolicyHash,
  feedId: evidenceArgs.feedId,
  entryMode: ENTRY_MODE.FORWARD_ENTRY,
  horizonSeconds: 600,
  targetGridSeconds: 60,
  minOpenLeadSeconds: 30,
  maxEntryAgeSeconds: 0,
  bandNumerator: 2,
  bandDenominator: 1,
  baseXp: 20n,
};
const rulesetHashValue = rulesetHash(rulesetSpec, economySpec);

assert.deepEqual(asBuffer(client.encodeEvidenceSpecArgs(evidenceArgs)),
  encodeTimepinEvidenceSpec(evidenceArgs), 'Timepin canonical 214-byte parity');
assert.equal(client.encodeEvidenceSpecArgs(evidenceArgs).length, 214);
assert.deepEqual(asBuffer(client.encodeEconomyArgs(economySpec)),
  encodeEconomy(economySpec), 'Economy canonical parity');
assert.deepEqual(asBuffer(client.encodeRulesetArgs(rulesetSpec)),
  encodeRuleset(rulesetSpec, economySpec), 'Ruleset canonical parity');
assert.deepEqual(asBuffer(await client.evidencePolicyHash(evidenceArgs)),
  evidencePolicyHash, 'Timepin policy hash parity');
assert.deepEqual(asBuffer(await client.evidenceSpecHash(evidenceArgs)),
  evidenceSpecHash, 'Timepin generation hash parity');
assert.deepEqual(asBuffer(await client.economyHashOf(economySpec)),
  economyHashValue, 'Economy hash parity');
assert.deepEqual(asBuffer(await client.rulesetHashOf(rulesetSpec)),
  rulesetHashValue, 'Ruleset hash parity');

const economyAccount = makeEconomyAccount(coreProgram.toBuffer(), economySpec);
const rulesetAccount = makeRulesetAccount(
  coreProgram.toBuffer(), rulesetSpec, economySpec);
const evidenceAccount = makeTimepinEvidenceSpecAccount(
  timepinProgram.toBuffer(), evidenceArgs);
const economy = await client.validateEconomyAccount({
  address: new PublicKey(economyAccount.key),
  info: infoFrom(economyAccount),
  expectedHash: economyHashValue,
});
const ruleset = await client.validateRulesetAccount({
  address: new PublicKey(rulesetAccount.key),
  info: infoFrom(rulesetAccount),
  economy,
  expectedHash: rulesetHashValue,
});
const evidenceSpec = await client.validateEvidenceSpecAccount({
  address: new PublicKey(evidenceAccount.key),
  info: infoFrom(evidenceAccount),
  expectedHash: evidenceSpecHash,
});
assert.equal(evidenceSpec.args.adapter, 1,
  'EvidenceSpec has no fictitious stored bump byte');
assert.equal(evidenceSpec.registeredSlot, 9n);
assert.equal(client.validateForwardKernel({ economy, ruleset, evidenceSpec }), true);

await assert.rejects(client.validateEvidenceSpecAccount({
  address: new PublicKey(evidenceAccount.key),
  info: mutateInfo(infoFrom(evidenceAccount), value => {
    value.data = Buffer.concat([value.data, Buffer.from([0])]);
  }),
}), /exactly 262/, 'trailing account bytes fail closed');
await assert.rejects(client.validateEvidenceSpecAccount({
  address: new PublicKey(evidenceAccount.key),
  info: mutateInfo(infoFrom(evidenceAccount), value => {
    value.owner = key('wrong owner');
  }),
}), /owner/, 'wrong owner fails closed');
await assert.rejects(client.validateEvidenceSpecAccount({
  address: key('wrong PDA'),
  info: infoFrom(evidenceAccount),
}), /PDA/, 'wrong EvidenceSpec PDA fails closed');
await assert.rejects(client.validateEvidenceSpecAccount({
  address: new PublicKey(evidenceAccount.key),
  info: mutateInfo(infoFrom(evidenceAccount), value => {
    value.data[0] ^= 1;
  }),
}), /discriminator/, 'wrong discriminator fails closed');
await assert.rejects(client.validateEvidenceSpecAccount({
  address: new PublicKey(evidenceAccount.key),
  info: mutateInfo(infoFrom(evidenceAccount), value => {
    value.data.writeBigUInt64LE(5n, 254);
  }),
}), /registered slot/, 'stale generation registration fails closed');

const payer = key('payer');
const registerIx = await client.registerEvidenceSpecIx({
  payer, args: evidenceArgs, specHash: evidenceSpecHash,
});
assert.equal(registerIx.data.length, 254);
assert.deepEqual(asBuffer(registerIx.data), Buffer.concat([
  disc('global', 'register_evidence_spec'),
  evidenceSpecHash,
  encodeTimepinEvidenceSpec(evidenceArgs),
]));
assert.deepEqual(flags(registerIx), [
  [true, true], [false, true], [false, false], [false, false],
  [false, false], [false, false], [false, false], [false, false],
]);
assert.deepEqual(keyStrings(registerIx), [
  payer.toBase58(),
  client.evidenceSpecPda(evidenceSpecHash)[0].toBase58(),
  new PublicKey(evidenceArgs.receiverProgram).toBase58(),
  client.programDataPda(evidenceArgs.receiverProgram)[0].toBase58(),
  client.receiverConfigPda(evidenceArgs.receiverProgram)[0].toBase58(),
  new PublicKey(evidenceArgs.wormholeProgram).toBase58(),
  client.programDataPda(evidenceArgs.wormholeProgram)[0].toBase58(),
  SystemProgram.programId.toBase58(),
]);

const targetTs = 1_800_000_000n;
const openNeedIx = client.openNeedIx({
  actor: payer, specHash: evidenceSpecHash, targetTs,
});
assert.equal(openNeedIx.data.length, 48);
assert.deepEqual(flags(openNeedIx), [
  [true, true], [false, false], [false, true], [false, false],
]);
assert.deepEqual(asBuffer(openNeedIx.data.subarray(0, 8)),
  disc('global', 'open_need'));

const player = key('player');
const openLedgerIx = client.openLedgerIx({
  player, economyHash: economyHashValue,
});
assert.equal(openLedgerIx.data.length, 8);
assert.deepEqual(flags(openLedgerIx), [
  [true, true], [false, false], [false, true], [false, false],
]);

const pageIndex = 2n;
const openHistoryIx = client.openHistoryPageIx({
  actor: player, player, economyHash: economyHashValue, pageIndex,
});
assert.equal(openHistoryIx.data.length, 16);
assert.deepEqual(flags(openHistoryIx), [
  [true, true], [false, false], [false, false], [false, false],
  [false, true], [false, false],
]);

const nonce = 17n;
const commit = hash('sealed commitment');
const chainNowTs = 1_700_000_001n;
const timing = client.admissionTiming({
  chainNowTs, economy, ruleset, evidenceSpec,
});
assert.equal(timing.entryTargetTs, alignFutureTarget(
  chainNowTs, rulesetSpec.minOpenLeadSeconds,
  rulesetSpec.targetGridSeconds));
assert.equal(timing.exitTargetTs,
  timing.entryTargetTs + BigInt(rulesetSpec.horizonSeconds));
assert.equal(timing.revealDeadlineTs,
  timing.exitTargetTs + BigInt(evidenceArgs.maxPostTargetLagSeconds) +
  BigInt(evidenceArgs.captureGraceSeconds) +
  BigInt(economySpec.revealWindowSeconds));

const sealIx = await client.sealForwardIx({
  player,
  economyHash: economyHashValue,
  rulesetHash: rulesetHashValue,
  evidenceSpecHash,
  nonce,
  commit,
  stake: 5n,
  entryTargetTs: timing.entryTargetTs,
  horizonSeconds: rulesetSpec.horizonSeconds,
  scoreDay: timing.scoreDay,
});
assert.equal(sealIx.data.length, 72);
assert.deepEqual(flags(sealIx), [
  [true, true], [false, false], [false, false], [false, true],
  [false, true], [false, true], [false, true], [false, true],
  [false, false], [false, false], [false, false],
]);
assert.deepEqual(asBuffer(sealIx.data.subarray(0, 8)),
  disc('global', 'seal_forward'));

const ledger = {
  economyHash: economy.economyHash,
  player,
  nextShotNonce: nonce,
  credits: 20n,
  open: 0,
};
const admission = await client.buildForwardAdmission({
  player, economy, ruleset, evidenceSpec, ledger,
  chainNowTs, stake: 5n, commit,
});
assert.equal(admission.instructions.length, 5,
  'one atomic admission has four idempotent openers then seal');
assert.deepEqual(admission.instructions.map(ix => ix.programId.toBase58()), [
  coreProgram.toBase58(), coreProgram.toBase58(),
  timepinProgram.toBase58(), timepinProgram.toBase58(),
  coreProgram.toBase58(),
]);
const packet = new web3.Transaction({
  feePayer: player, recentBlockhash: key('recent blockhash').toBase58(),
}).add(...admission.instructions).serialize({
  requireAllSignatures: false, verifySignatures: false,
});
assert.ok(packet.length <= web3.PACKET_DATA_SIZE,
  'atomic admission must fit the Solana transaction packet');
assert.equal(admission.nonce, nonce);
assert.equal(admission.pageIndex, 1n);
assert.equal(admission.addresses.shot.toBase58(),
  client.shotPda(economyHashValue, player, nonce)[0].toBase58());
const u64le = value => {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(value);
  return out;
};
const [workPage] = PublicKey.findProgramAddressSync([
  Buffer.from('work_page'), economyHashValue, player.toBuffer(),
  u64le(admission.pageIndex),
], coreProgram);
assert.equal(admission.instructions.some(ix =>
  ix.keys.some(item => item.pubkey.equals(workPage))), false,
'WorkPage is deliberately absent from admission');
assert.deepEqual(keyStrings(admission.instructions[4]),
  keyStrings(sealIx), 'composed seal uses the exact standalone topology');

const salt = hash('secret salt');
assert.deepEqual(asBuffer(await client.commitmentHash({
  economyHash: economyHashValue,
  rulesetHash: rulesetHashValue,
  player,
  nonce,
  side: 1,
  probability: 7_000,
  salt,
})), modelCommitmentHash({
  programId: coreProgram.toBuffer(),
  economyHash: economyHashValue,
  rulesetHash: rulesetHashValue,
  player: player.toBuffer(),
  nonce,
  side: 1,
  probability: 7_000,
  salt,
}), 'commitment domain and integer parity');

await assert.rejects(client.sealForwardIx({
  player,
  economyHash: economyHashValue,
  rulesetHash: rulesetHashValue,
  evidenceSpecHash,
  nonce: -1n,
  commit,
  stake: 5n,
  entryTargetTs: timing.entryTargetTs,
  horizonSeconds: rulesetSpec.horizonSeconds,
  scoreDay: timing.scoreDay,
}), /nonce/, 'negative nonce rejected client-side');
await assert.rejects(client.sealForwardIx({
  player,
  economyHash: economyHashValue,
  rulesetHash: rulesetHashValue,
  evidenceSpecHash,
  nonce,
  commit: Buffer.alloc(32),
  stake: 5n,
  entryTargetTs: timing.entryTargetTs,
  horizonSeconds: rulesetSpec.horizonSeconds,
  scoreDay: timing.scoreDay,
}), /nonzero/, 'empty commitment rejected client-side');
await assert.rejects(client.commitmentHash({
  economyHash: economyHashValue,
  rulesetHash: rulesetHashValue,
  player,
  nonce,
  side: 2,
  probability: 7_000,
  salt,
}), /side/, 'invalid side rejected client-side');
assert.throws(() => client.validateForwardKernel({
  economy,
  ruleset,
  evidenceSpec: {
    ...evidenceSpec,
    args: { ...evidenceSpec.args, maxTargetAheadSeconds: 688 },
  },
}), /target-ahead/, 'Timepin window must cover lead, alignment and horizon');

console.log('Core G2 browser client parity: PASS');

