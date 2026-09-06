// Host-only proof. No RPC, real keys, transactions, or production/private files.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as web3 from '@solana/web3.js';
import { buildContext, newState, timingFor, publicReceipt, parseArgs, assertBoundary, PAYER, PROGRAMS, DEVNET_GENESIS, readClock } from '../tools/g2-devnet-bootstrap.mjs';
import { legacyLeafHash, verifyLegacyProof } from '../onchain/ratchet-core-g2/legacy-snapshot.mjs';
import { verifyRulesetPolicyProof, commitmentHash as modelCommitmentHash } from '../onchain/ratchet-core-g2/model.mjs';
import { createCoreG2Client, ACCOUNT_DISCRIMINATOR } from '../onchain/ratchet-core-g2/client/client-v2.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest();
const manifestBytes = readFileSync(new URL('../releases/g2-mainnet-economy.json', import.meta.url));
const manifest = JSON.parse(manifestBytes), manifestSha256 = sha(manifestBytes).toString('hex');
const c = createCoreG2Client({ web3, coreProgramId: PROGRAMS.core, timepinProgramId: PROGRAMS.timepin });
const key = n => new web3.PublicKey(Buffer.alloc(32, n));
const receiver = c.pythReceiver, wormhole = key(7), loader = c.loaderProgram;
const program = pd => { const b = Buffer.alloc(36); b.writeUInt32LE(2); pd.toBuffer().copy(b, 4); return b; };
const programdata = slot => { const b = Buffer.alloc(45); b.writeUInt32LE(3); b.writeBigUInt64LE(slot, 4); b[12] = 1; key(11).toBuffer().copy(b, 13); return b; };
const config = Buffer.alloc(370); sha('account:Config').subarray(0, 8).copy(config); key(11).toBuffer().copy(config, 8); wormhole.toBuffer().copy(config, 41); config.writeUInt32LE(1, 73); config.writeUInt16LE(26, 77); key(12).toBuffer().copy(config, 79); config.writeBigUInt64LE(1n, 113); config[121] = 3;
const receiverPd = c.programDataPda(receiver)[0], wormholePd = c.programDataPda(wormhole)[0];
const generation = {
  receiverProgram: receiver.toBuffer(), receiverProgramExecutable: true, receiverProgramOwner: loader.toBuffer(), receiverProgramAccountData: program(receiverPd),
  receiverProgramdata: receiverPd.toBuffer(), receiverProgramdataOwner: loader.toBuffer(), receiverProgramdataExecutable: false, receiverProgramdataAccountData: programdata(900n), receiverProgramdataSlot: 900n,
  receiverConfigKey: c.receiverConfigPda(receiver)[0].toBuffer(), receiverConfigOwner: receiver.toBuffer(), receiverConfigExecutable: false, receiverConfigData: config,
  wormholeProgram: wormhole.toBuffer(), wormholeProgramExecutable: true, wormholeProgramOwner: loader.toBuffer(), wormholeProgramAccountData: program(wormholePd),
  wormholeProgramdata: wormholePd.toBuffer(), wormholeProgramdataOwner: loader.toBuffer(), wormholeProgramdataExecutable: false, wormholeProgramdataAccountData: programdata(901n), wormholeProgramdataSlot: 901n,
};
const clock = { slot: 1000n, nowTs: 1800000001n };
const state = newState({ manifestSha256, clock, generation });
const ctx = await buildContext({ manifest, manifestSha256, state, generation, clock });
let checks = 0;
const check = async (label, fn) => { await fn(); checks++; console.log('ok - ' + label); };
await check('exact devnet, designated payer and deployed identities; no other network accepted', () => {
  assertBoundary(DEVNET_GENESIS);
  for (const g of ['5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d', '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY', 'devnet', '']) assert.throws(() => assertBoundary(g), /DEVNET/);
  assert.throws(() => assertBoundary(DEVNET_GENESIS, key(5).toBase58()), /designated/);
  assert.throws(() => assertBoundary(DEVNET_GENESIS, PAYER, { ...PROGRAMS, core: key(8).toBase58() }), /program IDs/);
});
await check('private state never leaks into public proof, including salt and direction', () => {
  state.targets = JSON.parse(JSON.stringify(timingFor(ctx, clock), (_, v) => typeof v === 'bigint' ? String(v) : v));
  const receipt = publicReceipt(ctx, state, 'HOST_TEST'), text = JSON.stringify(receipt);
  assert.ok(!text.includes(state.salt)); assert.ok(!Object.hasOwn(receipt, 'side')); assert.ok(!Object.hasOwn(receipt, 'probability'));
  assert.equal(receipt.observer.needs.length, 2); assert.equal(receipt.observer.mustObserveBothNeedsConcurrently, true);
  const [entry, exit] = receipt.observer.needs;
  assert.equal(BigInt(exit.targetTs) - BigInt(entry.targetTs), 300n);
  assert.equal(BigInt(entry.captureDeadlineTs) - BigInt(entry.sourceDeadlineTs), 900n);
  assert.ok(BigInt(entry.captureDeadlineTs) > BigInt(exit.sourceDeadlineTs), 'entry finalization is too late to start observing exit');
});
await check('a real one-wallet Merkle leaf binds positive credit to devnet/payer/cutover; production root stays zero', () => {
  const m = ctx.snapshot.manifest, claim = m.claims[0];
  assert.equal(claim.wallet, PAYER); assert.equal(claim.credits, '10000'); assert.equal(claim.xp, '0'); assert.deepEqual(claim.proof, []);
  const args = { clusterGenesisHash: ctx.economy.args.clusterGenesisHash, migrationId: ctx.economy.args.migrationId, snapshotHash: ctx.snapshot.snapshotHash, cutoverSlot: 1000n,
    player: new web3.PublicKey(PAYER).toBuffer(), credits: 10000n, xp: 0n, programId: new web3.PublicKey(PROGRAMS.core).toBuffer() };
  assert.deepEqual(legacyLeafHash(args), ctx.snapshot.root);
  assert.equal(verifyLegacyProof(legacyLeafHash(args), [], ctx.snapshot.root), true);
  assert.equal(verifyLegacyProof(legacyLeafHash({ ...args, credits: 10001n }), [], ctx.snapshot.root), false);
  assert.notDeepEqual(legacyLeafHash({ ...args, player: key(3).toBuffer() }), ctx.snapshot.root);
  assert.notDeepEqual(legacyLeafHash({ ...args, credits: 10001n }), ctx.snapshot.root);
  assert.equal(manifest.economy.legacyRoot, '00'.repeat(32)); assert.equal(manifest.economy.legacyTotalCredits, '0');
  assert.deepEqual(readFileSync(new URL('../releases/g2-mainnet-economy.json', import.meta.url)), manifestBytes);
});
await check('all 49 approved policies verify and a changed leaf/proof is rejected', () => {
  assert.equal(ctx.rules.length, 49); assert.equal(ctx.economy.args.rulesetPolicyCount, 49);
  for (const r of ctx.rules) {
    assert.equal(verifyRulesetPolicyProof(r.leaf, r.proof, ctx.economy.args.rulesetPolicyRoot), true);
    const bad = Buffer.from(r.leaf); bad[0] ^= 1;
    assert.equal(verifyRulesetPolicyProof(bad, r.proof, ctx.economy.args.rulesetPolicyRoot), false);
  }
  assert.equal(ctx.spec.args.adapter, 2); assert.equal(ctx.spec.args.maxPostTargetLagSeconds, 299); assert.equal(ctx.spec.args.captureGraceSeconds, 900);
});
await check('register and claim payloads have the actual Anchor wire order and empty one-leaf proof', () => {
  const i = ctx.instructions;
  assert.equal(i.register_economy.data.length, 8 + 32 + 372);
  assert.deepEqual(Buffer.from(i.register_economy.data.subarray(8, 40)), Buffer.from(ctx.economy.economyHash));
  assert.equal(i.register_ruleset.data.length, 8 + 32 + 163 + 4 + 32 * ctx.ruleset.proof.length);
  const claim = Buffer.from(i.claim_legacy.data);
  assert.equal(claim.length, 28); assert.equal(claim.readBigUInt64LE(8), 10000n); assert.equal(claim.readBigUInt64LE(16), 0n); assert.equal(claim.readUInt32LE(24), 0);
  assert.equal(i.claim_legacy.keys.length, 4); assert.equal(i.claim_legacy.keys[0].pubkey.toBase58(), PAYER); assert.equal(i.claim_legacy.keys[0].isSigner, true); assert.equal(i.claim_legacy.keys[2].pubkey.toBase58(), ctx.addresses.ledger.toBase58());
});
await check('economy and ruleset existing-account mismatch cannot be resumed', async () => {
  const [address, bump] = ctx.c.economyPda(ctx.economy.economyHash);
  const header = Buffer.alloc(3); header.writeUInt16LE(2); header[2] = bump;
  const data = Buffer.concat([Buffer.from(ACCOUNT_DISCRIMINATOR.Economy, 'hex'), header, Buffer.from(ctx.economy.economyHash), Buffer.from(ctx.c.encodeEconomyArgs(ctx.economy.args))]);
  await ctx.c.validateEconomyAccount({ address, info: { owner: ctx.c.coreProgram, executable: false, data }, expectedHash: ctx.economy.economyHash });
  const [rulesetAddress, rulesetBump] = ctx.c.rulesetPda(ctx.ruleset.rulesetHash);
  const ruleHeader = Buffer.alloc(3); ruleHeader.writeUInt16LE(2); ruleHeader[2] = rulesetBump;
  const ruleData = Buffer.concat([Buffer.from(ACCOUNT_DISCRIMINATOR.Ruleset, 'hex'), ruleHeader, Buffer.from(ctx.ruleset.rulesetHash), Buffer.from(ctx.c.encodeRulesetArgs(ctx.ruleset.args))]);
  await ctx.c.validateRulesetAccount({ address: rulesetAddress, info: { owner: ctx.c.coreProgram, executable: false, data: ruleData }, economy: ctx.economy, expectedHash: ctx.ruleset.rulesetHash });
  const badRules = Buffer.from(ruleData); badRules[badRules.length - 1] ^= 1;
  await assert.rejects(() => ctx.c.validateRulesetAccount({ address: rulesetAddress, info: { owner: ctx.c.coreProgram, executable: false, data: badRules }, economy: ctx.economy, expectedHash: ctx.ruleset.rulesetHash }), /hash/i);
  const corrupt = Buffer.from(data); corrupt[corrupt.length - 1] ^= 1;
  await assert.rejects(() => ctx.c.validateEconomyAccount({ address, info: { owner: ctx.c.coreProgram, executable: false, data: corrupt }, expectedHash: ctx.economy.economyHash }), /hash/i);
  await assert.rejects(() => ctx.c.validateEconomyAccount({ address, info: { owner: ctx.c.timepinProgram, executable: false, data }, expectedHash: ctx.economy.economyHash }), /owner/);
});
await check('changed approval, generation, cutover, payer, migration or private-state binding refuses locally', async () => {
  for (const mutate of [m => { m.economy.minStake = '101'; }, m => { m.evidenceSpecTemplate.challengeWindowSeconds = 60; }, m => { m.feeds.pop(); }, m => { m.feeds[0].maxPostTargetLagSeconds = 300; }]) {
    const m = structuredClone(manifest); mutate(m); await assert.rejects(() => buildContext({ manifest: m, manifestSha256, state, generation, clock }));
  }
  for (const mutate of [s => { s.payer = key(5).toBase58(); }, s => { s.cutoverSlot = '1001'; }, s => { s.migrationId = '01'.repeat(32); }, s => { s.manifestSha256 = 'bad'; }, s => { s.generation.receiverProgramdataSlot = '899'; }, s => { s.testCredits = '0'; }]) {
    const s = structuredClone(state); mutate(s); await assert.rejects(() => buildContext({ manifest, manifestSha256, state: s, generation, clock }));
  }
});
await check('private commitment matches the independent Core serializer and changes with the salt', () => {
  const args = { programId: new web3.PublicKey(PROGRAMS.core).toBuffer(), economyHash: Buffer.from(ctx.economy.economyHash), rulesetHash: Buffer.from(ctx.ruleset.rulesetHash),
    player: new web3.PublicKey(PAYER).toBuffer(), nonce: 0n, side: state.side, probability: state.probability, salt: Buffer.from(state.salt, 'hex') };
  assert.deepEqual(Buffer.from(ctx.commit), modelCommitmentHash(args));
  const otherSalt = Buffer.from(args.salt); otherSalt[0] ^= 1;
  assert.notDeepEqual(Buffer.from(ctx.commit), modelCommitmentHash({ ...args, salt: otherSalt }));
});
await check('timing is exactly the first eligible grid target, including boundary changes', () => {
  for (let t = 1800000000n; t < 1800000601n; t++) {
    const timing = timingFor(ctx, { nowTs: t });
    assert.equal(timing.entryTargetTs, ((t + 60n + 299n) / 300n) * 300n);
    assert.equal(timing.exitTargetTs, timing.entryTargetTs + 300n);
    assert.equal(timing.captureDeadlineTs, timing.exitTargetTs + 1199n);
    assert.equal(timing.scoreDay, (timing.captureDeadlineTs + 3600n) / 86400n);
  }
});
await check('Clock comes from exact sysvar bytes, not host wall time', async () => {
  const data = Buffer.alloc(40); data.writeBigUInt64LE(1000n); data.writeBigInt64LE(clock.nowTs, 32);
  const out = await readClock({ getAccountInfo: async address => { assert.equal(address.toBase58(), web3.SYSVAR_CLOCK_PUBKEY.toBase58()); return { data, owner: new web3.PublicKey('Sysvar1111111111111111111111111111111111111'), executable: false }; } });
  assert.deepEqual(out, clock);
  await assert.rejects(() => readClock({ getAccountInfo: async () => ({ data: Buffer.alloc(39) }) }), /Clock/);
});
await check('actual Node CLI refuses missing inputs before network and import remains quiet', () => {
  const wrapper = fileURLToPath(new URL('../tools/g2-devnet-bootstrap.mjs', import.meta.url));
  const guard = 'data:text/javascript,' + encodeURIComponent('globalThis.fetch = () => { console.error("UNEXPECTED_NETWORK"); process.exit(91); };');
  const run = args => spawnSync(process.execPath, ['--import', guard, ...args], { encoding: 'utf8', windowsHide: true, timeout: 30000, env: { ...process.env, NODE_OPTIONS: '' } });
  const noRpc = run([wrapper]); assert.equal(noRpc.status, 1); assert.match(noRpc.stderr, /--rpc is required/); assert.ok(!noRpc.stderr.includes('UNEXPECTED_NETWORK'));
  const noKey = run([wrapper, '--rpc', 'http://127.0.0.1:1', '--send']); assert.equal(noKey.status, 1); assert.match(noKey.stderr, /--keypair/); assert.ok(!noKey.stderr.includes('UNEXPECTED_NETWORK'));
  const quiet = run(['--input-type=module', '-e', 'await import(' + JSON.stringify(pathToFileURL(wrapper).href) + ')']); assert.equal(quiet.status, 0); assert.equal(quiet.stdout, ''); assert.equal(quiet.stderr, '');
  assert.equal(parseArgs(['--rpc', 'http://127.0.0.1:1']).send, false);
  assert.equal(parseArgs(['--rpc', 'http://127.0.0.1:1', '--prepare-only']).prepareOnly, true);
  assert.throws(() => parseArgs(['--rpc', 'http://127.0.0.1:1', '--mainnet']), /unknown/);
});
console.log('PASS: devnet bootstrap host/CLI proof (' + checks + ' checks; no transactions executed)');
