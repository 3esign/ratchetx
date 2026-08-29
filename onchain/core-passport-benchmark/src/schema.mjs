import { createHash } from 'node:crypto';

export const SCHEMA = 'ratchet-core-passport-v1';
export const NAME = 'RATCHET Player Passport';
export const URI = 'https://ratchetx.xyz/token/player-passport.json';

const UINT_FIELDS = ['sequence', 'lifetimeXp', 'bestStreak', 'shots', 'podiumWins', 'burned', 'epochDay', 'checkpointUnix', 'logIndex'];
const HASH_FIELDS = ['previousCheckpointHash', 'checkpointHash', 'logHead', 'stateRoot'];

function uint(value, field) {
  const parsed = BigInt(value ?? 0);
  if (parsed < 0n) throw new RangeError(`${field} must be non-negative`);
  return parsed.toString();
}

function hash(value, field) {
  const text = String(value ?? '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(text)) throw new TypeError(`${field} must be 64 lowercase hex characters`);
  return text;
}

export function canonicalPassportState(input = {}) {
  if (!input.player) throw new TypeError('player is required');
  const state = { schema: SCHEMA, player: String(input.player) };
  for (const field of UINT_FIELDS) state[field] = uint(input[field], field);
  for (const field of HASH_FIELDS) state[field] = hash(input[field], field);
  return Object.freeze(state);
}

export function encodePassportState(input) {
  return new TextEncoder().encode(JSON.stringify(canonicalPassportState(input)));
}

export function digestPassportState(input) {
  return createHash('sha256').update(encodePassportState(input)).digest('hex');
}

export function authorityMap({ player, stateAuthority } = {}) {
  if (!player || !stateAuthority) throw new TypeError('player and stateAuthority are required');
  return Object.freeze({
    owner: String(player),
    assetUpdateAuthority: String(player),
    appDataDataAuthority: String(stateAuthority),
    appDataPluginAuthority: String(player),
    transferPolicy: 'FreezeDelegate owned by player; frozen after creation',
    recovery: 'replace stateAuthority only through player-approved plugin authority action',
  });
}

export function validateTransition(previous, next) {
  const before = canonicalPassportState(previous);
  const after = canonicalPassportState(next);
  if (after.player !== before.player) throw new Error('player is immutable');
  if (BigInt(after.sequence) !== BigInt(before.sequence) + 1n) throw new Error('sequence must increase by exactly one');
  if (after.previousCheckpointHash !== before.checkpointHash) throw new Error('previous checkpoint mismatch');
  for (const field of ['lifetimeXp', 'bestStreak', 'shots', 'podiumWins', 'burned', 'epochDay', 'checkpointUnix', 'logIndex']) {
    if (BigInt(after[field]) < BigInt(before[field])) throw new Error(`${field} cannot decrease`);
  }
  if (after.logHead === before.logHead) throw new Error('log head must advance');
  return after;
}
