import { createHash } from 'node:crypto';
import { address, getAddressEncoder } from '@solana/kit';
import { canonicalSnapshot, fixedUnsigned, normalizeHash } from './model.mjs';

export const CHECKPOINT_SCHEMA = 'ratchet-passport-checkpoint-v2';
export const ZERO_HASH = '0'.repeat(64);

const MONOTONIC = Object.freeze([
  'lifetimeXp', 'bestStreak', 'shots', 'podiumWins', 'burned', 'epochDay', 'checkpointUnix',
]);
const ADDRESS_ENCODER = getAddressEncoder();

function requiredText(value, field) {
  const text = String(value || '');
  if (!text || text.length > 96) throw new TypeError(`${field} is required`);
  return text;
}
function u64le(value, field) {
  const parsed = BigInt(fixedUnsigned(value, 20, field));
  const bytes = Buffer.alloc(8); bytes.writeBigUInt64LE(parsed); return bytes;
}
function i64le(value, field) {
  let parsed;
  try { parsed = BigInt(value); } catch { throw new TypeError(`${field} must be an integer`); }
  if (parsed < 0n || parsed > 9_223_372_036_854_775_807n) throw new RangeError(`${field} is outside i64 range`);
  const bytes = Buffer.alloc(8); bytes.writeBigInt64LE(parsed); return bytes;
}
function pubkeyBytes(value, field) {
  try { return Buffer.from(ADDRESS_ENCODER.encode(address(requiredText(value, field)))); }
  catch { throw new TypeError(`${field} must be a valid Solana address`); }
}
function hashBytes(value, field) {
  try { return Buffer.from(normalizeHash(value), 'hex'); }
  catch { throw new TypeError(`${field} must be a 32-byte hexadecimal hash`); }
}

export function canonicalCheckpointBody(input = {}) {
  return Object.freeze({
    schema: CHECKPOINT_SCHEMA,
    player: requiredText(input.player, 'player'),
    passportMint: requiredText(input.passportMint, 'passportMint'),
    sequence: fixedUnsigned(input.sequence, 20, 'sequence'),
    previousCheckpointHash: normalizeHash(input.previousCheckpointHash ?? ZERO_HASH),
    logIndex: fixedUnsigned(input.logIndex, 20, 'logIndex'),
    logHead: normalizeHash(input.logHead),
    stateRoot: normalizeHash(input.stateRoot),
    snapshot: canonicalSnapshot(input.snapshot),
  });
}

export function hashCheckpointBody(input) {
  const body = canonicalCheckpointBody(input), snapshot = body.snapshot;
  return createHash('sha256').update(Buffer.concat([
    Buffer.from('RATCHET_PLAYER_PASSPORT_V2\0'),
    pubkeyBytes(body.player, 'player'), pubkeyBytes(body.passportMint, 'passportMint'),
    u64le(body.sequence, 'sequence'), hashBytes(body.previousCheckpointHash, 'previousCheckpointHash'),
    u64le(body.logIndex, 'logIndex'), hashBytes(body.logHead, 'logHead'), hashBytes(body.stateRoot, 'stateRoot'),
    u64le(snapshot.lifetimeXp, 'lifetimeXp'), u64le(snapshot.bestStreak, 'bestStreak'),
    u64le(snapshot.shots, 'shots'), u64le(snapshot.podiumWins, 'podiumWins'),
    u64le(snapshot.burned, 'burned'), u64le(snapshot.epochDay, 'epochDay'),
    i64le(snapshot.checkpointUnix, 'checkpointUnix'),
  ])).digest('hex');
}

export function sealCheckpoint(input) {
  const body = canonicalCheckpointBody(input);
  return Object.freeze({ ...body, checkpointHash: hashCheckpointBody(body) });
}

export function verifyCheckpoint(checkpoint) {
  try { return normalizeHash(checkpoint?.checkpointHash) === hashCheckpointBody(checkpoint); }
  catch { return false; }
}

export function validateCheckpointTransition(previous, candidate, { nowUnix, maxFutureSeconds = 300 } = {}) {
  const errors = [];
  let next;
  try {
    next = sealCheckpoint(candidate);
    if (candidate?.checkpointHash && normalizeHash(candidate.checkpointHash) !== next.checkpointHash)
      errors.push('checkpoint hash mismatch');
  } catch (error) {
    return Object.freeze({ ok: false, errors: [error.message], checkpoint: null });
  }

  const nextSeq = BigInt(next.sequence), nextLog = BigInt(next.logIndex);
  if (!previous) {
    if (nextSeq !== 1n) errors.push('initial sequence must be 1');
    if (next.previousCheckpointHash !== ZERO_HASH)
      errors.push('initial previous checkpoint hash must be zero');
  } else {
    let prior;
    try { prior = sealCheckpoint(previous); }
    catch (error) {
      return Object.freeze({ ok: false, errors: [`invalid previous checkpoint: ${error.message}`], checkpoint: null });
    }
    if (previous.checkpointHash && normalizeHash(previous.checkpointHash) !== prior.checkpointHash)
      errors.push('previous checkpoint hash mismatch');
    if (next.player !== prior.player) errors.push('player is immutable');
    if (next.passportMint !== prior.passportMint) errors.push('passport mint is immutable');
    if (nextSeq !== BigInt(prior.sequence) + 1n) errors.push('sequence must increment by one');
    if (next.previousCheckpointHash !== prior.checkpointHash) errors.push('previous checkpoint link mismatch');
    if (nextLog <= BigInt(prior.logIndex)) errors.push('log index must increase');
    if (next.logHead === prior.logHead) errors.push('log head must advance');
    for (const field of MONOTONIC) {
      if (BigInt(next.snapshot[field]) < BigInt(prior.snapshot[field])) errors.push(`${field} cannot decrease`);
    }
  }
  const timestamp = BigInt(next.snapshot.checkpointUnix);
  if (nowUnix != null && timestamp > BigInt(nowUnix) + BigInt(maxFutureSeconds))
    errors.push('checkpoint timestamp is too far in the future');
  if (nextLog < 1n) errors.push('log index must be positive');
  return Object.freeze({ ok: errors.length === 0, errors, checkpoint: next });
}

export function checkpointMetadataV2(input) {
  const checkpoint = sealCheckpoint(input);
  return new Map([
    ['ratchet.schema', CHECKPOINT_SCHEMA],
    ['ratchet.player', checkpoint.player],
    ['ratchet.checkpoint_seq', checkpoint.sequence],
    ['ratchet.log_index', checkpoint.logIndex],
    ['ratchet.log_head', checkpoint.logHead],
    ['ratchet.state_root', checkpoint.stateRoot],
    ['ratchet.prev_checkpoint_hash', checkpoint.previousCheckpointHash],
    ['ratchet.lifetime_xp', checkpoint.snapshot.lifetimeXp],
    ['ratchet.best_streak', checkpoint.snapshot.bestStreak],
    ['ratchet.shots', checkpoint.snapshot.shots],
    ['ratchet.podium_wins', checkpoint.snapshot.podiumWins],
    ['ratchet.burned', checkpoint.snapshot.burned],
    ['ratchet.epoch_day', checkpoint.snapshot.epochDay],
    ['ratchet.checkpoint_unix', checkpoint.snapshot.checkpointUnix],
    ['ratchet.checkpoint_hash', checkpoint.checkpointHash],
  ]);
}