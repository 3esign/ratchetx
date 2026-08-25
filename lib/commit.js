const crypto = require('node:crypto');

function normalizeVersion(value) {
  const version = Number(value || 1);
  return Number.isFinite(version) && version >= 2 ? 2 : 1;
}

function preimage({ version = 1, wallet, shotId, side, salt }) {
  const v = normalizeVersion(version);
  if (!side || !salt) return null;
  if (v >= 2) {
    if (!wallet || !shotId) return null;
    return `RATCHET|v2|${wallet}|${shotId}|${side}|${salt}`;
  }
  return `${side}|${salt}`;
}

function hashCommit(input) {
  const payload = preimage(input);
  return payload == null ? null
    : crypto.createHash('sha256').update(payload).digest('hex');
}

function verifyCommit(input) {
  const recomputed = hashCommit(input || {});
  return {
    version: normalizeVersion(input && input.version),
    preimage: preimage(input || {}),
    recomputed,
    matches: !!(recomputed && input && input.commit && recomputed === input.commit),
  };
}

// Compatibility aliases for v3-side callers (same hash logic, one source of truth).
const sha = s => crypto.createHash('sha256').update(s).digest('hex');

function recomputeCommitment({ side, salt, wallet, shotId, commitVersion }) {
  return hashCommit({ version: commitVersion, wallet, shotId, side, salt });
}

function verifyCommitment({ commit, side, salt, wallet, shotId, commitVersion }) {
  if (!commit) return false;
  const recomputed = recomputeCommitment({ side, salt, wallet, shotId, commitVersion });
  return !!recomputed && recomputed === commit;
}

module.exports = { normalizeVersion, preimage, hashCommit, verifyCommit,
  recomputeCommitment, verifyCommitment, sha };
