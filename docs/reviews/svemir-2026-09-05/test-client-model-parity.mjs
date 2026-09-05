import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import * as model from './model.mjs';
import { createCoreG2Client } from './client-v2.mjs';
import { createCoreG2Client as createOldClient } from './client-v2.original.mjs';
const web3=await import(process.env.RATCHETX_WEB3_MODULE||'@solana/web3.js');
const core='ANVGVtDrECeyQkS56UZ9ZiWCUxk2JWEVNJioFW8JEwbL',timepin='C8wwxUGmoKAV22MaY3oW2Q6QeDbmB9dbNdbohsRjJkYp';
const options={web3,coreProgramId:core,timepinProgramId:timepin,cryptoImpl:webcrypto};
const client=createCoreG2Client(options),old=createOldClient(options);
const H=label=>createHash('sha256').update(label).digest(),bytes=x=>Buffer.from(x),hex=x=>bytes(x).toString('hex'),U64=(1n<<64n)-1n;
const slots=[1n,9007199254740993n,U64-2n];
function spec(i){const slot=slots[i%slots.length];return{schema:2,adapter:1,receiverProgram:client.pythReceiver.toBytes(),pushOracleProgram:client.pythPushOracle.toBytes(),shardId:i===31?65535:i,feedId:H('feed-'+i),requiredVerification:1,targetGridSeconds:60,minOpenLeadSeconds:30,maxTargetAheadSeconds:86400,maxPreTargetGapSeconds:1+i,maxPostTargetLagSeconds:30+i,captureGraceSeconds:30+i,maxFutureSkewSeconds:i===31?65535:30,minExponent:-12+(i%5),maxExponent:2,maxConfidenceBps:200+i,receiverProgramdataSlot:slot,receiverConfigHash:H('config-'+i),wormholeProgram:H('wormhole-'+i),wormholeProgramdataSlot:slot,registeredSlot:slot+1n};}
function economy(i){const legacy=i%2===1;return{schema:2,timepinProgram:client.timepinProgram.toBytes(),timepinSchema:2,clusterGenesisHash:H('fixture-genesis'),migrationId:H('migration-'+i),legacyRoot:legacy?H('root-'+i):Buffer.alloc(32),legacySnapshotHash:legacy?H('snapshot-'+i):Buffer.alloc(32),legacyCutoverSlot:legacy?9007199254740993n:0n,legacyLeafCount:legacy?4294967295:0,legacyTotalCredits:legacy?U64:0n,legacyTotalXp:legacy?9007199254740993n:0n,rulesetPolicyRoot:H('policies-'+i),rulesetPolicyCount:21,rcxMint:model.RCX_MINT,rcxTokenProgram:model.TOKEN_2022_PROGRAM,rcxDecimals:6,rawUnitsPerCredit:1000000n,burnPerMille:700,podiumPerMille:300,podiumCurve:[500,300,200],rankShardCount:16,daySeconds:86400,hitPayoutNumerator:17n,hitPayoutDenominator:10n,settleXp:1n,minStake:100n,maxStake:1000000000n,maxOpen:5,cleanupBondLamports:5000n,revealWindowSeconds:3600,maxHorizonSeconds:86400};}
function rules(i,e,s){const observed=i%2===1;return{schema:2,economyHash:model.economyHash(e),evidenceSpecHash:model.timepinEvidenceSpecHash(s),evidencePolicyHash:model.timepinEvidencePolicyHash(s),feedId:s.feedId,entryMode:observed?1:2,horizonSeconds:[300,900,3600][i%3],targetGridSeconds:60,minOpenLeadSeconds:30,maxEntryAgeSeconds:observed?300:0,bandNumerator:i,bandDenominator:10000,baseXp:BigInt(10+i)};}

test('Timepin canonical 214-byte encoding and both hashes equal independent model across 32 boundary-rich fixtures',async()=>{
 for(let i=0;i<32;i++){const s=spec(i),expected=model.encodeTimepinEvidenceSpec(s);assert.equal(expected.length,214);assert.equal(hex(client.encodeEvidenceSpecArgs(s)),hex(expected));assert.equal(hex(await client.evidencePolicyHash(s)),hex(model.timepinEvidencePolicyHash(s)));assert.equal(hex(await client.evidenceSpecHash(s)),hex(model.timepinEvidenceSpecHash(s)));}
});

test('model-produced 262-byte EvidenceSpec accounts decode without phantom bump or integer truncation',()=>{
 for(let i=0;i<32;i++){const s=spec(i),account=model.makeTimepinEvidenceSpecAccount(client.timepinProgram.toBytes(),s),decoded=client.decodeEvidenceSpec(account.data);assert.equal(account.data.length,262);assert.equal(decoded.registeredSlot,s.registeredSlot);assert.equal(decoded.args.receiverProgramdataSlot,s.receiverProgramdataSlot);assert.equal(decoded.args.wormholeProgramdataSlot,s.wormholeProgramdataSlot);assert.equal(hex(decoded.evidencePolicyHash),hex(model.timepinEvidencePolicyHash(s)));assert.equal(hex(client.encodeEvidenceSpecArgs(decoded.args)),hex(model.encodeTimepinEvidenceSpec(s)));assert.equal(Object.hasOwn(decoded,'bump'),false);}
});

test('Economy and observed/forward Ruleset encodings, hashes and model account round trips match across 32 fixtures',async()=>{
 for(let i=0;i<32;i++){const e=economy(i),s=spec(i),r=rules(i,e,s);assert.equal(hex(client.encodeEconomyArgs(e)),hex(model.encodeEconomy(e)));assert.equal(hex(await client.economyHashOf(e)),hex(model.economyHash(e)));assert.equal(hex(client.encodeRulesetArgs(r)),hex(model.encodeRuleset(r,e)));assert.equal(hex(await client.rulesetHashOf(r)),hex(model.rulesetHash(r,e)));const ea=model.makeEconomyAccount(client.coreProgram.toBytes(),e),ra=model.makeRulesetAccount(client.coreProgram.toBytes(),r,e),ed=client.decodeEconomy(ea.data),rd=client.decodeRuleset(ra.data);assert.equal(hex(client.encodeEconomyArgs(ed.args)),hex(model.encodeEconomy(e)));assert.equal(hex(ed.economyHash),hex(model.economyHash(e)));assert.equal(hex(client.encodeRulesetArgs(rd.args)),hex(model.encodeRuleset(r,e)));assert.equal(hex(rd.rulesetHash),hex(model.rulesetHash(r,e)));assert.equal(ed.args.legacyTotalCredits,e.legacyTotalCredits);}
});

test('unsafe JavaScript numbers cannot silently round large canonical u64 fields in either implementation',()=>{
 const bad=Number(9007199254740993n),s={...spec(0),receiverProgramdataSlot:bad},e={...economy(1),legacyTotalCredits:bad};assert.equal(Number.isSafeInteger(bad),false);assert.throws(()=>client.encodeEvidenceSpecArgs(s));assert.throws(()=>model.encodeTimepinEvidenceSpec(s));assert.throws(()=>client.encodeEconomyArgs(e));assert.throws(()=>model.encodeEconomy(e));
});

test('independent model vectors expose both previous client regressions: missing adapter and phantom account bump',()=>{
 const s=spec(0),raw=model.makeTimepinEvidenceSpecAccount(client.timepinProgram.toBytes(),s).data;assert.throws(()=>old.encodeEvidenceSpecArgs(s));assert.throws(()=>old.decodeEvidenceSpec(raw));assert.equal(hex(client.encodeEvidenceSpecArgs(s)),hex(model.encodeTimepinEvidenceSpec(s)));assert.equal(client.decodeEvidenceSpec(raw).registeredSlot,s.registeredSlot);
});
