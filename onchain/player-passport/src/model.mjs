import { createHash } from 'node:crypto';

export const PASSPORT_SCHEMA = 'ratchet-passport-v1';
export const PASSPORT_NAME = 'RATCHET Player Passport';
export const PASSPORT_SYMBOL = 'RPX';
export const PROOF_URL = 'https://ratchetx.xyz/api/proof';

const WIDTHS = Object.freeze({
  lifetimeXp: 20,
  bestStreak: 10,
  shots: 20,
  podiumWins: 10,
  epochDay: 10,
  checkpointUnix: 10,
});

function asNonNegativeBigInt(value, field) {
  let parsed;
  try {
    parsed = BigInt(value);
  } catch {
    throw new TypeError(`${field} must be an integer`);
  }
  if (parsed < 0n) throw new RangeError(`${field} must be non-negative`);
  return parsed;
}

export function fixedUnsigned(value, width, field = 'value') {
  const text = asNonNegativeBigInt(value, field).toString();
  if (text.length > width) throw new RangeError(`${field} exceeds ${width} digits`);
  return text.padStart(width, '0');
}

export function normalizeHash(value) {
  const hash = String(value).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    throw new TypeError('checkpointHash must be 64 lowercase hexadecimal characters');
  }
  return hash;
}

export function canonicalSnapshot(input = {}) {
  return Object.freeze({
    lifetimeXp: fixedUnsigned(input.lifetimeXp ?? 0, WIDTHS.lifetimeXp, 'lifetimeXp'),
    bestStreak: fixedUnsigned(input.bestStreak ?? 0, WIDTHS.bestStreak, 'bestStreak'),
    shots: fixedUnsigned(input.shots ?? 0, WIDTHS.shots, 'shots'),
    podiumWins: fixedUnsigned(input.podiumWins ?? 0, WIDTHS.podiumWins, 'podiumWins'),
    epochDay: fixedUnsigned(input.epochDay ?? 0, WIDTHS.epochDay, 'epochDay'),
    checkpointUnix: fixedUnsigned(input.checkpointUnix ?? 0, WIDTHS.checkpointUnix, 'checkpointUnix'),
  });
}

export function hashSnapshot(player, snapshot) {
  const payload = JSON.stringify({ player: String(player), ...canonicalSnapshot(snapshot) });
  return createHash('sha256').update(payload).digest('hex');
}

export function buildPassportFields({ player, checkpoint = {}, checkpointHash } = {}) {
  if (!player || typeof player !== 'string') throw new TypeError('player address is required');
  const snapshot = canonicalSnapshot(checkpoint);
  const digest = checkpointHash ? normalizeHash(checkpointHash) : hashSnapshot(player, snapshot);
  return new Map([
    ['ratchet.schema', PASSPORT_SCHEMA],
    ['ratchet.player', player],
    ['ratchet.lifetime_xp', snapshot.lifetimeXp],
    ['ratchet.best_streak', snapshot.bestStreak],
    ['ratchet.shots', snapshot.shots],
    ['ratchet.podium_wins', snapshot.podiumWins],
    ['ratchet.epoch_day', snapshot.epochDay],
    ['ratchet.checkpoint_unix', snapshot.checkpointUnix],
    ['ratchet.checkpoint_hash', digest],
    ['ratchet.proof', PROOF_URL],
  ]);
}

export function checkpointUpdates({ player, checkpoint = {}, checkpointHash } = {}) {
  const fields = buildPassportFields({ player, checkpoint, checkpointHash });
  const mutableKeys = [
    'ratchet.lifetime_xp',
    'ratchet.best_streak',
    'ratchet.shots',
    'ratchet.podium_wins',
    'ratchet.epoch_day',
    'ratchet.checkpoint_unix',
    'ratchet.checkpoint_hash',
  ];
  return mutableKeys.map(key => Object.freeze({ key, value: fields.get(key) }));
}

export function shouldCheckpoint({ previous, next, nowUnix, maxAgeSeconds = 86_400 } = {}) {
  if (!previous) return Object.freeze({ yes: true, reason: 'initial' });
  const before = canonicalSnapshot(previous);
  const after = canonicalSnapshot(next);
  if (before.epochDay !== after.epochDay) return Object.freeze({ yes: true, reason: 'daily-rollover' });
  if (before.podiumWins !== after.podiumWins) return Object.freeze({ yes: true, reason: 'podium-milestone' });
  if (before.bestStreak !== after.bestStreak) return Object.freeze({ yes: true, reason: 'streak-milestone' });
  const age = asNonNegativeBigInt(nowUnix ?? next?.checkpointUnix ?? 0, 'nowUnix') - BigInt(before.checkpointUnix);
  if (age >= BigInt(maxAgeSeconds)) return Object.freeze({ yes: true, reason: 'max-age' });
  return Object.freeze({ yes: false, reason: 'no-durable-change' });
}

export { WIDTHS };
