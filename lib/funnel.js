const { getJSON, setJSON } = require('./kv.js');

const MILESTONES = [
  'invite_seen', 'demo_created', 'shot_sealed', 'settlement_scored',
  'gauntlet_complete', 'x402_quoted', 'x402_paid', 'ranked_registered'
];

async function recordMilestone(inviteId, milestone, metadata = {}) {
  if (!MILESTONES.includes(milestone)) throw new Error(`Unknown milestone: ${milestone}`);
  if (!inviteId) return;

  const key = `funnel:${inviteId}`;
  const funnel = (await getJSON(key)) || { inviteId, history: [] };
  
  // Idempotency check: don't record if this specific milestone + reference is already present
  const ref = metadata.shotId || metadata.runId || metadata.tx || '';
  const exists = funnel.history.find(m => m.milestone === milestone && (m.ref === ref || !ref));
  if (exists) return;

  funnel.history.push({
    milestone,
    ref,
    ts: Date.now(),
    ...metadata
  });
  
  await setJSON(key, funnel);
  
  // Also append to a daily root log
  const day = new Date().toISOString().split('T')[0];
  const dailyKey = `funnel_daily:${day}`;
  const daily = (await getJSON(dailyKey)) || [];
  daily.push({ inviteId, milestone, ref, ts: Date.now() });
  await setJSON(dailyKey, daily);
}

module.exports = {
  MILESTONES,
  recordMilestone
};
