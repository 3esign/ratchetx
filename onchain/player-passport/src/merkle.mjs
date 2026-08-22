import { createHash } from 'node:crypto';
import { fixedUnsigned } from './model.mjs';

const LEAF_DOMAIN = 'RATCHET_PLAYER_ACHIEVEMENT_LEAF_V1\0';
const NODE_DOMAIN = 'RATCHET_PLAYER_ACHIEVEMENT_NODE_V1\0';
export const EMPTY_ROOT = createHash('sha256').update(`${NODE_DOMAIN}empty`).digest('hex');

const sha = value => createHash('sha256').update(value).digest();
function fromHex(value) {
  const text = String(value).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(text)) throw new TypeError('Merkle hash must be 64 hexadecimal characters');
  return Buffer.from(text, 'hex');
}

export function canonicalPlayerLeaf(input = {}) {
  const player = String(input.player || '');
  if (!player || player.length > 96) throw new TypeError('player is required');
  return Object.freeze({
    player,
    lifetimeXp: fixedUnsigned(input.lifetimeXp ?? 0, 20, 'lifetimeXp'),
    bestStreak: fixedUnsigned(input.bestStreak ?? 0, 10, 'bestStreak'),
    shots: fixedUnsigned(input.shots ?? 0, 20, 'shots'),
    podiumWins: fixedUnsigned(input.podiumWins ?? 0, 10, 'podiumWins'),
    burned: fixedUnsigned(input.burned ?? 0, 20, 'burned'),
  });
}

export function hashPlayerLeaf(input) {
  return sha(`${LEAF_DOMAIN}${JSON.stringify(canonicalPlayerLeaf(input))}`).toString('hex');
}
function hashNode(left, right) { return sha(Buffer.concat([Buffer.from(NODE_DOMAIN), left, right])); }

export function buildAchievementTree(records = []) {
  const leaves = records.map(canonicalPlayerLeaf).sort((a, b) => a.player.localeCompare(b.player));
  for (let i = 1; i < leaves.length; i++)
    if (leaves[i - 1].player === leaves[i].player) throw new Error(`duplicate player ${leaves[i].player}`);
  if (!leaves.length) return Object.freeze({ root: EMPTY_ROOT, leaves, proofs: new Map() });
  const levels = [leaves.map(item => fromHex(hashPlayerLeaf(item)))];
  while (levels.at(-1).length > 1) {
    const current = levels.at(-1), next = [];
    for (let i = 0; i < current.length; i += 2) next.push(hashNode(current[i], current[i + 1] || current[i]));
    levels.push(next);
  }
  const proofs = new Map();
  for (let leafIndex = 0; leafIndex < leaves.length; leafIndex++) {
    let index = leafIndex; const steps = [];
    for (let level = 0; level < levels.length - 1; level++) {
      const row = levels[level], isRight = index % 2 === 1;
      const siblingIndex = isRight ? index - 1 : Math.min(index + 1, row.length - 1);
      steps.push(Object.freeze({ side: isRight ? 'left' : 'right', hash: row[siblingIndex].toString('hex') }));
      index = Math.floor(index / 2);
    }
    proofs.set(leaves[leafIndex].player, Object.freeze(steps));
  }
  return Object.freeze({ root: levels.at(-1)[0].toString('hex'), leaves, proofs });
}

export function verifyAchievementProof(record, proof, root) {
  try {
    let hash = fromHex(hashPlayerLeaf(record));
    for (const step of proof || []) {
      const sibling = fromHex(step.hash);
      if (step.side === 'left') hash = hashNode(sibling, hash);
      else if (step.side === 'right') hash = hashNode(hash, sibling);
      else return false;
    }
    return hash.equals(fromHex(root));
  } catch { return false; }
}
