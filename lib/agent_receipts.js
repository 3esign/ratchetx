'use strict';
const crypto = require('node:crypto');
const { canon } = require('./canon.js');
const { getJSONStrict, getManyJSON, setJSON, acquireLease, releaseLease } = require('./kv.js');

const keyFor = shotId => `agentrun:${shotId}`;
function receiptDigest(payload) {
  return 'sha256:' + crypto.createHash('sha256').update(canon(payload)).digest('hex');
}

async function saveAgentRun({ shotId, receipt, chain }) {
  const id = String(shotId || '').trim();
  if (!/^[A-Za-z0-9:_-]{1,80}$/.test(id)) throw new Error('invalid AgentRun shot id');
  const payload = { version:'agentrun-v1', shotId:id, receipt, chain:chain || null };
  const digest = receiptDigest(payload);
  const key = keyFor(id), lock = `lock:${key}`;
  const lease = await acquireLease(lock, 20);
  if (!lease) throw new Error('AgentRun receipt is being updated');
  try {
    const prior = await getJSONStrict(key);
    if (prior && prior.digest === digest) return prior;
    const record = { ...payload, digest, verifiedAt:Date.now(),
      ...(prior && prior.digest ? { supersedes:prior.digest } : {}) };
    await setJSON(key, record);
    return record;
  } finally {
    try { await releaseLease(lock, lease); } catch {}
  }
}

async function getAgentRun(shotId) {
  return getJSONStrict(keyFor(String(shotId || '')));
}

async function getAgentRuns(shotIds) {
  const ids = [...new Set((shotIds || []).filter(id => /^[A-Za-z0-9:_-]{1,80}$/.test(String(id))))];
  const rows = await getManyJSON(ids.map(keyFor));
  return rows.filter(Boolean);
}

module.exports = { saveAgentRun, getAgentRun, getAgentRuns, receiptDigest, keyFor };
