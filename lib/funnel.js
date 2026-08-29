const crypto = require('node:crypto');
const { getJSONStrict, setJSON, setJSONEx, acquireLease, releaseLease, hincr } = require('./kv.js');

const INVITE_TTL_SECONDS = 30 * 24 * 60 * 60;
const INVITE_ID_RE = /^[a-f0-9]{32}$/;
const INVITE_HASH_RE = /^[a-f0-9]{64}$/;

const MILESTONES = [
  'invite_seen', 'demo_created', 'shot_sealed', 'settlement_scored',
  'gauntlet_complete', 'x402_quoted', 'x402_paid', 'ranked_registered'
];

async function recordMilestone(inviteId, milestone, metadata = {}) {
  if (!MILESTONES.includes(milestone)) throw new Error(`Unknown milestone: ${milestone}`);
  if (!INVITE_HASH_RE.test(String(inviteId || ''))) throw new Error('Invalid invite hash');

  const key = `funnel:${inviteId}`;
  const lockKey = `lock:${key}`;
  const lease = await acquireLease(lockKey, 10);
  if (!lease) throw new Error('Invite funnel is updating; retry');
  try {
    const funnel = (await getJSONStrict(key)) || { inviteId, history: [] };
    const ref = String(metadata.shotId || metadata.runId || metadata.tx || metadata.handle || '');
    const exists = funnel.history.find(m => m.milestone === milestone && m.ref === ref);
    if (exists) return false;

    const event = { milestone, ref, ts: Date.now(), ...metadata };
    funnel.history.push(event);
    await setJSON(key, funnel);
    const day = new Date(event.ts).toISOString().split('T')[0];
    await hincr(`funnel_daily:${day}`, milestone, 1);
    return true;
  } finally {
    await releaseLease(lockKey, lease).catch(() => {});
  }
}

function hashInvite(inviteId) {
  const id = String(inviteId || '').trim().toLowerCase();
  if (!INVITE_ID_RE.test(id)) throw new Error('invite must be the 128-bit hex ID returned by ratchet_invite');
  return crypto.createHash('sha256').update(id).digest('hex');
}

async function issueInvite(inviteId, source = 'agent') {
  const hash = hashInvite(inviteId);
  const createdAt = Date.now();
  const exp = createdAt + INVITE_TTL_SECONDS * 1000;
  const record = { createdAt, exp, source: String(source || 'agent').slice(0, 80), gauntletId: 'first-contact-001' };
  await setJSONEx(`inv:${hash}`, record, INVITE_TTL_SECONDS);
  await recordMilestone(hash, 'invite_seen', { source: record.source });
  return { hash, record };
}

async function resolveInvite(inviteId) {
  const hash = hashInvite(inviteId);
  const record = await getJSONStrict(`inv:${hash}`);
  if (!record || !Number.isFinite(Number(record.exp)) || Number(record.exp) <= Date.now()) {
    throw new Error('invite is missing or expired; call ratchet_invite for a fresh one');
  }
  return { hash, record };
}

async function bindDemoInvite(handle, inviteHash, expiresAt) {
  const ttl = Math.max(1, Math.floor((Number(expiresAt) - Date.now()) / 1000));
  await setJSONEx(`demo:invite:${handle}`, { inviteHash, expiresAt:Number(expiresAt) }, ttl);
}

async function inviteForDemo(handle) {
  const row = await getJSONStrict(`demo:invite:${handle}`);
  return row && INVITE_HASH_RE.test(String(row.inviteHash || '')) && Number(row.expiresAt) > Date.now()
    ? row.inviteHash : null;
}

module.exports = {
  MILESTONES,
  INVITE_TTL_SECONDS,
  hashInvite,
  issueInvite,
  resolveInvite,
  bindDemoInvite,
  inviteForDemo,
  recordMilestone
};
