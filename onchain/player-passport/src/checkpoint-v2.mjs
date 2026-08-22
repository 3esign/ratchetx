import { createHash } from 'node:crypto';
import { canonicalSnapshot, fixedUnsigned, normalizeHash } from './model.mjs';

export const CHECKPOINT_SCHEMA = 'ratchet-passport-checkpoint-v2';
export const ZERO_HASH = '0'.repeat(64);

const MONOTONIC = Object.freeze([
  'lifetimeXp', 'bestStreak', 'shots', 'podiumWins', 'epochDay', 'checkpointUnix',
]);

function requiredText(value, field) {
  const text = String(value || '');
  if (!text || text.length > 96) throw new TypeError(`${field} is required`);
  return text;
}
const digest = value => createHash('sha256').update(value).digest('hex');

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
  const body = canonicalCheckpointBody(input);
  return digest(`RATCHET_PLAYER_PASSPORT_V2\0${JSON.stringify(body)}`);
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
      if (BigInt(next.snapshot[field]) < BigInt(prior.snapshot[field]))
        errors.push(`${field} cannot decrease`);
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
    ['ratchet.epoch_day', checkpoint.snapshot.epochDay],
    ['ratchet.checkpoint_unix', checkpoint.snapshot.checkpointUnix],
    ['ratchet.checkpoint_hash', checkpoint.checkpointHash],
  ]);
}
