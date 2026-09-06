// The delegated path — the four instructions that let an agent play for a player.
//
// This is the one client path where a mistake means an agent spending somebody
// else's credits, so every account list is compared against the map PARSED FROM
// THE RUST rather than against what I remember writing.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  grantDelegateIx, revokeDelegateIx, sealForwardDelegatedIx, revealDelegatedIx,
  delegateGrantPda, grantAllows, discriminator, DELEGATE_GRANT_SEED, CORE_SCHEMA_SEED,
} from '../onchain/ratchet-core-g2/client/delegate.mjs';
import { INSTRUCTION_ACCOUNTS } from '../onchain/ratchet-core-g2/client/client-v2.mjs';
import web3 from '@solana/web3.js';

let checks = 0;
const ok = (c, msg) => { checks += 1; assert.ok(c, msg); };
const eq = (a, b, msg) => { checks += 1; assert.equal(a, b, msg); };

const CORE = 'ANVGVtDrECeyQkS56UZ9ZiWCUxk2JWEVNJioFW8JEwbL';
const key = n => web3.Keypair.generate().publicKey.toBase58();
const PLAYER = key(), DELEGATE = key(), ECONOMY = key(), RULESET = key();
const LEDGER = key(), DAY = key(), SHARD = key(), PAGE = key(), SHOT = key();
const NEED_A = key(), NEED_B = key(), WORK = key(), REFUND = key();
const H32 = 'ab'.repeat(32);
// 16 BYTES, which is 32 hex characters. I wrote repeat(8) first and the builder
// refused it with "grantId must be 16 bytes, got 8" - the right refusal, and the
// reason every fixed-width field in that file is checked rather than trusted.
const GRANT_ID = 'cd'.repeat(16);
const SALT = 'ef'.repeat(32);

const grantArgs = {
  programId: CORE, player: PLAYER, delegate: DELEGATE, economy: ECONOMY, ruleset: RULESET,
  economyHash: H32, rulesetHash: H32, grantId: GRANT_ID,
  maxStake: 500, maxGrossStake: 5000, maxShots: 20, minIntervalSeconds: 60, expiresAtTs: 1788700000,
};

// ---- the account lists must equal what the Rust declares --------------------
// Names, order, signer and writable flags. A client that gets an order right and
// a flag wrong produces a transaction that fails for a reason nobody can read.
const rust = INSTRUCTION_ACCOUNTS['ratchet-core-g2'];
const shape = ix => ix.keys.map(k => `${k.isSigner ? 'S' : '-'}${k.isWritable ? 'W' : '-'}`).join(' ');
const declared = name => rust[name].accounts.map(a => `${a.signer ? 'S' : '-'}${a.mut ? 'W' : '-'}`).join(' ');
const count = name => rust[name].accounts.length;

{
  const ix = grantDelegateIx(web3, grantArgs);
  eq(ix.keys.length, count('grant_delegate'), 'grant_delegate has the wrong number of accounts');
  eq(shape(ix), declared('grant_delegate'), 'grant_delegate signer/writable flags disagree with the program');
  ok(ix.keys[0].isSigner && ix.keys[0].pubkey.toBase58() === PLAYER,
    'THE PLAYER IS NOT THE SIGNER OF THEIR OWN GRANT. That is the whole safety property of this path.');
  ok(ix.data.subarray(0, 8).equals(discriminator('grant_delegate')), 'the discriminator is not sha256("global:grant_delegate")[0..8]');
  eq(ix.data.length, 8 + 16 + 8 + 8 + 2 + 4 + 8, 'the grant argument encoding is the wrong length');
}
{
  const ix = revokeDelegateIx(web3, { programId: CORE, player: PLAYER, economy: ECONOMY, ruleset: RULESET, grantAddress: key() });
  eq(ix.keys.length, count('revoke_delegate'), 'revoke_delegate has the wrong number of accounts');
  eq(shape(ix), declared('revoke_delegate'), 'revoke_delegate flags disagree with the program');
  eq(ix.data.length, 8, 'revoke takes no arguments, so its data should be the discriminator alone');
}
{
  const ix = sealForwardDelegatedIx(web3, {
    programId: CORE, delegate: DELEGATE, economy: ECONOMY, ruleset: RULESET, grantAddress: key(),
    ledger: LEDGER, playerDay: DAY, rankShard: SHARD, historyPage: PAGE, shot: SHOT,
    entryNeed: NEED_A, exitNeed: NEED_B,
    nonce: 0, commit: H32, stake: 300, entryTargetTs: 1788653100, scoreDay: 20702,
  });
  eq(ix.keys.length, count('seal_forward_delegated'), 'seal_forward_delegated has the wrong number of accounts');
  eq(shape(ix), declared('seal_forward_delegated'), 'seal_forward_delegated flags disagree with the program');
  ok(ix.keys[0].isSigner && ix.keys[0].pubkey.toBase58() === DELEGATE,
    'the delegate is not the signer of the delegated seal');
  ok(!ix.keys.some(k => k.pubkey.toBase58() === PLAYER),
    'THE PLAYER APPEARS IN A DELEGATED SEAL. They are named inside the grant; putting them here would '
    + 'imply they must be present, which is the opposite of what this path is for.');
}
{
  const ix = revealDelegatedIx(web3, {
    programId: CORE, delegate: DELEGATE, economy: ECONOMY, ruleset: RULESET, ledger: LEDGER,
    shot: SHOT, playerDay: DAY, rankShard: SHARD, historyPage: PAGE, workPage: WORK,
    rentRefund: REFUND, side: 0, pBps: 6500, salt: SALT,
  });
  eq(ix.keys.length, count('reveal_delegated'), 'reveal_delegated has the wrong number of accounts');
  eq(shape(ix), declared('reveal_delegated'), 'reveal_delegated flags disagree with the program');
  eq(ix.data.length, 8 + 1 + 2 + 32, 'the reveal argument encoding is the wrong length');
}

// ---- the bounds are required, never defaulted -------------------------------
for (const missing of ['maxStake', 'maxGrossStake', 'maxShots', 'minIntervalSeconds', 'expiresAtTs']) {
  checks += 1;
  assert.throws(() => grantDelegateIx(web3, { ...grantArgs, [missing]: undefined }), new RegExp(missing),
    `A GRANT WAS BUILT WITH NO ${missing}. A defaulted bound is a bound nobody chose, on the one instruction `
    + 'where that means an agent spending credits the player did not agree to.');
}

// ---- the PDA carries the grant id, and every seed changes the address -------
{
  const [a] = delegateGrantPda(web3, grantArgs);
  for (const [field, value] of [['economyHash', 'cd'.repeat(32)], ['rulesetHash', 'cd'.repeat(32)],
                                ['player', key()], ['delegate', key()], ['grantId', 'aa'.repeat(16)]]) {
    const [b] = delegateGrantPda(web3, { ...grantArgs, [field]: value });
    ok(!a.equals(b), `changing ${field} did not change the grant address, so two grants would collide`);
  }
  // Same inputs, same address — or nobody can find their own grant twice.
  const [again] = delegateGrantPda(web3, grantArgs);
  ok(a.equals(again), 'the grant address is not deterministic');
}

// ---- refusing before the chain does, in words a person can read -------------
const grant = {
  revoked: 0, expiresAtTs: 2000000000, maxStake: 500, maxGrossStake: 5000,
  grossStakeUsed: 0, maxShots: 20, shotsUsed: 0, minIntervalSeconds: 60, lastSealTs: 0,
};
ok(grantAllows(grant, { stake: 300, nowTs: 1788653100 }).ok, 'a shot inside every bound was refused');
const refused = (patch, match, msg) => {
  const r = grantAllows({ ...grant, ...patch }, { stake: 300, nowTs: 1788653100 });
  checks += 1; assert.equal(r.ok, false, msg);
  checks += 1; assert.ok(r.problems.some(p => match.test(p)), `wrong reason: ${r.problems.join(' | ')}`);
};
refused({ revoked: 1 }, /revoked/, 'a revoked grant still allowed a shot');
refused({ expiresAtTs: 1788653000 }, /expired/, 'an expired grant still allowed a shot');
refused({ maxStake: 100 }, /per-shot cap/, 'a stake over the per-shot cap was allowed');
refused({ grossStakeUsed: 4900 }, /total staked/, 'a shot past the total the player authorised was allowed');
refused({ shotsUsed: 20 }, /no shots left/, 'a grant with no shots left still allowed one');
refused({ lastSealTs: 1788653090 }, /too soon/, 'the minimum interval between shots was ignored');
{
  const r = grantAllows(null, { stake: 1 });
  checks += 1; assert.equal(r.ok, false, 'a MISSING grant was treated as permission');
  checks += 1; assert.ok(/unread grant is not a valid one/.test(r.problems[0]), 'the missing-grant reason is wrong');
}

console.log(`ok - the player signs the grant, the delegate signs the shot, and no bound is ever defaulted (${checks} checks)`);
