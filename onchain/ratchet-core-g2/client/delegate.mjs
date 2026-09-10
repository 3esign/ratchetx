// The delegated path: the four instructions that let an agent play on a player's
// behalf, within bounds the PROGRAM enforces.
//
// docs/BANKR_ON_CHAIN_DELEGATE.md is the argument. This is the code. It exists
// because the client knew thirty-five instructions and not these four, which is
// why the Bankr lane looked like a server problem for a month.
//
// Kept in its own file rather than added to client-v2.mjs: that file is 65KB and
// several people are in it tonight, and this path deserves to be reviewable on
// its own - it is the one where a mistake means an agent spending somebody
// else's credits.
import { createHash } from 'node:crypto';

export const DELEGATE_GRANT_SEED = Buffer.from('delegate_grant', 'latin1');
export const CORE_SCHEMA_VERSION = 2;
export const CORE_SCHEMA_SEED = Buffer.from([CORE_SCHEMA_VERSION & 0xff, CORE_SCHEMA_VERSION >> 8]);

// Anchor: sha256("global:" + name)[0..8].
export const discriminator = name =>
  createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);

const u16 = v => { const b = Buffer.alloc(2); b.writeUInt16LE(check(v, 0, 0xffff, 'u16')); return b; };
const u32 = v => { const b = Buffer.alloc(4); b.writeUInt32LE(check(v, 0, 0xffff_ffff, 'u32')); return b; };
const u64 = v => { const b = Buffer.alloc(8); b.writeBigUInt64LE(big(v, 0n, 2n ** 64n - 1n, 'u64')); return b; };
const i64 = v => { const b = Buffer.alloc(8); b.writeBigInt64LE(big(v, -(2n ** 63n), 2n ** 63n - 1n, 'i64')); return b; };
const u8 = v => Buffer.from([check(v, 0, 255, 'u8')]);

function check(v, lo, hi, what) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < lo || n > hi) throw new RangeError(`${what} out of range: ${v}`);
  return n;
}
function big(v, lo, hi, what) {
  const n = typeof v === 'bigint' ? v : BigInt(v);
  if (n < lo || n > hi) throw new RangeError(`${what} out of range: ${v}`);
  return n;
}
function bytes(v, len, what) {
  const b = typeof v === 'string' ? Buffer.from(v.replace(/^0x/, ''), 'hex') : Buffer.from(v);
  if (b.length !== len) throw new RangeError(`${what} must be ${len} bytes, got ${b.length}`);
  return b;
}

// THE PDA. Seeds, in order, from state.rs:1959. The GRANT ID is in there, which
// is what makes a second grant to the same delegate possible without disturbing
// the first - and what makes a stale grant_id silently derive an address that
// holds nothing.
export function delegateGrantPda(web3, { programId, economyHash, rulesetHash, player, delegate, grantId }) {
  return web3.PublicKey.findProgramAddressSync([
    DELEGATE_GRANT_SEED,
    CORE_SCHEMA_SEED,
    bytes(economyHash, 32, 'economyHash'),
    bytes(rulesetHash, 32, 'rulesetHash'),
    new web3.PublicKey(player).toBuffer(),
    new web3.PublicKey(delegate).toBuffer(),
    bytes(grantId, 16, 'grantId'),
  ], new web3.PublicKey(programId));
}

const meta = (pubkey, isSigner = false, isWritable = false) => ({ pubkey, isSigner, isWritable });

// THE ONE HUMAN STEP IN THE WHOLE AGENT PATH. The player signs this, once, from
// their own wallet, and every bound below is enforced by the program on every
// later shot rather than by anything we run.
//
// The bounds are REQUIRED, not defaulted. A grant with a default cap is a grant
// somebody did not choose, and this is the instruction where not choosing means
// an agent spending more of your credits than you meant.
export function grantDelegateIx(web3, {
  programId, player, delegate, economy, ruleset, economyHash, rulesetHash,
  grantId, maxStake, maxGrossStake, maxShots, minIntervalSeconds, expiresAtTs,
}) {
  for (const [name, v] of Object.entries({ maxStake, maxGrossStake, maxShots, minIntervalSeconds, expiresAtTs })) {
    if (v === undefined || v === null) {
      throw new Error(`${name} is required: a delegate grant with a defaulted bound is a bound nobody chose, `
        + 'and this is the instruction where that means an agent spending credits you did not agree to');
    }
  }
  const [grant] = delegateGrantPda(web3, { programId, economyHash, rulesetHash, player, delegate, grantId });
  return new web3.TransactionInstruction({
    programId: new web3.PublicKey(programId),
    keys: [
      meta(new web3.PublicKey(player), true, true),
      meta(new web3.PublicKey(economy)),
      meta(new web3.PublicKey(ruleset)),
      meta(new web3.PublicKey(delegate)),
      meta(grant, false, true),
      meta(web3.SystemProgram.programId),
    ],
    data: Buffer.concat([
      discriminator('grant_delegate'),
      bytes(grantId, 16, 'grantId'),
      u64(maxStake), u64(maxGrossStake), u16(maxShots), u32(minIntervalSeconds), i64(expiresAtTs),
    ]),
  });
}

// Ends it, from the player's wallet, without asking anyone. No arguments: the
// grant is identified by its address, so there is nothing to type wrong.
export function revokeDelegateIx(web3, { programId, player, economy, ruleset, grantAddress }) {
  return new web3.TransactionInstruction({
    programId: new web3.PublicKey(programId),
    keys: [
      meta(new web3.PublicKey(economy)),
      meta(new web3.PublicKey(ruleset)),
      meta(new web3.PublicKey(grantAddress), false, true),
      meta(new web3.PublicKey(player), true),
    ],
    data: discriminator('revoke_delegate'),
  });
}

// The agent's shot. Signed by the DELEGATE; the player does not sign and is not
// even an account here - they are named inside the grant, which is what makes
// this safe to hand to something running on somebody else's infrastructure.
export function sealForwardDelegatedIx(web3, {
  programId, delegate, economy, ruleset, grantAddress,
  ledger, playerDay, rankShard, historyPage, shot, entryNeed, exitNeed,
  entryHold, exitHold, timepinProgram,
  nonce, commit, stake, entryTargetTs, scoreDay,
}) {
  return new web3.TransactionInstruction({
    programId: new web3.PublicKey(programId),
    keys: [
      meta(new web3.PublicKey(delegate), true, true),
      meta(new web3.PublicKey(economy)),
      meta(new web3.PublicKey(ruleset)),
      meta(new web3.PublicKey(grantAddress), false, true),
      meta(new web3.PublicKey(ledger), false, true),
      meta(new web3.PublicKey(playerDay), false, true),
      meta(new web3.PublicKey(rankShard), false, true),
      meta(new web3.PublicKey(historyPage), false, true),
      meta(new web3.PublicKey(shot), false, true),
      // Writable since 2026-09-10: the seal takes a Timepin hold on each target,
      // which moves the Need's open_refs. Those two holds are what let the
      // evidence rent be returned once every game on the target has ended.
      meta(new web3.PublicKey(entryNeed), false, true),
      meta(new web3.PublicKey(exitNeed), false, true),
      meta(new web3.PublicKey(entryHold), false, true),
      meta(new web3.PublicKey(exitHold), false, true),
      meta(new web3.PublicKey(timepinProgram)),
      meta(web3.SystemProgram.programId),
    ],
    data: Buffer.concat([
      discriminator('seal_forward_delegated'),
      u64(nonce), bytes(commit, 32, 'commit'), u64(stake), i64(entryTargetTs), i64(scoreDay),
    ]),
  });
}

// The agent finishes what it started. Same signer, and the salt it reveals must
// be the one behind the commitment it sealed - the program checks that, not us.
export function revealDelegatedIx(web3, {
  programId, delegate, economy, ruleset, ledger, shot, playerDay, rankShard,
  historyPage, workPage, rentRefund, side, pBps, salt,
}) {
  return new web3.TransactionInstruction({
    programId: new web3.PublicKey(programId),
    keys: [
      meta(new web3.PublicKey(economy)),
      meta(new web3.PublicKey(ruleset)),
      meta(new web3.PublicKey(ledger), false, true),
      meta(new web3.PublicKey(shot), false, true),
      meta(new web3.PublicKey(playerDay), false, true),
      meta(new web3.PublicKey(rankShard), false, true),
      meta(new web3.PublicKey(historyPage), false, true),
      meta(new web3.PublicKey(workPage), false, true),
      meta(new web3.PublicKey(delegate), true, true),
      meta(new web3.PublicKey(rentRefund), false, true),
      meta(web3.SystemProgram.programId),
    ],
    data: Buffer.concat([
      discriminator('reveal_delegated'),
      u8(side), u16(pBps), bytes(salt, 32, 'salt'),
    ]),
  });
}

// What the caller should check BEFORE building a delegated seal, so the refusal
// is ours and legible rather than a custom program error number.
export function grantAllows(grant, { stake, nowTs }) {
  const problems = [];
  if (!grant) return { ok: false, problems: ['no grant account was read; an unread grant is not a valid one'] };
  if (Number(grant.revoked) !== 0) problems.push('the grant is revoked');
  if (nowTs !== undefined && Number(grant.expiresAtTs) <= Number(nowTs)) problems.push('the grant has expired');
  if (stake !== undefined && BigInt(stake) > BigInt(grant.maxStake)) {
    problems.push(`stake ${stake} exceeds the per-shot cap of ${grant.maxStake}`);
  }
  if (stake !== undefined && BigInt(grant.grossStakeUsed) + BigInt(stake) > BigInt(grant.maxGrossStake)) {
    problems.push('this shot would exceed the total staked the player authorised');
  }
  if (Number(grant.shotsUsed) >= Number(grant.maxShots)) problems.push('the grant has no shots left');
  if (nowTs !== undefined && Number(grant.lastSealTs) > 0
      && Number(nowTs) - Number(grant.lastSealTs) < Number(grant.minIntervalSeconds)) {
    problems.push(`too soon: the grant requires ${grant.minIntervalSeconds}s between shots`);
  }
  return { ok: problems.length === 0, problems };
}
