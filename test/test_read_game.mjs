// One offline path: genuine G2 account codecs -> closed account -> attributed
// transaction receipt. Only RPC transport is replaced; no wallet or network.
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import * as web3 from '@solana/web3.js';
import { createCoreG2Client, ACCOUNT_DISCRIMINATOR } from '../lib/g2/client-v2.mjs';
import { createGameReader, explorerLink } from '../lib/g2/read-game.mjs';
import { makeEconomyAccount, makeRulesetAccount, economyHash,
  RCX_MINT, TOKEN_2022_PROGRAM } from '../onchain/ratchet-core-g2/model.mjs';

const genesis = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const mainnet = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const hash = text => createHash('sha256').update(text).digest();
const client = createCoreG2Client({ web3, cryptoImpl: webcrypto,
  coreProgramId: 'ANVGVtDrECeyQkS56UZ9ZiWCUxk2JWEVNJioFW8JEwbL',
  timepinProgramId: 'C8wwxUGmoKAV22MaY3oW2Q6QeDbmB9dbNdbohsRjJkYp' });
const player = new web3.PublicKey(hash('read-game player'));
const infoFrom = a => ({ owner: new web3.PublicKey(a.owner), executable: a.executable,
  data: Buffer.from(a.data) });
function fixtures(cluster = genesis) {
  const spec = {
    schema: 2, timepinProgram: client.timepinProgram.toBuffer(), timepinSchema: 2,
    clusterGenesisHash: new web3.PublicKey(cluster).toBuffer(), migrationId: hash('migration'),
    legacyRoot: Buffer.alloc(32), legacySnapshotHash: Buffer.alloc(32), legacyCutoverSlot: 0n,
    legacyLeafCount: 0, legacyTotalCredits: 0n, legacyTotalXp: 0n,
    rulesetPolicyRoot: hash('policy'), rulesetPolicyCount: 1,
    rcxMint: RCX_MINT, rcxTokenProgram: TOKEN_2022_PROGRAM, rcxDecimals: 6,
    rawUnitsPerCredit: 1_000_000n, burnPerMille: 700, podiumPerMille: 300,
    podiumCurve: [500, 300, 200], rankShardCount: 16, daySeconds: 86400,
    hitPayoutNumerator: 2n, hitPayoutDenominator: 1n, settleXp: 10n,
    minStake: 1n, maxStake: 100n, maxOpen: 64, cleanupBondLamports: 100_000n,
    revealWindowSeconds: 60, maxHorizonSeconds: 7200,
  };
  const eHash = economyHash(spec);
  const rules = { schema: 2, economyHash: eHash,
    evidenceSpecHash: hash('spec'), evidencePolicyHash: hash('evidence'), feedId: hash('feed'),
    entryMode: 2, horizonSeconds: 600, targetGridSeconds: 300, minOpenLeadSeconds: 60,
    maxEntryAgeSeconds: 0, bandNumerator: 0, bandDenominator: 1, baseXp: 20n };
  const economy = makeEconomyAccount(client.coreProgram.toBuffer(), spec);
  const ruleset = makeRulesetAccount(client.coreProgram.toBuffer(), rules, spec);
  return { values: [infoFrom(economy), infoFrom(ruleset), null],
    eHash, rHash: client.decodeRuleset(ruleset.data).rulesetHash };
}
let data = fixtures(), tx = null, reads = 0, transactionReads = 0, rpcGenesis = genesis;
const connection = {
  getGenesisHash: async () => rpcGenesis,
  getMultipleAccountsInfoAndContext: async (keys, options) => {
    reads++; assert.equal(keys.length, 3); assert.equal(options.commitment, 'confirmed');
    return { context: { slot: 456 }, value: data.values };
  },
  getTransaction: async (signature, options) => {
    transactionReads++; assert.equal(options.maxSupportedTransactionVersion, 0); return tx;
  },
};
const reader = createGameReader({ connection, client, web3, expectedGenesisHash: genesis });
const request = () => ({ economyHash: data.eHash, rulesetHash: data.rHash, player, nonce: 0n });
let result = await reader.readGame(request());
assert.equal(result.kind, 'unavailable');
assert.equal(result.reason, 'shot-account-absent');
assert.equal(transactionReads, 0, 'absence does not start a history crawl or invent success');
assert.equal(new URL(result.links.shot).searchParams.get('cluster'), 'devnet');

// Minimal active Shot fixture in the source ABI: identity header and state.
const shot = Buffer.alloc(780);
Buffer.from(ACCOUNT_DISCRIMINATOR.Shot, 'hex').copy(shot);
shot.writeUInt16LE(2, 8); shot[10] = client.shotPda(data.eHash, player, 0n)[1];
Buffer.from(data.eHash).copy(shot, 11); Buffer.from(data.rHash).copy(shot, 43);
player.toBuffer().copy(shot, 75); shot[211] = 2; shot[212] = 1;
data.values[2] = { owner: client.coreProgram, executable: false, data: shot };
result = await reader.readGame(request());
assert.equal(result.kind, 'account'); assert.equal(result.shot.state, 1);
assert.equal(result.shot.nonce, 0n); assert.equal(result.rawAccount.length, 780);
assert.equal(result.checks.resultEconomics, false);
data.values[2] = { ...data.values[2], owner: web3.SystemProgram.programId };
await assert.rejects(reader.readGame(request()), /owner/);
data.values[2] = null;

rpcGenesis = mainnet;
const before = reads;
await assert.rejects(reader.readGame(request()), /cluster/);
assert.equal(reads, before, 'wrong RPC cluster rejected before account interpretation');
rpcGenesis = genesis;
data = fixtures(mainnet);
await assert.rejects(reader.readGame(request()), /Economy belongs to a different cluster/);
data = fixtures();
await assert.rejects(reader.readGame({ ...request(), nonce: Number.MAX_SAFE_INTEGER + 1 }), /exact/);

const signature = '2'.repeat(88);
result = await reader.readGame({ ...request(), terminalSignature: signature });
assert.equal(result.reason, 'transaction-unavailable');
// Archive bytes are independently laid out per Rust ShotArchived + ShotResult;
// discriminator derives from Anchor's event namespace, not from decoder output.
const archive = Buffer.alloc(319);
hash('event:ShotArchived').subarray(0, 8).copy(archive);
Buffer.from(data.eHash).copy(archive, 8); player.toBuffer().copy(archive, 40);
archive[89] = 1; // nonce0 -> page0/slot0, first terminal event
Buffer.from(data.rHash).copy(archive, 154); archive[218] = 4;
const core = client.coreProgram.toBase58();
const logs = () => [`Program ${core} invoke [1]`,
  'Program data: ' + archive.toString('base64'), `Program ${core} success`];
tx = { slot: 457, transaction: { signatures: [signature] },
  meta: { err: null, logMessages: logs() } };
result = await reader.readGame({ ...request(), terminalSignature: signature });
assert.equal(result.kind, 'archive'); assert.equal(result.shot, null);
assert.equal(result.receipt.event.result.state, 4);
assert.equal(result.checks.historyCommitment, false);
assert.equal(result.receipt.provenance.independentVerification, false);
assert.equal(new URL(result.links.terminal).searchParams.get('cluster'), 'devnet');
tx.meta.err = { InstructionError: [0, 'InvalidArgument'] };
await assert.rejects(reader.readGame({ ...request(), terminalSignature: signature }), /meta.err/);
tx.meta.err = null;
archive[40] ^= 1; tx.meta.logMessages = logs();
await assert.rejects(reader.readGame({ ...request(), terminalSignature: signature }), /exactly one archive/);
archive[40] ^= 1; tx.meta.logMessages = logs();
tx.transaction.signatures[0] = '3'.repeat(88);
await assert.rejects(reader.readGame({ ...request(), terminalSignature: signature }), /different transaction/);
assert.equal(new URL(explorerLink({ genesisHash: mainnet, kind: 'address', value: core })).search, '');
for (const invalid of ['unknown', 'constructor', '__proto__', 'toString']) {
  assert.throws(() => explorerLink({ genesisHash: invalid, kind: 'address', value: core }), /Unknown cluster/);
  assert.throws(() => createGameReader({ connection, client, web3, expectedGenesisHash: invalid }), /known cluster/);
}
assert.throws(() => explorerLink({ genesisHash: genesis, kind: 'address', value: 'javascript:alert(1)' }), /Invalid/);
console.log('G2 on-demand reader: account -> closed -> receipt, cluster and provenance checks PASS (host)');
