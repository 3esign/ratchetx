import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@solana/web3.js';
import crypto from 'crypto';

import { createCoreG2Client } from '../onchain/ratchet-core-g2/client/client-v2.mjs';
import { 
  economyHash,
  encodeEconomy, 
  encodeRuleset, 
  encodeTimepinEvidenceSpec,
  RCX_MINT,
  TOKEN_2022_PROGRAM
} from '../onchain/ratchet-core-g2/model.mjs';
import * as web3 from '@solana/web3.js';

const client = createCoreG2Client({
  web3,
  coreProgramId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  timepinProgramId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  cryptoImpl: crypto.webcrypto
});

const b32 = Buffer.alloc(32, 1);
const pkStr = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const pkBuf = new web3.PublicKey(pkStr).toBytes();
const rcxMintStr = new web3.PublicKey(RCX_MINT).toBase58();
const token2022Str = new web3.PublicKey(TOKEN_2022_PROGRAM).toBase58();

test('EvidenceSpec parity', () => {
  const args = {
    schema: 2, adapter: 1, receiverProgram: pkBuf,
    pushOracleProgram: pkBuf, shardId: 1,
    feedId: b32,
    requiredVerification: 1, targetGridSeconds: 10, minOpenLeadSeconds: 10,
    maxTargetAheadSeconds: 1000, maxPreTargetGapSeconds: 100, maxPostTargetLagSeconds: 100,
    captureGraceSeconds: 100, maxFutureSkewSeconds: 30, minExponent: -10,
    maxExponent: 2, maxConfidenceBps: 100, receiverProgramdataSlot: 1000n,
    receiverConfigHash: b32,
    wormholeProgram: pkBuf, wormholeProgramdataSlot: 1000n
  };
  
  const clientArgs = { ...args, receiverProgram: pkStr, pushOracleProgram: pkStr, wormholeProgram: pkStr };
  
  const clientBuf = client.encodeEvidenceSpecArgs(clientArgs);
  const modelBuf = encodeTimepinEvidenceSpec(args);
  assert.equal(clientBuf.length, 214);
  assert.equal(modelBuf.length, 214);
  assert.ok(Buffer.compare(Buffer.from(clientBuf), modelBuf) === 0);
});

test('Economy parity', () => {
  const args = {
    schema: 2, timepinProgram: pkBuf, timepinSchema: 2,
    clusterGenesisHash: b32, migrationId: b32, legacyRoot: b32,
    legacySnapshotHash: b32, legacyCutoverSlot: 100n, legacyLeafCount: 100n,
    legacyTotalCredits: 100n, legacyTotalXp: 100n, rulesetPolicyRoot: b32,
    rulesetPolicyCount: 1n, rcxMint: RCX_MINT, rcxTokenProgram: TOKEN_2022_PROGRAM,
    rcxDecimals: 6, rawUnitsPerCredit: 1000000n, burnPerMille: 700,
    podiumPerMille: 300, podiumCurve: [500, 300, 200], rankShardCount: 16,
    daySeconds: 86400, hitPayoutNumerator: 17, hitPayoutDenominator: 10,
    settleXp: 10, minStake: 100n, maxStake: 1000n, maxOpen: 5,
    cleanupBondLamports: 50000n, revealWindowSeconds: 3600, maxHorizonSeconds: 7200
  };
  
  const clientArgs = { ...args, timepinProgram: pkStr, rcxMint: rcxMintStr, rcxTokenProgram: token2022Str };
  
  const clientBuf = client.encodeEconomyArgs(clientArgs);
  const modelBuf = encodeEconomy(args);
  assert.ok(Buffer.compare(Buffer.from(clientBuf), modelBuf) === 0);
});

test('Ruleset parity', () => {
  const economyArgs = {
    schema: 2, timepinProgram: pkBuf, timepinSchema: 2,
    clusterGenesisHash: b32, migrationId: b32, legacyRoot: b32,
    legacySnapshotHash: b32, legacyCutoverSlot: 100n, legacyLeafCount: 100n,
    legacyTotalCredits: 100n, legacyTotalXp: 100n, rulesetPolicyRoot: b32,
    rulesetPolicyCount: 1n, rcxMint: RCX_MINT, rcxTokenProgram: TOKEN_2022_PROGRAM,
    rcxDecimals: 6, rawUnitsPerCredit: 1000000n, burnPerMille: 700,
    podiumPerMille: 300, podiumCurve: [500, 300, 200], rankShardCount: 16,
    daySeconds: 86400, hitPayoutNumerator: 17, hitPayoutDenominator: 10,
    settleXp: 10, minStake: 100n, maxStake: 1000n, maxOpen: 5,
    cleanupBondLamports: 50000n, revealWindowSeconds: 3600, maxHorizonSeconds: 7200
  };
  const economy = { ...economyArgs };
  
  const args = {
    schema: 2, economyHash: economyHash(economy), evidenceSpecHash: b32,
    evidencePolicyHash: b32, feedId: b32, entryMode: 1,
    horizonSeconds: 1800, targetGridSeconds: 60, minOpenLeadSeconds: 60,
    maxEntryAgeSeconds: 300,
    bandNumerator: 1, bandDenominator: 1, baseXp: 10n
  };
  
  const clientArgs = { ...args, economyHash: economyHash(economy).toString('hex'), evidenceSpecHash: b32.toString('hex'), evidencePolicyHash: b32.toString('hex'), feedId: b32.toString('hex') };
  const clientBuf = client.encodeRulesetArgs(clientArgs);
  const modelBuf = encodeRuleset(args, economy);
  assert.ok(Buffer.compare(Buffer.from(clientBuf), modelBuf) === 0);
});
