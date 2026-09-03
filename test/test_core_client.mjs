// The Core v1 JS client against the program's own vectors: every instruction
// encoding, every PDA, every account parser and the crank's plan — offline.
import assert from 'node:assert';
import fs from 'node:fs';
import { test } from 'node:test';
import { PublicKey } from '@solana/web3.js';
import * as C from '../onchain/ratchet-core/client/core.mjs';
import { DEVNET_NOTICE, inspectionJson } from '../onchain/ratchet-core/client/inspect.mjs';

const V = JSON.parse(fs.readFileSync(new URL('../onchain/ratchet-core/vectors/core-rules-v2.json', import.meta.url), 'utf8'));
const W = new PublicKey(V.pdas.wallet), D = new PublicKey(V.pdas.delegate);
const SALT = V.commit.salt;
const hex = ix => Buffer.from(ix.data).toString('hex');
const keys = ix => ix.keys.map(k => [k.pubkey.toBase58(), k.isSigner, k.isWritable]);

test('feed table and push accounts are the program\'s', () => {
  assert.equal(C.FEEDS.length, 7);
  for (const f of V.feeds) {
    assert.equal(C.FEEDS[f.index].feedId, f.feedId, `feed ${f.index}`);
    assert.equal(C.pushAccount(f.index).toBase58(), f.pushAccount, `push ${f.index}`);
  }
  assert.equal(C.PROGRAM_ID.toBase58(), V.program);
});

test('RCX paths are explicitly Token-2022, never classic SPL Token', () => {
  assert.equal(C.TOKEN_PROGRAM.toBase58(), 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
  assert.notEqual(C.TOKEN_PROGRAM.toBase58(), 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
  const reload = C.reloadIx({ player: W, amount: 1_000_000 });
  assert.equal(reload.keys[5].pubkey.toBase58(), C.TOKEN_PROGRAM.toBase58());
});

test('PDAs match the program', () => {
  assert.equal(C.ledgerPda(W).toBase58(), V.pdas.ledger);
  assert.equal(C.shotPda(W, 42).toBase58(), V.pdas.shot42);
  assert.equal(C.clockPda(3).toBase58(), V.pdas.clock3);
  assert.equal(C.podiumPda().toBase58(), V.pdas.podium);
  assert.equal(C.grantPda(W, D).toBase58(), V.pdas.grant);
  assert.equal(C.claimPda(W).toBase58(), V.pdas.claim);
});

test('account discriminators and sizes match', () => {
  for (const [name, a] of Object.entries(V.accounts)) {
    assert.equal(C.accountDiscriminator(name).toString('hex'), a.discriminator, name);
    assert.equal(C.ACCOUNT_SIZE[name], a.size, name);
  }
});

test('every instruction encodes byte for byte like anchor', () => {
  const shot = C.shotPda(W, 42);
  assert.equal(hex(C.reloadIx({ player: W, amount: 1_500_000 })), V.ix.reload);
  assert.equal(hex(C.sealIx({ player: W, nonce: 42, commit: '07'.repeat(32), feedIndex: 0, minutes: 5, stake: 500 })), V.ix.seal);
  assert.equal(hex(C.sealDelegatedIx({ delegate: D, player: W, nonce: 42, commit: Buffer.alloc(32, 7), feedIndex: 6, minutes: 1440, stake: 1_000_000_000n })), V.ix.seal_delegated);
  assert.equal(hex(C.checkpointIx({ cranker: D, feedIndex: 3 })), V.ix.checkpoint);
  assert.equal(hex(C.settleIx({ cranker: D, shot, player: W, feedIndex: 0 })), V.ix.settle);
  assert.equal(hex(C.revealIx({ revealer: D, shot, player: W, side: 'YES', pBps: 6500, salt: SALT })), V.ix.reveal);
  assert.equal(hex(C.forfeitIx({ cranker: D, shot, player: W })), V.ix.forfeit);
  assert.equal(hex(C.voidShotIx({ cranker: D, shot, player: W })), V.ix.void_shot);
  assert.equal(hex(C.closeShotIx({ cranker: D, shot, player: W })), V.ix.close_shot);
  assert.equal(hex(C.grantDelegateIx({ player: W, delegate: D, allowance: 10_000, maxStake: 500, expiryTs: 1_800_000_000 })), V.ix.grant_delegate);
  assert.equal(hex(C.revokeDelegateIx({ player: W, delegate: D })), V.ix.revoke_delegate);
  assert.equal(hex(C.claimLegacyIx({ player: W, credits: 5000, xp: 321, proof: ['01'.repeat(32), Buffer.alloc(32, 2)] })), V.ix.claim_legacy);
});

test('account metas follow the program\'s struct order and mutability', () => {
  const shot = C.shotPda(W, 42);
  assert.deepEqual(keys(C.sealIx({ player: W, nonce: 42, commit: '07'.repeat(32), feedIndex: 0, minutes: 5, stake: 500 })), [
    [shot.toBase58(), false, true], [V.pdas.ledger, false, true], [W.toBase58(), true, true], [V.feeds[0].pushAccount, false, false], ['11111111111111111111111111111111', false, false]]);
  assert.deepEqual(keys(C.settleIx({ cranker: D, shot, player: W, feedIndex: 3 })), [
    [shot.toBase58(), false, true], [V.pdas.ledger, false, true], [V.pdas.clock3, false, false], [D.toBase58(), true, false]]);
  assert.deepEqual(keys(C.closeShotIx({ cranker: D, shot, player: W })), [[shot.toBase58(), false, true], [W.toBase58(), false, true], [D.toBase58(), true, false]]);
  const reload = C.reloadIx({ player: W, amount: 1, seats: [D] });
  assert.equal(reload.keys.length, 8);
  assert.deepEqual(reload.keys[3], { pubkey: C.RCX_MINT, isSigner: false, isWritable: true }, 'the mint is writable: burn changes supply');
  assert.equal(reload.keys[7].pubkey.toBase58(), C.ata(D).toBase58());
  assert.equal(C.ata(W).toBase58(), PublicKey.findProgramAddressSync([W.toBuffer(), C.TOKEN_PROGRAM.toBuffer(), C.RCX_MINT.toBuffer()], C.ATA_PROGRAM)[0].toBase58());
});

test('the v3 commit is the program\'s', () => {
  const c = V.commit;
  assert.equal(C.commitPreimage({ wallet: c.wallet, nonce: c.nonce, side: c.side, pBps: c.pBps, salt: c.salt }), c.preimage);
  assert.equal(C.commitHash({ wallet: c.wallet, nonce: 42n, side: 1, pBps: 6500, salt: c.salt }).toString('hex'), c.sha256);
  assert.throws(() => C.commitPreimage({ wallet: c.wallet, nonce: 1, side: 'UP', salt: c.salt }), /side/);
  assert.throws(() => C.commitPreimage({ wallet: c.wallet, nonce: 1, side: 'YES', salt: 'ABCD' }), /salt/);
});

test('parsers read what the program serialized', () => {
  const s = C.parseShot(Buffer.from(V.samples.Shot, 'hex'));
  assert.equal(s.player.toBase58(), V.pdas.wallet); assert.equal(s.delegate.toBase58(), V.pdas.delegate);
  assert.deepEqual([s.nonce, s.feedIndex, s.minutes, s.stake, s.xpBase, s.xpAwarded], [42n, 3, 30, 2500n, 70n, 81n]);
  assert.deepEqual([s.sealedTs, s.expiryTs, s.settledTs, s.entryE12, s.exitE12, s.exitPublishTime], [1800000000n, 1800001800n, 1800001805n, 123456789012345n, 123456789999999n, 1800001803n]);
  assert.deepEqual([s.pBps, s.side, s.hit, s.state, s.voidReason], [6500, 1, 1, 3, 0]);
  // Ruleset 2: a settled shot carries the numbers its own settlement used, so
  // the client can recheck the verdict from the shot alone -- no ring, no RPC
  // archive, no trust in whoever happened to crank it.
  assert.deepEqual([s.exitConfE12, s.exitPrevPublishTime, s.exitPostedSlot], [61728394n, 1800001700n, 300000250n]);
  assert.deepEqual([s.ruleset, s.bandKBps, s.crossingBound], [V.ruleset, V.bandKBps, 1]);
  assert.equal(s.commit, '07'.repeat(32)); assert.equal(s.feedId, V.feeds[3].feedId);
  const l = C.parseLedger(Buffer.from(V.samples.PlayerLedger, 'hex'));
  assert.deepEqual([l.credits, l.xp, l.streak, l.best, l.hits, l.shots, l.voids, l.forfeits, l.sealed, l.open, l.day, l.dailyXp, l.burned, l.reloaded, l.bump],
    [9350n, 24n, 0, 1, 1n, 2n, 1n, 0n, 3n, 1, 20833n, 24n, 700000n, 1000000n, 254]);
  const p = C.parsePodium(Buffer.from(V.samples.Podium, 'hex'));
  assert.equal(p.day, 20833n); assert.equal(p.seats.length, 2, 'the empty seat is dropped');
  assert.equal(p.seats[1].player.toBase58(), V.pdas.delegate); assert.equal(p.seats[1].dailyXp, 7n);
  const k = C.parseClock(Buffer.from(V.samples.FeedClock, 'hex'));
  assert.equal(k.feedId, V.feeds[3].feedId); assert.equal(k.latestPublishTime, 1800001803n); assert.equal(k.observations.length, 2);
  assert.deepEqual(k.observations[1], { prevPublishTime: 1800001700n, publishTime: 1800001803n, priceE12: 123456789999999n, confE12: 61728394n, postedSlot: 300000250n });
  const g = C.parseGrant(Buffer.from(V.samples.DelegateGrant, 'hex'));
  assert.deepEqual([g.allowance, g.maxStake, g.used, g.shots, g.expiryTs, g.bump], [10000n, 500n, 1000n, 2n, 1800000000n, 252]);
  assert.throws(() => C.parseShot(Buffer.from(V.samples.PlayerLedger, 'hex')), /not a Shot/);
  // The crossing rule, on the sample clock: expiry 1800001800 -> the 1803 observation.
  assert.equal(C.crossing(k, 1800001800).publishTime, 1800001803n);
  assert.equal(C.crossing(k, 1800001900), null);
  assert.equal(C.crossing(k, 1800001700), null, 'the first observation ever has no predecessor: never a crossing');
});

test('parsePriceUpdate reads a Full and a Partial PriceUpdateV2', () => {
  const build = full => {
    const b = Buffer.alloc(8 + 32 + (full ? 1 : 2) + 32 + 8 + 8 + 4 + 8 + 8 + 8 + 8 + 8);
    let o = 8 + 32; b.writeUInt8(full ? 1 : 0, o++); if (!full) b.writeUInt8(5, o++);
    Buffer.from(V.feeds[0].feedId, 'hex').copy(b, o); o += 32;
    b.writeBigInt64LE(21012345678n, o); o += 8; b.writeBigUInt64LE(9876n, o); o += 8; b.writeInt32LE(-8, o); o += 4;
    b.writeBigInt64LE(1800000010n, o); o += 8; b.writeBigInt64LE(1800000009n, o); o += 8; o += 16; b.writeBigUInt64LE(300000000n, o);
    return b;
  };
  const f = C.parsePriceUpdate(build(true));
  assert.deepEqual([f.full, f.feedId, f.price, f.conf, f.exponent, f.publishTime, f.prevPublishTime, f.postedSlot], [true, V.feeds[0].feedId, 21012345678n, 9876n, -8, 1800000010n, 1800000009n, 300000000n]);
  const p = C.parsePriceUpdate(build(false));
  assert.equal(p.full, false); assert.equal(p.publishTime, 1800000010n, 'the Partial variant carries one extra byte before the message');
});

test('the crank plans exactly the program\'s permissionless moves', () => {
  const shotPk = C.shotPda(W, 1);
  const mk = (state, expiryTs, feedIndex = 0, crossingBound = 0) => ({ pubkey: shotPk, player: W, feedIndex, state, expiryTs: BigInt(expiryTs), crossingBound });
  const clock = obs => ({ latestPublishTime: obs.length ? obs[obs.length - 1].publishTime : 0n, observations: obs });
  const push = (publishTime, full = true) => ({ full, publishTime: BigInt(publishTime) });
  const plan = (shots, clocks, pushes, now, close) => C.planActions({ shots, clocks: new Map(Object.entries(clocks).map(([k, v]) => [Number(k), v])), pushes: new Map(Object.entries(pushes).map(([k, v]) => [Number(k), v])), now, close }).map(a => a.kind);
  // Open, far from expiry, clock warm: nothing. Clock stale and Pyth newer: one warming checkpoint per feed.
  assert.deepEqual(plan([mk(1, 2000)], { 0: clock([{ prevPublishTime: 1500n, publishTime: 1600n }]) }, { 0: push(1650) }, 1700), []);
  assert.deepEqual(plan([mk(1, 2000), mk(1, 2100)], { 0: null }, { 0: push(1650) }, 1700), ['checkpoint']);
  assert.deepEqual(plan([mk(1, 2000)], { 0: clock([{ prevPublishTime: 900n, publishTime: 1000n }]) }, { 0: push(1650, false) }, 1700), [], 'a partially verified update is never captured');
  // Expired: crossing already in the clock -> settle; Pyth has a post-expiry update -> checkpoint+settle; not yet -> wait.
  assert.deepEqual(plan([mk(1, 2000)], { 0: clock([{ prevPublishTime: 1990n, publishTime: 2003n }]) }, { 0: push(2010) }, 2020), ['settle']);
  assert.deepEqual(plan([mk(1, 2000)], { 0: clock([{ prevPublishTime: 1900n, publishTime: 1990n }]) }, { 0: push(2003) }, 2005), ['checkpoint+settle']);
  assert.deepEqual(plan([mk(1, 2000)], { 0: clock([{ prevPublishTime: 1900n, publishTime: 1990n }]) }, { 0: push(1990) }, 2005), []);
  // Past the settlement window -> void; settled and unrevealed for an hour -> forfeit; final -> close only when asked.
  assert.deepEqual(plan([mk(1, 2000)], { 0: null }, { 0: push(1990) }, 2119), [], 'inside the two-minute window with no post-expiry update yet: wait');
  assert.deepEqual(plan([mk(1, 2000)], { 0: null }, { 0: push(2150) }, 2120), ['void']);
  // Ruleset 2: a shot whose crossing was bound in time settles however late the
  // cranker is, with no clock read at all. The deadline was for capturing the
  // print, and it was captured. Planning `void` here would burn a real answer.
  assert.deepEqual(plan([mk(1, 2000, 0, 1)], { 0: null }, {}, 2120), ['settle'], 'a bound shot never voids on the settle deadline');
  assert.deepEqual(plan([mk(1, 2000, 0, 1)], { 0: null }, {}, 99999), ['settle']);
  assert.deepEqual(plan([mk(1, 2000, 0, 1)], { 0: null }, {}, 1999), [], 'and it still waits for its own expiry');
  // The instruction exists for anyone who wants to freeze an answer without
  // settling it, even though the runner never needs to plan it separately.
  {
    const [bind] = C.instructionsFor({ kind: 'bind', shot: shotPk, feedIndex: 3 }, D);
    assert.equal(bind.keys.length, 3, 'shot, clock, cranker -- no ledger, nothing else');
    assert.ok(bind.keys[0].pubkey.equals(shotPk) && bind.keys[0].isWritable && !bind.keys[0].isSigner);
    assert.ok(bind.keys[1].pubkey.equals(C.clockPda(3)) && !bind.keys[1].isWritable);
    assert.ok(bind.keys[2].pubkey.equals(D) && bind.keys[2].isSigner && !bind.keys[2].isWritable);
    assert.equal(bind.data.toString('hex'), V.ix.bind_crossing);
  }
  assert.deepEqual(plan([mk(2, 2000)], {}, {}, 5599), []);
  assert.deepEqual(plan([mk(2, 2000)], {}, {}, 5600), ['forfeit']);
  assert.deepEqual(plan([mk(3, 2000), mk(4, 2000), mk(5, 2000)], {}, {}, 9000), []);
  assert.deepEqual(plan([mk(3, 2000), mk(4, 2000), mk(5, 2000)], {}, {}, 9000, true), ['close', 'close', 'close']);
  // Instructions for each action are the program's, with the cranker as the only signer.
  for (const a of C.planActions({ shots: [mk(1, 2000)], clocks: new Map([[0, clock([{ prevPublishTime: 1900n, publishTime: 1990n }])]]), pushes: new Map([[0, push(2003)]]), now: 2005 })) {
    const ixs = C.instructionsFor(a, D);
    assert.equal(ixs.length, 2);
    assert.ok(ixs.every(i => i.keys.filter(k => k.isSigner).every(k => k.pubkey.equals(D))));
  }
});

test('chain-only reads reject spoofed Core accounts and return context slots', async () => {
  const shotData = Buffer.from(V.samples.Shot, 'hex');
  const shotAddress = C.shotPda(W, 42);
  const account = (data, overrides = {}) => ({
    data, owner: C.PROGRAM_ID, executable: false, lamports: 1, rentEpoch: 0, ...overrides,
  });
  let filters;
  const connection = {
    async getProgramAccounts(program, config) {
      assert.ok(program.equals(C.PROGRAM_ID));
      filters = config.filters;
      assert.equal(config.commitment, 'finalized');
      assert.equal(config.withContext, true);
      return { context: { slot: 800 }, value: [{ pubkey: shotAddress, account: account(shotData) }] };
    },
  };
  const read = await C.readPlayerShots(connection, W);
  assert.equal(read.contextSlot, 800);
  assert.equal(read.shots.length, 1);
  assert.equal(read.shots[0].nonce, 42n);
  assert.deepEqual(filters, [
    { dataSize: C.ACCOUNT_SIZE.Shot },
    { memcmp: { offset: 0, bytes: filters[1].memcmp.bytes } },
    { memcmp: { offset: 8, bytes: W.toBase58() } },
  ]);

  assert.throws(() => C.assertCoreAccount(shotAddress, account(shotData, { owner: D }), 'Shot'), /wrong owner/);
  assert.throws(() => C.assertCoreAccount(shotAddress, account(shotData.subarray(0, -1)), 'Shot'),
    new RegExp(`expected ${C.ACCOUNT_SIZE.Shot}`), 'the size check must follow the layout, not a number typed once');
  const wrongPdaConnection = {
    async getProgramAccounts() {
      return { context: { slot: 801 }, value: [{ pubkey: C.shotPda(W, 43), account: account(shotData) }] };
    },
  };
  await assert.rejects(() => C.readPlayerShots(wrongPdaConnection, W), /not its canonical PDA/);
});

test('deployment inspection validates the loader graph and serializes BigInts as decimal strings', async () => {
  const [programDataAddress] = PublicKey.findProgramAddressSync([C.PROGRAM_ID.toBuffer()], C.UPGRADEABLE_LOADER);
  const programData = Buffer.alloc(36);
  programData.writeUInt32LE(2, 0);
  programDataAddress.toBuffer().copy(programData, 4);
  const deployed = Buffer.alloc(64);
  deployed.writeUInt32LE(3, 0);
  deployed.writeBigUInt64LE(491787400n, 4);
  deployed.writeUInt8(1, 12);
  D.toBuffer().copy(deployed, 13);
  const connection = {
    async getMultipleAccountsInfoAndContext(addresses, commitment) {
      assert.equal(commitment, 'finalized');
      assert.ok(addresses[0].equals(C.PROGRAM_ID));
      assert.ok(addresses[1].equals(programDataAddress));
      return {
        context: { slot: 900 },
        value: [
          { data: programData, owner: C.UPGRADEABLE_LOADER, executable: true },
          { data: deployed, owner: C.UPGRADEABLE_LOADER, executable: false },
        ],
      };
    },
  };
  const result = await C.readProgramDeployment(connection);
  assert.equal(result.contextSlot, 900);
  assert.equal(result.executable, true);
  assert.equal(result.programData.toBase58(), programDataAddress.toBase58());
  assert.equal(result.deployedSlot, 491787400n);
  assert.equal(result.upgradeAuthority.toBase58(), D.toBase58());
  assert.equal(result.immutable, false);

  deployed.writeUInt8(0, 12);
  assert.equal(C.parseUpgradeableProgramData(deployed).upgradeAuthority, null);
  const wrongLoader = {
    async getMultipleAccountsInfoAndContext() {
      return {
        context: { slot: 901 },
        value: [
          { data: programData, owner: D, executable: true },
          { data: deployed, owner: C.UPGRADEABLE_LOADER, executable: false },
        ],
      };
    },
  };
  await assert.rejects(() => C.readProgramDeployment(wrongLoader), /wrong loader owner/);
  assert.match(inspectionJson({ notice: DEVNET_NOTICE, slot: 491787400n }), /"slot": "491787400"/);
  assert.match(inspectionJson({ notice: DEVNET_NOTICE }), /DEVNET/);
});
