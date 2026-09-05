import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
  ACCOUNT_SIZE,
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

// Derive the fixture's order and byte offsets independently from the actual Rust
// Borsh struct. A client field transpose, omitted field, or wrong integer width
// must fail even if somebody writes a matching JavaScript fixture by mistake.
{
  const rust = readFileSync(new URL(
    '../onchain/ratchet-core-g2/programs/ratchet-core-g2/src/state.rs',
    import.meta.url), 'utf8');
  const body = rust.match(/pub struct Shot \{([\s\S]*?)\n\}/)?.[1];
  assert.ok(body, 'Rust Shot struct is present');
  const fields = [...body.matchAll(/pub (\w+):\s*([^,]+),/g)]
    .map(([, name, type]) => ({ name, type: type.replace(/\s+/g, '') }));
  const widths = { u8: 1, u16: 2, u64: 8, i64: 8, i32: 4, Pubkey: 32, '[u8;32]': 32 };
  const rustLength = Number(rust.match(/impl Shot\s*\{\s*pub const LEN: usize = (\d+);/)?.[1]);
  let size = 8;
  for (const field of fields) {
    assert.ok(widths[field.type], 'known Rust Shot field type: ' + field.type);
    field.offset = size;
    size += widths[field.type];
  }
  assert.equal(size, rustLength + 8, 'all actual Rust fields fit Shot::LEN');
  assert.equal(size, 780, 'Shot full account ABI remains 780 bytes');
  assert.equal(ACCOUNT_SIZE.Shot, size, 'client length matches the Rust account');
  const camel = name => name.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
  const unsignedMax = (1n << 64n) - 1n;
  const [shotAddress, shotBump] = PublicKey.findProgramAddressSync([
    Buffer.from('shot'), economyHashValue, player.toBuffer(),
    Buffer.from('1100000000000000', 'hex'),
  ], coreProgram);
  const special = {
    schema: CORE_G2_SCHEMA, bump: shotBump, economy_hash: economyHashValue,
    ruleset_hash: rulesetHashValue, player, nonce,
    entry_mode: 2, state: 254, void_reason: 253, outcome_yes: 252, side: 251, hit: 250,
    stake: unsignedMax, xp_base: 0n, p_bps: 7000,
    sealed_ts: -(1n << 63n), entry_target_ts: (1n << 63n) - 1n,
    entry_exponent: -2147483648, exit_exponent: 2147483647,
  };
  const data = Buffer.alloc(size);
  disc('account', 'Shot').copy(data);
  const expected = {};
  const writeField = (buffer, field, value) => {
    const at = field.offset;
    if (field.type === 'Pubkey') value.toBuffer().copy(buffer, at);
    else if (field.type === '[u8;32]') Buffer.from(value).copy(buffer, at);
    else if (field.type === 'u8') buffer.writeUInt8(value, at);
    else if (field.type === 'u16') buffer.writeUInt16LE(value, at);
    else if (field.type === 'u64') buffer.writeBigUInt64LE(value, at);
    else if (field.type === 'i64') buffer.writeBigInt64LE(value, at);
    else if (field.type === 'i32') buffer.writeInt32LE(value, at);
  };
  for (const [index, field] of fields.entries()) {
    const value = Object.hasOwn(special, field.name) ? special[field.name]
      : field.type === 'Pubkey' ? key('Shot ' + field.name)
      : field.type === '[u8;32]' ? hash('Shot ' + field.name)
      : field.type === 'u64' ? (1n << 53n) + BigInt(index)
      : field.type === 'i64' ? -(1n << 53n) - BigInt(index)
      : field.type === 'i32' ? -1000 - index : index;
    expected[camel(field.name)] = value;
    writeField(data, field, value);
  }
  const decoded = client.decodeShot(data);
  assert.equal(Object.keys(decoded).length, fields.length, 'every Rust Shot field is exposed once');
  for (const field of fields) {
    const name = camel(field.name), value = decoded[name];
    if (field.type === 'Pubkey') assert.equal(value.toBase58(), expected[name].toBase58(), name);
    else if (field.type === '[u8;32]') assert.deepEqual(Buffer.from(value), expected[name], name);
    else assert.equal(value, expected[name], name + ' preserves its Rust integer width/sign');
  }
  const info = { owner: coreProgram, executable: false, data };
  const input = { address: shotAddress, info, economy, ruleset, player, nonce };
  const checked = client.validateShotAccount(input);
  assert.equal(checked.state, 254, 'unknown state is returned without inventing an outcome');
  assert.equal(checked.voidReason, 253, 'unknown void reason remains visible');
  assert.equal(checked.outcomeYes, 252, 'outcome byte is not coerced to a boolean');
  assert.equal(checked.hit, 250, 'hit byte is not coerced to a boolean');
  const changed = (name, value) => mutateInfo(info, copy => {
    writeField(copy.data, fields.find(field => field.name === name), value);
  });
  assert.throws(() => client.validateShotAccount({ ...input, info: null }), /missing/);
  assert.throws(() => client.validateShotAccount({ ...input,
    info: { ...info, executable: true } }), /executable/);
  assert.throws(() => client.validateShotAccount({ ...input,
    info: { ...info, owner: key('other program') } }), /owner/);
  for (const bytes of [data.subarray(0, -1), Buffer.concat([data, Buffer.from([0])])])
    assert.throws(() => client.validateShotAccount({ ...input,
      info: { ...info, data: bytes } }), /exactly 780/);
  assert.throws(() => client.decodeShot(data.subarray(0, -1)), /exactly 780/);
  assert.throws(() => client.validateShotAccount({ ...input,
    info: mutateInfo(info, copy => { copy.data[0] ^= 1; }) }), /discriminator/);
  assert.throws(() => client.validateShotAccount({ ...input,
    info: changed('schema', CORE_G2_SCHEMA + 1) }), /schema/);
  assert.throws(() => client.validateShotAccount({ ...input,
    info: changed('economy_hash', hash('other economy')) }), /Economy/);
  assert.throws(() => client.validateShotAccount({ ...input,
    info: changed('ruleset_hash', hash('other ruleset')) }), /Ruleset/);
  assert.throws(() => client.validateShotAccount({ ...input, player: key('other player') }), /player/);
  assert.throws(() => client.validateShotAccount({ ...input, nonce: nonce + 1n }), /nonce/);
  assert.throws(() => client.validateShotAccount({ ...input, nonce: -1n }), /nonce/);
  assert.throws(() => client.validateShotAccount({ ...input, nonce: unsignedMax + 1n }), /nonce/);
  assert.throws(() => client.validateShotAccount({ ...input, address: key('other PDA') }), /PDA/);
  assert.throws(() => client.validateShotAccount({ ...input,
    info: changed('bump', shotBump ^ 1) }), /bump/);
  const [lastAddress, lastBump] = PublicKey.findProgramAddressSync([
    Buffer.from('shot'), economyHashValue, player.toBuffer(), Buffer.alloc(8, 255),
  ], coreProgram);
  const lastInfo = changed('nonce', unsignedMax);
  writeField(lastInfo.data, fields.find(field => field.name === 'bump'), lastBump);
  assert.equal(client.validateShotAccount({ ...input, address: lastAddress,
    info: lastInfo, nonce: unsignedMax }).nonce, unsignedMax, 'u64 nonce boundary derives the exact PDA');
}
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

