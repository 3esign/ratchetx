import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, webcrypto } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import * as web3 from '@solana/web3.js';
import { createCoreG2Client } from '../lib/g2/client-v2.mjs';
import { createPlayerActions } from '../lib/g2/player-actions.mjs';
import {
  RCX_MINT, TOKEN_2022_PROGRAM, RCX_DECIMALS, RCX_RAW_UNITS_PER_CREDIT,
  makeEconomyAccount, makeRulesetAccount, legacyLeafHash, verifyLegacyProof,
} from '../onchain/ratchet-core-g2/model.mjs';

const root = new URL('../', import.meta.url);
const lib = readFileSync(new URL('onchain/ratchet-core-g2/programs/ratchet-core-g2/src/lib.rs', root), 'utf8');
const state = readFileSync(new URL('onchain/ratchet-core-g2/programs/ratchet-core-g2/src/state.rs', root), 'utf8');
const hash = (...parts) => createHash('sha256').update(Buffer.concat(parts.map(p => Buffer.from(p)))).digest();
const key = label => new web3.PublicKey(hash(label));
const core = new web3.PublicKey('ANVGVtDrECeyQkS56UZ9ZiWCUxk2JWEVNJioFW8JEwbL');
const timepin = new web3.PublicKey('C8wwxUGmoKAV22MaY3oW2Q6QeDbmB9dbNdbohsRjJkYp');
const client = createCoreG2Client({ web3, coreProgramId: core, timepinProgramId: timepin, cryptoImpl: webcrypto });
const actions = createPlayerActions({ client, web3 });
const le = (n, type = 'u64') => {
  const b = Buffer.alloc({ u8: 1, u16: 2, u32: 4, u64: 8, i64: 8, i32: 4 }[type]);
  ({ u8: () => b.writeUInt8(Number(n)), u16: () => b.writeUInt16LE(Number(n)),
    u32: () => b.writeUInt32LE(Number(n)), u64: () => b.writeBigUInt64LE(BigInt(n)),
    i64: () => b.writeBigInt64LE(BigInt(n)), i32: () => b.writeInt32LE(Number(n)) })[type]();
  return b;
};
const disc = name => hash('global:' + name).subarray(0, 8);
const player = key('player'), refund = key('immutable rent refund');
const claim = { credits: 2500n, xp: 17n, proof: [] };
const migration = { programId: core.toBuffer(), clusterGenesisHash: hash('devnet genesis'),
  migrationId: hash('migration'), snapshotHash: hash('snapshot'), cutoverSlot: 100n,
  player: player.toBuffer(), credits: claim.credits, xp: claim.xp };
const leaf = legacyLeafHash(migration);
const economySpec = {
  schema: 2, timepinProgram: timepin.toBuffer(), timepinSchema: 2,
  clusterGenesisHash: migration.clusterGenesisHash, migrationId: migration.migrationId,
  legacyRoot: leaf, legacySnapshotHash: migration.snapshotHash, legacyCutoverSlot: migration.cutoverSlot,
  legacyLeafCount: 1, legacyTotalCredits: claim.credits, legacyTotalXp: claim.xp,
  rulesetPolicyRoot: hash('policy root'), rulesetPolicyCount: 1, rcxMint: RCX_MINT,
  rcxTokenProgram: TOKEN_2022_PROGRAM, rcxDecimals: RCX_DECIMALS,
  rawUnitsPerCredit: RCX_RAW_UNITS_PER_CREDIT, burnPerMille: 700, podiumPerMille: 300,
  podiumCurve: [500, 300, 200], rankShardCount: 16, daySeconds: 86_400,
  hitPayoutNumerator: 2n, hitPayoutDenominator: 1n, settleXp: 10n,
  minStake: 1n, maxStake: 100n, maxOpen: 64, cleanupBondLamports: 100_000n,
  revealWindowSeconds: 60, maxHorizonSeconds: 7_200,
};
const economyAccount = makeEconomyAccount(core.toBuffer(), economySpec);
const info = account => ({ owner: new web3.PublicKey(account.owner), executable: false, data: Buffer.from(account.data) });
const economy = await client.validateEconomyAccount({ address: economyAccount.key, info: info(economyAccount) });
const rulesetSpec = {
  schema: 2, economyHash: economy.economyHash, evidenceSpecHash: hash('spec'),
  evidencePolicyHash: hash('evidence policy'), feedId: hash('feed'), entryMode: 2,
  horizonSeconds: 600, targetGridSeconds: 60, minOpenLeadSeconds: 30,
  maxEntryAgeSeconds: 0, bandNumerator: 2, bandDenominator: 1, baseXp: 20n,
};
const rulesetAccount = makeRulesetAccount(core.toBuffer(), rulesetSpec, economySpec);
const ruleset = await client.validateRulesetAccount({ address: rulesetAccount.key, info: info(rulesetAccount), economy });
const secret = { side: 1, pBps: 6789, salt: new Uint8Array(hash('saved wallet secret')) };
const nonce = 17n, scoreDay = 21_000n;
const pda = (...seeds) => web3.PublicKey.findProgramAddressSync(seeds.map(s => Buffer.from(s)), core)[0];
const [shotAddress, shotBump] = client.shotPda(economy.economyHash, player, nonce);
const rank = hash('rcx-core:rank-shard-for:g2\0', player.toBuffer())[0] % 16;
const savedCommit = hash('rcx-core:commitment:g2\0', core.toBuffer(), economy.economyHash,
  ruleset.rulesetHash, player.toBuffer(), le(nonce), le(secret.side, 'u8'), le(secret.pBps, 'u16'), secret.salt);
// Build the Shot account from CURRENT Rust field order, then use the PUBLIC
// browser validator. The adapter receives exactly the objects the UI receives.
const shotBody = /pub struct Shot \{([\s\S]*?)^\}/m.exec(state)[1];
const shotFields = [...shotBody.matchAll(/pub\s+(\w+)\s*:\s*([^,\n]+),/g)]
  .map(([, name, type]) => [name, type.replace(/\s/g, '')]);
const shotValues = { schema: 2, bump: shotBump, economy_hash: economy.economyHash,
  ruleset_hash: ruleset.rulesetHash, player: player.toBuffer(), rent_refund: refund.toBuffer(),
  nonce, commit: savedCommit, state: 3, score_day: scoreDay, rank_shard: rank };
const shotData = Buffer.concat([hash('account:Shot').subarray(0, 8), ...shotFields.map(([name, type]) => {
  if (type === 'Pubkey' || type === '[u8;32]') return Buffer.from(shotValues[name] ?? Buffer.alloc(32));
  return le(shotValues[name] ?? 0, type);
})]);
const shot = client.validateShotAccount({ address: shotAddress,
  info: { owner: core, executable: false, data: shotData }, economy, ruleset, player, nonce });
const reveal = { economy, ruleset, shotAddress, shot, ...secret };

function rustAccounts(name) {
  const body = new RegExp('pub struct ' + name + "<'info> \\{([\\s\\S]*?)^\\}", 'm').exec(lib)[1];
  let previous = 0;
  return [...body.matchAll(/pub\s+(\w+):\s*([^\n]+),/g)].map(match => {
    const attributes = body.slice(previous, match.index); previous = match.index + match[0].length;
    return { name: match[1], signer: /\bSigner</.test(match[2]),
      writable: /\b(mut|init|init_if_needed)\b/.test(attributes) };
  });
}
function assertAccounts(ix, context, addresses) {
  const expected = rustAccounts(context);
  assert.deepEqual(ix.keys.map(meta => ({ signer: meta.isSigner, writable: meta.isWritable })),
    expected.map(({ signer, writable }) => ({ signer, writable })));
  assert.deepEqual(ix.keys.map(meta => meta.pubkey.toBase58()),
    expected.map(meta => addresses[meta.name].toBase58()));
  assert.ok(ix.programId.equals(core));
}
const common = {
  economy: pda('economy', le(2, 'u16'), economy.economyHash),
  ruleset: pda('ruleset', le(2, 'u16'), ruleset.rulesetHash),
  ledger: pda('ledger', economy.economyHash, player.toBuffer()), player,
  system_program: web3.SystemProgram.programId,
};

test('adapters follow current Rust args and fixed source limits', () => {
  assert.match(lib, /pub fn claim_legacy\(\s*ctx: Context<ClaimLegacy>,\s*credits: u64,\s*xp: u64,\s*proof: Vec<\[u8; 32\]>,/);
  assert.match(lib, /pub fn reveal\(ctx: Context<RevealShot>, side: u8, p_bps: u16, salt: \[u8; 32\]\)/);
  assert.match(state, /pub const MAX_MERKLE_PROOF: usize = 32;/);
  assert.match(state, /pub const HISTORY_PAGE_CAP: usize = 16;/);
  assert.match(state, /AwaitReveal = 3,/);
  assert.match(state, /require!\(\(1\.\.10_000\)\.contains\(&p_bps\)/);
});

test('one-leaf legacy claim accepts empty proof with exact bytes and Rust accountmeta', () => {
  assert.equal(verifyLegacyProof(leaf, [], economy.args.legacyRoot), true);
  const ix = actions.claimLegacyIx({ economy, player, ...claim });
  assert.equal(typeof ix.then, 'undefined', 'claim builder is synchronous');
  assert.deepEqual(Buffer.from(ix.data), Buffer.concat([disc('claim_legacy'), le(2500n), le(17n), le(0, 'u32')]));
  assert.equal(ix.data.length, 28);
  assertAccounts(ix, 'ClaimLegacy', common);
});

test('devnet playground claim is argument-free, synchronous and uses the ClaimLegacy account shape', () => {
  const ix = actions.claimDevnetCreditsIx({ economy, player });
  assert.equal(typeof ix.then, 'undefined', 'claim builder is synchronous');
  assert.deepEqual(Buffer.from(ix.data), disc('claim_devnet_credits'));
  assert.equal(ix.data.length, 8);
  assertAccounts(ix, 'ClaimDevnetCredits', common);
  assert.throws(() => actions.claimDevnetCreditsIx({ economy, player: 'not-a-key' }));
});

test('legacy proof vector serializes u32 count followed by all exact siblings', () => {
  const proof = [new Uint8Array(hash('sibling one')), new Uint8Array(hash('sibling two'))];
  const ix = actions.claimLegacyIx({ economy, player, ...claim, proof });
  assert.deepEqual(Buffer.from(ix.data), Buffer.concat([
    disc('claim_legacy'), le(claim.credits), le(claim.xp), le(2, 'u32'), ...proof.map(Buffer.from),
  ]));
});

test('claim rejects invalid widths/types, disabled snapshot and identity drift', () => {
  for (const delta of [{ credits: '2500' }, { xp: Number.MAX_SAFE_INTEGER + 1 },
    { credits: 1n << 64n }, { credits: 0n, xp: 0n }, { proof: Array(33).fill(new Uint8Array(32)) },
    { proof: [new Uint8Array(31)] }, { proof: new Array(1) },
    { economy: { ...economy, bump: (economy.bump + 1) % 256 } },
    { economy: { ...economy, args: { ...economy.args, legacyRoot: new Uint8Array(32) } } },
    { economy: { ...economy, args: { ...economy.args, timepinProgram: player } } }])
    assert.throws(() => actions.claimLegacyIx({ economy, player, ...claim, ...delta }));
});

test('known saved reveal secret produces exact payload and all Rust accountmeta', async () => {
  const ix = await actions.revealIx(reveal);
  assert.deepEqual(Buffer.from(ix.data), Buffer.concat([disc('reveal'), le(secret.side, 'u8'),
    le(secret.pBps, 'u16'), Buffer.from(secret.salt)]));
  assert.equal(ix.data.length, 43);
  assertAccounts(ix, 'RevealShot', {
    ...common, shot: pda('shot', economy.economyHash, player.toBuffer(), le(nonce)),
    player_day: pda('player_day', economy.economyHash, le(scoreDay, 'i64'), player.toBuffer()),
    rank_shard: pda('rank_shard', economy.economyHash, le(scoreDay, 'i64'), le(rank, 'u8')),
    history_page: pda('history_page', economy.economyHash, player.toBuffer(), le(1n)),
    work_page: pda('work_page', economy.economyHash, player.toBuffer(), le(1n)), rent_refund: refund,
  });
});

test('wrong secret, unknown numerics, links or PDA fail before any instruction builds', async () => {
  let builds = 0;
  const guarded = createPlayerActions({ client: { ...client, buildIx(...args) { builds++; return client.buildIx(...args); } }, web3 });
  for (const delta of [{ salt: new Uint8Array(hash('wrong secret')) }, { side: 0 }, { side: '1' },
    { pBps: 0 }, { pBps: 10_000 }, { shotAddress: player },
    { shot: { ...shot, state: 255 } }, { shot: { ...shot, state: 3n } },
    { shot: { ...shot, nonce: '17' } }, { shot: { ...shot, scoreDay: 0.5 } },
    { shot: { ...shot, bump: (shot.bump + 1) % 256 } },
    { shot: { ...shot, rankShard: (rank + 1) % 16 } },
    { shot: { ...shot, economyHash: new Uint8Array(hash('other economy')) } },
    { ruleset: { ...ruleset, args: { ...ruleset.args, economyHash: new Uint8Array(32) } } }]) {
    await assert.rejects(() => guarded.revealIx({ ...reveal, ...delta }));
    assert.equal(builds, 0);
  }
});

test('adapters run without Node globals and expose no signing/sending method', async () => {
  const source = readFileSync(new URL('lib/g2/player-actions.mjs', root), 'utf8');
  const make = runInNewContext(source.replace(/^export /gm, '') + '\ncreatePlayerActions',
    { TextEncoder, Uint8Array, DataView });
  const browser = make({ client, web3 });
  assert.deepEqual(Object.keys(browser), ['claimLegacyIx', 'claimDevnetCreditsIx', 'revealIx']);
  assert.equal(browser.claimLegacyIx({ economy, player, ...claim }).data.length, 28);
  assert.equal((await browser.revealIx(reveal)).data.length, 43);
});
